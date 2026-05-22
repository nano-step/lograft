import { describe, it, expect } from "@jest/globals";
import { renderHtml } from "./html.js";
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
      headline: "[ERROR] 2 row(s) correlated into 1 finding group(s)",
      severity: "error",
      bullets: ["operationId=op-1: 2 row(s)"],
    },
    groups: [
      {
        label: "operationId=op-1",
        rows: [makeRow({ message: "boom" }), makeRow({ message: "again" })],
        links: {
          commits: [
            {
              sha: "abcdef1234567890",
              shortSha: "abcdef1",
              author: "Test",
              authoredAt: "2026-05-22T00:00:00.000Z",
              subject: "fix",
            },
          ],
          tickets: ["PROJ-42"],
          atoms: [],
        },
        evidence: [],
      },
    ],
    unmatched: [],
  };
}

describe("renderHtml — self-contained (D19)", () => {
  it("emits a complete single-file document", () => {
    const r = renderHtml(fixtureFindings());
    expect(r.content).toMatch(/^<!doctype html>/i);
    expect(r.content).toContain("</html>");
  });

  it("inlines all CSS in a single <style> tag — no external links", () => {
    const r = renderHtml(fixtureFindings());
    expect(r.content).toContain("<style>");
    expect(r.content).not.toMatch(/<link[^>]+rel=["']stylesheet["']/);
    expect(r.content).not.toMatch(/<script[^>]/);
  });

  it("references no remote URLs (no CDN, no remote fonts)", () => {
    const r = renderHtml(fixtureFindings());
    expect(r.content).not.toMatch(/https?:\/\/(?:cdn|fonts|unpkg|jsdelivr)/i);
  });

  it("includes a restrictive CSP meta tag", () => {
    const r = renderHtml(fixtureFindings());
    expect(r.content).toMatch(/<meta[^>]+Content-Security-Policy/i);
    expect(r.content).toContain("default-src 'none'");
  });
});

describe("renderHtml — XSS safety (R16)", () => {
  it("escapes <script> in log message content", () => {
    const f = fixtureFindings();
    f.groups[0]!.rows = [
      makeRow({ message: "<script>alert(1)</script>" }),
    ];
    const r = renderHtml(f);
    expect(r.content).not.toContain("<script>alert(1)");
    expect(r.content).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("escapes < > & \" ' in commit subjects", () => {
    const f = fixtureFindings();
    f.groups[0]!.links.commits[0]!.subject = "<img onerror='alert(1)'>";
    const r = renderHtml(f);
    expect(r.content).not.toContain("<img onerror=");
  });

  it("escapes <iframe> in headline", () => {
    const f = fixtureFindings();
    f.summary.headline = "<iframe src=javascript:1></iframe>";
    const r = renderHtml(f);
    expect(r.content).not.toContain("<iframe src=javascript:1>");
    expect(r.content).toContain("&lt;iframe");
  });
});

describe("renderHtml — ticket links (D33)", () => {
  it("emits <a href> when ticketLinkBase set and https", () => {
    const r = renderHtml(fixtureFindings(), {
      ticketLinkBase: "https://example.atlassian.net/browse",
    });
    expect(r.content).toMatch(
      /<a href="https:\/\/example\.atlassian\.net\/browse\/PROJ-42">PROJ-42<\/a>/,
    );
  });

  it("rejects non-https ticketLinkBase", () => {
    expect(() =>
      renderHtml(fixtureFindings(), {
        ticketLinkBase: "http://example.com/browse",
      }),
    ).toThrow(/https/i);
  });
});

describe("renderHtml — severity styling", () => {
  it("applies .headline.error class for error severity", () => {
    const r = renderHtml(fixtureFindings());
    expect(r.content).toMatch(/<div class="headline error"/);
  });

  it("applies .headline.info for info severity", () => {
    const f = fixtureFindings();
    f.summary.severity = "info";
    const r = renderHtml(f);
    expect(r.content).toMatch(/<div class="headline info"/);
  });
});

describe("renderHtml — sections present", () => {
  it("contains Summary, Correlations, and Raw rows sections", () => {
    const r = renderHtml(fixtureFindings());
    expect(r.content).toContain("<h2>Summary</h2>");
    expect(r.content).toContain("<h2>Correlations</h2>");
    expect(r.content).toContain("<h2>Raw rows</h2>");
  });
});

describe("renderHtml — truncation", () => {
  it("flags truncated on oversized output", () => {
    const f = fixtureFindings();
    f.groups[0]!.rows = Array.from({ length: 30_000 }, (_, i) =>
      makeRow({ message: "x".repeat(180), raw: { idx: i } }),
    );
    const r = renderHtml(f, { rawRowLimit: 30_000 });
    expect(r.truncated).toBe(true);
  });
});
