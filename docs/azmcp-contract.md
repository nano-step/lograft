# `azmcp` CLI Contract (snapshot)

> **Pinned version:** `@azure/mcp@^2.0` (latest stable: `2.0.2` as of 2026-05-22).
> **CI drift detector** in `.github/workflows/ci.yml` (job `azmcp-contract`) re-runs `npx -y @azure/mcp@^2 monitor workspace log query --help` weekly and fails if the shape below changes.

## Invocation we depend on

```bash
azmcp monitor workspace log query \
  --subscription <subscription-id> \
  --workspace <workspace-id> \
  --table <table-name> \
  --query "<KQL>" \
  [--hours <N>] \
  [--limit <N>] \
  --output json
```

## Expected JSON output (recorded fixture mirrors this)

Either:

```json
{
  "tables": [
    {
      "name": "PrimaryResult",
      "columns": [
        { "name": "TimeGenerated", "type": "datetime" },
        { "name": "Message", "type": "string" }
      ],
      "rows": [
        ["2026-05-22T00:00:00Z", "boom"],
        ["2026-05-22T00:01:00Z", "again"]
      ]
    }
  ]
}
```

— OR (the simpler flat-array form some versions return):

```json
[
  { "TimeGenerated": "2026-05-22T00:00:00Z", "Message": "boom" },
  { "TimeGenerated": "2026-05-22T00:01:00Z", "Message": "again" }
]
```

Both shapes are handled by `src/normalize/index.ts` (`parseAzureMonitorJson`).

## Auth

`azmcp` uses Microsoft's `DefaultAzureCredential` chain. lograft delegates all credential resolution to the subprocess — we do not touch `AZURE_*` env vars ourselves. See https://github.com/microsoft/mcp/blob/main/docs/Authentication.md.

## Exit codes

- `0` — success, JSON on stdout
- non-zero — error, message on stderr

## Subprocess discipline (D30)

- Always spawn with array argv (NEVER `exec` with shell).
- Pass `--query` value as a single argv element (no shell quoting concerns).
- 5-minute default timeout via `AbortController`; on timeout, surface the last stderr line.
- Auto-bootstrap via `npx -y @azure/mcp@^2` if `azmcp` is not on PATH.
