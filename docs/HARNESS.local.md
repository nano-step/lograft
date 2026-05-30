<!-- Regular file, NOT a symlink. Survives standalone clones. -->

# Harness — local pointer for `lograft`

The authoritative harness lives at the workspace root, **not in this repo**.

- **In-workspace path:** `../../docs/HARNESS.md` (resolved by the symlinks)
- **Workspace canonical:** `/Users/nhonh/Documents/personal/docs/HARNESS.md`
- **Migrated from per-repo harness on 2026-05-30** — pre-migration state preserved at branch `harness/pre-symlink-migration-2026-05-30` (run `git log harness/pre-symlink-migration-2026-05-30 -- docs/` to see it).
- **If you cloned this repo standalone:** the symlinks will be broken. Run `npx @nano-step/skill-manager get harness-init` then `bash ~/.config/opencode/skills/harness-init/scripts/install.sh --target "$PWD"`.

See: [Consumption Model](../../docs/HARNESS.md#consumption-model)
