import type {
  CorrelatedFindings,
  ExternalAtomRef,
  FindingEvidence,
  FindingGroup,
  GitCommitRef,
  JoinPolicy,
  NormalizedRowset,
  RepoContext,
  Row,
  Severity,
} from "../types.js";

export interface CorrelateOptions {
  rowset: NormalizedRowset;
  repoContext: RepoContext;
  joinPolicy: JoinPolicy;
  externalAtoms?: ExternalAtomRef[];
}

interface MatchedEvidence {
  evidence: FindingEvidence;
  commitMatches: GitCommitRef[];
  ticketMatches: string[];
  atomMatches: ExternalAtomRef[];
}

const OPERATION_ID_FIELDS = ["operation_Id", "operationId", "operation_id"];

function extractOperationId(
  row: Row,
  configuredField: string,
): string | undefined {
  const fields = new Set<string>([configuredField, ...OPERATION_ID_FIELDS]);
  for (const key of fields) {
    const value = row.raw[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function extractTicketMentions(
  row: Row,
  ticketRegex: RegExp,
): string[] {
  const found = new Set<string>();
  const haystacks = [
    row.message,
    typeof row.raw.operationName === "string" ? row.raw.operationName : "",
  ];
  for (const text of haystacks) {
    if (!text) continue;
    ticketRegex.lastIndex = 0;
    for (const match of text.matchAll(ticketRegex)) {
      found.add(match[0]);
    }
  }
  return Array.from(found);
}

function buildTicketRegex(pattern: string | undefined): RegExp | undefined {
  if (!pattern) return undefined;
  try {
    return new RegExp(pattern, "g");
  } catch {
    return undefined;
  }
}

function rowMatchesService(row: Row, allowlist: string[]): string | undefined {
  if (allowlist.length === 0) return undefined;
  for (const allowed of allowlist) {
    if (row.source === allowed) return allowed;
    if (row.source.startsWith(`${allowed}.`)) return allowed;
  }
  return undefined;
}

function commitsForTicket(
  commits: GitCommitRef[],
  ticket: string,
): GitCommitRef[] {
  return commits.filter((c) => c.subject.includes(ticket));
}

function commitsByOperationProximity(
  commits: GitCommitRef[],
  rowTimestamp: string,
  windowMin: number,
): GitCommitRef[] {
  if (windowMin <= 0) return [];
  const rowTs = Date.parse(rowTimestamp);
  if (Number.isNaN(rowTs)) return [];
  const windowMs = windowMin * 60_000;
  return commits.filter((c) => {
    const commitTs = Date.parse(c.authoredAt);
    if (Number.isNaN(commitTs)) return false;
    return Math.abs(commitTs - rowTs) <= windowMs;
  });
}

function atomsByTicketOrOperation(
  atoms: ExternalAtomRef[],
  matchKeys: Set<string>,
): ExternalAtomRef[] {
  return atoms.filter(
    (a) =>
      (a.tags ?? []).some((t) => matchKeys.has(t)) ||
      Array.from(matchKeys).some((k) => a.message.includes(k)),
  );
}

function summariseSeverity(rows: Row[]): Severity {
  for (const row of rows) {
    if (/critical|fatal/i.test(row.level)) return "error";
    if (/err/i.test(row.level)) return "error";
  }
  for (const row of rows) {
    if (/warn/i.test(row.level)) return "warn";
  }
  return "info";
}

function buildHeadline(
  rowCount: number,
  groupCount: number,
  topSeverity: Severity,
): string {
  const sevLabel =
    topSeverity === "error"
      ? "ERROR"
      : topSeverity === "warn"
      ? "WARN"
      : "INFO";
  return `[${sevLabel}] ${rowCount} row(s) correlated into ${groupCount} finding group(s)`.slice(
    0,
    500,
  );
}

function buildBullets(groups: FindingGroup[]): string[] {
  return groups.slice(0, 10).map((g) => {
    const commitNote =
      g.links.commits.length > 0
        ? ` — ${g.links.commits.length} commit(s)`
        : "";
    const ticketNote =
      g.links.tickets.length > 0
        ? ` — tickets: ${g.links.tickets.slice(0, 3).join(", ")}`
        : "";
    return `${g.label}: ${g.rows.length} row(s)${commitNote}${ticketNote}`;
  });
}

function buildEvidence(
  row: Row,
  rowId: string,
  operationId: string | undefined,
  tickets: string[],
  service: string | undefined,
): FindingEvidence[] {
  const evidence: FindingEvidence[] = [];
  if (operationId) {
    evidence.push({
      logRowId: rowId,
      evidenceType: "operationId",
      evidenceRef: operationId,
    });
  }
  for (const ticket of tickets) {
    evidence.push({
      logRowId: rowId,
      evidenceType: "winTicket",
      evidenceRef: ticket,
    });
  }
  if (service) {
    evidence.push({
      logRowId: rowId,
      evidenceType: "service",
      evidenceRef: service,
    });
  }
  return evidence;
}

function rowFingerprint(row: Row): string {
  const opId = OPERATION_ID_FIELDS.map((k) => row.raw[k]).find(
    (v) => typeof v === "string",
  );
  return `${row.timestamp}|${row.source}|${opId ?? "-"}`;
}

export function correlate(opts: CorrelateOptions): CorrelatedFindings {
  const { rowset, repoContext, joinPolicy } = opts;
  const externalAtoms = opts.externalAtoms ?? [];

  const ticketRegex = buildTicketRegex(joinPolicy.ticketRegex);
  const serviceAllowlist = joinPolicy.serviceAllowlist ?? [];
  const tiebreakerWindowMin = joinPolicy.tiebreakerWindowMin ?? 10;

  const groupMap = new Map<
    string,
    {
      label: string;
      rows: Row[];
      commits: Set<GitCommitRef>;
      tickets: Set<string>;
      atoms: Set<ExternalAtomRef>;
      evidence: FindingEvidence[];
    }
  >();
  const unmatched: Row[] = [];

  rowset.rows.forEach((row, idx) => {
    const rowId = `row-${idx}`;
    const operationId = extractOperationId(row, joinPolicy.operationIdField);
    const ticketMentions = ticketRegex
      ? extractTicketMentions(row, ticketRegex)
      : [];
    const service = rowMatchesService(row, serviceAllowlist);

    const hasKeyMatch =
      operationId !== undefined ||
      ticketMentions.length > 0 ||
      service !== undefined;

    if (!hasKeyMatch) {
      unmatched.push(row);
      return;
    }

    const groupKey =
      operationId !== undefined
        ? `op:${operationId}`
        : ticketMentions.length > 0
        ? `tickets:${ticketMentions.sort().join(",")}`
        : `service:${service!}`;

    const groupLabel =
      operationId !== undefined
        ? `operationId=${operationId}`
        : ticketMentions.length > 0
        ? `tickets ${ticketMentions.join(", ")}`
        : `service ${service!}`;

    let entry = groupMap.get(groupKey);
    if (!entry) {
      entry = {
        label: groupLabel,
        rows: [],
        commits: new Set<GitCommitRef>(),
        tickets: new Set<string>(),
        atoms: new Set<ExternalAtomRef>(),
        evidence: [],
      };
      groupMap.set(groupKey, entry);
    }
    entry.rows.push(row);

    for (const ticket of ticketMentions) {
      entry.tickets.add(ticket);
      for (const c of commitsForTicket(repoContext.commits, ticket)) {
        entry.commits.add(c);
      }
    }

    if (operationId !== undefined && tiebreakerWindowMin > 0) {
      const nearby = commitsByOperationProximity(
        repoContext.commits,
        row.timestamp,
        tiebreakerWindowMin,
      );
      for (const c of nearby) entry.commits.add(c);
    }

    const matchKeys = new Set<string>();
    if (operationId) matchKeys.add(operationId);
    for (const t of ticketMentions) matchKeys.add(t);
    if (service) matchKeys.add(service);
    for (const a of atomsByTicketOrOperation(externalAtoms, matchKeys)) {
      entry.atoms.add(a);
    }

    entry.evidence.push(
      ...buildEvidence(row, rowFingerprint(row) + "/" + rowId, operationId, ticketMentions, service),
    );
  });

  const groups: FindingGroup[] = Array.from(groupMap.values()).map((g) => ({
    label: g.label,
    rows: g.rows,
    links: {
      commits: Array.from(g.commits),
      tickets: Array.from(g.tickets),
      atoms: Array.from(g.atoms),
    },
    evidence: g.evidence,
  }));

  const matchedRows = groups.flatMap((g) => g.rows);
  const allRowsForSeverity = [...matchedRows, ...unmatched];
  const severity = summariseSeverity(allRowsForSeverity);

  return {
    summary: {
      headline: buildHeadline(rowset.rows.length, groups.length, severity),
      severity,
      bullets: buildBullets(groups),
    },
    groups,
    unmatched,
  };
}
