import { describe, it, expect } from "@jest/globals";
import {
  runParseKql,
  PARSE_KQL_TOOL_NAME,
  PARSE_KQL_DESCRIPTION,
} from "../src/server/tools/parse-kql.js";
import type { ParsedQuery } from "../src/types.js";

describe("lograft_parse_kql — MCP tool surface", () => {
  it("has a stable tool name", () => {
    expect(PARSE_KQL_TOOL_NAME).toBe("lograft_parse_kql");
  });

  it("description steers LLM clients toward lograft_investigate", () => {
    expect(PARSE_KQL_DESCRIPTION).toMatch(/lograft_investigate/i);
  });

  it("returns ok envelope on a valid query", async () => {
    const r = await runParseKql({
      kqlText: "requests | where timestamp > ago(1h) | take 10",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const data = r.data as ParsedQuery;
      expect(data.tables).toEqual(["requests"]);
      expect(data.timeRange).toBeDefined();
    }
  });

  it("returns fail envelope on empty input", async () => {
    const r = await runParseKql({ kqlText: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("INPUT_INVALID");
    }
  });

  it("returns fail envelope on invalid ticketRegex", async () => {
    const r = await runParseKql({
      kqlText: "requests",
      ticketRegex: "(unclosed",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("PARSE_FAILED");
    }
  });
});
