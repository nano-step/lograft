# lograft

> **Raft together logs, code, and tickets into post-mortem-ready investigation reports.**

`lograft` is an MCP server that turns raw log query results into structured incident reports — Markdown (paste-into-ticket), JSON (machine-readable), and self-contained HTML (share offline). It composes Microsoft's official [`@azure/mcp`](https://github.com/microsoft/mcp) for live Azure Monitor queries, and contributes the parts MS does NOT solve: **KQL parsing, log↔git↔ticket correlation, PII redaction, multi-format reporting**.

Works in any MCP-compatible client: opencode, Cursor, Claude Desktop, VS Code GitHub Copilot, Windsurf, Zed, Continue.dev.

- **Status:** beta (0.1.x)
- **License:** MIT
- **Runtime:** Node 20.10+

---

## Quick start

```bash
npx lograft
```

That's it. The MCP server starts on stdio and waits for a client to call its tools.

To use `lograft` as a daily tool, install globally:

```bash
npm i -g lograft@beta
lograft   # starts MCP server on stdio
```

For live Azure mode, you also need `@azure/mcp` (auto-spawned via `npx` if absent, but installing it globally is faster):

```bash
npm i -g @azure/mcp@^2
az login   # azmcp handles all Azure auth
```

---

## What it does

Given Azure log query results (live or pasted) **plus** a git repo, `lograft` produces a single investigation bundle:

```
reports/<UTC-timestamp>/
├── report.md     # Jira-paste-ready summary + correlations
├── data.json     # machine-readable findings
└── report.html   # offline-viewable, self-contained, CSP-locked
```

Correlation joins are **explicit-keys only**: `operation_Id`, your configured ticket regex (e.g. `[A-Z]+-\d+`), and a service allowlist. Timestamp proximity is a tiebreaker, never a primary signal (no noise explosion).

**Default-on PII redaction** — emails, JWTs, GUIDs in auth context, `Authorization` headers, IPv4/IPv6, RFC1918 private ranges, internal hostnames (`*.internal`, `*.corp`, `*.local`). The redactor is internal middleware — there is no "skip redaction" tool surface.

---

## MCP client setup

`lograft` speaks the MCP stdio transport. Below are the snippets for the four distinct config formats. Tested in **opencode, Cursor, Claude Desktop**; the other clients use one of these same formats — contributions welcome to confirm.

### opencode (`opencode.json` or `~/.config/opencode/config.json`)

```json
{
  "mcp": {
    "servers": {
      "lograft": {
        "command": "npx",
        "args": ["-y", "lograft@beta"]
      }
    }
  }
}
```

### Claude Desktop family (`claude_desktop_config.json` / Cursor `mcp.json` / Windsurf / Zed)

```json
{
  "mcpServers": {
    "lograft": {
      "command": "npx",
      "args": ["-y", "lograft@beta"]
    }
  }
}
```

**Paths:**
- Claude Desktop (macOS): `~/Library/Application Support/Claude/claude_desktop_config.json`
- Claude Desktop (Windows): `%APPDATA%\Claude\claude_desktop_config.json`
- Cursor: `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project)
- Windsurf: `~/.codeium/windsurf/mcp_config.json`
- Zed: similar shape — see Zed docs

### VS Code GitHub Copilot (`settings.json`)

```json
{
  "chat.mcp.servers": {
    "lograft": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "lograft@beta"]
    }
  }
}
```

### Continue.dev (`~/.continue/config.json`)

```json
{
  "experimental": {
    "modelContextProtocolServers": [
      {
        "transport": {
          "type": "stdio",
          "command": "npx",
          "args": ["-y", "lograft@beta"]
        }
      }
    ]
  }
}
```

---

## Tools

`lograft` exposes 5 fine-grained MCP tools plus 1 convenience orchestrator. **Most users want `lograft_investigate` first.** The atomic tools exist for partial pipelines.

| Tool | Purpose |
|------|---------|
| `lograft_investigate` | Full pipeline: parse → normalize → repo context → correlate → redact → render bundle. The tool most users want. |
| `lograft_parse_kql` | Pure: extract tables, time range, ticket mentions, projections from a KQL query. |
| `lograft_normalize` | Pure: turn CSV / JSON / azure-monitor-json into a unified 5-field rowset. |
| `lograft_gather_repo_context` | Shells out to `git log` for the last N days of commits. |
| `lograft_correlate` | The heart: joins rows ↔ commits ↔ tickets ↔ atoms via explicit keys only. |
| `lograft_render_report` | Writes md+json+html bundle. Redactor middleware runs on input — non-bypassable. |

> **The redactor is NOT a public tool** by design (plan D13). If it were optional via tool selection, a misbehaving LLM client could exfiltrate raw PII into a Jira paste. Bypassing requires explicit `redaction.bypass: true` on the render call and emits a prominent stderr warning.

---

## Example — paste mode

You already have a Portal export CSV and want a report.

```jsonc
// Client calls lograft_investigate with:
{
  "result": {
    "kind": "inline",
    "format": "csv",
    "data": "timestamp,message,operation_Id,cloud_RoleName\n2026-05-22T13:58:00Z,InvalidSignature MYPROJ-42,op-1,PaymentService\n…"
  },
  "kql": {
    "kind": "inline",
    "text": "exceptions | where timestamp > ago(1h) | project timestamp, message, operation_Id"
  },
  "repoPath": "/path/to/your/repo",
  "outDir": "./reports"
}
```

Output:
```
reports/20260522-141023/
├── report.md
├── data.json
└── report.html
```

`report.md` opens with a ≤500-char headline summary block suitable for pasting into a ticket.

---

## Example — live mode (delegates to azmcp)

```jsonc
{
  "kql": {
    "kind": "inline",
    "text": "AppExceptions | where TimeGenerated > ago(1h) | project TimeGenerated, Message, operation_Id"
  },
  "live": {
    "workspaceId": "<log-analytics-workspace-id>",
    "subscriptionId": "<subscription-id>",
    "table": "AppExceptions",
    "hours": 1
  },
  "repoPath": "/path/to/your/repo"
}
```

Under the hood `lograft` shells out to:

```
azmcp monitor workspace log query \
  --subscription <subscription-id> \
  --workspace <workspace-id> \
  --table AppExceptions \
  --query "AppExceptions | where ... " \
  --output json \
  --hours 1
