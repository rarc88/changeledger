# AGENTS.md — ChangeLedger (project's own contract)

This is the ChangeLedger repo itself. It dogfoods its own format: changes live
under `.changeledger/changes/`, persistent truth under `.changeledger/specs/`.

<!-- changeledger -->
> [!IMPORTANT]
> This repo uses **ChangeLedger**. Read and follow [`.changeledger/AGENTS.md`](.changeledger/AGENTS.md)
> (the change contract). If it is missing, run `changeledger register`.

The **canonical ChangeLedger contract** (the convention every consuming repo
follows) is shipped as [`templates/AGENTS.md`](templates/AGENTS.md) and linked
into each repo as `.changeledger/AGENTS.md`. Edit the convention there, not here.

## Project-specific notes

- Product evolution follows the complexity budget and no-goals in
  [`INTENT.md`](INTENT.md): prefer observed problems and a small deterministic,
  local-first core; AI orchestration, memory and cloud services belong only in
  optional integrations.
- Managed with **pnpm**; lint/format via **Biome**. Runtime dependencies are
  allowed only when they are mature and justified: the CLI uses `yaml` for
  config/frontmatter parsing, and the viewer uses `lit-html`, `marked`,
  `dompurify` and `mermaid` for templating, Markdown, sanitization and diagrams.
- `pnpm verify` (lint + test + `changeledger check`) is the full quality gate. The
  versioned `hooks/pre-commit` runs `lint-staged`, `pnpm test` and `changeledger check`
  so staged formatting stays compatible with partial commits.
- The contract you edit for the convention is `templates/AGENTS.md` — it is the
  artifact that `changeledger init`/`register` symlink into other repos.
