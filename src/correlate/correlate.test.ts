import { describe, it, expect } from "@jest/globals";
import { correlate } from "./index.js";
import type {
  GitCommitRef,
  NormalizedRowset,
  RepoContext,
  Row,
  JoinPolicy,
  ExternalAtomRef,
} from "../types.js";

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

function makeCommit(overrides: Partial<GitCommitRef> = {}): GitCommitRef {
  return {
    sha: "abcdef1234567890",
    shortSha: "abcdef1",
    author: "Test",
    authoredAt: "2026-05-22T00:00:00.000Z",
    subject: "feat: thing",
    ...overrides,
  };
}

function makeRepoContext(commits: GitCommitRef[] = []): RepoContext {
  return {
    repoPath: "/tmp/repo",
    commits,
    currentBranch: "main",
  };
}

const DEFAULT_POLICY: JoinPolicy = {
  operationIdField: "operation_Id",
  tiebreakerWindowMin: 10,
};

describe("correlate — operationId match", () => {
  it("groups rows sharing the same operation_Id", () => {
    const f = correlate({
      rowset: makeRowset([
        makeRow({ raw: { operation_Id: "op-1" } }),
        makeRow({ raw: { operation_Id: "op-1" } }),
        makeRow({ raw: { operation_Id: "op-2" } }),
      ]),
      repoContext: makeRepoContext(),
      joinPolicy: DEFAULT_POLICY,
    });
    expect(f.groups).toHaveLength(2);
    expect(f.unmatched).toHaveLength(0);
  });

  it("uses configured operationIdField for non-default name", () => {
    const f = correlate({
      rowset: makeRowset([
        makeRow({ raw: { traceId: "t-1" } }),
        makeRow({ raw: { traceId: "t-1" } }),
      ]),
      repoContext: makeRepoContext(),
      joinPolicy: { ...DEFAULT_POLICY, operationIdField: "traceId" },
    });
    expect(f.groups).toHaveLength(1);
  });
});

describe("correlate — ticket regex match (configurable, D29)", () => {
  it("groups rows by ticket mention when regex configured", () => {
    const f = correlate({
      rowset: makeRowset([
        makeRow({ message: "PROJ-42 broke" }),
        makeRow({ message: "PROJ-42 again" }),
        makeRow({ message: "no ticket" }),
      ]),
      repoContext: makeRepoContext(),
      joinPolicy: { ...DEFAULT_POLICY, ticketRegex: "PROJ-\\d+" },
    });
    expect(f.groups).toHaveLength(1);
    expect(f.groups[0]?.links.tickets).toEqual(["PROJ-42"]);
    expect(f.unmatched).toHaveLength(1);
  });

  it("falls back to unmatched when no ticket regex configured", () => {
    const f = correlate({
      rowset: makeRowset([makeRow({ message: "PROJ-42 broke" })]),
      repoContext: makeRepoContext(),
      joinPolicy: DEFAULT_POLICY,
    });
    expect(f.unmatched).toHaveLength(1);
    expect(f.groups).toHaveLength(0);
  });
});

describe("correlate — service allowlist match", () => {
  it("groups rows by exact service-name match", () => {
    const f = correlate({
      rowset: makeRowset([
        makeRow({ source: "PaymentService" }),
        makeRow({ source: "PaymentService" }),
        makeRow({ source: "OtherService" }),
      ]),
      repoContext: makeRepoContext(),
      joinPolicy: { ...DEFAULT_POLICY, serviceAllowlist: ["PaymentService"] },
    });
    expect(f.groups).toHaveLength(1);
    expect(f.unmatched).toHaveLength(1);
  });

  it("matches service-prefix (allowlist 'X' matches 'X.SubService')", () => {
    const f = correlate({
      rowset: makeRowset([
        makeRow({ source: "Payments.Skrill" }),
        makeRow({ source: "Payments.Paysafe" }),
      ]),
      repoContext: makeRepoContext(),
      joinPolicy: { ...DEFAULT_POLICY, serviceAllowlist: ["Payments"] },
    });
    expect(f.groups).toHaveLength(1);
    expect(f.groups[0]?.rows).toHaveLength(2);
  });
});

describe("correlate — commit attribution", () => {
  it("attaches commits whose subject mentions a matched ticket", () => {
    const commit = makeCommit({ subject: "fix: PROJ-42 root cause" });
    const f = correlate({
      rowset: makeRowset([makeRow({ message: "PROJ-42 broke" })]),
      repoContext: makeRepoContext([commit]),
      joinPolicy: { ...DEFAULT_POLICY, ticketRegex: "PROJ-\\d+" },
    });
    expect(f.groups[0]?.links.commits).toContain(commit);
  });

  it("attaches commits within tiebreaker window when matched by operationId", () => {
    const commit = makeCommit({
      authoredAt: "2026-05-22T00:03:00.000Z",
      subject: "deploy",
    });
    const f = correlate({
      rowset: makeRowset([
        makeRow({
          timestamp: "2026-05-22T00:05:00.000Z",
          raw: { operation_Id: "op-1" },
        }),
      ]),
      repoContext: makeRepoContext([commit]),
      joinPolicy: { ...DEFAULT_POLICY, tiebreakerWindowMin: 10 },
    });
    expect(f.groups[0]?.links.commits).toContain(commit);
  });

  it("does NOT attach commits outside tiebreaker window", () => {
    const commit = makeCommit({
      authoredAt: "2026-05-22T03:00:00.000Z",
    });
    const f = correlate({
      rowset: makeRowset([
        makeRow({
          timestamp: "2026-05-22T00:00:00.000Z",
          raw: { operation_Id: "op-x" },
        }),
      ]),
      repoContext: makeRepoContext([commit]),
      joinPolicy: { ...DEFAULT_POLICY, tiebreakerWindowMin: 10 },
    });
    expect(f.groups[0]?.links.commits).not.toContain(commit);
  });
});