```

All Azure credentials are handled by `azmcp` via Microsoft's `DefaultAzureCredential` chain — `lograft` never touches `AZURE_*` env vars itself. See [Authentication docs](https://github.com/microsoft/mcp/blob/main/docs/Authentication.md).

If `azmcp` is missing, `lograft` returns a clear error with install instructions.

---

## Configuration

Place an optional `lograft.config.toml` in your project root (or `~/.config/lograft/lograft.config.toml`). Resolution order:

1. `--configPath` arg on `lograft_investigate` (explicit)
2. `<MCP-process-cwd>/lograft.config.toml`
3. `~/.config/lograft/lograft.config.toml`
4. Built-in defaults

See [`examples/lograft.generic-issue-tracker.toml`](./examples/lograft.generic-issue-tracker.toml) for a starting template covering ticket regex, service allowlist, redaction extras, and ticket-link base URL.

---

## Architecture

```
   ┌────────────────────────┐
   │  Any MCP Client (stdio) │
   └──────────┬─────────────┘
              │
              ▼
   ┌─────────────────────────────────┐
   │  lograft (this package)          │
   │   parse_kql ─┐                   │
   │   normalize ─┼─► correlate ─┐    │
   │   gather    ─┘              │    │
   │                   redactor  │    │   ← internal middleware (D13)
   │                             ▼    │
   │                       render md/json/html
   └─────────────────────┬───────────┘
                         │ subprocess (live mode only)
                         ▼
            ┌──────────────────────────────┐
            │  azmcp (microsoft/mcp, GA)    │
            │  Owns Azure auth + KQL exec.  │
            └──────────────────────────────┘
```

**Trust boundaries:**
- `lograft` never holds Azure credentials. Live mode = subprocess to `azmcp`.
- The redactor is the SOLE chokepoint between log content and any output file.
- stdout is reserved for MCP JSON-RPC. All logs go to stderr. A runtime guard throws if anything else writes to stdout.

---

## Caps and defaults

| Setting | Default | Rationale |
|---------|---------|-----------|
| Max correlated rows | 1000 | bounded report size |
| Max commits considered | 200 | bounded git log |
| Max output file size | 5 MB | bounded share-ability |
| Tiebreaker window | ±10 min | timestamp proximity, AFTER key match |
| `azmcp` subprocess timeout | 5 min | bounded live mode |
| Repo lookback | 14 days | recent context only |

All are TOML-configurable; none are removable.

---

## Roadmap (Phase 2)

- Datadog / CloudWatch / Loki / Elastic `LogSourceAdapter` implementations
- Slack / Teams webhook output
- Live Jira / GitHub API ticket enrichment (replaces regex-only extraction)
- Public MCP registry submission to modelcontextprotocol.io
- Multi-query batch mode
- `lograft_preview_redaction` tool — read-only diff for audit

---

## Contributing

Pull requests are welcome — especially new `LogSourceAdapter` implementations.

Before submitting:

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for adapter contracts and commit conventions.

Security reports: **do not open public issues**. See [SECURITY.md](./SECURITY.md).

---

## License

MIT © Hoài Nhớ
