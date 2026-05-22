import { z } from "zod";

export const ErrorCode = z.enum([
  "AZMCP_NOT_FOUND",
  "AZMCP_AUTH_FAILED",
  "AZMCP_TIMEOUT",
  "AZMCP_SUBPROCESS_FAILED",
  "PARSE_FAILED",
  "NORMALIZE_FAILED",
  "CORRELATE_NO_KEYS",
  "RENDER_CAP_EXCEEDED",
  "CONFIG_INVALID",
  "INPUT_INVALID",
  "FS_ERROR",
  "INTERNAL",
]);

export type ErrorCode = z.infer<typeof ErrorCode>;

export const ToolErr = z.object({
  ok: z.literal(false),
  code: ErrorCode,
  message: z.string(),
  hint: z.string().optional(),
  retryable: z.boolean(),
});

export type ToolErr = z.infer<typeof ToolErr>;

export const okSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    ok: z.literal(true),
    data,
    warnings: z.array(z.string()).optional(),
  });

export type Ok<T> = { ok: true; data: T; warnings?: string[] };
export type ToolResult<T> = Ok<T> | ToolErr;

export const fail = (
  code: ErrorCode,
  message: string,
  opts: { hint?: string; retryable?: boolean } = {},
): ToolErr => ({
  ok: false,
  code,
  message,
  hint: opts.hint,
  retryable: opts.retryable ?? false,
});

export const ok = <T>(data: T, warnings?: string[]): Ok<T> =>
  warnings && warnings.length > 0
    ? { ok: true, data, warnings }
    : { ok: true, data };
