import { describe, it, expect } from "@jest/globals";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, resolveOutDir, DEFAULT_CONFIG } from "./index.js";

describe("loadConfig", () => {
  it("returns DEFAULT_CONFIG when no file present", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lograft-cfg-"));
    try {
      const r = await loadConfig({ cwd: dir });
      expect(r.source).toBe("default");
      expect(r.config).toEqual(DEFAULT_CONFIG);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("loads cwd file when present", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lograft-cfg-"));
    try {
      await writeFile(
        join(dir, "lograft.config.toml"),
        `[joinPolicy]\nticketRegex = "FOO-\\\\d+"\n`,
      );
      const r = await loadConfig({ cwd: dir });
      expect(r.source).toBe("cwd-file");
      expect(r.config.joinPolicy.ticketRegex).toBe("FOO-\\d+");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("falls back to default + warns on TOML syntax error", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lograft-cfg-"));
    try {
      await writeFile(join(dir, "lograft.config.toml"), "this is not toml\n");
      const r = await loadConfig({ cwd: dir });
      expect(r.warnings.some((w) => /TOML parse failed/.test(w))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("explicit path overrides cwd", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lograft-cfg-"));
    try {
      const explicit = join(dir, "custom.toml");
      await writeFile(explicit, `[joinPolicy]\nticketRegex = "EX-\\\\d+"\n`);
      const r = await loadConfig({ explicitPath: explicit, cwd: dir });
      expect(r.source).toBe("explicit-file");
      expect(r.config.joinPolicy.ticketRegex).toBe("EX-\\d+");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("warns when explicit path missing, falls back to default", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lograft-cfg-"));
    try {
      const r = await loadConfig({
        explicitPath: join(dir, "nope.toml"),
        cwd: dir,
      });
      expect(r.source).toBe("default");
      expect(r.warnings.some((w) => /not found/.test(w))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("resolveOutDir", () => {
  it("uses configured absolute path verbatim", () => {
    const r = resolveOutDir("/some/cwd", "/abs/out");
    expect(r).toBe("/abs/out");
  });

  it("resolves relative configured path against cwd", () => {
    const r = resolveOutDir("/cwd", "out");
    expect(r).toBe("/cwd/out");
  });

  it("defaults to cwd/reports when nothing configured", () => {
    const r = resolveOutDir("/cwd", undefined);
    expect(r).toBe("/cwd/reports");
  });

  it("refuses default when cwd is filesystem root (D11)", () => {
    const r = resolveOutDir("/", undefined);
    expect(typeof r === "object" && "error" in r).toBe(true);
  });

  it("accepts Windows-style absolute path", () => {
    const r = resolveOutDir("C:\\cwd", "C:\\out");
    expect(r).toBe("C:\\out");
  });
});
