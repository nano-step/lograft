import type { CorrelatedFindings, FindingGroup, Row } from "../types.js";
import { renderMarkdown, type RenderMarkdownOptions } from "./markdown.js";
import { assertHttpsUrl, buildTicketLink, truncatedToCap } from "./util.js";

export interface RenderHtmlOptions extends RenderMarkdownOptions {
  title?: string;
}

export interface RenderedHtml {
  content: string;
  truncated: boolean;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CSS = `
*, *::before, *::after { box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  line-height: 1.55;
  max-width: 960px;
  margin: 2rem auto;
  padding: 0 1rem;
  color: #1c1e21;
  background: #fafbfc;
}
h1, h2, h3 { line-height: 1.25; }
h1 { font-size: 1.6rem; border-bottom: 1px solid #d0d7de; padding-bottom: 0.4rem; }
h2 { font-size: 1.3rem; margin-top: 2rem; border-bottom: 1px solid #eaecef; padding-bottom: 0.3rem; }
h3 { font-size: 1.1rem; margin-top: 1.5rem; }
.headline { font-size: 1.05rem; padding: 0.75rem 1rem; border-radius: 6px; }
.headline.error { background: #ffeef0; border-left: 4px solid #d73a49; }
.headline.warn  { background: #fff8e1; border-left: 4px solid #b08800; }
.headline.info  { background: #f1f8ff; border-left: 4px solid #0366d6; }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.85rem; }
code { background: #f1f3f5; padding: 0.1rem 0.35rem; border-radius: 4px; }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: 0.9rem; }
th, td { border: 1px solid #d0d7de; padding: 0.4rem 0.6rem; text-align: left; vertical-align: top; }
th { background: #f1f3f5; }
tr:nth-child(even) td { background: #fafbfc; }
.group { background: white; border: 1px solid #d0d7de; border-radius: 6px; padding: 1rem 1.2rem; margin: 1rem 0; }
.muted { color: #6a737d; font-size: 0.85rem; }
ul { padding-left: 1.5rem; }
li { margin: 0.2rem 0; }
.truncated-note { background: #fff8e1; padding: 0.5rem 1rem; border-left: 4px solid #b08800; border-radius: 4px; margin-top: 2rem; }
a { color: #0366d6; text-decoration: none; }
a:hover { text-decoration: underline; }
`;

function renderBullets(bullets: string[]): string {
  if (bullets.length === 0) return "<p class='muted'>No findings.</p>";
  return `<ul>${bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>`;
}

function renderTickets(tickets: string[], base: URL | undefined): string {
  if (tickets.length === 0) return "";
  const items = tickets
    .map((t) => {
      const escaped = escapeHtml(t);
      if (base) {
        const url = escapeHtml(buildTicketLink(base, t));
        return `<a href="${url}">${escaped}</a>`;
      }
      return escaped;
    })
    .join(", ");
  return `<p><strong>Tickets:</strong> ${items}</p>`;
}

function renderGroup(group: FindingGroup, base: URL | undefined): string {
  const commitsHtml =
    group.links.commits.length === 0
      ? ""
      : `<p><strong>Commits:</strong></p><ul>${group.links.commits
          .map(
            (c) =>
              `<li><code>${escapeHtml(c.shortSha)}</code> ${escapeHtml(c.subject)} — ${escapeHtml(c.author)} @ ${escapeHtml(c.authoredAt)}</li>`,
          )
          .join("")}</ul>`;

  const atomsHtml =
    group.links.atoms.length === 0
      ? ""
      : `<p><strong>External atoms:</strong></p><ul>${group.links.atoms
          .map(
            (a) =>
              `<li>${escapeHtml(a.id)} @ ${escapeHtml(a.ts)}: ${escapeHtml(a.message)}</li>`,
          )
          .join("")}</ul>`;

  return `<div class="group">
  <h3>${escapeHtml(group.label)}</h3>
  <p>Rows: <strong>${group.rows.length}</strong></p>
  ${commitsHtml}
  ${renderTickets(group.links.tickets, base)}
  ${atomsHtml}
</div>`;
}

function renderRawTable(findings: CorrelatedFindings, limit: number): string {
  const rows: Row[] = [
    ...findings.groups.flatMap((g) => g.rows),
    ...findings.unmatched,
  ];
  const shown = rows.slice(0, limit);
  if (shown.length === 0) return "<p class='muted'>No rows.</p>";

  const head = `<thead><tr><th>timestamp</th><th>level</th><th>source</th><th>message</th></tr></thead>`;
  const body = `<tbody>${shown
    .map(
      (r) =>
        `<tr><td><code>${escapeHtml(r.timestamp)}</code></td><td>${escapeHtml(r.level)}</td><td>${escapeHtml(r.source)}</td><td>${escapeHtml(r.message.slice(0, 500))}</td></tr>`,
    )
    .join("")}</tbody>`;

  const footer =
    rows.length > limit
      ? `<p class="muted">Showing first ${limit} of ${rows.length} rows. See <code>data.json</code> for the full set.</p>`
      : "";

  return `<table>${head}${body}</table>${footer}`;
}

export function renderHtml(
  findings: CorrelatedFindings,
  opts: RenderHtmlOptions = {},
): RenderedHtml {
  const base = opts.ticketLinkBase
    ? assertHttpsUrl(opts.ticketLinkBase)
    : undefined;
  const limit = opts.rawRowLimit ?? 50;
  const title = opts.title ?? "lograft investigation report";

  void renderMarkdown;

  const severityClass = findings.summary.severity;

  const bulletsHtml = renderBullets(findings.summary.bullets);
  const allTickets = new Set<string>();
  for (const g of findings.groups) for (const t of g.links.tickets) allTickets.add(t);
  const ticketLinks = renderTickets(Array.from(allTickets).sort(), base);

  const groupsHtml =
    findings.groups.length === 0
      ? "<p class='muted'>No correlated groups.</p>"
      : findings.groups.map((g) => renderGroup(g, base)).join("\n");

  const rawHtml = renderRawTable(findings, limit);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'self'">
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>

<h2>Summary</h2>
<div class="headline ${severityClass}">${escapeHtml(findings.summary.headline)}</div>
${bulletsHtml}
${ticketLinks}

<h2>Correlations</h2>
${groupsHtml}

<h2>Raw rows</h2>
${rawHtml}

</body>
</html>
`;

  return truncatedToCap(html);
}
