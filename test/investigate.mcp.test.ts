import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runInvestigate,
  INVESTIGATE_TOOL_NAME,
  INVESTIGATE_DESCRIPTION,
} from "../src/server/tools/investigate.js";

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
let workspaceDir: string;

beforeAll(async () => {
  repoPath = await mkdtemp(join(tmpdir(), "lograft-inv-repo-"));
  runGit(repoPath, ["init", "-q", "-b", "main"]);
  runGit(repoPath, ["config", "user.email", "t@x"]);
  runGit(repoPath, ["config", "user.name", "Test"]);
  await writeFile(join(repoPath, "a.txt"), "1\n");
  runGit(repoPath, ["add", "a.txt"]);
  runGit(repoPath, ["commit", "-q", "-m", "fix: PROJ-42 deploy"]);

  workspaceDir = await mkdtemp(join(tmpdir(), "lograft-inv-ws-"));
});

afterAll(async () => {
  if (repoPath) await rm(repoPath, { recursive: true, force: true });
  if (workspaceDir) await rm(workspaceDir, { recursive: true, force: true });
});

describe("lograft_investigate — MCP tool", () => {
  it("has stable tool name + plan-mandated description", () => {
    expect(INVESTIGATE_TOOL_NAME).toBe("lograft_investigate");
    expect(INVESTIGATE_DESCRIPTION).toMatch(/full investigation pipeline/i);
  });

  it("rejects when neither result nor live is provided", async () => {
    const r = await runInvestigate({
      repoPath,
      outDir: workspaceDir,
    } as Parameters<typeof runInvestigate>[0]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INPUT_INVALID");
  });

  it("paste-mode happy path produces md+json+html bundle", async () => {
    const r = await runInvestigate({
      result: {
        kind: "inline",
        format: "csv",
        data: `timestamp,message,operation_Id,source\n2026-05-22T13:59:00Z,PROJ-42 fail,op-1,Sweeps.Skrill\n2026-05-22T14:00:00Z,PROJ-42 fail,op-1,Sweeps.Skrill\n`,
      },
      kql: {
        kind: "inline",
        text: "exceptions | where timestamp > ago(1h)",
      },
      repoPath,
      outDir: workspaceDir,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.mdPath).toBeDefined();
      expect(r.data.jsonPath).toBeDefined();
      expect(r.data.htmlPath).toBeDefined();
      const md = await readFile(r.data.mdPath!, "utf8");
      expect(md).toContain("## Summary");
      expect(md).toContain("## Correlations");
      const json = JSON.parse(await readFile(r.data.jsonPath!, "utf8"));
      expect(json.groups.length).toBeGreaterThan(0);
      const html = await readFile(r.data.htmlPath!, "utf8");
      expect(html).toMatch(/^<!doctype html>/i);
    }
  });

  it("FS_ERROR when repoPath is not a git repo", async () => {
    const r = await runInvestigate({
      result: {
        kind: "inline",
        format: "csv",
        data: "timestamp,message\n2026-05-22T00:00:00Z,hi",
      },
      repoPath: "/tmp/__not_a_repo_lograft",
      outDir: workspaceDir,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("FS_ERROR");
  });

  it("redaction is applied to output (D13 chokepoint)", async () => {
    const r = await runInvestigate({
      result: {
        kind: "inline",
        format: "csv",
        data: `timestamp,message,operation_Id\n2026-05-22T00:00:00Z,user alice@example.com hit error,op-r`,
      },
      repoPath,
      outDir: workspaceDir,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const md = await readFile(r.data.mdPath!, "utf8");
      expect(md).not.toContain("alice@example.com");
      expect(md).toMatch(/\[REDACTED:email\]/);
    }
  });
});

describe("lograft_investigate — composition (R19 / Metis F4)", () => {
  it("uses the same handlers as atomic tools (architectural)", async () => {
    const investigateSrc = await readFile(
      join(process.cwd(), "src", "server", "tools", "investigate.ts"),
      "utf8",
    );
    expect(investigateSrc).toContain('import { parseKql, isParseError } from "../../parser/kql.js"');
    expect(investigateSrc).toContain('import { normalize } from "../../normalize/index.js"');
    expect(investigateSrc).toContain(
      'import { gatherRepoContext } from "../../correlate/repo-context.js"',
    );
    expect(investigateSrc).toContain('import { correlate } from "../../correlate/index.js"');
    expect(investigateSrc).toContain('import { redactFindings } from "../../redact/index.js"');
    expect(investigateSrc).toContain(
      'import { renderMarkdown, renderJson } from "../../render/markdown.js"',
    );
    expect(investigateSrc).toContain('import { renderHtml } from "../../render/html.js"');
    expect(investigateSrc).not.toContain("ListToolsRequestSchema");
    expect(investigateSrc).not.toContain("CallToolRequestSchema");
  });
});
