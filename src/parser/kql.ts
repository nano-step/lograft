import type { ParsedQuery, ParseError } from "../types.js";

const APP_INSIGHTS_TABLES = new Set([
  "requests",
  "traces",
  "dependencies",
  "exceptions",
  "customEvents",
  "customMetrics",
  "pageViews",
  "browserTimings",
  "availabilityResults",
  "performanceCounters",
]);

const LOG_ANALYTICS_TABLES = new Set([
  "AzureDiagnostics",
  "AzureActivity",
  "AzureMetrics",
  "ContainerLogs",
  "ContainerLog",
  "ContainerLogV2",
  "Heartbeat",
  "Syslog",
  "Event",
  "SecurityEvent",
  "Perf",
  "Update",
  "Operation",
  "AppExceptions",
  "AppRequests",
  "AppTraces",
  "AppDependencies",
  "AppEvents",
  "AppPageViews",
  "AppPerformanceCounters",
  "AppMetrics",
]);

function isLogAnalyticsCustomTable(name: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]*_CL$/.test(name);
}

function isKnownTable(name: string): boolean {
  return (
    APP_INSIGHTS_TABLES.has(name) ||
    LOG_ANALYTICS_TABLES.has(name) ||
    isLogAnalyticsCustomTable(name)
  );
}

function stripCommentsAndStrings(text: string): string {
  return text
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

function extractTables(scrubbed: string): string[] {
  const found = new Set<string>();
  const candidatePattern = /\b([A-Za-z][A-Za-z0-9_]*)\b/g;
  let match: RegExpExecArray | null;
  while ((match = candidatePattern.exec(scrubbed)) !== null) {
    const name = match[1];
    if (!name) continue;
    if (isKnownTable(name)) {
      found.add(name);
    }
  }
  return Array.from(found);
}

function extractTicketMentions(
  raw: string,
  regex: RegExp | undefined,
): string[] {
  if (!regex) return [];
  const found = new Set<string>();
  const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
  const globalRegex = new RegExp(regex.source, flags);
  let match: RegExpExecArray | null;
  while ((match = globalRegex.exec(raw)) !== null) {
    found.add(match[0]);
  }
  return Array.from(found);
}

function extractProjections(scrubbed: string): string[] {
  const projections = new Set<string>();
  const projectPattern = /\|\s*project(?:-away|-rename|-reorder)?\s+([^|;]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = projectPattern.exec(scrubbed)) !== null) {
    const clause = match[1];
    if (!clause) continue;
    for (const part of clause.split(",")) {
      const lhs = part.trim().split(/\s*=\s*/)[0];
      if (!lhs) continue;
      const idMatch = lhs.match(/^[A-Za-z_][A-Za-z0-9_]*/);
      if (idMatch) {
        projections.add(idMatch[0]);
      }
    }
  }
  return Array.from(projections);
}

function extractTimeRange(
  scrubbed: string,
  now: () => Date,
): ParsedQuery["timeRange"] {
  const agoMatch = scrubbed.match(
    /\bago\s*\(\s*(\d+(?:\.\d+)?)\s*(d|h|m|s|ms)\s*\)/i,
  );
  if (agoMatch && agoMatch[1] && agoMatch[2]) {
    const qty = Number(agoMatch[1]);
    const unit = agoMatch[2].toLowerCase();
    const unitMs: Record<string, number> = {
      ms: 1,
      s: 1000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };
    const ms = qty * (unitMs[unit] ?? 0);
    if (ms > 0) {
      const to = now();
      const from = new Date(to.getTime() - ms);
      return { from: from.toISOString(), to: to.toISOString() };
    }
  }

  const betweenMatch = scrubbed.match(
    /\bbetween\s*\(\s*datetime\(([^)]+)\)\s*\.\.\s*datetime\(([^)]+)\)\s*\)/i,
  );
  if (betweenMatch && betweenMatch[1] && betweenMatch[2]) {
    const fromStr = betweenMatch[1].trim();
    const toStr = betweenMatch[2].trim();
    const fromDate = new Date(fromStr);
    const toDate = new Date(toStr);
    if (!Number.isNaN(fromDate.getTime()) && !Number.isNaN(toDate.getTime())) {
      return { from: fromDate.toISOString(), to: toDate.toISOString() };
    }
  }

  return undefined;
}

export interface ParseKqlOptions {
  ticketRegex?: string;
  now?: () => Date;
}

export function parseKql(
  kqlText: string,
  opts: ParseKqlOptions = {},
): ParsedQuery | ParseError {
  if (typeof kqlText !== "string") {
    return {
      kind: "parse-error",
      message: "kqlText must be a string",
      rawText: String(kqlText),
    };
  }

  const trimmed = kqlText.trim();
  if (trimmed.length === 0) {
    return {
      kind: "parse-error",
      message: "empty KQL text",
      rawText: kqlText,
    };
  }

  let ticketRegex: RegExp | undefined;
  if (opts.ticketRegex && opts.ticketRegex.length > 0) {
    try {
      ticketRegex = new RegExp(opts.ticketRegex);
    } catch (err) {
      return {
        kind: "parse-error",
        message: `invalid ticketRegex: ${(err as Error).message}`,
        rawText: kqlText,
      };
    }
  }

  const scrubbed = stripCommentsAndStrings(kqlText);
  const tables = extractTables(scrubbed);
  const ticketMentions = extractTicketMentions(kqlText, ticketRegex);
  const projections = extractProjections(scrubbed);
  const timeRange = extractTimeRange(scrubbed, opts.now ?? (() => new Date()));

  return {
    tables,
    ...(timeRange ? { timeRange } : {}),
    ticketMentions,
    projections,
    rawText: kqlText,
  };
}

export function isParseError(
  result: ParsedQuery | ParseError,
): result is ParseError {
  return (
    typeof result === "object" &&
    result !== null &&
    "kind" in result &&
    (result as ParseError).kind === "parse-error"
  );
}
