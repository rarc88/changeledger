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
Approval in conversation must explicitly identify the draft and order approval;
praise, a request to continue, or the agent's recommendation does not authorize
`changeledger approve`.

## Change document

A change is one Markdown file: YAML frontmatter plus fixed English stage
headings. Required and optional frontmatter:

```yaml
---
id: "20260613-134548"
title: Short, clear title
type: feature                  # feature | bug | audit | refactor | chore | quick
status: draft                  # lifecycle value
created: 2026-06-13T13:45:48Z # full ISO 8601 UTC
depends_on: []                 # change ids or external project:id refs
related_to: []                 # optional non-blocking discovery links
owner: ana                     # optional
release_impact: minor          # optional: none | patch | minor | major
---
```

Use `depends_on` only for execution prerequisites: dependencies can block
lifecycle progress and cycles. Use optional `related_to` for useful context that
must not impose execution order or affect readiness. Both accept local ids and
external `project:id` refs; declare a local relation once, deriving its backlink.

`owner` identifies responsibility. `approved → in-progress` assigns an absent
owner via `gh api user --jq .login`, then `git config user.name`. Override with
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
| quick | ✓ | — | — | — | — | ✓ |

The configured matrix is authoritative. For bugs, Investigation contains the
root cause; for audits, it is the core analysis. Proposal includes the chosen
solution, discarded alternatives and scenarios.

`quick` is for small, reversible, single-concern work that adds no public surface
or persistent truth (`specs/`): only Request and Log, ~10-15 lines. It retains
the human `draft → approved` gate and `[#id]` marker, skipping only `in-review`.
If scope outgrows this, discard and recreate it under the correct type.

Before writing Investigation, run `changeledger search <terms from the request>`;
during Investigation, classify every relevant change discovered, regardless of
whether it came from `search`, `list`, direct reading, context or conversation:
an execution prerequisite becomes `depends_on`, and useful context without
execution order becomes `related_to`. An explicit local change id must not
remain only in prose. Do not rediscover work another change or spec already
covers.

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
- [x] Update `src/app/foo.ts`; verify: `pnpm test` (CR1)
  - **Resolved:** `2026-06-13T14:20:00Z`
- [!] Update `src/app/foo.ts`; verify: `pnpm test` (CR1)
  - **Blocked:** blocked reason — arbitrary punctuation is safe
- [ ] Run the complete test suite after implementation (support)
```

For a CR-bearing task, target and verification precede the final `(CRn)` block; only that block supplies traceability. Any mentions of `CR1` earlier in the sentence are prose, and one task may cover `(CR1, CR2)`.
Resolution metadata is structural: `[x]` requires one immediate `Resolved` child with a backticked ISO UTC timestamp, `[!]` one immediate `Blocked` child with a non-empty reason, and `[ ]` none. Descriptions and reasons may contain arbitrary punctuation; unknown, duplicate, missing or orphan metadata is invalid.

Verification must precede the final criteria block; this is invalid:

```markdown
- [ ] Update `src/app/foo.ts` (CR1) — verify: `pnpm test`
```

`(support)` marks operational work such as test suites, reading, blast-radius analysis or scaffolding. It needs no CR or target/verification readiness checks, must be the final parenthesized marker and cannot replace a criterion for observable behaviour.

## Log event grammar

Every top-level Log entry has a strict ISO UTC timestamp and canonical type:

```markdown
- **2026-06-13T14:20:00Z** `[status]` draft → approved
- **2026-06-13T14:30:00Z** `[note]` arbitrary text — even `[status]` and `|`
```

Types are `status`, `review`, `validation`, `owner`, `graduation`, `archive` and `note`. Lifecycle commands write their type; `changeledger log` writes an opaque `note` that cannot simulate an operational event. Continuation prose is allowed, but every top-level `- ` line must be a valid typed event.

## IDs and language

The id is the UTC creation instant in `YYYYMMDD-HHMMSS`, derived from `created`:
`2026-06-13T15:04:02Z` becomes `20260613-150402`. The filename is
`{id}-{english-slug}.md`. Timestamp ids sort chronologically and avoid central
coordination; abbreviated viewer ids are display-only.

Always English: frontmatter keys, enum values, stage headings, CR ids and step
keywords, task markers, filenames/directories and CLI. Configured language:
title, stage prose, scenario content and task descriptions.

## Authoring helpers

- `changeledger new <type> <slug> "<title>"`
- `changeledger check [id]`
- `changeledger list [--status S] [--type T] [--owner NAME|--unowned] [--pending graduation|archive] [--archived|--all] [--json]`
- `changeledger show <id> [--json]`
- `changeledger search <terms...> [--type T] [--status S] [--json]`
- `changeledger owner <id> <name|->`
- `changeledger fix --structured-sections [--dry-run]`

Run `changeledger <command> --help` for exact options; the commands support the
file contract rather than replacing it.
