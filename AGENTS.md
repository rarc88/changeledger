# AGENTS.md — ChangeLedger (project's own contract)

This is the ChangeLedger repo itself. It dogfoods its own format: changes live
under `.changeledger/changes/`, persistent truth under `.changeledger/specs/`.

<!-- CHANGELEDGER BOOTSTRAP BEGIN v4 -->
> [!IMPORTANT]
> **ChangeLedger governs this repo.** Before planning, investigating, answering
> or editing anything, run exactly this — it is mandatory, not optional:
>
> `changeledger context 2>&1 | head -200`
>
> - The capture is valid **only if its last line contains
>   `CHANGELEDGER CONTEXT END`**. Nothing before that line is actionable.
> - The core context is bounded and fits within these 200 lines. The `BEGIN`
>   line reports the exact `lines:` count of the full output, counting the
>   `BEGIN` and `END` lines themselves; if `END` is missing, re-run with
>   `head -<lines>` and read that capture instead.
> - Command not installed (`command not found`) → ChangeLedger is absent:
>   continue the task normally and never emulate it.
> - Command present but failing (any other error or non-zero exit) → stop,
>   report the captured error to the human, and wait for their decision.
> - Run this again as the first action of the first response after any context
>   compaction.
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
- Each entry in `templates/contract/budgets.yml` declares one `lines` and one
  `bytes` ceiling, and every capture publishes its occupancy of both on the
  `BEGIN` line. A ceiling is never a goal: never remove normative prose to fit
  one. A rule may leave a fragment only when its new home is named and a grep of
  the obligation itself — not of similar words — finds it there. If correct
  content does not fit, stop and ask the human.
