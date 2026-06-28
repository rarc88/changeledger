# Authoring a Change

## Repository layout

```text
.changeledger/
  config.yml
  changes/<id>-<english-slug>.md
  specs/
AGENTS.md
CLAUDE.md  # optional
```

The project-owned `AGENTS.md` contains the ChangeLedger bootstrap. Run
`changeledger context` before acting; no per-machine contract link is required.

## Change document

A change is one Markdown file with YAML frontmatter and fixed English stage
headings. Required frontmatter:

```yaml
---
id: "20260613-134548"
title: Short, clear title
type: feature
status: draft
created: 2026-06-13T13:45:48Z
depends_on: []
owner: ana             # optional
release_impact: minor  # optional: none | patch | minor | major
---
```

`owner` is assigned on `approved → in-progress` when absent, preferring the
GitHub login and falling back to `git config user.name`.

Stages use this order:

| Key | Heading | Purpose |
|---|---|---|
| request | `## Request` | Ask, context and why |
| investigation | `## Investigation` | Current state, evidence, constraints, risks |
| proposal | `## Proposal` | Chosen solution and discarded alternatives |
| specification | `## Specification` | Testable acceptance criteria |
| plan | `## Plan` | Actionable checklist |
| log | `## Log` | Chronological execution decisions |

Use only the stages activated for the type in `config.yml`. Defaults are:

| Type | request | investigation | proposal | specification | plan | log |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| feature | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| bug | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| audit | ✓ | ✓ | — | — | — | ✓ |
| refactor | ✓ | — | ✓ | — | ✓ | ✓ |
| chore | ✓ | — | — | — | ✓ | — |

## Acceptance criteria

Each criterion is a separate `### CRn — name` block:

```markdown
### CR1 — Short name
- **Given** concrete precondition
- **When** concrete action
- **Then** exact result
- **And** optional additional result
```

The heading, ids and Given/When/Then/And keywords are fixed English. Localized
headings, inline criteria and `#### CR1` are not machine-readable.

## Plan tasks

```markdown
- [ ] Update `src/foo.mjs`; verify: `node --test test/foo.test.mjs` (CR1)
- [x] Update `src/foo.mjs`; verify: `node --test test/foo.test.mjs` (CR1) — 2026-06-13T14:20:00Z
- [!] Update `src/foo.mjs`; verify: `node --test test/foo.test.mjs` (CR1) — reason
- [ ] Operational step with no observable behavior (support)
```

The final `(CRn)` block provides traceability. Put target and verification text
before it; the trailing em-dash suffix is reserved for done timestamps or block
reasons. `(support)` is only for truly operational work.

## IDs and language

The id is the UTC creation instant in `YYYYMMDD-HHMMSS` form. Filename is
`{id}-{english-slug}.md`; the slug is always English and kebab ASCII.

Frontmatter keys/enums, stage headings, criterion keywords, markers, filenames
and CLI stay English. Titles, prose and task descriptions follow the configured
language.
