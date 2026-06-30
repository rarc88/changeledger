# Authoring a Change

## Repository layout and creation

```text
.changeledger/
  config.yml
  changes/<id>-<english-slug>.md
  specs/
AGENTS.md
CLAUDE.md  # optional
```

The project-owned `AGENTS.md` contains the bootstrap. Run `changeledger context`
before acting. Create a change with:

```text
changeledger new <type> <slug> "<title>"
```

The CLI generates the UTC id, filename and active stages. The slug is structural
and must be English; title and narrative follow the configured language. Files
remain the source of truth and may be edited directly, but prefer the CLI for
timestamps, enums and markers that are easy to mistype.

One concern per change. If a request mixes unrelated concerns, propose separate
changes and create them only after explicit human authorization. Work necessary
for an already authorized objective stays in that change's Specification, Plan
and Log. If related work materially expands observable scope, obtain explicit
human authorization; independent work belongs in a separate change.

## Change document

A change is one Markdown file: YAML frontmatter plus fixed English stage
headings. Required and optional frontmatter:

```yaml
---
id: "20260613-134548"
title: Short, clear title
type: feature                  # feature | bug | audit | refactor | chore
status: draft                  # lifecycle value
created: 2026-06-13T13:45:48Z # full ISO 8601 UTC
depends_on: []                 # change ids or external project:id refs
owner: ana                     # optional
release_impact: minor          # optional: none | patch | minor | major
---
```

`owner` means responsibility for the change. On `approved → in-progress`, it is
assigned when absent from the GitHub login (`gh api user --jq .login`), falling
back to `git config user.name`. Override or clear it with
`changeledger owner <id> <name|->`; absence means unassigned.

Keep each fact in one stage and link to it from the others. Do not let summaries
or plans become competing versions of the same truth.

## Stages

Use fixed English `##` headings in this order and only when activated for the
type in `config.yml`:

| Key | Heading | Purpose |
|---|---|---|
| request | `## Request` | Ask, context and why |
| investigation | `## Investigation` | Evidence, constraints and risks; root cause for bugs, core analysis for audits |
| proposal | `## Proposal` | Chosen solution, discarded alternatives and scenarios |
| specification | `## Specification` | Testable requirements and acceptance criteria |
| plan | `## Plan` | Actionable task checklist |
| log | `## Log` | Chronological decisions and execution changes |

Default activation matrix:

| Type | request | investigation | proposal | specification | plan | log |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| feature | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| bug | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| audit | ✓ | ✓ | — | — | — | ✓ |
| refactor | ✓ | — | ✓ | — | ✓ | ✓ |
| chore | ✓ | — | — | — | ✓ | — |

The configured matrix is authoritative. For bugs, Investigation contains the
root cause; for audits, it is the core analysis. Proposal includes the chosen
solution, discarded alternatives and scenarios.

When a relationship, flow or architecture is clearer visually, use a Mermaid
block and keep its text as the source; the viewer renders it.

## Acceptance criteria

Every behavioral requirement is a separate structured scenario:

```markdown
### CR1 — Short name
- **Given** concrete precondition
- **When** concrete action
- **Then** exact result
- **And** optional additional step
```

Use one `### CRn` block per scenario. Heading, ids and
Given/When/Then/And keywords stay English; scenario content follows the repo
language. Localized headings, translated keywords, inline criteria and
`#### CR1` are not machine-readable.

## Plan task grammar

Markers encode state and the final parenthesized block encodes traceability:

```markdown
- [ ] Update `src/app/foo.ts`; verify: `pnpm test` (CR1)
- [x] Update `src/app/foo.ts`; verify: `pnpm test` (CR1) — 2026-06-13T14:20:00Z
- [!] Update `src/app/foo.ts`; verify: `pnpm test` (CR1) — blocked reason
- [ ] Run the complete test suite after implementation (support)
```

For a CR-bearing task, target and verification belong in the description before
the final `(CRn)` block. Only that final block supplies traceability; mentions of
`CR1` earlier in the sentence are prose. A task may cover several criteria with
`(CR1, CR2)`.

The trailing `— ...` suffix is resolution metadata only: an ISO UTC timestamp
for `[x]` or a required reason for `[!]`. Pending tasks have no suffix. This form
is invalid:

```markdown
- [ ] Update `src/app/foo.ts` (CR1) — verify: `pnpm test`
```

The parser removes `— verify: ...` before readiness checks, so the task retains
CR traceability but appears to have no verification. Write verification before
the criteria block as shown in the valid examples.

`(support)` is reserved for operational work that does not directly implement
observable behaviour: running a test suite, reading before refactoring,
evaluating blast radius or scaffolding. Support tasks do not require a CR and do
not run target/verification readiness checks. `(support)` must be the final
parenthesized marker and is not a substitute for a missing criterion on
observable behaviour.

## IDs and language

The id is the UTC creation instant in `YYYYMMDD-HHMMSS`, derived from `created`:
`2026-06-13T15:04:02Z` becomes `20260613-150402`. The filename is
`{id}-{english-slug}.md`. Timestamp ids sort chronologically and avoid central
coordination; abbreviated viewer ids are display-only.

Always English: frontmatter keys, enum values, stage headings, CR ids and step
keywords, task markers, filenames/directories and CLI. Configured language:
title, stage prose, scenario content and task descriptions.

## Authoring helpers

- `changeledger new <type> <slug> "<title>"` — scaffold a change with an English slug.
- `changeledger check [id]` — validate one change or the repository.
- `changeledger list [--status S] [--type T] [--json]` — inspect/filter changes.
- `changeledger show <id> [--json]` — inspect one resolved change.
- `changeledger owner <id> <name|->` — set or clear responsibility.

Run `changeledger <command> --help` for exact options; the commands support the
file contract rather than replacing it.
