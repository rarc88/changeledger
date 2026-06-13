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

1. **Do not implement in `draft`.** Create the change, wait for human approval.
2. **Single source of truth.** Do not duplicate info across stages; link instead.
3. **Atomic commits** that reference the id: `feat(scope): description [#0001]`.
4. **Keep the change updated as you go:** tick tasks, move `status`, write to Log.
   The document reflects reality at all times.
5. **On completion**, propose which truth graduates to `specs/` (once that layer exists).
6. **No residue:** no TODO/FIXME or dead code without explicit agreement.

## 7. IDs

Sequential, 4 digits, zero-padded: `0001`, `0002`. Filename is `{id}-{slug}.md`,
e.g. `0001-bootstrap-spec-ledger.md`.

## 8. Language policy

| Always English (fixed) | Variable (per `config.yml` `language`) |
|------------------------|----------------------------------------|
| frontmatter keys (`id`, `type`, `status`, …) | `title` value (it is change content) |
| enum values: `status`, `type` | prose inside each stage |
| stage keys and headings (`## Request`, …) | human narrative (README, etc.) |
| task markers, file/dir names, CLI | |

This contract (`AGENTS.md`) is the canonical spec and stays in English regardless
of the repo's configured language.
