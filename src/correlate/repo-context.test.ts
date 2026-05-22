import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gatherRepoContext, HARD_MAX_COMMITS } from "./repo-context.js";

function runGit(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd,
    env: { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "t@x", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "t@x" },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
}

let repoPath: string;

beforeAll(async () => {
  repoPath = await mkdtemp(join(tmpdir(), "lograft-repo-"));
  runGit(repoPath, ["init", "-q", "-b", "main"]);
  runGit(repoPath, ["config", "user.email", "t@x"]);
  runGit(repoPath, ["config", "user.name", "Test"]);
  runGit(repoPath, ["remote", "add", "origin", "https://example.invalid/repo.git"]);

  await writeFile(join(repoPath, "a.txt"), "1\n");
  runGit(repoPath, ["add", "a.txt"]);
  runGit(repoPath, ["commit", "-q", "-m", "feat: initial commit"]);

  await writeFile(join(repoPath, "b.txt"), "2\n");
  runGit(repoPath, ["add", "b.txt"]);
  runGit(repoPath, ["commit", "-q", "-m", "fix: pipe | char and | quote\" in subject"]);

  await writeFile(join(repoPath, "c.txt"), "3\n");
  runGit(repoPath, ["add", "c.txt"]);
  runGit(repoPath, ["commit", "-q", "-m", "docs: mention PROJ-42"]);
});

afterAll(async () => {
  if (repoPath) await rm(repoPath, { recursive: true, force: true });
});

describe("gatherRepoContext", () => {
  it("returns commits in reverse chronological order", async () => {
    const ctx = await gatherRepoContext({ repoPath, sinceDays: 30 });
    expect(ctx.commits.length).toBe(3);
    expect(ctx.commits[0]?.subject).toMatch(/PROJ-42/);
    expect(ctx.commits[2]?.subject).toMatch(/initial/);
  });

  it("populates currentBranch from rev-parse", async () => {
    const ctx = await gatherRepoContext({ repoPath, sinceDays: 30 });
    expect(ctx.currentBranch).toBe("main");
  });

  it("populates remoteUrl from origin config", async () => {
    const ctx = await gatherRepoContext({ repoPath, sinceDays: 30 });
    expect(ctx.remoteUrl).toBe("https://example.invalid/repo.git");
  });

  it("populates shortSha and authoredAt as ISO", async () => {
    const ctx = await gatherRepoContext({ repoPath, sinceDays: 30 });
    const c = ctx.commits[0]!;
    expect(c.shortSha.length).toBe(7);
    expect(c.sha.startsWith(c.shortSha)).toBe(true);
    expect(Date.parse(c.authoredAt)).not.toBeNaN();
  });

  it("preserves subjects containing pipes and quotes (D31 null-byte separator)", async () => {
    const ctx = await gatherRepoContext({ repoPath, sinceDays: 30 });
    const fixCommit = ctx.commits.find((c) => c.subject.includes("pipe"));
    expect(fixCommit?.subject).toContain("|");
    expect(fixCommit?.subject).toContain('"');
  });

  it("caps at HARD_MAX_COMMITS even when caller asks for more", async () => {
    const ctx = await gatherRepoContext({
      repoPath,
      sinceDays: 365,
      maxCommits: HARD_MAX_COMMITS + 50,
    });
    expect(ctx.commits.length).toBeLessThanOrEqual(HARD_MAX_COMMITS);
  });

  it("respects a tighter maxCommits", async () => {
    const ctx = await gatherRepoContext({ repoPath, sinceDays: 30, maxCommits: 1 });
    expect(ctx.commits.length).toBe(1);
  });

  it("throws a clear error when repoPath is not a git repo", async () => {
    const notRepo = await mkdtemp(join(tmpdir(), "lograft-not-repo-"));
    try {
      await expect(gatherRepoContext({ repoPath: notRepo })).rejects.toThrow();
    } finally {
      await rm(notRepo, { recursive: true, force: true });
    }
  });
});
