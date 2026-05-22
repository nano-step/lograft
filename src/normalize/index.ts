import type {
  ColSpec,
  ColumnType,
  NormalizedRowset,
  Row,
  RowsetSource,
} from "../types.js";

export const DEFAULT_ROW_CAP = 1000;

const TIMESTAMP_KEYS = [
  "timestamp",
  "TimeGenerated",
  "time",
  "Time",
  "@timestamp",
  "ts",
  "eventTime",
  "EventTime",
];

const LEVEL_KEYS = [
  "level",
  "severityLevel",
  "SeverityLevel",
  "Level",
  "severity",
  "Severity",
  "type",
];

const MESSAGE_KEYS = [
  "message",
  "Message",
  "msg",
  "outerMessage",
  "name",
  "Name",
];

const SOURCE_KEYS = [
  "source",
  "Source",
  "cloud_RoleName",
  "appName",
  "service",
  "category",
  "Category",
];

function pickField(
  raw: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const val = raw[key];
    if (val !== undefined && val !== null) {
      return typeof val === "string" ? val : String(val);
    }
  }
  return undefined;
}

function coerceTimestamp(raw: Record<string, unknown>): string {
  const candidate = pickField(raw, TIMESTAMP_KEYS);
  if (candidate) {
    const parsed = Date.parse(candidate);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  return new Date(0).toISOString();
}

function normaliseLevel(
  raw: Record<string, unknown>,
): string {
  const candidate = pickField(raw, LEVEL_KEYS);
  if (!candidate) return "info";
  const lower = candidate.toLowerCase();
  if (/(crit|fatal|emerg)/.test(lower)) return "critical";
  if (/(err|severe)/.test(lower)) return "error";
  if (/warn/.test(lower)) return "warn";
  if (/(info|notice)/.test(lower)) return "info";
  if (/(debug|trace|verbose)/.test(lower)) return "debug";
  if (/^[0-3]$/.test(lower)) {
    const map: Record<string, string> = {
      "0": "info",
      "1": "warn",
      "2": "error",
      "3": "critical",
    };
    return map[lower] ?? "info";
  }
  return candidate;
}

function rowFromRaw(raw: Record<string, unknown>): Row {
  return {
    timestamp: coerceTimestamp(raw),
    level: normaliseLevel(raw),
    message: pickField(raw, MESSAGE_KEYS) ?? "",
    source: pickField(raw, SOURCE_KEYS) ?? "unknown",
    raw,
  };
}

function inferType(values: unknown[]): ColumnType {
  let allNumber = true;
  let allDatetime = true;
  let allString = true;
  let nullableCount = 0;
  for (const value of values) {
    if (value === null || value === undefined || value === "") {
      nullableCount++;
      continue;
    }
    if (typeof value !== "number" && !(typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value))) {
      allNumber = false;
    }
    if (
      typeof value !== "string" ||
      Number.isNaN(Date.parse(value)) ||
      !/[-:T]/.test(value)
    ) {
      allDatetime = false;
    }
    if (typeof value !== "string") allString = false;
  }
  if (values.length === nullableCount) return "string";
  if (allNumber) return "number";
  if (allDatetime) return "datetime";
  if (allString) return "string";
  return "dynamic";
}

function buildColumns(rows: Record<string, unknown>[]): ColSpec[] {
  const seen = new Map<string, unknown[]>();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key)!.push(value);
    }
  }
  return Array.from(seen.entries()).map(([name, samples]) => ({
    name,
    type: inferType(samples),
  }));
}

function parseCsv(text: string): Record<string, unknown>[] {
  const lines: string[] = [];
  let buffer = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        buffer += '""';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      buffer += '"';
      continue;
    }
    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      lines.push(buffer);
      buffer = "";
      continue;
    }
    buffer += ch;
  }
  if (buffer.length > 0) lines.push(buffer);

  if (lines.length === 0) return [];

  const splitRow = (line: string): string[] => {
    const cells: string[] = [];
    let cell = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (q && line[i + 1] === '"') {
          cell += '"';
          i++;
          continue;
        }
        q = !q;
        continue;
      }
      if (!q && ch === ",") {
        cells.push(cell);
        cell = "";
        continue;
      }
      cell += ch;
    }
    cells.push(cell);
    return cells;
  };

  const headers = splitRow(lines[0]!);
  return lines.slice(1)
    .filter((line) => line.length > 0)
    .map((line) => {
      const cells = splitRow(line);
      const obj: Record<string, unknown> = {};
      headers.forEach((h, i) => {
        obj[h] = cells[i] ?? "";
      });
      return obj;
    });
}

function parseJsonRows(text: string): Record<string, unknown>[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  const data = JSON.parse(trimmed);
  if (Array.isArray(data)) {
    return data.filter((r): r is Record<string, unknown> =>
      typeof r === "object" && r !== null && !Array.isArray(r),
    );
  }
  if (typeof data === "object" && data !== null) {
    return [data as Record<string, unknown>];
  }
  return [];
}

function parseAzureMonitorJson(text: string): Record<string, unknown>[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  const data = JSON.parse(trimmed);

  if (data && typeof data === "object" && Array.isArray(data.tables)) {
    const out: Record<string, unknown>[] = [];
    for (const table of data.tables) {
      if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) continue;
      const colNames = table.columns.map((c: { name: string }) => c.name);
      for (const row of table.rows) {
        const obj: Record<string, unknown> = {};
        colNames.forEach((name: string, i: number) => {
          obj[name] = row[i];
        });
        out.push(obj);
      }
    }
    return out;
  }

  if (Array.isArray(data)) {
    return data.filter((r): r is Record<string, unknown> =>
      typeof r === "object" && r !== null && !Array.isArray(r),
    );
  }

  return [];
}

export interface NormalizeOptions {
  rowCap?: number;
}

export function normalize(
  source: RowsetSource,
  data: string,
  opts: NormalizeOptions = {},
): NormalizedRowset {
  const rowCap = opts.rowCap ?? DEFAULT_ROW_CAP;

  let rawRows: Record<string, unknown>[];
  switch (source) {
    case "csv":
      rawRows = parseCsv(data);
      break;
    case "json":
      rawRows = parseJsonRows(data);
      break;
    case "azure-monitor-json":
      rawRows = parseAzureMonitorJson(data);
      break;
  }

  const truncated = rawRows.length > rowCap;
  const capped = truncated ? rawRows.slice(0, rowCap) : rawRows;
  const columns = buildColumns(capped);
  const rows = capped.map(rowFromRaw);

  return {
    columns,
    rows,
    meta: {
      source,
      rowCount: rows.length,
      truncated,
    },
  };
}
