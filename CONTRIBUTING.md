# Contributing to lograft

Thanks for your interest! `lograft` is an open-source MCP server for log
investigation. It is generic by default; org-specific behaviour lives in user
config, never in `src/`.

## Quick start

```bash
git clone https://github.com/nano-step/lograft.git
cd lograft
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Node 20.10+ and pnpm are required.

## Project structure (early sketch)

```
bin/lograft.ts          # CLI entry; spawns the MCP server
src/server.ts           # MCP server bootstrap (stdio transport, stdout guard)
src/index.ts            # Public library entry
src/adapters/           # LogSourceAdapter implementations (later tasks)
src/parser/             # KQL extractor (later tasks)
src/correlate/          # Correlator + repo context (later tasks)
src/redact/             # Redactor middleware (later tasks)
src/render/             # Markdown/JSON/HTML renderers (later tasks)
test/                   # Jest tests + fixtures
```

## Adding a new `LogSourceAdapter`

The `LogSourceAdapter` interface (added in TASK-9a) is the extension point for
new log sources (Datadog, CloudWatch, Loki, Elastic, …). To contribute one:

1. Implement the interface in `src/adapters/<name>.ts`.
2. Add tests with a recorded fixture (no live API calls in CI).
3. Add a README section documenting required environment / credentials.
4. Update `CHANGELOG.md` under `[Unreleased]`.

The interface is intentionally **the union of what the two MVP adapters
(`RawDataAdapter`, `AzmcpAdapter`) need** — not speculative. Please open an
issue first if your adapter needs a new interface field.

## Commit style

Conventional Commits are appreciated but not enforced. Examples:

```
feat(parser): extract Log Analytics tables from KQL
fix(correlate): tolerate empty tickets list
docs(readme): document opencode integration
```

## Pull requests

- Tests added or updated for behaviour changes.
- `pnpm test`, `pnpm typecheck`, and `pnpm lint` all pass.
- No `WIN`, `playSWEEPS`, or `playstudios` strings introduced under `src/`
  (CI grep guard will fail otherwise — see plan D29 / R9).
- `CHANGELOG.md` updated under `[Unreleased]`.
- PR description follows `.github/PULL_REQUEST_TEMPLATE.md`.

## Reporting security issues

Please **do not** open a public issue. See [`SECURITY.md`](./SECURITY.md).

## License

By contributing you agree your work is released under the MIT License.
