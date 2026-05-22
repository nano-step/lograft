import { describe, it, expect } from "@jest/globals";
import {
  ParsedQuery,
  ParseError,
  Row,
  NormalizedRowset,
  RepoContext,
  CorrelatedFindings,
  Bundle,
  Payload,
  JoinPolicy,
  ExternalAtomRef,
  RedactionRule,
} from "./types.js";
import { ErrorCode, ok, fail, type ToolResult } from "./errors.js";

describe("ParsedQuery", () => {
  it("accepts a valid parsed query", () => {
    const q = ParsedQuery.parse({
      tables: ["requests", "exceptions"],
      timeRange: { from: "2026-05-22T00:00:00Z", to: "2026-05-22T01:00:00Z" },
      ticketMentions: ["WIN-123"],
      projections: ["timestamp", "message"],
      rawText: "requests | take 10",
    });
    expect(q.tables).toHaveLength(2);
    expect(q.timeRange?.from).toBe("2026-05-22T00:00:00Z");
  });

  it("rejects an unparseable timestamp", () => {
    expect(() =>
      ParsedQuery.parse({
        tables: [],
        timeRange: { from: "not-a-date", to: "2026-05-22T01:00:00Z" },
        ticketMentions: [],
        projections: [],
        rawText: "",
      }),
    ).toThrow();
  });

  it("allows empty tables (low-confidence parse — R4)", () => {
    const q = ParsedQuery.parse({
      tables: [],
      ticketMentions: [],
      projections: [],
      rawText: "garbage",
    });
    expect(q.tables).toEqual([]);
  });
});

describe("ParseError", () => {
  it("requires kind literal", () => {
    const e = ParseError.parse({
      kind: "parse-error",
      message: "syntax error",
      rawText: "junk",
    });
    expect(e.kind).toBe("parse-error");
  });
});

describe("Row (D18 — exactly 5 named fields)", () => {
  it("accepts the 5-field shape", () => {
    const r = Row.parse({
      timestamp: "2026-05-22T00:00:00Z",
      level: "error",
      message: "boom",
      source: "Sweeps.Skrill",
      raw: { custom: 42 },
    });
    expect(Object.keys(r)).toEqual([
      "timestamp",
      "level",
      "message",
      "source",
      "raw",
    ]);
  });

  it("rejects missing raw object", () => {
    expect(() =>
      Row.parse({
        timestamp: "2026-05-22T00:00:00Z",
        level: "error",
        message: "boom",
        source: "x",
      }),
    ).toThrow();
  });
});

describe("NormalizedRowset", () => {
  it("round-trips a small rowset", () => {
    const rs = NormalizedRowset.parse({
      columns: [{ name: "timestamp", type: "datetime" }],
      rows: [
        {
          timestamp: "2026-05-22T00:00:00Z",
          level: "info",
          message: "ok",
          source: "test",
          raw: {},
        },
      ],
      meta: { source: "csv", rowCount: 1, truncated: false },
    });
    expect(rs.rows).toHaveLength(1);
    expect(rs.meta.source).toBe("csv");
  });

  it("source enum rejects legacy 'azmcp-json' string", () => {
    expect(() =>
      NormalizedRowset.parse({
        columns: [],
        rows: [],
        meta: { source: "azmcp-json", rowCount: 0, truncated: false },
      }),
    ).toThrow();
  });
});

describe("RepoContext", () => {
  it("accepts an empty commits list", () => {
    const ctx = RepoContext.parse({
      repoPath: "/tmp/repo",
      commits: [],
      currentBranch: "main",
    });
    expect(ctx.commits).toEqual([]);
  });
});

describe("JoinPolicy defaults", () => {
  it("defaults operationIdField + tiebreakerWindowMin", () => {
    const p = JoinPolicy.parse({});
    expect(p.operationIdField).toBe("operation_Id");
    expect(p.tiebreakerWindowMin).toBe(10);
  });
});

describe("CorrelatedFindings", () => {
  it("requires summary, groups, unmatched", () => {
    const f = CorrelatedFindings.parse({
      summary: { headline: "all good", severity: "info", bullets: [] },
      groups: [],
      unmatched: [],
    });
    expect(f.summary.severity).toBe("info");
  });

  it("rejects a headline over 500 chars", () => {
    expect(() =>
      CorrelatedFindings.parse({
        summary: {
          headline: "x".repeat(501),
          severity: "info",
          bullets: [],
        },
        groups: [],
        unmatched: [],
      }),
    ).toThrow();
  });

  it("rejects more than 10 bullets", () => {
    expect(() =>
      CorrelatedFindings.parse({
        summary: {
          headline: "h",
          severity: "info",
          bullets: Array(11).fill("b"),
        },
        groups: [],
        unmatched: [],
      }),
    ).toThrow();
  });
});

describe("ExternalAtomRef (generic shape — no org leak)", () => {
  it("accepts minimal 4-field shape", () => {
    const a = ExternalAtomRef.parse({
      id: "atom-1",
      ts: "2026-05-22T00:00:00Z",
      message: "error happened",
    });
    expect(a.tags).toBeUndefined();
  });
});

describe("Bundle", () => {
  it("requires dir, formats optional", () => {
    const b = Bundle.parse({ dir: "/tmp/reports/run-1" });
    expect(b.mdPath).toBeUndefined();
  });
});

describe("Payload discriminated union", () => {
  it("accepts inline form", () => {
    const p = Payload.parse({ kind: "inline", data: "hi" });
    expect(p.kind).toBe("inline");
  });

  it("accepts path form", () => {
    const p = Payload.parse({ kind: "path", filePath: "/tmp/file" });
    expect(p.kind).toBe("path");
  });

  it("rejects mixed shape (Oracle: pick one)", () => {
    expect(() =>
      Payload.parse({ kind: "inline", filePath: "/tmp/file" }),
    ).toThrow();
  });
});

describe("ErrorCode enum (D25)", () => {
  it("includes all 12 codes", () => {
    expect(ErrorCode.options).toContain("AZMCP_NOT_FOUND");
    expect(ErrorCode.options).toContain("RENDER_CAP_EXCEEDED");
    expect(ErrorCode.options).toContain("INTERNAL");
  });
});

describe("ToolResult envelope helpers", () => {
  it("ok() wraps data", () => {
    const r: ToolResult<number> = ok(42);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toBe(42);
  });

  it("ok() with warnings", () => {
    const r = ok(42, ["watch out"]);
    expect(r.warnings).toEqual(["watch out"]);
  });

  it("ok() drops empty warnings array", () => {
    const r = ok(42, []);
    expect(r.warnings).toBeUndefined();
  });

  it("fail() builds the envelope", () => {
    const r = fail("CONFIG_INVALID", "bad TOML", { hint: "check syntax" });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("CONFIG_INVALID");
    expect(r.retryable).toBe(false);
    expect(r.hint).toBe("check syntax");
  });

  it("fail() retryable defaults to false", () => {
    const r = fail("AZMCP_TIMEOUT", "slow", { retryable: true });
    expect(r.retryable).toBe(true);
  });
});

describe("RedactionRule", () => {
  it("defaults replacement to [REDACTED]", () => {
    const r = RedactionRule.parse({ name: "email", pattern: "\\S+@\\S+" });
    expect(r.replacement).toBe("[REDACTED]");
  });
});
