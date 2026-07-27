# AGENTS.md — ChangeLedger (project's own contract)

This is the ChangeLedger repo itself. It dogfoods its own format: changes live
under `.changeledger/changes/`, persistent truth under `.changeledger/specs/`.

<!-- CHANGELEDGER BOOTSTRAP BEGIN v3 -->
> [!IMPORTANT]
> Attempt to run **ChangeLedger** with `changeledger context` immediately after
> reading this file — before planning, investigating, or acting. If it succeeds,
> retain complete stdout through the `CHANGELEDGER CONTEXT END` line and follow that
> complete context: no pipes, filters, summaries, previews or voluntary output limits.
> If the tool exposes an output budget, reserve enough for the whole response. A
> missing END means the output was truncated: stop and re-run with a larger capture.
>
> If the command is unavailable, continue normally without ChangeLedger. If it
> starts but fails, report the error to the human and wait for them to decide how
> to continue; do not treat a failing command as absent.
<!-- CHANGELEDGER BOOTSTRAP END -->

The canonical ChangeLedger contract is split into task-focused fragments under
[`templates/contract/`](templates/contract/). The deterministic
`changeledger context` command composes them; consuming repos keep only the
bootstrap above, not a linked or copied contract.

## Project-specific notes

- Product evolution follows the complexity budget and no-goals in
  [`INTENT.md`](INTENT.md): prefer observed problems and a small deterministic,
  local-first core; AI orchestration, memory and cloud services belong only in
  optional integrations.
- Managed with **pnpm**; lint/format via **Biome**. Runtime dependencies are
  allowed only when they are mature and justified: the CLI uses `yaml` for
  config/frontmatter parsing and `commander` for argument/option/subcommand
  parsing with built-in errors and help, and the viewer uses `lit-html`,
  `marked`, `dompurify` and `mermaid` for templating, Markdown, sanitization and
  diagrams.
- `pnpm verify` (lint + test + `changeledger check`) is the full quality gate. The
  versioned `hooks/pre-commit` runs `lint-staged`, `pnpm test` and `changeledger check`
  so staged formatting stays compatible with partial commits.
- Edit the convention in `templates/contract/`; keep each rule in one fragment
  so task contexts compose without duplicated truth.
