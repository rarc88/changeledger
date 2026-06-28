# Portable Release Planning

- `changeledger release init <version>` adopts release tracking at an existing
  stable SemVer; the baseline contains changes already done.
- `changeledger release plan [--json]` deterministically selects unreleased done
  changes and calculates the next version without writing.
- `changeledger release record <version>` records exactly that plan in
  `.changeledger/releases/<version>.yml`.

Defaults live under `release.impacts` in `.changeledger/config.yml`; a change may
override its type with `release_impact` (`none|patch|minor|major`).

ChangeLedger owns portable membership and SemVer. The operating agent owns
stack-specific version files, project gates, commits, tags and publishing.
Never infer that every ChangeLedger repository uses npm or GitHub.

## Routine release preparation

Routine release preparation is operational work.
Version bumps, release manifests, quality gates, packaging, commits, tags and publishing do not require a ChangeLedger change by themselves.
Do not create a change only to group those routine steps.

If preparation reveals a functional fix, release-workflow change or persistent documentation, capture it as a separate change.
Complete that change and rerun `changeledger release plan` before `changeledger release record <version>`.
Keep this workflow stack-agnostic; do not assume npm, GitHub or specific manifest filenames.
