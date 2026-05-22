import { z } from "zod";
import { correlate } from "../../correlate/index.js";
import { redactFindings } from "../../redact/index.js";
import { ok, fail, type ToolResult } from "../../errors.js";
import { sharedSessionStore, type SessionStore } from "../../sessions/store.js";
import {
  ExternalAtomRef,
  JoinPolicy,
  NormalizedRowset,
  RepoContext,
  type CorrelatedFindings,
  type FindingsSummary,
} from "../../types.js";

export const CorrelateInput = z.object({
  rowset: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("ref"), rowsetRef: z.string() }),
    z.object({ kind: z.literal("inline"), rowset: NormalizedRowset }),
  ]),
  repoContext: RepoContext,
  joinPolicy: JoinPolicy,
  externalAtoms: z.array(ExternalAtomRef).optional(),
  sessionId: z.string().min(1).optional(),
});
export type CorrelateInput = z.infer<typeof CorrelateInput>;

export interface CorrelateOutput {
  findingsRef?: string;
  summary: FindingsSummary;
  groupCount: number;
  unmatchedCount: number;
}

export const CORRELATE_TOOL_NAME = "lograft_correlate";

export const CORRELATE_DESCRIPTION = [
  "Join a NormalizedRowset against a RepoContext using explicit keys",
  "(operation_Id, configured ticket regex, service allowlist). Output is",
  "redacted via the internal middleware before being returned.",
  "Most users want lograft_investigate; this atomic tool is for partial pipelines.",
].join(" ");

const INLINE_FINDINGS_GROUP_ROW_LIMIT = 50;

function shouldUseRef(findings: CorrelatedFindings): boolean {
  const totalRows =
    findings.unmatched.length +
    findings.groups.reduce((acc, g) => acc + g.rows.length, 0);
  return totalRows > INLINE_FINDINGS_GROUP_ROW_LIMIT;
}

export async function runCorrelate(
  input: CorrelateInput,
  store: SessionStore = sharedSessionStore,
): Promise<ToolResult<CorrelateOutput>> {
  const parsed = CorrelateInput.safeParse(input);
  if (!parsed.success) {
    return fail("INPUT_INVALID", "invalid input for lograft_correlate", {
      hint: parsed.error.message,
      retryable: false,
    });
  }

  let rowset: NormalizedRowset;
  if (parsed.data.rowset.kind === "ref") {
    const found = store.get<NormalizedRowset>(parsed.data.rowset.rowsetRef);
    if (!found) {
      return fail(
        "INPUT_INVALID",
        `rowsetRef not found in session store: ${parsed.data.rowset.rowsetRef}`,
        {
          hint: "session entries expire after 30 minutes; re-run lograft_normalize",
          retryable: false,
        },
      );
    }
    rowset = found;
  } else {
    rowset = parsed.data.rowset.rowset;
  }

  const findings = correlate({
    rowset,
    repoContext: parsed.data.repoContext,
    joinPolicy: parsed.data.joinPolicy,
    externalAtoms: parsed.data.externalAtoms,
  });

  const redacted = redactFindings(findings);

  if (
    redacted.groups.length === 0 &&
    redacted.unmatched.length === rowset.rows.length &&
    rowset.rows.length > 0
  ) {
    const warnings = [
      "no explicit join keys matched — operationId, configured ticket regex, and service allowlist all unmatched",
    ];
    const useRef = shouldUseRef(redacted);
    if (useRef && parsed.data.sessionId) {
      const findingsRef = store.put(
        parsed.data.sessionId,
        "findings",
        redacted,
      );
      return ok(
        {
          findingsRef,
          summary: redacted.summary,
          groupCount: 0,
          unmatchedCount: redacted.unmatched.length,
        },
        warnings,
      );
    }
    return ok(
      {
        summary: redacted.summary,
        groupCount: 0,
        unmatchedCount: redacted.unmatched.length,
      },
      warnings,
    );
  }

  const useRef = shouldUseRef(redacted);
  if (useRef && parsed.data.sessionId) {
    const findingsRef = store.put(parsed.data.sessionId, "findings", redacted);
    return ok({
      findingsRef,
      summary: redacted.summary,
      groupCount: redacted.groups.length,
      unmatchedCount: redacted.unmatched.length,
    });
  }

  return ok({
    summary: redacted.summary,
    groupCount: redacted.groups.length,
    unmatchedCount: redacted.unmatched.length,
  });
}

export function runCorrelateFull(
  input: Pick<CorrelateInput, "repoContext" | "joinPolicy" | "externalAtoms"> & {
    rowset: NormalizedRowset;
  },
): CorrelatedFindings {
  const findings = correlate({
    rowset: input.rowset,
    repoContext: input.repoContext,
    joinPolicy: input.joinPolicy,
    externalAtoms: input.externalAtoms,
  });
  return redactFindings(findings);
}
