import { describe, it, expect } from "@jest/globals";
import {
  redactFindings,
  redactString,
  buildCompiledRules,
  defaultRedactionRules,
} from "./index.js";
import { compileRule } from "./default-rules.js";
import type { CorrelatedFindings, Row } from "../types.js";

const compiled = buildCompiledRules(defaultRedactionRules);

function makeRow(overrides: Partial<Row> = {}): Row {
  return {
    timestamp: "2026-05-22T00:00:00.000Z",
    level: "error",
    message: "x",
    source: "test",
    raw: {},
    ...overrides,
  };
}

function makeFindings(rows: Row[]): CorrelatedFindings {
  return {
    summary: { headline: "h", severity: "info", bullets: [] },
    groups: [],
    unmatched: rows,
  };
}

describe("compileRule — inline (?i) handling", () => {
  it("strips inline (?i) flag and applies to JS flags", () => {
    const r = compileRule({
      name: "auth",
      pattern: "(?i)Authorization:\\s*Bearer\\s+\\S+",
      flags: "g",
      replacement: "X",
    });
    expect(r.flags).toContain("i");
    expect(r.flags).toContain("g");
    expect("authorization: BEARER token".replace(r, "X")).toBe("X");
  });

  it("forces 'g' flag even when not requested", () => {
    const r = compileRule({
      name: "x",
      pattern: "abc",
      replacement: "X",
    });
    expect(r.flags).toContain("g");
  });
});

describe("redactString — built-in rule coverage (R20 poisoned-fixture)", () => {
  const cases: Array<[string, string, RegExp]> = [
    ["email", "ping alice@example.com pong", /\[REDACTED:email\]/],
    ["JWT", "tok eyJabcdefgh.eyJijklmnop.signaturexyz", /\[REDACTED:jwt\]/],
    ["Authorization Bearer", "Authorization: Bearer abc.def.ghi", /\[REDACTED\]/],
    ["Authorization Basic", "Authorization: Basic dXNlcjpwYXNz", /\[REDACTED\]/],
    ["RFC1918 10.x", "host 10.0.0.5 down", /\[REDACTED:ipv4\]/],
    ["RFC1918 192.168", "ip 192.168.1.10 ok", /\[REDACTED:ipv4\]/],
    ["RFC1918 172.16", "ip 172.16.0.1 ok", /\[REDACTED:ipv4\]/],
    ["public IPv4", "from 203.0.113.5 fired", /\[REDACTED:ipv4\]/],
    ["IPv6", "::1-ish fe80:0:0:0:1:2:3:4 here", /\[REDACTED:ipv6\]/],
    ["internal hostname .internal", "host db-01.internal failed", /\[REDACTED:hostname\]/],
    ["internal hostname .corp", "from web.corp", /\[REDACTED:hostname\]/],
    ["internal hostname .local", "node-7.local restart", /\[REDACTED:hostname\]/],
    [
      "GUID in auth ctx",
      "token=550e8400-e29b-41d4-a716-446655440000",
      /\[REDACTED:guid\]/,
    ],
  ];

  for (const [label, input, expected] of cases) {
    it(`redacts ${label}`, () => {
      const out = redactString(input, compiled);
      expect(out).toMatch(expected);
    });
  }

  it("leaves benign text untouched", () => {
    expect(redactString("the user paid 5 credits", compiled)).toBe(
      "the user paid 5 credits",
    );
  });
});

describe("redactFindings — chokepoint coverage", () => {
  it("redacts row.message", () => {
    const out = redactFindings(
      makeFindings([makeRow({ message: "from alice@example.com" })]),
    );
    expect(out.unmatched[0]?.message).toMatch(/\[REDACTED:email\]/);
  });

  it("redacts row.raw (nested)", () => {
    const out = redactFindings(
      makeFindings([
        makeRow({ raw: { nested: { ip: "10.0.0.5", note: "ok" } } }),
      ]),
    );
    const ip = (out.unmatched[0]?.raw?.nested as { ip: string })?.ip;
    expect(ip).toMatch(/\[REDACTED:ipv4\]/);
  });

  it("redacts summary.headline and summary.bullets", () => {
    const out = redactFindings({
      summary: {
        headline: "leak alice@example.com",
        severity: "info",
        bullets: ["host db.internal", "no leak here"],
      },
      groups: [],
      unmatched: [],
    });
    expect(out.summary.headline).toMatch(/\[REDACTED:email\]/);
    expect(out.summary.bullets[0]).toMatch(/\[REDACTED:hostname\]/);
    expect(out.summary.bullets[1]).toBe("no leak here");
  });

  it("preserves row.timestamp/level/source verbatim", () => {
    const out = redactFindings(
      makeFindings([
        makeRow({
          timestamp: "2026-05-22T01:23:45.000Z",
          level: "error",
          source: "Sweeps.Payments",
        }),
      ]),
    );
    expect(out.unmatched[0]?.timestamp).toBe("2026-05-22T01:23:45.000Z");
    expect(out.unmatched[0]?.level).toBe("error");
    expect(out.unmatched[0]?.source).toBe("Sweeps.Payments");
  });

  it("bypass:true passes through and emits a warning", () => {
    const warnings: string[] = [];
    const out = redactFindings(
      makeFindings([makeRow({ message: "alice@example.com" })]),
      { bypass: true, warn: (m) => warnings.push(m) },
    );
    expect(out.unmatched[0]?.message).toBe("alice@example.com");
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/redaction bypassed/i);
  });

  it("idempotency: redacting twice yields the same result", () => {
    const input = makeFindings([
      makeRow({ message: "alice@example.com 10.0.0.5" }),
    ]);
    const once = redactFindings(input);
    const twice = redactFindings(once);
    expect(twice).toEqual(once);
  });
});

describe("redactFindings — D13 R20 poisoned-fixture full sweep", () => {
  it("seeds 12 PII shapes — none survive default redaction", () => {
    const seeds = [
      "alice@example.com",
      "bob@playstudios.com",
      "eyJabcdefgh.eyJijklmnop.signaturexyz",
      "Authorization: Bearer s3cr3t.token.here",
      "Authorization: Basic dXNlcjpwYXNz",
      "token=550e8400-e29b-41d4-a716-446655440000",
      "10.20.30.40",
      "192.168.1.1",
      "172.16.5.6",
      "203.0.113.5",
      "fe80:0:0:0:1:2:3:4",
      "db-01.internal",
    ];
    const rows = seeds.map((s, i) =>
      makeRow({ message: s, raw: { idx: i, copy: s } }),
    );
    const out = redactFindings(makeFindings(rows));
    for (let i = 0; i < seeds.length; i++) {
      const seed = seeds[i]!;
      expect(out.unmatched[i]?.message).not.toContain(seed);
      const rawCopy = (out.unmatched[i]?.raw as { copy?: string })?.copy;
      expect(rawCopy).not.toContain(seed);
    }
  });
});
