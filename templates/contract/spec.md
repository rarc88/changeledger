# Authoring a Change

## Repository layout and creation

The project-owned `AGENTS.md` carries the bootstrap; `changeledger new` creates
a change. The slug is structural
and must be English; title and narrative follow the configured language. Files
remain the source of truth and may be edited directly, but prefer the CLI for
timestamps, enums and markers.

A request that mixes unrelated concerns becomes separate changes, created only
after explicit human authorization.

## Change document

A change is one Markdown file: YAML frontmatter plus fixed English stage
headings. Required and optional frontmatter:

```yaml
---
id: "20260613-134548"
title: Short, clear title
type: change                   # change | epic
status: draft                  # lifecycle value
created: 2026-06-13T13:45:48Z # full ISO 8601 UTC
depends_on: []                 # change ids or external project:id refs
related_to: []                 # optional non-blocking discovery links
parent: "<id>"                 # optional: the epic this change belongs to
owner: ana                     # optional
tdd: false                     # optional
integrates_into: release       # optional
release_impact: minor          # optional: none | patch | minor | major
---
```

There are two types: `change` implements and `epic` groups without implementing.
A multi-change effort declares one epic and each child names it in `parent`. The edge is exclusive and
deliberately outside the relation graph: sharing a parent connects nothing, and
the hierarchy is two levels, never a tree. The epic is approved on objective and
frontier and **never enumerates its children at approval**; they are created as
the work discovers them. It cannot reach `done` while a child is neither
`done` nor `discarded`.

Use `depends_on` only for execution prerequisites: dependencies can block
lifecycle progress and cycles. Use optional `related_to` for useful context that
must not impose execution order. Both accept local ids and
external `project:id` refs; declare a local relation once, deriving its backlink.

`owner` identifies responsibility and is born at creation, resolved by the CLI
unless `--owner` sets it. Override with `changeledger owner <id> <name|->`;
absence means unassigned.

Keep each fact in one stage and link to it from the others. Do not let summaries
or plans become competing versions of the same truth.

## Stages

Use fixed English `##` headings — `Request`, `Specification`, `Plan` and `Log` —
in that order. No type activates a stage: a change carries the ones it needs.
Investigation and Proposal are free prose under `###` headings: inside the
Request for what helps the human approve, inside the Specification for what is
found with the code in front. A change that fixes a defect states its root cause
in its investigation; a proposal states the chosen solution, the discarded
alternatives and the scenarios. `changeledger fix`, previewable with `--dry-run`,
repairs a live document's retired type or stage or lists it for a manual fix.

Ceremony is decided by comprehension, risk and resumability, never by size,
file count or task count:

- Comprehension: if the code must be explored before the objective can be
  stated, the Request carries that investigation.
- Risk: if the change takes an irreversible action or alters a public surface or
  persistent truth, its Specification states a criterion for that effect.
- Resumability: if another session could not resume it from the diff alone, it
  carries a Plan.

A draft declares `tdd: false` only when the change delivers no behaviour a test
can exercise — prose, specs, configuration or ledger documents only — and its
Log says why.

`changeledger approve` requires the Request's `### Objective` and `### Frontier`,
each with a body, for both types, and the human approves exactly those two. The
objective says what problem is solved and what finished means; the frontier says
what surface is in, what is out and what is pre-authorized inside. Other `###`
headings in the Request are free prose. Specification and Plan are written in
`in-progress`, with the code in front, and never return to approval: `changeledger
context implement` owns how they evolve and the exit gate that requires them.

A change that documents one topic against the code
writes its execution rules as its own CRs: the
perimeter is fixed in the draft from who calls what, never from
textual matches; every claim cites path and symbol; the human decides every
divergence from an existing spec before `in-review` or `done`, and the change waits
on a `[!]` task until they do; corrections to existing specs are drafted inside the
change.

When you classify a problem as a defect and the `Effective policy:` line
publishes `release_branch=`, explicitly ask the human whether the fix integrates
into the integration branch or the release branch, and declare
`integrates_into: release` in the frontmatter when it is the latter. Never infer
the answer, and create no draft until the human answers. Without
`release_branch=`, neither ask nor declare `integrates_into`.

Before investigating, run `changeledger search <terms from the request>`;
while investigating, classify every relevant change discovered, regardless of
whether it came from `search`, `list`, direct reading, context or conversation:
an execution prerequisite becomes `depends_on`, and useful context without
execution order becomes `related_to`. An explicit local change id must not
remain only in prose. Do not rediscover work another change or spec already
covers.

When a relationship, flow or architecture is clearer visually, use a Mermaid
block and keep its text as the source.

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
- Use actual inputs rather than “a valid input”, exact outputs or effects and
  literal error messages; give every edge case its own criterion. Nothing that
  must hold lives only in prose.
- For every external interface the change depends on, state whether its output
  is stable for automated consumption; a criterion may not assume stability
  nobody established.
- Every ask in `## Request` maps to at least one criterion or is explicitly
  named as excluded. No check judges this or the interface declaration; review
  does.
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

An implementation task cites the criteria it proves, names its target and its concrete verification, and fits one red-green cycle. `Support` (value optional) marks operational work such as test suites, reading, blast-radius analysis or scaffolding; it cannot replace a criterion for observable behaviour.

## IDs and language

The id is the UTC creation instant in `YYYYMMDD-HHMMSS`, derived from `created`;
the filename is `{id}-{english-slug}.md`. Abbreviated viewer ids are
display-only.

Always English: frontmatter keys, enum values, stage headings, CR ids and step
keywords, task markers, filenames/directories and CLI. Configured language:
title, stage prose, scenario content and task descriptions.
