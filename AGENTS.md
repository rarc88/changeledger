# AGENTS.md — Spec Ledger (project's own contract)

This is the Spec Ledger repo itself. It dogfoods its own format: changes live
under `.sl/changes/`, persistent truth under `.sl/specs/`.

<!-- spec-ledger -->
> [!IMPORTANT]
> This repo uses **Spec Ledger**. Read and follow [`.sl/AGENTS.md`](.sl/AGENTS.md)
> (the change contract). If it is missing, run `sl register`.

The **canonical Spec Ledger contract** (the convention every consuming repo
follows) is shipped as [`templates/AGENTS.md`](templates/AGENTS.md) and linked
into each repo as `.sl/AGENTS.md`. Edit the convention there, not here.

## Project-specific notes

- Managed with **pnpm**; lint/format via **Biome**. Runtime dependencies are
  allowed only when they are mature and justified: the CLI uses `yaml` for
  config/frontmatter parsing, and the viewer uses `lit-html`, `marked`,
  `dompurify` and `mermaid` for templating, Markdown, sanitization and diagrams.
- `pnpm verify` (lint + test + `sl check`) is the quality gate; the versioned
  `hooks/pre-commit` runs it.
- The contract you edit for the convention is `templates/AGENTS.md` — it is the
  artifact that `sl init`/`register` symlink into other repos.
