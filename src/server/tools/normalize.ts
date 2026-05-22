import { z } from "zod";
import { readFile } from "node:fs/promises";
import { normalize, DEFAULT_ROW_CAP } from "../../normalize/index.js";
import { ok, fail, type ToolResult } from "../../errors.js";
import { sharedSessionStore, type SessionStore } from "../../sessions/store.js";
import type { NormalizedRowset } from "../../types.js";

export const NormalizeInput = z.object({
  source: z.enum(["csv", "json", "azure-monitor-json"]),
  payload: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("inline"), data: z.string() }),
    z.object({ kind: z.literal("path"), filePath: z.string() }),
  ]),
  sessionId: z.string().min(1).optional(),
  rowCap: z.number().int().positive().max(10_000).optional(),
});
export type NormalizeInput = z.infer<typeof NormalizeInput>;

export interface NormalizeOutput {
  rowsetRef?: string;
  preview: NormalizedRowset;
  meta: NormalizedRowset["meta"];
}

export const NORMALIZE_TOOL_NAME = "lograft_normalize";

export const NORMALIZE_DESCRIPTION = [
  "Normalise a CSV / JSON / Azure-Monitor-JSON log export into a 5-field rowset",
  "(timestamp, level, message, source, raw).",
  "Pass sessionId to receive an opaque rowsetRef for downstream lograft_correlate calls",
  "(avoids re-shipping large payloads through MCP).",
  "Most users want lograft_investigate; this atomic tool is for partial pipelines.",
].join(" ");

const PREVIEW_ROW_LIMIT = 50;

function buildPreview(full: NormalizedRowset): NormalizedRowset {
  return {
    columns: full.columns,
    rows: full.rows.slice(0, PREVIEW_ROW_LIMIT),
    meta: full.meta,
  };
}

const MAX_PATH_BYTES = 50 * 1024 * 1024;

export async function runNormalize(
  input: NormalizeInput,
  store: SessionStore = sharedSessionStore,
): Promise<ToolResult<NormalizeOutput>> {
  const parsed = NormalizeInput.safeParse(input);
  if (!parsed.success) {
    return fail("INPUT_INVALID", "invalid input for lograft_normalize", {
      hint: parsed.error.message,
      retryable: false,
    });
  }

  let data: string;
  if (parsed.data.payload.kind === "inline") {
    data = parsed.data.payload.data;
  } else {
    try {
      const buf = await readFile(parsed.data.payload.filePath);
      if (buf.byteLength > MAX_PATH_BYTES) {
        return fail("INPUT_INVALID", "input file exceeds 50MB cap", {
          hint: `path: ${parsed.data.payload.filePath}`,
          retryable: false,
        });
      }
      data = buf.toString("utf8");
    } catch (err) {
      return fail("FS_ERROR", `cannot read input file: ${(err as Error).message}`, {
        hint: `path: ${parsed.data.payload.filePath}`,
        retryable: false,
      });
    }
  }

  let full: NormalizedRowset;
  try {
    full = normalize(parsed.data.source, data, {
      rowCap: parsed.data.rowCap ?? DEFAULT_ROW_CAP,
    });
  } catch (err) {
    return fail("NORMALIZE_FAILED", (err as Error).message, {
      hint: `source=${parsed.data.source}; check input shape`,
      retryable: false,
    });
  }

  const useRef =
    parsed.data.sessionId !== undefined && full.rows.length > 100;
  const rowsetRef = useRef
    ? store.put(parsed.data.sessionId!, "rowset", full)
    : undefined;

  const preview = useRef ? buildPreview(full) : full;
  const warnings = full.meta.truncated
    ? [`rowset truncated to ${full.meta.rowCount} rows (cap ${parsed.data.rowCap ?? DEFAULT_ROW_CAP})`]
    : undefined;

  return ok(
    {
      ...(rowsetRef ? { rowsetRef } : {}),
      preview,
      meta: full.meta,
    },
    warnings,
  );
}
