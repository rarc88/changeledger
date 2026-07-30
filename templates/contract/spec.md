# Authoring a Change

## Repository layout and creation

The project-owned `AGENTS.md` carries the bootstrap; run `changeledger context`
before acting and `changeledger new` to create a change. The slug is structural
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

`owner` identifies responsibility and is born at creation, resolved by the CLI
unless `--owner` sets it. Override with `changeledger owner <id> <name|->`;
absence means unassigned.

Keep each fact in one stage and link to it from the others. Do not let summaries
or plans become competing versions of the same truth.

## Stages

Use fixed English `##` headings — `Request`, `Investigation`, `Proposal`,
`Specification`, `Plan`, `Log` — in that order and only when activated for the
type in `config.yml`, whose configured matrix is authoritative. For bugs,
Investigation contains the root cause; for audits, it is the core analysis.
Proposal includes the chosen solution, discarded alternatives and scenarios.

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

A criterion is a falsifiable claim, so its wording is part of the contract:

- Every `Then` states a fact measured at writing time, never a plausible
  assumption: verify before you write it.
- A criterion that quantifies universally (e.g. `every`, `all`, `no`) either covers
  its whole domain or narrows to what it verifies.
- Derive sets from `config.yml` instead of enumerating members by hand, so a new
  member cannot leave the criterion silently partial.
- For code the change will edit, cite symbols, paths and test names, never line
  numbers: the change's own work invalidates them.

## Plan task grammar

Markers encode state; structured children carry every trace, never a position:

```markdown
- [ ] Rewrite the parser, wrapping onto
  an indented continuation line
  - **Target:** `src/foo.ts`
  - **Verify:** `pnpm test`
  - **Criteria:** CR1, CR2
- [x] Update `src/bar.ts`
  - **Target:** `src/bar.ts`
  - **Verify:** `pnpm test`
  - **Criteria:** CR3
  - **Resolved:** `2026-06-13T14:20:00Z`
- [!] Run the complete test suite after implementation
  - **Support:**
  - **Blocked:** blocked reason — arbitrary punctuation is safe
```

`Target`, `Verify`, `Criteria` and `Support` are legal in any state, at most once each, and contiguous with their task. `Criteria` is the sole traceability — a list of `CRn` ids — so parentheses in the description are always prose. An indented non-child line continues the description; a non-indented line that is neither task nor blank is reported, never dropped.

`Support` (value optional) marks operational work such as test suites, reading, blast-radius analysis or scaffolding. It needs no CR or target/verification readiness checks and cannot replace a criterion for observable behaviour.

Pre-existing Plan tasks without structured children migrate to this grammar with `changeledger fix --plan-tags`, and legacy task metadata or Log events migrate with `changeledger fix --structured-sections` (both previewed with `--dry-run`).

## IDs and language

The id is the UTC creation instant in `YYYYMMDD-HHMMSS`, derived from `created`;
the filename is `{id}-{english-slug}.md`. Abbreviated viewer ids are
display-only.

Always English: frontmatter keys, enum values, stage headings, CR ids and step
keywords, task markers, filenames/directories and CLI. Configured language:
title, stage prose, scenario content and task descriptions.
