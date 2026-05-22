import { describe, it, expect } from "@jest/globals";
import {
  runNormalize,
  NORMALIZE_TOOL_NAME,
  NORMALIZE_DESCRIPTION,
} from "../src/server/tools/normalize.js";
import { SessionStore } from "../src/sessions/store.js";

describe("lograft_normalize — MCP tool", () => {
  it("has a stable tool name", () => {
    expect(NORMALIZE_TOOL_NAME).toBe("lograft_normalize");
  });

  it("description steers LLM clients toward lograft_investigate", () => {
    expect(NORMALIZE_DESCRIPTION).toMatch(/lograft_investigate/i);
  });

  it("returns ok envelope on a tiny CSV (no rowsetRef for <=100 rows even with sessionId)", async () => {
    const store = new SessionStore();
    const r = await runNormalize(
      {
        source: "csv",
        payload: { kind: "inline", data: "timestamp,message\n2026-05-22T00:00:00Z,hi" },
        sessionId: "test",
      },
      store,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.rowsetRef).toBeUndefined();
      expect(r.data.preview.rows).toHaveLength(1);
    }
  });

  it("returns a rowsetRef when >100 rows and sessionId is set", async () => {
    const store = new SessionStore();
    const csv = ["timestamp,message"];
    for (let i = 0; i < 150; i++) {
      csv.push(`2026-05-22T00:00:00Z,m${i}`);
    }
    const r = await runNormalize(
      {
        source: "csv",
        payload: { kind: "inline", data: csv.join("\n") },
        sessionId: "many",
      },
      store,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.rowsetRef).toBeDefined();
      expect(r.data.preview.rows.length).toBeLessThanOrEqual(50);
      expect(store.has(r.data.rowsetRef!)).toBe(true);
    }
  });

  it("does NOT use rowsetRef when sessionId is omitted (D24 stateless default)", async () => {
    const store = new SessionStore();
    const csv = ["timestamp,message"];
    for (let i = 0; i < 200; i++) {
      csv.push(`2026-05-22T00:00:00Z,m${i}`);
    }
    const r = await runNormalize(
      { source: "csv", payload: { kind: "inline", data: csv.join("\n") } },
      store,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.rowsetRef).toBeUndefined();
      expect(r.data.preview.rows).toHaveLength(200);
    }
  });

  it("fails with INPUT_INVALID on bad source", async () => {
    const r = await runNormalize({
      source: "yaml" as unknown as "csv",
      payload: { kind: "inline", data: "x" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INPUT_INVALID");
  });

  it("fails with FS_ERROR for missing path", async () => {
    const r = await runNormalize({
      source: "csv",
      payload: { kind: "path", filePath: "/tmp/__lograft_nonexistent.csv" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("FS_ERROR");
  });

  it("surfaces a warning when rowset is truncated", async () => {
    const store = new SessionStore();
    const csv = ["timestamp,message"];
    for (let i = 0; i < 1100; i++) {
      csv.push(`2026-05-22T00:00:00Z,m${i}`);
    }
    const r = await runNormalize(
      { source: "csv", payload: { kind: "inline", data: csv.join("\n") } },
      store,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings?.some((w) => /truncated/.test(w))).toBe(true);
    }
  });
});
