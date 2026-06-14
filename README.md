# Spec Ledger (`sl`)

> Documents are the source of truth. Code is their reflection.

Spec Ledger is a tool for **planning before coding**. Every change in a repo
(feature, bug, audit, refactor) starts from a conversation with an agent, is
captured as a **change** with its own lifecycle, and stays tangible, trackable
and actionable: what's done, what's pending, what's blocked.

What sets it apart: a **human consumption layer**. You don't read raw markdown —
a local viewer consolidates the documents into a navigable, filterable board
ordered by the lifecycle.

## How it works

- **Global CLI** (`sl`). The viewer's code lives in the global install, not in your repo.
- Each repo holds only the documents and config, under `.sl/`.
- The contract ships with `sl` and is linked into each repo as `.sl/AGENTS.md`
  (a per-machine, gitignored symlink — never copied, so it never drifts). The
  repo's own `AGENTS.md` references it with one line, so any agent (Claude,
  Codex, opencode, Copilot, Cursor…) discovers the convention. `sl check`
  enforces that the reference exists.

```
sl init         # set up .sl/ in the repo, give it an identity, register it
sl register     # (re)link this repo's path in the global registry (moved/cloned)
sl view         # launch the viewer — all registered projects (sl view . for current only)
sl new <type> <slug> <title>   # scaffold a change (slug is the English filename)
sl check [id]   # validate the repo (or one change) and its health (exit ≠ 0 on errors)

# Agent helpers — files stay the source of truth; these inject correct
# timestamps/markers and validate transitions:
sl status <id> <status>                  # move lifecycle + log the transition
sl log <id> <message>                    # append a timestamped Log entry
sl task <id> done|block <n> [reason]     # mark a Plan task
sl list [--status S] [--type T] [--json] # list changes
sl show <id> [--json]                    # print a change
sl graduate <change-id> <spec-slug>      # scaffold a spec seeded from a change
sl graduate <change-id> --skip [reason]  # mark graduation reviewed, no spec
sl graduate --pending                    # list done changes not yet reviewed
```

`sl check` validates every change against the contract (frontmatter, enums,
stages, dependencies, unique ids) and reports health warnings. It exits non-zero
on errors, so it drops into a pre-commit hook or CI step:

```sh
# .git/hooks/pre-commit  (or a CI job)
sl check || exit 1
```

## Status

Under construction. This repo documents itself with its own format (dogfooding):
see [`.sl/changes/`](.sl/changes/).

## Model

- **`changes/`** — deltas with a lifecycle (what's being worked on).
- **`specs/`** — persistent truth (current state of the system). _Appears once the first change graduates._

The full contract for agents lives in [`AGENTS.md`](AGENTS.md).

## Definition of Ready

Spec Ledger assumes a **strong model documents, a less capable model implements**.
The `tdd` flag in `config.yml` (default `true`) makes that explicit: changes are
documented test-grade (every requirement a concrete `CR`; every Plan task names
its files and test, mapped to a `CR`) and implemented via TDD. `sl check` warns
when an `approved`/`in-progress` change has a `CR` without a task, or a task
without a `CR`. Set `tdd: false` for exploratory repos. See [`AGENTS.md`](AGENTS.md) §11.

## Development

Managed with **pnpm**. Lint/format via **Biome**; the source itself ships zero
runtime dependencies.

```sh
pnpm install                  # dev deps (Biome)
pnpm lint                     # Biome lint + format check
pnpm format                   # Biome auto-fix
pnpm test                     # node --test
pnpm verify                   # lint + test + sl check (the quality gate)
git config core.hooksPath hooks   # enable the pre-commit gate
```

The versioned `hooks/pre-commit` runs `pnpm verify`, so commits that fail lint,
tests, or `sl check` are blocked — agents can't quietly accumulate debt.

### Using `sl` outside this repo

Not published to npm yet (that's tracked separately). Meanwhile, `pnpm link`
exposes the `sl` bin globally, pointing at this checkout with live edits:

```sh
pnpm link --global    # expose `sl` globally from this checkout
sl --help             # verify it resolves
pnpm unlink --global  # revert
```

## Language policy

Structure is always English (frontmatter keys, enum values, stage headings, CLI,
file names). Generated **content** follows each repo's `config.yml` `language`.
This project's own docs (`README.md`, `AGENTS.md`) are canonical English. See
[`AGENTS.md`](AGENTS.md) §8.
