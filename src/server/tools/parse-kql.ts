import { z } from "zod";
import { parseKql, isParseError } from "../../parser/kql.js";
import { ok, fail, type ToolResult } from "../../errors.js";
import type { ParsedQuery } from "../../types.js";

export const ParseKqlInput = z.object({
  kqlText: z.string().min(1),
  ticketRegex: z.string().optional(),
});
export type ParseKqlInput = z.infer<typeof ParseKqlInput>;

export const PARSE_KQL_TOOL_NAME = "lograft_parse_kql";

export const PARSE_KQL_DESCRIPTION = [
  "Extract structural facts from a Kusto Query Language (KQL) query without executing it.",
  "Returns the referenced tables, projected columns, time range, and ticket mentions.",
  "Most users want lograft_investigate; use this atomic tool only when you need partial pipeline output.",
  "Pure compute, no side effects, no network.",
].join(" ");

export async function runParseKql(
  input: ParseKqlInput,
): Promise<ToolResult<ParsedQuery>> {
  const parsed = ParseKqlInput.safeParse(input);
  if (!parsed.success) {
    return fail("INPUT_INVALID", "invalid input for lograft_parse_kql", {
      hint: parsed.error.message,
      retryable: false,
    });
  }

  const result = parseKql(parsed.data.kqlText, {
    ticketRegex: parsed.data.ticketRegex,
  });

  if (isParseError(result)) {
    return fail("PARSE_FAILED", result.message, {
      hint: "Pass a non-empty KQL string. Garbage input is tolerated but yields empty tables.",
      retryable: false,
    });
  }

  return ok(result);
}
