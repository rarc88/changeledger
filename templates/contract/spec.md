# Authoring a Change

## Repository layout and creation

The project-owned `AGENTS.md` carries the bootstrap; `changeledger new` creates
a change. The slug is structural
and must be English; title and narrative follow the configured language. Files
remain the source of truth and may be edited directly, but prefer the CLI for
timestamps, enums and markers that are easy to mistype.

A request that mixes unrelated concerns becomes separate changes, created only
after explicit human authorization.

## Change document

A change is one Markdown file: YAML frontmatter plus fixed English stage
headings. Required and optional frontmatter:

```yaml
---
id: "20260613-134548"
title: Short, clear title
type: feature                  # a configured type; `new --help` lists them
status: draft                  # lifecycle value
created: 2026-06-13T13:45:48Z # full ISO 8601 UTC
depends_on: []                 # change ids or external project:id refs
related_to: []                 # optional non-blocking discovery links
parent: "<id>"                  # optional: the epic this change belongs to
owner: ana                     # optional
release_impact: minor          # optional: none | patch | minor | major
---
```

A multi-change effort declares one epic — a change of a type that carries no
implementation — and each child names it in `parent`. The edge is exclusive and
deliberately outside the relation graph: sharing a parent connects nothing, and
the hierarchy is two levels, never a tree. The epic is approved on objective and
frontier and **never enumerates its children at approval**; they are created as
the work discovers them, which is the same rule as not planning before
investigating, one level up. It cannot reach `done` while a child is neither
`done` nor `discarded`.

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

`documentation` delivers persistent truth about one topic, contrasted with what
the code actually does, and changes no application code. The shipped type turns
`tdd` off and has no Plan, so write its execution rules as its own CRs while
drafting: the perimeter is fixed in the draft from who calls what, never from
textual matches; every claim cites path and symbol; the human decides every
divergence from an existing spec before `in-review`, and the change waits on a `[!]`
task until they do; corrections to existing specs are drafted inside the change, where
the reviewer sees them.

When you classify a problem as a defect and the `Effective policy:` line
publishes `release_types=`, explicitly ask the human whether it is a normal fix
(`bug`, into the integration branch) or one of those types (into the release
branch). Never infer the answer, and create no draft until the human answers.
Without `release_types=`, neither ask nor propose a release type.

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
- A change that delivers or alters a workflow includes one criterion walking
  its first real end-to-end use — the full happy path of the day after, never
  only its edges and failure modes.

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

`changeledger fix --plan-tags` migrates Plan tasks without structured children; `--structured-sections` migrates legacy task metadata and Log events; preview either with `--dry-run`.


## IDs and language

The id is the UTC creation instant in `YYYYMMDD-HHMMSS`, derived from `created`;
the filename is `{id}-{english-slug}.md`. Abbreviated viewer ids are
display-only.

Always English: frontmatter keys, enum values, stage headings, CR ids and step
keywords, task markers, filenames/directories and CLI. Configured language:
title, stage prose, scenario content and task descriptions.
