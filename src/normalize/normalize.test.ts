import { describe, it, expect } from "@jest/globals";
import { normalize, DEFAULT_ROW_CAP } from "./index.js";

describe("normalize — CSV", () => {
  it("parses a simple CSV with headers", () => {
    const csv = `timestamp,level,message,source
2026-05-22T00:00:00Z,error,boom,Sweeps.Skrill
2026-05-22T00:01:00Z,info,ok,Sweeps.Health`;
    const rs = normalize("csv", csv);
    expect(rs.rows).toHaveLength(2);
    expect(rs.rows[0]?.timestamp).toBe("2026-05-22T00:00:00.000Z");
    expect(rs.rows[0]?.level).toBe("error");
    expect(rs.rows[0]?.message).toBe("boom");
    expect(rs.rows[0]?.source).toBe("Sweeps.Skrill");
    expect(rs.meta.source).toBe("csv");
    expect(rs.meta.rowCount).toBe(2);
    expect(rs.meta.truncated).toBe(false);
  });

  it("handles CSV cells with embedded commas via double-quote escaping", () => {
    const csv = `timestamp,message
2026-05-22T00:00:00Z,"hello, world"`;
    const rs = normalize("csv", csv);
    expect(rs.rows[0]?.raw?.message).toBe("hello, world");
  });

  it("handles CSV cells with embedded newlines via double-quote escaping", () => {
    const csv = `timestamp,message
2026-05-22T00:00:00Z,"line1\nline2"`;
    const rs = normalize("csv", csv);
    expect(rs.rows).toHaveLength(1);
  });

  it("falls back to source='unknown' when no source-like column", () => {
    const csv = `timestamp,message
2026-05-22T00:00:00Z,hi`;
    const rs = normalize("csv", csv);
    expect(rs.rows[0]?.source).toBe("unknown");
  });

  it("infers timestamp column type", () => {
    const csv = `timestamp,count
2026-05-22T00:00:00Z,5`;
    const rs = normalize("csv", csv);
    const tsCol = rs.columns.find((c) => c.name === "timestamp");
    const countCol = rs.columns.find((c) => c.name === "count");
    expect(tsCol?.type).toBe("datetime");
    expect(countCol?.type).toBe("number");
  });
});

describe("normalize — JSON", () => {
  it("parses an array of row objects", () => {
    const json = JSON.stringify([
      {
        timestamp: "2026-05-22T00:00:00Z",
        level: "error",
        message: "boom",
        source: "x",
      },
      {
        timestamp: "2026-05-22T00:01:00Z",
        level: "info",
        message: "ok",
        source: "y",
      },
    ]);
    const rs = normalize("json", json);
    expect(rs.rows).toHaveLength(2);
    expect(rs.meta.source).toBe("json");
  });

  it("handles a single-object input", () => {
    const json = JSON.stringify({
      timestamp: "2026-05-22T00:00:00Z",
      message: "single",
    });
    const rs = normalize("json", json);
    expect(rs.rows).toHaveLength(1);
    expect(rs.rows[0]?.message).toBe("single");
  });

  it("normalises App Insights severityLevel ints to canonical levels", () => {
    const json = JSON.stringify([
      { timestamp: "2026-05-22T00:00:00Z", severityLevel: 2, message: "err" },
    ]);
    const rs = normalize("json", json);
    expect(rs.rows[0]?.level).toBe("error");
  });
});

describe("normalize — azure-monitor-json", () => {
  it("parses Azure Monitor tables format", () => {
    const data = JSON.stringify({
      tables: [
        {
          name: "PrimaryResult",
          columns: [
            { name: "TimeGenerated", type: "datetime" },
            { name: "Message", type: "string" },
            { name: "Source", type: "string" },
          ],
          rows: [
            ["2026-05-22T00:00:00Z", "boom", "Sweeps.Skrill"],
            ["2026-05-22T00:01:00Z", "ok", "Sweeps.Health"],
          ],
        },
      ],
    });
    const rs = normalize("azure-monitor-json", data);
    expect(rs.rows).toHaveLength(2);
    expect(rs.rows[0]?.message).toBe("boom");
    expect(rs.rows[0]?.source).toBe("Sweeps.Skrill");
    expect(rs.meta.source).toBe("azure-monitor-json");
  });

  it("falls back to plain-array shape if tables key absent", () => {
    const data = JSON.stringify([
      { TimeGenerated: "2026-05-22T00:00:00Z", Message: "x", Source: "y" },
    ]);
    const rs = normalize("azure-monitor-json", data);
    expect(rs.rows).toHaveLength(1);
  });
});

describe("normalize — truncation (D16)", () => {
  it("flags truncated when rows exceed cap", () => {
    const csv = ["timestamp,message"];
    for (let i = 0; i < DEFAULT_ROW_CAP + 5; i++) {
      csv.push(`2026-05-22T00:00:0${i % 10}Z,m${i}`);
    }
    const rs = normalize("csv", csv.join("\n"));
    expect(rs.meta.truncated).toBe(true);
    expect(rs.rows.length).toBe(DEFAULT_ROW_CAP);
  });

  it("does not flag truncated when under cap", () => {
    const rs = normalize(
      "csv",
      `timestamp,message
2026-05-22T00:00:00Z,m`,
    );
    expect(rs.meta.truncated).toBe(false);
  });
});

describe("normalize — empty input", () => {
  it("returns empty rowset on empty CSV", () => {
    const rs = normalize("csv", "");
    expect(rs.rows).toEqual([]);
    expect(rs.meta.rowCount).toBe(0);
  });

  it("returns empty rowset on empty JSON", () => {
    const rs = normalize("json", "");
    expect(rs.rows).toEqual([]);
  });
});
