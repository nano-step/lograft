import { z } from "zod";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseKql, isParseError } from "../../parser/kql.js";
import { normalize } from "../../normalize/index.js";
import { gatherRepoContext } from "../../correlate/repo-context.js";
import { correlate } from "../../correlate/index.js";
import { redactFindings } from "../../redact/index.js";
import { renderMarkdown, renderJson } from "../../render/markdown.js";
import { renderHtml } from "../../render/html.js";
import { RawDataAdapter } from "../../adapters/index.js";
import { AzmcpAdapter } from "../../adapters/azmcp.js";
import { loadConfig, resolveOutDir } from "../../config/index.js";
import { ok, fail, type ToolResult } from "../../errors.js";
import type { Bundle, NormalizedRowset, OutputFormat } from "../../types.js";

const KqlInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("inline"), text: z.string().min(1) }),
  z.object({ kind: z.literal("path"), filePath: z.string().min(1) }),
]);

const ResultInput = z.object({
  kind: z.literal("inline"),
  data: z.string(),
  format: z.enum(["csv", "json", "azure-monitor-json"]),
});

const ResultPathInput = z.object({
  kind: z.literal("path"),
  filePath: z.string().min(1),
  format: z.enum(["csv", "json", "azure-monitor-json"]),
});

const LiveInput = z.object({
  workspaceId: z.string().min(1),
  subscriptionId: z.string().min(1),
  table: z.string().min(1),
  hours: z.number().int().positive().max(720).optional(),
  limit: z.number().int().positive().max(10_000).optional(),
});

export const InvestigateInput = z
  .object({
    kql: KqlInput.optional(),
    result: z
      .discriminatedUnion("kind", [ResultInput, ResultPathInput])
      .optional(),
    live: LiveInput.optional(),
    repoPath: z.string().min(1),
    outDir: z.string().optional(),
    configPath: z.string().optional(),
    ticketLinkBase: z.string().optional(),
    sessionId: z.string().optional(),
  })
  .refine((v) => v.result !== undefined || v.live !== undefined, {
    message: "must provide either result (paste) or live (azmcp delegation)",
  });

export type InvestigateInput = z.infer<typeof InvestigateInput>;

export const INVESTIGATE_TOOL_NAME = "lograft_investigate";

export const INVESTIGATE_DESCRIPTION = [
  "Run the full investigation pipeline in one call: parse KQL (optional) ->",
  "normalize -> gather repo context -> correlate -> redact -> render md+json+html bundle.",
  "Either pass result={inline|path} (paste mode) OR live={workspace,subscription,table,...}",
  "(delegates to azmcp). Returns a Bundle with paths to the written files.",
  "This is the tool most users want first.",
].join(" ");

