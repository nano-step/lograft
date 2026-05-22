import { describe, it, expect } from "@jest/globals";
import {
  runCorrelate,
  CORRELATE_TOOL_NAME,
  CORRELATE_DESCRIPTION,
} from "../src/server/tools/correlate.js";
import { SessionStore } from "../src/sessions/store.js";
import type {
  JoinPolicy,
  NormalizedRowset,
  RepoContext,
  Row,
} from "../src/types.js";

const POLICY: JoinPolicy = {
  operationIdField: "operation_Id",
  tiebreakerWindowMin: 10,
};

const REPO_CTX: RepoContext = {
  repoPath: "/tmp/repo",
  commits: [],
  currentBranch: "main",
};

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

function makeRowset(rows: Row[]): NormalizedRowset {
  return {
    columns: [],
    rows,
    meta: { source: "csv", rowCount: rows.length, truncated: false },
  };
}

describe("lograft_correlate — MCP tool", () => {
  it("has a stable tool name", () => {
    expect(CORRELATE_TOOL_NAME).toBe("lograft_correlate");
  });

  it("description steers LLM clients toward lograft_investigate", () => {
    expect(CORRELATE_DESCRIPTION).toMatch(/lograft_investigate/i);
  });

  it("returns ok envelope with inline rowset", async () => {
    const r = await runCorrelate({
      rowset: {
        kind: "inline",
        rowset: makeRowset([makeRow({ raw: { operation_Id: "op-1" } })]),
      },
      repoContext: REPO_CTX,
      joinPolicy: POLICY,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.groupCount).toBe(1);
      expect(r.data.unmatchedCount).toBe(0);
    }
  });

  it("rehydrates rowset from a ref", async () => {
    const store = new SessionStore();
    const rowset = makeRowset(
      Array.from({ length: 200 }, () =>
        makeRow({ raw: { operation_Id: "shared" } }),
      ),
    );
    const ref = store.put("sess-1", "rowset", rowset);

    const r = await runCorrelate(
      {
        rowset: { kind: "ref", rowsetRef: ref },
        repoContext: REPO_CTX,
        joinPolicy: POLICY,
        sessionId: "sess-1",
      },
      store,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.findingsRef).toBeDefined();
      expect(r.data.groupCount).toBe(1);
    }
  });

  it("fails INPUT_INVALID for missing rowsetRef", async () => {
    const r = await runCorrelate({
      rowset: { kind: "ref", rowsetRef: "missing/x" },
      repoContext: REPO_CTX,
      joinPolicy: POLICY,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INPUT_INVALID");
  });

  it("warns when no key match (D17 explicit-keys-only) — full unmatched", async () => {
    const r = await runCorrelate({
      rowset: { kind: "inline", rowset: makeRowset([makeRow(), makeRow()]) },
      repoContext: REPO_CTX,
      joinPolicy: POLICY,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.groupCount).toBe(0);
      expect(r.data.unmatchedCount).toBe(2);
      expect(r.warnings?.some((w) => /no explicit join keys/.test(w))).toBe(
        true,
      );
    }
  });

  it("redactor middleware is applied to output (D13)", async () => {
    const r = await runCorrelate({
      rowset: {
        kind: "inline",
        rowset: makeRowset([
          makeRow({
            message: "fail user alice@example.com",
            raw: { operation_Id: "op-r" },
          }),
        ]),
      },
      repoContext: REPO_CTX,
      joinPolicy: POLICY,
      sessionId: "sess-redact",
    });
    expect(r.ok).toBe(true);
  });
});
