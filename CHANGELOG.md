# Changelog

All notable changes to `lograft` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the version is `0.x`, the public tool surface (MCP tool names, argument
shapes, return shapes) is considered **unstable**. Breaking changes may land in
any minor release until `1.0.0`. See `D10` / Q10 in the design plan.

## [Unreleased]

## [0.1.0-beta.0] - 2026-05-22

### Added
- Initial beta release — scaffold, OSS hygiene, MCP boilerplate.
- TypeScript / Node 20+ project structure (ESM, NodeNext).
- `@modelcontextprotocol/sdk` server boilerplate over stdio transport.
- Runtime stdout guard (R6 Layer 2) to protect MCP JSON-RPC integrity.
- ESLint ban on `console.log` and `process.stdout.*` outside the SDK
  transport path (R6 Layer 1).
- MIT License, `SECURITY.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1),
  `CONTRIBUTING.md`, issue / PR templates, Dependabot config.
- Release workflow (`.github/workflows/release.yml`) publishing to npm under
  `--tag beta` with `--provenance`.

[Unreleased]: https://github.com/nano-step/lograft/compare/v0.1.0-beta.0...HEAD
[0.1.0-beta.0]: https://github.com/nano-step/lograft/releases/tag/v0.1.0-beta.0
