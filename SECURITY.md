# Security Policy

## Supported Versions

`lograft` is in early beta. Until `1.0.0` ships, all `0.x` versions are
"supported" only in the sense that we will accept and triage reports against
the latest published release. We do not backport patches to older `0.x` lines.

| Version | Status              |
| ------- | ------------------- |
| 0.x     | Latest published    |

## Reporting a Vulnerability

Please **do not** open public GitHub issues for security problems.

Use either of the following private channels:

1. **GitHub private security advisories** (preferred):
   <https://github.com/nano-step/lograft/security/advisories/new>
2. **Email:** `nhoxtvt@gmail.com`

When reporting, please include:

- A clear description of the issue and its impact.
- Steps to reproduce, ideally a minimal MCP-client config or fixture.
- The `lograft` version (`npx lograft --version` or the npm tag).
- Any logs, but **redact PII** before sending — `lograft` is built around
  log redaction; do the same for your reports.

## Response SLA

Best-effort response within **14 calendar days** for the duration of beta. We
aim to acknowledge sooner. After `1.0.0` we will publish a stricter SLA.

## Scope

In scope:

- Code shipped in the `lograft` npm package (`bin/`, `src/`, generated `dist/`).
- The release workflow (`.github/workflows/release.yml`) and any other CI
  pipeline that builds or publishes artifacts.
- Documentation that, if followed, leads users to insecure configuration.

Out of scope:

- Issues in upstream dependencies (please report those upstream; we will
  accept a separate ticket once a fix is available).
- Issues caused exclusively by user TOML config (we will still triage but they
  may be classified as "config error" rather than vulnerability).
- Bugs in `@azure/mcp` or other tools `lograft` invokes as a subprocess.
