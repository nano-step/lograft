import { z } from "zod";

const isoDateTime = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), {
    message: "must be a parseable ISO-8601 timestamp",
  });

export const ParsedQuery = z.object({
  tables: z.array(z.string()),
  timeRange: z
    .object({
      from: isoDateTime,
      to: isoDateTime,
    })
    .optional(),
  ticketMentions: z.array(z.string()),
  projections: z.array(z.string()),
  rawText: z.string(),
});
export type ParsedQuery = z.infer<typeof ParsedQuery>;

export const ParseError = z.object({
  kind: z.literal("parse-error"),
  message: z.string(),
  rawText: z.string(),
});
export type ParseError = z.infer<typeof ParseError>;

export const ColumnType = z.enum(["string", "number", "datetime", "dynamic"]);
export type ColumnType = z.infer<typeof ColumnType>;

export const ColSpec = z.object({
  name: z.string(),
  type: ColumnType,
});
export type ColSpec = z.infer<typeof ColSpec>;

export const Row = z.object({
  timestamp: isoDateTime,
  level: z.string(),
  message: z.string(),
  source: z.string(),
  raw: z.record(z.string(), z.unknown()),
});
export type Row = z.infer<typeof Row>;

export const RowsetSource = z.enum(["csv", "json", "azure-monitor-json"]);
export type RowsetSource = z.infer<typeof RowsetSource>;

export const NormalizedRowset = z.object({
  columns: z.array(ColSpec),
  rows: z.array(Row),
  meta: z.object({
    source: RowsetSource,
    rowCount: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }),
});
export type NormalizedRowset = z.infer<typeof NormalizedRowset>;

export const GitCommitRef = z.object({
  sha: z.string().min(7),
  shortSha: z.string().min(7).max(12),
  author: z.string(),
  authoredAt: isoDateTime,
  subject: z.string(),
});
export type GitCommitRef = z.infer<typeof GitCommitRef>;

export const ServiceMap = z.object({
  allowlist: z.array(z.string()).default([]),
});
export type ServiceMap = z.infer<typeof ServiceMap>;

export const RepoContext = z.object({
  repoPath: z.string(),
  commits: z.array(GitCommitRef),
  currentBranch: z.string(),
  remoteUrl: z.string().optional(),
  serviceMap: ServiceMap.optional(),
});
export type RepoContext = z.infer<typeof RepoContext>;

export const JoinPolicy = z.object({
  ticketRegex: z.string().optional(),
  serviceAllowlist: z.array(z.string()).optional(),
  operationIdField: z.string().default("operation_Id"),
  tiebreakerWindowMin: z.number().int().nonnegative().default(10),
});
export type JoinPolicy = z.infer<typeof JoinPolicy>;

export const ExternalAtomRef = z.object({
  id: z.string(),
  ts: isoDateTime,
  message: z.string(),
  tags: z.array(z.string()).optional(),
});
export type ExternalAtomRef = z.infer<typeof ExternalAtomRef>;

export const EvidenceType = z.enum(["operationId", "winTicket", "service"]);
export type EvidenceType = z.infer<typeof EvidenceType>;

export const FindingEvidence = z.object({
  logRowId: z.string(),
  evidenceType: EvidenceType,
  evidenceRef: z.string(),
});
export type FindingEvidence = z.infer<typeof FindingEvidence>;

export const Severity = z.enum(["info", "warn", "error"]);
export type Severity = z.infer<typeof Severity>;

export const FindingsSummary = z.object({
  headline: z.string().max(500),
  severity: Severity,
  bullets: z.array(z.string()).max(10),
});
export type FindingsSummary = z.infer<typeof FindingsSummary>;

export const FindingGroup = z.object({
  label: z.string(),
  rows: z.array(Row),
  links: z.object({
    commits: z.array(GitCommitRef),
    tickets: z.array(z.string()),
    atoms: z.array(ExternalAtomRef),
  }),
  evidence: z.array(FindingEvidence),
});
export type FindingGroup = z.infer<typeof FindingGroup>;

export const CorrelatedFindings = z.object({
  summary: FindingsSummary,
  groups: z.array(FindingGroup),
  unmatched: z.array(Row),
});
export type CorrelatedFindings = z.infer<typeof CorrelatedFindings>;

export const RedactionRule = z.object({
  name: z.string(),
  pattern: z.string(),
  flags: z.string().optional(),
  replacement: z.string().default("[REDACTED]"),
});
export type RedactionRule = z.infer<typeof RedactionRule>;

export const RedactionRules = z.object({
  rules: z.array(RedactionRule),
});
export type RedactionRules = z.infer<typeof RedactionRules>;

export const OutputFormat = z.enum(["md", "json", "html"]);
export type OutputFormat = z.infer<typeof OutputFormat>;

export const Bundle = z.object({
  dir: z.string(),
  mdPath: z.string().optional(),
  jsonPath: z.string().optional(),
  htmlPath: z.string().optional(),
});
export type Bundle = z.infer<typeof Bundle>;

export const PayloadInline = z.object({
  kind: z.literal("inline"),
  data: z.string(),
});
export const PayloadPath = z.object({
  kind: z.literal("path"),
  filePath: z.string(),
});
export const Payload = z.discriminatedUnion("kind", [
  PayloadInline,
  PayloadPath,
]);
export type Payload = z.infer<typeof Payload>;

export const RowsetRefOrInline = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ref"), rowsetRef: z.string() }),
  z.object({ kind: z.literal("inline"), rowset: NormalizedRowset }),
]);
export type RowsetRefOrInline = z.infer<typeof RowsetRefOrInline>;

export const FindingsRefOrInline = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ref"), findingsRef: z.string() }),
  z.object({ kind: z.literal("inline"), findings: CorrelatedFindings }),
]);
export type FindingsRefOrInline = z.infer<typeof FindingsRefOrInline>;
