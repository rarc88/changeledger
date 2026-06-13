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
- Any agent reads `AGENTS.md` and follows the convention. No agent-specific tooling.

```
sl init         # set up .sl/ in the repo
sl view         # launch the local viewer in the browser
sl new <type> <slug> <title>   # scaffold a change (slug is the English filename)
sl check        # validate changes and repo health (exit ≠ 0 on errors)
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

## Language policy

Structure is always English (frontmatter keys, enum values, stage headings, CLI,
file names). Generated **content** follows each repo's `config.yml` `language`.
This project's own docs (`README.md`, `AGENTS.md`) are canonical English. See
[`AGENTS.md`](AGENTS.md) §8.
