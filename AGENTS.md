# AGENTS.md — Spec Ledger Contract

This repo uses **Spec Ledger**. The documents under `.sl/` are the **source of
truth**. Code is their reflection. Work is planned and documented here before any
code is written.

Any agent working in this repo **must** follow this convention.

> **Language policy.** Structure is always English; content follows the repo's
> configured language. See §8.

---

## 1. Principles

1. Every change starts from a conversation and is captured as a **change**
   document before touching code.
2. The document wins. If code and document diverge, the document is the truth:
   update the code, never quietly drift the document.
3. Humans consume these documents in the **viewer** (`sl view`), not as raw
   markdown. Write with the rendered view in mind.

## 2. Repo layout

```
.sl/
  config.yml          # types, active stages, paths, language (repo specifics)
  changes/
    0001-title.md     # one change = one file
  specs/              # persistent truth (appears once the first change graduates)
AGENTS.md             # this contract
```

## 3. The change

A change is **a single markdown file**: frontmatter (structured, for machine and
viewer) plus a body of **stages** (the lifecycle).

### Frontmatter (required)

```yaml
---
id: "0001"
title: Short, clear title
type: feature                  # feature | bug | audit | refactor | chore
status: draft                  # draft | approved | in-progress | blocked | done
created: 2026-06-13T13:45:48Z  # full ISO 8601 UTC timestamp
depends_on: []                 # ids of other changes, e.g. ["0000"]
---
```

### Stages (body)

Stages are `##` sections with **fixed English headings**. Not every stage applies
to every type — use only those `config.yml` activates for that `type`. Fixed
order:

| Stage key | `##` heading | Purpose |
|-----------|--------------|---------|
| request | `## Request` | What is being asked, context, why. |
| investigation | `## Investigation` | Findings, current state, constraints, risks. For `bug`: root cause. For `audit`: the core. |
| proposal | `## Proposal` | Chosen solution + discarded alternatives + scenarios. |
| specification | `## Specification` | Requirements + acceptance criteria (Given/When/Then). |
| plan | `## Plan` | Actionable task checklist. |
| log | `## Log` | Decisions and changes during execution (chronological). |

### Active stages per type (defaults)

| Type | request | investigation | proposal | specification | plan | log |
|------|:--:|:--:|:--:|:--:|:--:|:--:|
| feature | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| bug | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| audit | ✓ | ✓ | — | — | — | ✓ |
| refactor | ✓ | — | ✓ | — | ✓ | ✓ |
| chore | ✓ | — | — | — | ✓ | — |

The real matrix lives in `config.yml`; it can be tuned per repo.

### Specification scenarios

Acceptance criteria use one **fixed, structured Given/When/Then format** — never
inline. Each criterion is an `###` block with id `CRn` and a short name, followed
by per-line steps:

```markdown
### CR1 — Short name
- **Given** precondition
- **When** action
- **Then** expected outcome
- **And** extra step (optional, repeatable after any Given/When/Then)
```

One block per scenario (`CR1`, `CR2`, …). The step keywords (`Given`, `When`,
`Then`, `And`) are fixed English; the rest is content (per `language`).

## 4. Tasks (inside `## Plan`)

Markdown checklist. State convention by marker:

```markdown
- [ ] Pending task (CR1)
- [x] Completed task (CR1) — 2026-06-13T14:20:00Z
- [!] Blocked task (CR1) — reason for the block
```

The viewer derives progress and the "blocked" state from these markers.

**Traceability.** Each task references the criteria it satisfies, in trailing
parentheses: `- [ ] Validate frontmatter (CR1, CR2)`. This links
criterion → task, so coverage is auditable.

**Resolution timestamp.** A completed task (`[x]`) carries a trailing
`— <ISO 8601 UTC>` with the exact moment it was resolved (full timestamp, so
same-day tasks keep their order). Pending tasks have none; blocked tasks use the
suffix for the reason. Order on the line: `description (CRn) — timestamp|reason`.

