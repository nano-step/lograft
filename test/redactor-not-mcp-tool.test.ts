import { describe, it, expect } from "@jest/globals";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

describe("D13: redactor is NOT a public MCP tool", () => {
  it("src/server/tools/ contains no file named lograft_redact or redact-tool", async () => {
    const dir = join(process.cwd(), "src", "server", "tools");
    const entries = await readdir(dir);
    expect(entries.some((e) => /redact/i.test(e))).toBe(false);
  });

  it("no PARSE_KQL_TOOL_NAME-style export for redact", async () => {
    const dir = join(process.cwd(), "src", "server", "tools");
    const entries = await readdir(dir);
    for (const e of entries) {
      const content = await readFile(join(dir, e), "utf8");
      expect(content).not.toMatch(/lograft_redact/);
    }
  });
});
