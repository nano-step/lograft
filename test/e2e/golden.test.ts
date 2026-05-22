import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { mkdtemp, readFile, rm, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInvestigate } from "../../src/server/tools/investigate.js";

function runGit(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "t@x",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "t@x",
    },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
}

let repoPath: string;
let outRoot: string;

const FIXTURE_ROOT = join(process.cwd(), "test", "fixtures", "investigations");

beforeAll(async () => {
  repoPath = await mkdtemp(join(tmpdir(), "lograft-e2e-repo-"));
  runGit(repoPath, ["init", "-q", "-b", "main"]);
  runGit(repoPath, ["config", "user.email", "t@x"]);
  runGit(repoPath, ["config", "user.name", "Test"]);
  runGit(repoPath, ["commit", "-q", "--allow-empty", "-m", "fix: PROJ-42 deploy"]);
  runGit(repoPath, [
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "feat: MYPROJ-101 auth flow",
  ]);

  outRoot = await mkdtemp(join(tmpdir(), "lograft-e2e-out-"));
});

afterAll(async () => {
  if (repoPath) await rm(repoPath, { recursive: true, force: true });
  if (outRoot) await rm(outRoot, { recursive: true, force: true });
});

async function readFirstReport(dir: string): Promise<{ md: string; json: string; html: string }> {
  const entries = await readdir(dir);
  expect(entries.length).toBe(1);
  const inner = join(dir, entries[0]!);
  return {
    md: await readFile(join(inner, "report.md"), "utf8"),
    json: await readFile(join(inner, "data.json"), "utf8"),
    html: await readFile(join(inner, "report.html"), "utf8"),
  };
}

describe("E2E golden — scenario 1 (KQL + CSV, PROJ-42 ticket)", () => {
  it("produces bundle with PROJ-42 grouping and PaymentService commits attached", async () => {
    const outDir = join(outRoot, "scenario-1");
    const kql = await readFile(
      join(FIXTURE_ROOT, "scenario-1-csv", "query.kql"),
      "utf8",
    );
    const csv = await readFile(
      join(FIXTURE_ROOT, "scenario-1-csv", "results.csv"),
      "utf8",
    );

    const r = await runInvestigate({
      kql: { kind: "inline", text: kql },
      result: { kind: "inline", format: "csv", data: csv },
      repoPath,
      outDir,
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      const { md, json, html } = await readFirstReport(outDir);
      expect(md).toContain("## Summary");
      expect(md).toContain("## Correlations");
      expect(md).toContain("InvalidSignatureException");
      expect(md).toContain("op-aaa-111");
      const parsedJson = JSON.parse(json);
      expect(parsedJson.groups.length).toBe(2);
      expect(parsedJson.unmatched).toHaveLength(0);
      expect(html).toMatch(/^<!doctype html>/i);
    }
  });
});

describe("E2E golden — scenario 2 (KQL + azure-monitor-json)", () => {
  it("normalizes Azure Monitor tables shape and correlates by operation_Id", async () => {
    const outDir = join(outRoot, "scenario-2");
    const kql = await readFile(
      join(FIXTURE_ROOT, "scenario-2-azmcp-json", "query.kql"),
      "utf8",
    );
    const data = await readFile(
      join(FIXTURE_ROOT, "scenario-2-azmcp-json", "results.json"),
      "utf8",
    );

    const r = await runInvestigate({
      kql: { kind: "inline", text: kql },
      result: { kind: "inline", format: "azure-monitor-json", data },
      repoPath,
      outDir,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const { md } = await readFirstReport(outDir);
      expect(md).toContain("op-ccc-333");
      expect(md).toContain("TokenValidationException");
    }
  });
});

describe("E2E golden — scenario 3 (raw CSV only, no KQL, no key matches)", () => {
  it("renders bundle with all rows in unmatched + warn-no-keys", async () => {
    const outDir = join(outRoot, "scenario-3");
    const csv = await readFile(
      join(FIXTURE_ROOT, "scenario-3-raw-csv-only", "results.csv"),
      "utf8",
    );

    const r = await runInvestigate({
      result: { kind: "inline", format: "csv", data: csv },
      repoPath,
      outDir,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const { md, json } = await readFirstReport(outDir);
      const parsedJson = JSON.parse(json);
      expect(parsedJson.groups).toHaveLength(0);
      expect(parsedJson.unmatched).toHaveLength(3);
      expect(md).toContain("unhandled rejection");
    }
  });
});

describe("E2E golden — redaction sweep on fixtures (R20)", () => {
  it("seeds PII at runtime into fixture, asserts none survives", async () => {
    const outDir = join(outRoot, "redact-sweep");
    const poisoned = `timestamp,message,operation_Id,source
2026-05-22T00:00:00Z,user alice@example.com hit JWT eyJabcdefgh.eyJijklmnop.signaturexyz,op-r,Svc
2026-05-22T00:00:01Z,from 10.20.30.40 internal db-1.internal,op-r,Svc
`;
    const r = await runInvestigate({
      result: { kind: "inline", format: "csv", data: poisoned },
      repoPath,
      outDir,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const { md, json, html } = await readFirstReport(outDir);
      const seeds = [
        "alice@example.com",
        "eyJabcdefgh.eyJijklmnop.signaturexyz",
        "10.20.30.40",
        "db-1.internal",
      ];
      for (const s of seeds) {
        expect(md).not.toContain(s);
        expect(json).not.toContain(s);
        expect(html).not.toContain(s);
      }
    }
  });
});
