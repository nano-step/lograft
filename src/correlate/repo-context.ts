import { spawn } from "node:child_process";
import type { GitCommitRef, RepoContext } from "../types.js";

export const DEFAULT_SINCE_DAYS = 14;
export const DEFAULT_MAX_COMMITS = 200;
export const HARD_MAX_COMMITS = 200;

export interface GatherRepoContextOptions {
  repoPath: string;
  sinceDays?: number;
  maxCommits?: number;
}

interface GitExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

async function git(repoPath: string, args: string[]): Promise<GitExecResult> {
  return new Promise((resolve) => {
    const child = spawn("git", args, {
      cwd: repoPath,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("close", (code) => {
      resolve({
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        code,
      });
    });
    child.on("error", () => {
      resolve({ stdout: "", stderr: "spawn failed", code: -1 });
    });
  });
}

function parseCommits(raw: string): GitCommitRef[] {
  if (raw.length === 0) return [];
  const records = raw.split("\x1e").filter((r) => r.length > 0);
  const out: GitCommitRef[] = [];
  for (const record of records) {
    const parts = record.split("\x00");
    const [sha, author, authoredAt, subject] = parts;
    if (!sha || !author || !authoredAt || subject === undefined) continue;
    if (sha.length < 7) continue;
    const isoTs = (() => {
      const d = new Date(authoredAt.trim());
      return Number.isNaN(d.getTime())
        ? new Date(0).toISOString()
        : d.toISOString();
    })();
    out.push({
      sha: sha.trim(),
      shortSha: sha.trim().slice(0, 7),
      author: author.trim(),
      authoredAt: isoTs,
      subject: subject.trim(),
    });
  }
  return out;
}

export async function gatherRepoContext(
  opts: GatherRepoContextOptions,
): Promise<RepoContext> {
  const sinceDays = Math.max(1, opts.sinceDays ?? DEFAULT_SINCE_DAYS);
  const maxCommits = Math.min(
    HARD_MAX_COMMITS,
    Math.max(1, opts.maxCommits ?? DEFAULT_MAX_COMMITS),
  );

  const since = `${sinceDays} days ago`;

  const logResult = await git(opts.repoPath, [
    "log",
    `--since=${since}`,
    `--max-count=${maxCommits}`,
    "--pretty=format:%H%x00%an%x00%aI%x00%s%x1e",
  ]);
  if (logResult.code !== 0) {
    throw new Error(`git log failed: ${logResult.stderr.trim() || "exit " + logResult.code}`);
  }
  const commits = parseCommits(logResult.stdout);

  const branchResult = await git(opts.repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const currentBranch =
    branchResult.code === 0 ? branchResult.stdout.trim() : "HEAD";

  const remoteResult = await git(opts.repoPath, [
    "config",
    "--get",
    "remote.origin.url",
  ]);
  const remoteUrl =
    remoteResult.code === 0 && remoteResult.stdout.trim().length > 0
      ? remoteResult.stdout.trim()
      : undefined;

  return {
    repoPath: opts.repoPath,
    commits,
    currentBranch,
    ...(remoteUrl ? { remoteUrl } : {}),
  };
}
