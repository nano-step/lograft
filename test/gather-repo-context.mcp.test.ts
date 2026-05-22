import { describe, it, expect } from "@jest/globals";
import {
  runGatherRepoContext,
  GATHER_REPO_CONTEXT_TOOL_NAME,
  GATHER_REPO_CONTEXT_DESCRIPTION,
} from "../src/server/tools/gather-repo-context.js";

describe("lograft_gather_repo_context — MCP tool", () => {
  it("has a stable tool name", () => {
    expect(GATHER_REPO_CONTEXT_TOOL_NAME).toBe("lograft_gather_repo_context");
  });

  it("description steers LLM clients toward lograft_investigate", () => {
    expect(GATHER_REPO_CONTEXT_DESCRIPTION).toMatch(/lograft_investigate/i);
  });

  it("returns FS_ERROR for non-existent path", async () => {
    const r = await runGatherRepoContext({
      repoPath: "/tmp/__lograft_nonexistent_repo_path",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("FS_ERROR");
  });

  it("rejects invalid input shape", async () => {
    const r = await runGatherRepoContext({
      repoPath: "",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INPUT_INVALID");
  });
});
