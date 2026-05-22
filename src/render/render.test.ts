import { describe, it, expect } from "@jest/globals";
import { renderMarkdown, renderJson } from "./markdown.js";
import type { CorrelatedFindings, Row } from "../types.js";

function makeRow(overrides: Partial<Row> = {}): Row {
  return {
    timestamp: "2026-05-22T00:00:00.000Z",
    level: "info",
    message: "x",
    source: "test",
    raw: {},
    ...overrides,
  };
}

function fixtureFindings(): CorrelatedFindings {
  return {
    summary: {
      headline: "[ERROR] 3 row(s) correlated into 1 finding group(s)",
      severity: "error",
      bullets: ["operationId=op-1: 3 row(s) — 1 commit(s)"],
    },
    groups: [
      {
        label: "operationId=op-1",
        rows: [
          makeRow({ level: "error", message: "boom", raw: { operation_Id: "op-1" } }),
          makeRow({ level: "error", message: "still boom", raw: { operation_Id: "op-1" } }),
        ],
        links: {
          commits: [
            {
              sha: "abcdef1234567890",
              shortSha: "abcdef1",
              author: "Test",
              authoredAt: "2026-05-22T00:00:00.000Z",
              subject: "fix: PROJ-42 root cause",
            },
          ],
          tickets: ["PROJ-42"],
          atoms: [],
        },
        evidence: [
          { logRowId: "r-0", evidenceType: "operationId", evidenceRef: "op-1" },
        ],
      },
    ],
    unmatched: [makeRow({ message: "unrelated noise" })],
  };
}

describe("renderMarkdown — structure", () => {
  it("emits the four required sections in order", () => {
    const r = renderMarkdown(fixtureFindings());
    const idxSummary = r.content.indexOf("## Summary");
    const idxFindings = r.content.indexOf("- operationId=op-1");
    const idxCorrelations = r.content.indexOf("## Correlations");
    const idxRaw = r.content.indexOf("## Raw");
    expect(idxSummary).toBeGreaterThan(-1);
    expect(idxCorrelations).toBeGreaterThan(idxSummary);
    expect(idxRaw).toBeGreaterThan(idxCorrelations);
    expect(idxFindings).toBeGreaterThan(idxSummary);
  });

  it("emits Jira-paste-ready headline within first 500 chars", () => {
    const r = renderMarkdown(fixtureFindings());
    const summaryBlock = r.content.split("## Summary")[1]?.split("##")[0] ?? "";
    expect(summaryBlock.length).toBeGreaterThan(0);
    expect(summaryBlock).toContain("[ERROR]");
  });

  it("renders raw rows as a markdown table", () => {
    const r = renderMarkdown(fixtureFindings());
    expect(r.content).toMatch(/\|\s*timestamp\s*\|\s*level\s*\|/);
    expect(r.content).toContain("boom");
  });

  it("renders unmatched rows in the raw table", () => {
    const r = renderMarkdown(fixtureFindings());
    expect(r.content).toContain("unrelated noise");
  });
});

describe("renderMarkdown — ticketLinkBase (D33)", () => {
  it("emits markdown links when ticketLinkBase provided", () => {
    const r = renderMarkdown(fixtureFindings(), {
      ticketLinkBase: "https://example.atlassian.net/browse",
    });
    expect(r.content).toContain(
      "[PROJ-42](https://example.atlassian.net/browse/PROJ-42)",
    );
  });

  it("emits plain text when ticketLinkBase absent", () => {
    const r = renderMarkdown(fixtureFindings());
    expect(r.content).toContain("PROJ-42");
    expect(r.content).not.toContain(
      "](https://example.atlassian.net/browse",
    );
  });

  it("rejects non-https base", () => {
    expect(() =>
      renderMarkdown(fixtureFindings(), {
        ticketLinkBase: "http://example.atlassian.net/browse",
      }),
    ).toThrow(/https/i);
  });

  it("rejects malformed URL", () => {
    expect(() =>
      renderMarkdown(fixtureFindings(), {
        ticketLinkBase: "not a url",
      }),
    ).toThrow();
  });

  it("URL-encodes ticket id (defence-in-depth)", () => {
    const f = fixtureFindings();
    f.groups[0]!.links.tickets = ["WEIRD/&%"];
    const r = renderMarkdown(f, {
      ticketLinkBase: "https://example.com/browse",
    });
    expect(r.content).toContain("WEIRD%2F%26%25");
  });
});

describe("renderMarkdown — truncation (D16)", () => {
  it("flags truncated when content exceeds 5MB", () => {
    const huge: CorrelatedFindings = fixtureFindings();
    huge.groups[0]!.rows = Array.from({ length: 60_000 }, (_, i) =>
      makeRow({
        message: "x".repeat(180),
        raw: { idx: i },
      }),
    );
    const r = renderMarkdown(huge, { rawRowLimit: 60_000 });
    expect(r.truncated).toBe(true);
    expect(r.content).toMatch(/TRUNCATED/);
  });

  it("does not flag truncated for normal-size reports", () => {
    const r = renderMarkdown(fixtureFindings());
    expect(r.truncated).toBe(false);
  });

  it("caps raw rows at the configured limit", () => {
    const f = fixtureFindings();
    f.unmatched = Array.from({ length: 200 }, (_, i) =>
      makeRow({ message: `row-${i}` }),
    );
    const groupRowCount = f.groups.reduce((n, g) => n + g.rows.length, 0);
    const total = groupRowCount + f.unmatched.length;
    const r = renderMarkdown(f, { rawRowLimit: 5 });
    expect(r.content).toMatch(new RegExp(`Showing first 5 of ${total} rows`));
  });
});

describe("renderJson", () => {
  it("returns parseable JSON of the full findings shape", () => {
    const r = renderJson(fixtureFindings());
    const parsed = JSON.parse(r.content);
    expect(parsed.summary.severity).toBe("error");
    expect(parsed.groups).toHaveLength(1);
    expect(parsed.unmatched).toHaveLength(1);
  });

  it("flags truncated when oversized", () => {
    const huge: CorrelatedFindings = fixtureFindings();
    huge.groups[0]!.rows = Array.from({ length: 5000 }, (_, i) =>
      makeRow({ raw: { idx: i, blob: "x".repeat(2000) } }),
    );
    const r = renderJson(huge);
    expect(r.truncated).toBe(true);
  });
});

describe("renderMarkdown — pipe-escaping in raw table", () => {
  it("escapes embedded pipes in row.message to keep table valid", () => {
    const f = fixtureFindings();
    f.unmatched = [makeRow({ message: "left | right" })];
    const r = renderMarkdown(f);
    expect(r.content).toMatch(/left \\\| right/);
  });
});
