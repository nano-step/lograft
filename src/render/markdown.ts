import type { CorrelatedFindings, FindingGroup, Row } from "../types.js";
import { assertHttpsUrl, buildTicketLink, truncatedToCap } from "./util.js";

export interface RenderMarkdownOptions {
  ticketLinkBase?: string;
  rawRowLimit?: number;
}

const RAW_ROW_LIMIT = 50;

function ticketAsLink(ticket: string, base: URL | undefined): string {
  if (!base) return ticket;
  return `[${ticket}](${buildTicketLink(base, ticket)})`;
}

function renderSummary(
  findings: CorrelatedFindings,
  base: URL | undefined,
): string {
  const headline = findings.summary.headline;
  const bullets =
    findings.summary.bullets.length > 0
      ? findings.summary.bullets.map((b) => `- ${b}`).join("\n")
      : "_(no findings)_";

  const allTickets = new Set<string>();
  for (const g of findings.groups) {
    for (const t of g.links.tickets) allTickets.add(t);
  }
  const ticketLinks = Array.from(allTickets)
    .sort()
    .map((t) => `- ${ticketAsLink(t, base)}`)
    .join("\n");

  return [
    "## Summary",
    "",
    headline,
    "",
    bullets,
    ticketLinks ? `\n### Linked tickets\n\n${ticketLinks}` : "",
  ]
    .filter((s) => s.length > 0)
    .join("\n");
}

function renderGroup(group: FindingGroup, base: URL | undefined): string {
  const sections: string[] = [];
  sections.push(`### ${group.label}`);
  sections.push("");
  sections.push(`Rows: **${group.rows.length}**`);

  if (group.links.commits.length > 0) {
    sections.push("");
    sections.push("**Commits:**");
    for (const c of group.links.commits) {
      sections.push(`- \`${c.shortSha}\` ${c.subject} — ${c.author} @ ${c.authoredAt}`);
    }
  }

  if (group.links.tickets.length > 0) {
    sections.push("");
    sections.push(
      `**Tickets:** ${group.links.tickets.map((t) => ticketAsLink(t, base)).join(", ")}`,
    );
  }

  if (group.links.atoms.length > 0) {
    sections.push("");
    sections.push("**External atoms:**");
    for (const a of group.links.atoms) {
      sections.push(`- ${a.id} @ ${a.ts}: ${a.message}`);
    }
  }

  return sections.join("\n");
}

function renderCorrelations(
  findings: CorrelatedFindings,
  base: URL | undefined,
): string {
  if (findings.groups.length === 0) {
    return "## Correlations\n\n_(no correlated groups)_";
  }
  return [
    "## Correlations",
    "",
    ...findings.groups.map((g) => renderGroup(g, base)),
  ].join("\n\n");
}

function renderRawRows(findings: CorrelatedFindings, limit: number): string {
  const rows: Row[] = [
    ...findings.groups.flatMap((g) => g.rows),
    ...findings.unmatched,
  ];
  const shown = rows.slice(0, limit);
  if (shown.length === 0) return "## Raw\n\n_(no rows)_";

  const header = "| timestamp | level | source | message |";
  const sep = "|---|---|---|---|";
  const body = shown.map((r) => {
    const msg = r.message.replace(/\|/g, "\\|").slice(0, 200);
    return `| ${r.timestamp} | ${r.level} | ${r.source} | ${msg} |`;
  });
  const footer =
    rows.length > limit
      ? `\n_Showing first ${limit} of ${rows.length} rows. See \`data.json\` for the full set._`
      : "";

  return ["## Raw", "", header, sep, ...body, footer].join("\n");
}

export interface RenderedMarkdown {
  content: string;
  truncated: boolean;
}

export function renderMarkdown(
  findings: CorrelatedFindings,
  opts: RenderMarkdownOptions = {},
): RenderedMarkdown {
  const base = opts.ticketLinkBase
    ? assertHttpsUrl(opts.ticketLinkBase)
    : undefined;
  const limit = opts.rawRowLimit ?? RAW_ROW_LIMIT;

  const sections = [
    "# lograft investigation report",
    "",
    renderSummary(findings, base),
    "",
    renderCorrelations(findings, base),
    "",
    renderRawRows(findings, limit),
    "",
  ].join("\n");

  return truncatedToCap(sections);
}

export interface RenderedJson {
  content: string;
  truncated: boolean;
}

export function renderJson(findings: CorrelatedFindings): RenderedJson {
  const content = JSON.stringify(findings, null, 2);
  return truncatedToCap(content);
}