## 5. Lifecycle (`status`)

```
draft → approved → in-progress → done
                       ↑↓
                    blocked
```

- **draft** — the agent created it from the conversation. Do not implement yet.
- **approved** — the human reviewed it in the viewer and approved. Ready to build.
- **in-progress** — implementation underway; tick tasks as you go.
- **blocked** — blocked; at least one `[!]` task or external impediment. Note it in Log.
- **done** — all tasks `[x]`, acceptance criteria met.

## 6. Agent rules

1. **One concern per change.** If a request mixes unrelated concerns, split it
   into separate changes (e.g. a bug fix and a new feature are two changes).
2. **Do not implement in `draft`.** Create the change, wait for human approval.
3. **Single source of truth.** Do not duplicate info across stages; link instead.
4. **Atomic commits** that reference the id: `feat(scope): description [#0001]`.
5. **Keep the change updated as you go:** tick tasks, move `status`, write to Log.
   The document reflects reality at all times.
6. **On completion**, graduate the truth: update or create the `specs/` doc(s)
   that capture the new persistent state (see §10).
7. **No residue:** no TODO/FIXME or dead code without explicit agreement.
8. **Prefer visuals.** When a diagram explains something better than prose
   (flows, state, architecture, relationships), use a ` ```mermaid ` block. The
   diagram text is the source; the viewer renders it. Humans grasp it faster.

## 7. IDs

The `id` is the UTC creation instant in `YYYYMMDD-HHMMSS` form, derived from
`created` (one instant, one source). Example: `created: 2026-06-13T15:04:02Z` →
`id: "20260613-150402"`. Filename is `{id}-{slug}.md`, e.g.
`20260613-150402-timestamp-ids.md`.

Timestamp ids are unique without central coordination, so concurrent
devs/agents on parallel branches never collide. They sort chronologically. The
viewer may display an abbreviated form (`#0613-1504`); the full id is canonical.

The `{slug}` is **always English** (it is part of the filename — structure, not
content; see §8), even when the change content is in another language. `sl new`
takes it explicitly: `sl new <type> <slug> "<title>"`.

## 8. Language policy

| Always English (fixed) | Variable (per `config.yml` `language`) |
|------------------------|----------------------------------------|
| frontmatter keys (`id`, `type`, `status`, …) | `title` value (it is change content) |
| enum values: `status`, `type` | prose inside each stage |
| stage keys and headings (`## Request`, …) | human narrative (README, etc.) |
| task markers, file/dir names, CLI | |

This contract (`AGENTS.md`) is the canonical spec and stays in English regardless
of the repo's configured language.

## 9. Optional CLI helpers

Files are the source of truth; you may edit them directly. But the CLI does the
error-prone parts (UTC timestamps, status enums, task markers) for you:

- `sl new <type> <slug> "<title>"` — scaffold a change (English slug).
- `sl status <id> <status>` — move the lifecycle and log the transition.
- `sl log <id> "<message>"` — append a timestamped Log entry.
- `sl task <id> done|block <n> [reason]` — mark a Plan task (done injects the UTC).
- `sl list [--status S] [--type T] [--json]` / `sl show <id> [--json]` — query.
- `sl check [id]` — validate before committing.

## 10. Specs (persistent truth)

`changes/` are deltas with a lifecycle; `.sl/specs/*.md` are the **persistent
truth** — the current state of the system (capabilities, architecture, domain).
Code reflects the specs.

Specs have **no lifecycle** (no `status`). Minimal frontmatter, free markdown
body (headings are not stages):

```yaml
---
title: Short title
updated: 2026-06-13T21:00:00Z   # ISO 8601 UTC
tags: []
---
```

When a change reaches `done`, update or create the spec(s) it affects. A change
is the journey; a spec is the destination. Prefer diagrams (§9 / mermaid) where
they explain the system better than prose.
