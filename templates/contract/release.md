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