function timestampSlug(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

async function readMaybeFile(
  source: { kind: "inline"; data: string; format: string }
    | { kind: "path"; filePath: string; format: string },
): Promise<{ data: string; format: "csv" | "json" | "azure-monitor-json" }> {
  if (source.kind === "inline") {
    return { data: source.data, format: source.format as "csv" | "json" | "azure-monitor-json" };
  }
  const data = await readFile(source.filePath, "utf8");
  return { data, format: source.format as "csv" | "json" | "azure-monitor-json" };
}

async function readKqlSource(
  kql: z.infer<typeof KqlInput> | undefined,
): Promise<string | undefined> {
  if (!kql) return undefined;
  if (kql.kind === "inline") return kql.text;
  return readFile(kql.filePath, "utf8");
}

export async function runInvestigate(
  input: InvestigateInput,
): Promise<ToolResult<Bundle & { warnings: string[] }>> {
  const parsed = InvestigateInput.safeParse(input);
  if (!parsed.success) {
    return fail("INPUT_INVALID", "invalid input for lograft_investigate", {
      hint: parsed.error.message,
      retryable: false,
    });
  }

  const warnings: string[] = [];

  const configResult = await loadConfig({
    explicitPath: parsed.data.configPath,
  });
  warnings.push(...configResult.warnings);
  const config = configResult.config;

  const kqlText = await readKqlSource(parsed.data.kql).catch((err) => {
    warnings.push(`failed to read kqlPath: ${(err as Error).message}`);
    return undefined;
  });

  let parsedQuery;
  let ticketRegex = config.joinPolicy.ticketRegex;
  if (kqlText) {
    const p = parseKql(kqlText, { ticketRegex });
    if (!isParseError(p)) {
      parsedQuery = p;
    }
  }
  void parsedQuery;

  let rowset: NormalizedRowset;
  if (parsed.data.live) {
    if (!kqlText) {
      return fail("INPUT_INVALID", "live mode requires a kql.text or kql.path", {
        retryable: false,
      });
    }
    const azmcp = new AzmcpAdapter();
    const validation = await azmcp.validate();
    if (!validation.ok) {
      return fail("AZMCP_NOT_FOUND", validation.reason, {
        hint: validation.installHint,
        retryable: false,
      });
    }
    try {
      rowset = await azmcp.fetch(
        {
          kind: "azmcp",
          workspaceId: parsed.data.live.workspaceId,
          subscriptionId: parsed.data.live.subscriptionId,
          table: parsed.data.live.table,
          query: kqlText,
          hours: parsed.data.live.hours,
          limit: parsed.data.live.limit,
        },
        new AbortController().signal,
      );
    } catch (err) {
      return fail("AZMCP_SUBPROCESS_FAILED", (err as Error).message, {
        retryable: true,
      });
    }
  } else if (parsed.data.result) {
    try {
      const { data, format } = await readMaybeFile(parsed.data.result);
      const adapter = new RawDataAdapter();
      rowset = await adapter.fetch(
        { kind: "raw", source: format, data },
        new AbortController().signal,
      );
    } catch (err) {
      return fail("FS_ERROR", (err as Error).message, { retryable: false });
    }
  } else {
    return fail("INPUT_INVALID", "must provide result or live", {
      retryable: false,
    });
  }

  let repoContext;
  try {
    repoContext = await gatherRepoContext({
      repoPath: parsed.data.repoPath,
      sinceDays: config.repo.sinceDays,
      maxCommits: config.repo.maxCommits,
    });
  } catch (err) {
    return fail("FS_ERROR", `failed to gather repo context: ${(err as Error).message}`, {
      hint: `repoPath: ${parsed.data.repoPath}`,
      retryable: false,
    });
  }

  const findings = correlate({
    rowset,
    repoContext,
    joinPolicy: {
      ticketRegex,
      serviceAllowlist: config.joinPolicy.serviceAllowlist,
      operationIdField: config.joinPolicy.operationIdField,
      tiebreakerWindowMin: config.joinPolicy.tiebreakerWindowMin,
    },
  });

  const redacted = redactFindings(findings);

  const cwd = process.cwd();
  const outDirResolved = resolveOutDir(
    cwd,
    parsed.data.outDir ?? config.output.dir,
  );
  if (typeof outDirResolved !== "string") {
    return fail("CONFIG_INVALID", outDirResolved.error, { retryable: false });
  }

  const slug = timestampSlug();
  const dir = join(outDirResolved, slug);
  await mkdir(dir, { recursive: true });

  const ticketLinkBase = parsed.data.ticketLinkBase ?? config.output.ticketLinkBase;
  const formats: OutputFormat[] = config.output.formats;

  const bundle: Bundle = { dir };

  if (formats.includes("md")) {
    const md = renderMarkdown(redacted, { ticketLinkBase });
    if (md.truncated) warnings.push("report.md truncated due to 5MB cap");
    const mdPath = join(dir, "report.md");
    await writeFile(mdPath, md.content, "utf8");
    bundle.mdPath = mdPath;
  }

  if (formats.includes("json")) {
    const j = renderJson(redacted);
    if (j.truncated) warnings.push("data.json truncated due to 5MB cap");
    const jsonPath = join(dir, "data.json");
    await writeFile(jsonPath, j.content, "utf8");
    bundle.jsonPath = jsonPath;
  }

  if (formats.includes("html")) {
    const h = renderHtml(redacted, { ticketLinkBase });
    if (h.truncated) warnings.push("report.html truncated due to 5MB cap");
    const htmlPath = join(dir, "report.html");
    await writeFile(htmlPath, h.content, "utf8");
    bundle.htmlPath = htmlPath;
  }

  return ok({ ...bundle, warnings }, warnings);
}
