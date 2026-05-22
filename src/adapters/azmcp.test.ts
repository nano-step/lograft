import { describe, it, expect } from "@jest/globals";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AzmcpAdapter,
  AZMCP_NPM_SPEC,
  AZMCP_MIN_VERSION_MAJOR,
  type SpawnLike,
  type SubprocessHandle,
} from "./azmcp.js";

function fakeSpawn(map: Record<string, { code: number; stdout: string; stderr?: string }>): SpawnLike {
  return (command, args) => {
    const key = `${command} ${args.join(" ")}`;
    const found = Object.entries(map).find(([k]) => key.startsWith(k));
    const spec = found ? found[1] : { code: 127, stdout: "", stderr: "not found" };
    const handle: SubprocessHandle = {
      stdoutText: Promise.resolve(spec.stdout),
      stderrText: Promise.resolve(spec.stderr ?? ""),
      done: Promise.resolve({ code: spec.code }),
    };
    return handle;
  };
}

describe("AzmcpAdapter — capability + identity", () => {
  it("declares live-only capability", () => {
    const a = new AzmcpAdapter();
    expect(a.id).toBe("azmcp");
    expect(a.capabilities.live).toBe(true);
    expect(a.capabilities.paste).toBe(false);
  });
});

describe("AzmcpAdapter — validate()", () => {
  it("returns ok when azmcp on PATH reports v2.0.2", async () => {
    const a = new AzmcpAdapter({
      spawn: fakeSpawn({
        "azmcp --version": { code: 0, stdout: "2.0.2\n" },
      }),
    });
    const v = await a.validate();
    expect(v.ok).toBe(true);
  });

  it("rejects v1.x as below minimum major", async () => {
    const a = new AzmcpAdapter({
      spawn: fakeSpawn({
        "azmcp --version": { code: 0, stdout: "1.5.0\n" },
      }),
    });
    const v = await a.validate();
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason).toMatch(/below.*required.*major/i);
      expect(v.installHint).toContain(AZMCP_NPM_SPEC);
    }
  });

  it("falls back to npx -y @azure/mcp@^2 when azmcp not on PATH", async () => {
    const a = new AzmcpAdapter({
      spawn: fakeSpawn({
        "azmcp --version": { code: 127, stdout: "", stderr: "not found" },
        "npx -y @azure/mcp@^2 --version": { code: 0, stdout: "2.1.0\n" },
      }),
    });
    const v = await a.validate();
    expect(v.ok).toBe(true);
  });

  it("returns clear install hint when both PATH and npx fail", async () => {
    const a = new AzmcpAdapter({
      spawn: fakeSpawn({
        "azmcp --version": { code: 127, stdout: "" },
        "npx -y @azure/mcp@^2 --version": { code: 127, stdout: "" },
      }),
    });
    const v = await a.validate();
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.installHint).toContain(AZMCP_NPM_SPEC);
    }
  });

  it("caches the result across calls", async () => {
    let calls = 0;
    const spawnCounted: SpawnLike = (command, args) => {
      calls++;
      return {
        stdoutText: Promise.resolve(
          command === "azmcp" && args[0] === "--version" ? "2.0.0\n" : "",
        ),
        stderrText: Promise.resolve(""),
        done: Promise.resolve({ code: 0 }),
      };
    };
    const a = new AzmcpAdapter({ spawn: spawnCounted });
    await a.validate();
    await a.validate();
    expect(calls).toBe(1);
  });

  it("supports versionCheck override for test injection", async () => {
    const a = new AzmcpAdapter({
      versionCheck: async () => ({ ok: true }),
    });
    const v = await a.validate();
    expect(v.ok).toBe(true);
  });
});

describe("AzmcpAdapter — fetch()", () => {
  it("rejects non-azmcp input kind", async () => {
    const a = new AzmcpAdapter({
      versionCheck: async () => ({ ok: true }),
    });
    await expect(
      a.fetch(
        {
          kind: "raw",
          source: "csv",
          data: "x",
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/cannot handle/i);
  });

  it("throws when validation fails", async () => {
    const a = new AzmcpAdapter({
      versionCheck: async () => ({
        ok: false,
        reason: "missing",
        installHint: "npm i",
      }),
    });
    await expect(
      a.fetch(
        {
          kind: "azmcp",
          subscriptionId: "s",
          workspaceId: "w",
          table: "AppRequests",
          query: "AppRequests | take 1",
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/missing/);
  });

  it("normalises azmcp stdout to rowset using recorded snapshot fixture", async () => {
    const snapshotPath = join(
      process.cwd(),
      "test",
      "fixtures",
      "azmcp-snapshot.json",
    );
    const stdout = await readFile(snapshotPath, "utf8");
    const a = new AzmcpAdapter({
      versionCheck: async () => ({ ok: true }),
      spawn: () => ({
        stdoutText: Promise.resolve(stdout),
        stderrText: Promise.resolve(""),
        done: Promise.resolve({ code: 0 }),
      }),
    });
    const rs = await a.fetch(
      {
        kind: "azmcp",
        subscriptionId: "sub-1",
        workspaceId: "ws-1",
        table: "AppExceptions",
        query: "AppExceptions | take 10",
        hours: 1,
      },
      new AbortController().signal,
    );
    expect(rs.rows.length).toBe(3);
    expect(rs.meta.source).toBe("azure-monitor-json");
    expect(rs.rows[0]?.message).toBe("InvalidSignatureException");
    expect(rs.rows[0]?.source).toBe("Sweeps.Skrill");
  });

  it("surfaces non-zero exit with stderr tail", async () => {
    const a = new AzmcpAdapter({
      versionCheck: async () => ({ ok: true }),
      spawn: () => ({
        stdoutText: Promise.resolve(""),
        stderrText: Promise.resolve(
          "warning: deprecation\nerror: AuthenticationFailed: token expired",
        ),
        done: Promise.resolve({ code: 1 }),
      }),
    });
    await expect(
      a.fetch(
        {
          kind: "azmcp",
          subscriptionId: "sub-1",
          workspaceId: "ws-1",
          table: "AppExceptions",
          query: "x",
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/exited 1.*AuthenticationFailed/);
  });
});

describe("AzmcpAdapter — constants exposed", () => {
  it("pins @azure/mcp@^2", () => {
    expect(AZMCP_NPM_SPEC).toBe("@azure/mcp@^2");
  });

  it("min major is 2", () => {
    expect(AZMCP_MIN_VERSION_MAJOR).toBe(2);
  });
});
