import { describe, it, expect } from "@jest/globals";
import { parseKql, isParseError } from "./kql.js";
import type { ParsedQuery } from "../types.js";

function asQuery(result: ReturnType<typeof parseKql>): ParsedQuery {
  if (isParseError(result)) {
    throw new Error(`expected ParsedQuery, got ParseError: ${result.message}`);
  }
  return result;
}

describe("parseKql — basic shape", () => {
  it("returns ParseError on empty string", () => {
    const r = parseKql("");
    expect(isParseError(r)).toBe(true);
  });

  it("returns ParseError on whitespace-only string", () => {
    const r = parseKql("   \n\t  ");
    expect(isParseError(r)).toBe(true);
  });

  it("returns ParseError on invalid ticketRegex", () => {
    const r = parseKql("requests", { ticketRegex: "(unclosed" });
    expect(isParseError(r)).toBe(true);
  });

  it("preserves rawText verbatim", () => {
    const text = "requests | take 10";
    const q = asQuery(parseKql(text));
    expect(q.rawText).toBe(text);
  });
});

describe("parseKql — App Insights tables", () => {
  it("extracts a single table reference", () => {
    const q = asQuery(parseKql("exceptions | where severityLevel >= 3"));
    expect(q.tables).toEqual(["exceptions"]);
  });

  it("extracts multiple App Insights tables across a join", () => {
    const q = asQuery(
      parseKql(`
        requests
        | join kind=inner exceptions on operation_Id
        | join dependencies on operation_Id
      `),
    );
    expect(q.tables.sort()).toEqual(
      ["dependencies", "exceptions", "requests"].sort(),
    );
  });

  it("recognises all 5 plan-listed App Insights tables", () => {
    const q = asQuery(
      parseKql(
        "requests | union traces | union dependencies | union exceptions | union customEvents",
      ),
    );
    expect(q.tables.sort()).toEqual(
      ["customEvents", "dependencies", "exceptions", "requests", "traces"].sort(),
    );
  });
});

describe("parseKql — Log Analytics tables", () => {
  it("recognises canonical Log Analytics tables", () => {
    const q = asQuery(
      parseKql("AzureDiagnostics | where Category == 'AppServiceHTTPLogs'"),
    );
    expect(q.tables).toEqual(["AzureDiagnostics"]);
  });

  it("recognises ContainerLogs", () => {
    const q = asQuery(parseKql("ContainerLogs | take 50"));
    expect(q.tables).toEqual(["ContainerLogs"]);
  });

  it("recognises a custom *_CL table", () => {
    const q = asQuery(parseKql("MyCustomLogs_CL | where TimeGenerated > ago(1h)"));
    expect(q.tables).toEqual(["MyCustomLogs_CL"]);
  });

  it("recognises Heartbeat and Syslog", () => {
    const q = asQuery(parseKql("Heartbeat | union Syslog"));
    expect(q.tables.sort()).toEqual(["Heartbeat", "Syslog"].sort());
  });
});

describe("parseKql — low confidence fallback (R4)", () => {
  it("returns empty tables when query has no known table reference", () => {
    const q = asQuery(parseKql("totallyMadeUpTable | take 10"));
    expect(q.tables).toEqual([]);
  });

  it("does not throw on garbage input — returns empty tables instead", () => {
    const q = asQuery(parseKql("zzz xxx 12345 !!!"));
    expect(q.tables).toEqual([]);
  });
});