describe("correlate — externalAtoms match", () => {
  it("attaches atoms tagged with operationId", () => {
    const atom: ExternalAtomRef = {
      id: "a-1",
      ts: "2026-05-22T00:00:00.000Z",
      message: "related",
      tags: ["op-1"],
    };
    const f = correlate({
      rowset: makeRowset([makeRow({ raw: { operation_Id: "op-1" } })]),
      repoContext: makeRepoContext(),
      joinPolicy: DEFAULT_POLICY,
      externalAtoms: [atom],
    });
    expect(f.groups[0]?.links.atoms).toContain(atom);
  });
});

describe("correlate — full coverage scenarios", () => {
  it("(a) full match: every row joins via at least one explicit key", () => {
    const f = correlate({
      rowset: makeRowset([
        makeRow({ raw: { operation_Id: "op-A" } }),
        makeRow({ message: "PROJ-1 ref" }),
        makeRow({ source: "PaymentService" }),
      ]),
      repoContext: makeRepoContext(),
      joinPolicy: {
        ...DEFAULT_POLICY,
        ticketRegex: "PROJ-\\d+",
        serviceAllowlist: ["PaymentService"],
      },
    });
    expect(f.groups.length).toBe(3);
    expect(f.unmatched).toHaveLength(0);
  });

  it("(b) partial match: some rows match, others unmatched", () => {
    const f = correlate({
      rowset: makeRowset([
        makeRow({ raw: { operation_Id: "op-A" } }),
        makeRow(),
      ]),
      repoContext: makeRepoContext(),
      joinPolicy: DEFAULT_POLICY,
    });
    expect(f.groups).toHaveLength(1);
    expect(f.unmatched).toHaveLength(1);
  });

  it("(c) no key match: empty groups, full unmatched (D17 explicit-keys-only)", () => {
    const f = correlate({
      rowset: makeRowset([makeRow(), makeRow(), makeRow()]),
      repoContext: makeRepoContext(),
      joinPolicy: DEFAULT_POLICY,
    });
    expect(f.groups).toHaveLength(0);
    expect(f.unmatched).toHaveLength(3);
  });
});

describe("correlate — summary", () => {
  it("severity escalates to error when any row is error-level", () => {
    const f = correlate({
      rowset: makeRowset([
        makeRow({ level: "info" }),
        makeRow({ level: "error" }),
      ]),
      repoContext: makeRepoContext(),
      joinPolicy: DEFAULT_POLICY,
    });
    expect(f.summary.severity).toBe("error");
  });

  it("severity is warn when only warns present", () => {
    const f = correlate({
      rowset: makeRowset([makeRow({ level: "warn" })]),
      repoContext: makeRepoContext(),
      joinPolicy: DEFAULT_POLICY,
    });
    expect(f.summary.severity).toBe("warn");
  });

  it("headline is capped at 500 chars", () => {
    const f = correlate({
      rowset: makeRowset([makeRow()]),
      repoContext: makeRepoContext(),
      joinPolicy: DEFAULT_POLICY,
    });
    expect(f.summary.headline.length).toBeLessThanOrEqual(500);
  });

  it("bullets are capped at 10", () => {
    const rows: Row[] = Array.from({ length: 15 }).map((_, i) =>
      makeRow({ raw: { operation_Id: `op-${i}` } }),
    );
    const f = correlate({
      rowset: makeRowset(rows),
      repoContext: makeRepoContext(),
      joinPolicy: DEFAULT_POLICY,
    });
    expect(f.summary.bullets.length).toBeLessThanOrEqual(10);
  });
});

describe("correlate — evidence ledger (D17)", () => {
  it("emits one evidence entry per (row × key)", () => {
    const f = correlate({
      rowset: makeRowset([
        makeRow({
          message: "PROJ-1 mention",
          raw: { operation_Id: "op-X" },
        }),
      ]),
      repoContext: makeRepoContext(),
      joinPolicy: { ...DEFAULT_POLICY, ticketRegex: "PROJ-\\d+" },
    });
    const evidence = f.groups[0]?.evidence ?? [];
    const types = evidence.map((e) => e.evidenceType);
    expect(types).toContain("operationId");
    expect(types).toContain("winTicket");
  });
});
