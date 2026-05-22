import { z } from "zod";
import {
  gatherRepoContext,
  DEFAULT_SINCE_DAYS,
  DEFAULT_MAX_COMMITS,
  HARD_MAX_COMMITS,
} from "../../correlate/repo-context.js";
import { ok, fail, type ToolResult } from "../../errors.js";
import type { RepoContext } from "../../types.js";

export const GatherRepoContextInput = z.object({
  repoPath: z.string().min(1),
  sinceDays: z.number().int().positive().max(365).optional(),
  maxCommits: z.number().int().positive().max(HARD_MAX_COMMITS).optional(),
});
export type GatherRepoContextInput = z.infer<typeof GatherRepoContextInput>;

export const GATHER_REPO_CONTEXT_TOOL_NAME = "lograft_gather_repo_context";

export const GATHER_REPO_CONTEXT_DESCRIPTION = [
  `Snapshot a git repository's recent commits (default: last ${DEFAULT_SINCE_DAYS} days, max ${DEFAULT_MAX_COMMITS} commits)`,
  "plus current branch and origin URL. Pure read-only, shells out to git.",
  "Most users want lograft_investigate; this atomic tool is for partial pipelines.",
].join(" ");

export async function runGatherRepoContext(
  input: GatherRepoContextInput,
): Promise<ToolResult<RepoContext>> {
  const parsed = GatherRepoContextInput.safeParse(input);
  if (!parsed.success) {
    return fail("INPUT_INVALID", "invalid input for lograft_gather_repo_context", {
      hint: parsed.error.message,
      retryable: false,
    });
  }

  try {
    const ctx = await gatherRepoContext(parsed.data);
    return ok(ctx);
  } catch (err) {
    return fail("FS_ERROR", (err as Error).message, {
      hint: `repoPath: ${parsed.data.repoPath} — check it is a git repo and 'git' is on PATH`,
      retryable: false,
    });
  }
}