describe("parseKql — time range extraction", () => {
  it("extracts ago(1h)", () => {
    const fixedNow = new Date("2026-05-22T12:00:00.000Z");
    const q = asQuery(
      parseKql("requests | where timestamp > ago(1h)", { now: () => fixedNow }),
    );
    expect(q.timeRange?.to).toBe("2026-05-22T12:00:00.000Z");
    expect(q.timeRange?.from).toBe("2026-05-22T11:00:00.000Z");
  });

  it("extracts ago(30m)", () => {
    const fixedNow = new Date("2026-05-22T12:00:00.000Z");
    const q = asQuery(
      parseKql("exceptions | where timestamp > ago(30m)", {
        now: () => fixedNow,
      }),
    );
    expect(q.timeRange?.from).toBe("2026-05-22T11:30:00.000Z");
  });

  it("extracts ago(7d)", () => {
    const fixedNow = new Date("2026-05-22T00:00:00.000Z");
    const q = asQuery(
      parseKql("Heartbeat | where TimeGenerated > ago(7d)", {
        now: () => fixedNow,
      }),
    );
    expect(q.timeRange?.from).toBe("2026-05-15T00:00:00.000Z");
  });

  it("extracts between(datetime..datetime)", () => {
    const q = asQuery(
      parseKql(
        "requests | where timestamp between(datetime(2026-05-01) .. datetime(2026-05-02))",
      ),
    );
    expect(q.timeRange?.from).toContain("2026-05-01");
    expect(q.timeRange?.to).toContain("2026-05-02");
  });

  it("returns no timeRange when none present", () => {
    const q = asQuery(parseKql("requests | take 5"));
    expect(q.timeRange).toBeUndefined();
  });
});

describe("parseKql — ticket mentions", () => {
  it("extracts ticket mentions when regex is provided", () => {
    const q = asQuery(
      parseKql(
        "// related to WIN-6650 and WIN-6884\nrequests | take 10",
        { ticketRegex: "WIN-\\d+" },
      ),
    );
    expect(q.ticketMentions.sort()).toEqual(["WIN-6650", "WIN-6884"].sort());
  });

  it("returns empty ticket mentions when no regex configured (D29 — generic default)", () => {
    const q = asQuery(parseKql("// WIN-1234 mentioned but no regex\nrequests"));
    expect(q.ticketMentions).toEqual([]);
  });

  it("supports generic [A-Z]+-\\d+ pattern", () => {
    const q = asQuery(
      parseKql("// PROJ-42 and ALPHA-7\nrequests", {
        ticketRegex: "[A-Z]+-\\d+",
      }),
    );
    expect(q.ticketMentions.sort()).toEqual(["ALPHA-7", "PROJ-42"].sort());
  });

  it("deduplicates repeated ticket mentions", () => {
    const q = asQuery(
      parseKql("// PROJ-1 PROJ-1 PROJ-1\nrequests", {
        ticketRegex: "PROJ-\\d+",
      }),
    );
    expect(q.ticketMentions).toEqual(["PROJ-1"]);
  });
});

describe("parseKql — projections", () => {
  it("extracts simple project columns", () => {
    const q = asQuery(
      parseKql("requests | project timestamp, name, success | take 10"),
    );
    expect(q.projections.sort()).toEqual(
      ["name", "success", "timestamp"].sort(),
    );
  });

  it("handles project with assignment expressions", () => {
    const q = asQuery(
      parseKql(
        "requests | project ts = timestamp, msg = name, durationMs = duration",
      ),
    );
    expect(q.projections.sort()).toEqual(
      ["durationMs", "msg", "ts"].sort(),
    );
  });

  it("returns empty projections when no project clause", () => {
    const q = asQuery(parseKql("requests | take 5"));
    expect(q.projections).toEqual([]);
  });
});

describe("parseKql — comment/string stripping", () => {
  it("ignores single-line comments when extracting tables", () => {
    const q = asQuery(parseKql("// fakeTable_CL is mocked\nrequests | take 1"));
    expect(q.tables).toEqual(["requests"]);
  });

  it("ignores block comments", () => {
    const q = asQuery(
      parseKql("/* AppExceptions is mentioned here */ requests | take 1"),
    );
    expect(q.tables).toEqual(["requests"]);
  });

  it("ignores table names embedded in string literals", () => {
    const q = asQuery(
      parseKql('requests | where message == "the AppRequests table"'),
    );
    expect(q.tables).toEqual(["requests"]);
  });
});

describe("parseKql — D29 / R9 generic-purity (no hardcoded org pattern)", () => {
  it("does NOT extract WIN tickets unless caller supplies a regex", () => {
    const q = asQuery(parseKql("// WIN-1234\nrequests | take 1"));
    expect(q.ticketMentions).toEqual([]);
  });
});
