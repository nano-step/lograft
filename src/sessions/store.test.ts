import { describe, it, expect } from "@jest/globals";
import { SessionStore } from "./store.js";

describe("SessionStore", () => {
  it("returns undefined for missing refs", () => {
    const s = new SessionStore();
    expect(s.get("missing")).toBeUndefined();
    expect(s.has("missing")).toBe(false);
  });

  it("stores and retrieves a value", () => {
    const s = new SessionStore();
    const ref = s.put("sess-1", "rowset", { hello: "world" });
    expect(ref.startsWith("sess-1/rowset-")).toBe(true);
    expect(s.get(ref)).toEqual({ hello: "world" });
  });

  it("expires entries after TTL", () => {
    let nowMs = 1_000_000;
    const s = new SessionStore({ ttlMs: 1000, now: () => nowMs });
    const ref = s.put("s1", "x", { v: 1 });
    expect(s.has(ref)).toBe(true);
    nowMs += 1001;
    expect(s.has(ref)).toBe(false);
  });

  it("evicts LRU when over byte cap", () => {
    const s = new SessionStore({ maxBytes: 200 });
    s.put("s1", "a", "x".repeat(80));
    const refB = s.put("s1", "b", "y".repeat(80));
    s.put("s1", "c", "z".repeat(80));
    expect(s.has(refB) || s.stats().totalBytes <= 200).toBe(true);
    expect(s.stats().totalBytes).toBeLessThanOrEqual(200);
  });

  it("rejects values larger than the cap", () => {
    const s = new SessionStore({ maxBytes: 100 });
    expect(() => s.put("s1", "big", "x".repeat(200))).toThrow();
  });

  it("clears entries by sessionId prefix", () => {
    const s = new SessionStore();
    s.put("sA", "x", 1);
    s.put("sA", "y", 2);
    s.put("sB", "z", 3);
    const cleared = s.clearSession("sA");
    expect(cleared).toBe(2);
    expect(s.stats().entryCount).toBe(1);
  });

  it("updates lastAccess on get (LRU correctness)", () => {
    let nowMs = 1000;
    const s = new SessionStore({ now: () => nowMs, maxBytes: 200 });
    const refA = s.put("s", "a", "x".repeat(80));
    nowMs += 10;
    const refB = s.put("s", "b", "x".repeat(80));
    nowMs += 10;
    s.get(refA);
    nowMs += 10;
    s.put("s", "c", "x".repeat(80));
    expect(s.has(refA)).toBe(true);
    expect(s.has(refB)).toBe(false);
  });
});
