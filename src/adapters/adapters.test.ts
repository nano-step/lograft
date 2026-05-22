import { describe, it, expect } from "@jest/globals";
import { RawDataAdapter } from "./index.js";

describe("RawDataAdapter", () => {
  it("declares paste-only capability", () => {
    const a = new RawDataAdapter();
    expect(a.id).toBe("raw");
    expect(a.capabilities.paste).toBe(true);
    expect(a.capabilities.live).toBe(false);
  });

  it("validate() always succeeds (no external dep)", async () => {
    const a = new RawDataAdapter();
    const v = await a.validate();
    expect(v.ok).toBe(true);
  });

  it("fetch passes through to normalize for csv", async () => {
    const a = new RawDataAdapter();
    const rs = await a.fetch(
      {
        kind: "raw",
        source: "csv",
        data: "timestamp,message\n2026-05-22T00:00:00Z,hi",
      },
      new AbortController().signal,
    );
    expect(rs.rows).toHaveLength(1);
    expect(rs.meta.source).toBe("csv");
  });

  it("fetch rejects non-raw input kind", async () => {
    const a = new RawDataAdapter();
    await expect(
      a.fetch(
        {
          kind: "azmcp",
          workspaceId: "x",
          subscriptionId: "y",
          table: "z",
          query: "q",
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/cannot handle/);
  });

  it("respects rowCap option", async () => {
    const a = new RawDataAdapter();
    const csv = ["timestamp,message"];
    for (let i = 0; i < 50; i++) csv.push(`2026-05-22T00:00:00Z,m${i}`);
    const rs = await a.fetch(
      { kind: "raw", source: "csv", data: csv.join("\n"), rowCap: 10 },
      new AbortController().signal,
    );
    expect(rs.rows.length).toBe(10);
    expect(rs.meta.truncated).toBe(true);
  });
});
