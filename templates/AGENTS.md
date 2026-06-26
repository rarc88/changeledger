# AGENTS.md — Spec Ledger Contract

This repo uses **Spec Ledger**. The documents under `.sl/` are the **source of
truth**. Code is their reflection. Work is planned and documented here before any
code is written.

Any agent working in this repo **must** follow this convention.

> **Language policy.** Structure is always English; content follows the repo's
> configured language. See §8.

## Agent Fast Path

Use this path first; read the detailed sections below when the work touches that
area.

1. Read the repo's own `AGENTS.md`, then this contract at `.sl/AGENTS.md`. If the
   link is missing after a clone or move, run `sl register`.
2. Do not create files or implement from a vague request. Create or update a
   change only after the human authorizes documentation.
3. Do not implement while the change is `draft`. Wait for human approval, then
   commit the approved change document before editing implementation files.
4. Work one approved change at a time on a non-main branch. Inspect the worktree
   first and keep unrelated changes out of your commits.
5. Keep the change current as you work: `sl status`, `sl task`, `sl log`, and
   `sl owner` are the safest way to update lifecycle, tasks and ownership.
6. For types that require review, move to `in-review` and delegate a clean-context
   review before human validation. Size any delegated model to the actual
   difficulty; do not over-shard work.
7. Stop at `in-validation`. The human accepts or rejects the whole result; the
   agent never marks `done`.
8. After human acceptance, graduate persistent truth into `.sl/specs/` or record
   an explicit graduation skip, then archive the done change.

When you need exact CLI syntax, run `sl help` or `sl <command> --help`.

---

## 1. Principles

1. Work starts with conversation. Questions and read-only investigation may
   develop the request, but no change file or implementation artifact is created
   until there is enough clarity to document faithfully **and** the human
   explicitly authorizes documentation. A direct request such as “create the
   change” is authorization; if essential information is still missing, clarify
   it instead of inventing requirements.
2. The human authorizes scope, approves drafts and accepts the final result. The
   agent decides how to divide and execute work within that authorized scope.
3. Every authorized change is captured as a **change** document before touching
   code.
4. The document wins. If code and document diverge, the document is the truth:
   update the code, never quietly drift the document.
5. Humans consume these documents in the **viewer** (`sl view`), not as raw
   markdown. Write with the rendered view in mind.

## 2. Repo layout

```
.sl/
  config.yml          # types, active stages, paths, language (repo specifics)
  changes/
    0001-title.md     # one change = one file
  specs/              # persistent truth (appears once the first change graduates)
  AGENTS.md           # symlink to the installed contract (per-machine, gitignored)
AGENTS.md             # the project's own contract; references .sl/AGENTS.md
CLAUDE.md             # optional — same reference, for Claude Code
```

**Contract discovery.** This contract is a tool artifact, not a project artifact:
it ships with `sl` and is linked into each repo as `.sl/AGENTS.md` (a per-machine,
gitignored symlink — never copied, never committed, so it never drifts). The
project's own contract files (`AGENTS.md`, and `CLAUDE.md` if present) keep their
own content; `sl init` only appends an alert-box reference pointing agents to
`.sl/AGENTS.md`. `sl register` regenerates the link after a clone or move;
`sl check` fails if a reference or the link is missing.

## 3. The change

A change is **a single markdown file**: frontmatter (structured, for machine and
viewer) plus a body of **stages** (the lifecycle).

### Frontmatter (required)

```yaml
---
id: "0001"
title: Short, clear title
type: feature                  # feature | bug | audit | refactor | chore
status: draft                  # draft | approved | in-progress | in-review | in-validation | blocked | done | discarded
created: 2026-06-13T13:45:48Z  # full ISO 8601 UTC timestamp
depends_on: []                 # ids of other changes, e.g. ["0000"]
owner: ana                     # optional — who is working on it (see below)
release_impact: minor          # optional — none | patch | minor | major
---
```

**`owner` (optional).** Who is responsible for the change. It is auto-assigned the
moment work starts — the `approved → in-progress` transition — unless already set.
The handle is the **GitHub login** (`gh api user --jq .login`), falling back to
`git config user.name` when `gh` is missing or unauthenticated. Override or clear
it anytime with `sl owner <id> <name|->`. Absent means unassigned.

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
`Then`, `And`) are fixed English; the rest is content (per `language`). The
machine-readable shape is exact: localized headings such as
`## Especificación`, translated step labels such as `Dado`/`Cuando`/`Entonces`,
inline criteria, or `#### CR1` do not count as structured criteria for
`sl check`.

## 4. Tasks (inside `## Plan`)

Markdown checklist. State convention by marker:

```markdown
- [ ] Pending task with target and verification (CR1)
- [x] Completed task with target and verification (CR1) — 2026-06-13T14:20:00Z
- [!] Blocked task with target and verification (CR1) — reason for the block
- [ ] Operational task that changes no observable behavior (support)
```

The viewer derives progress and the "blocked" state from these markers.

**Traceability.** Each task references the criteria it satisfies, in trailing
parentheses: `- [ ] Validate frontmatter (CR1, CR2)`. This links
criterion → task, so coverage is auditable. `sl check` extracts criteria only
from the final parenthesized `CRn` block in the task description; mentions of
`CR1` earlier in the sentence are prose, not traceability.

**Machine-readable task grammar.** For tasks that satisfy criteria, keep all
target and verification text inside the description before the final criteria
block:

```markdown
- [ ] Update `src/app/foo.ts`; verify: `pnpm test` (CR1)
- [x] Update `src/app/foo.ts`; verify: `pnpm test` (CR1) — 2026-06-13T14:20:00Z
- [!] Update `src/app/foo.ts`; verify: `pnpm test` (CR1) — blocked reason
```

The trailing `— ...` suffix is reserved for resolution metadata: done timestamps
and blocked reasons. Pending tasks have no suffix. Do not put readiness evidence
after the criteria block:

```markdown
- [ ] Update `src/app/foo.ts` (CR1) — verify: `pnpm test`
```

In that bad form, the parser removes `— verify: ...` before readiness checks, so
the task still references `CR1` but appears to have no verification. Write it as:

```markdown
- [ ] Update `src/app/foo.ts`; verify: `pnpm test` (CR1)
```

**Operational tasks.** Tasks that do not directly satisfy a criterion — running
a test suite, reading a wrapper before refactoring, evaluating blast radius,
scaffolding — may carry a literal trailing `(support)` instead of a `CRn`.
`sl check` will not warn about missing criteria for these tasks, and readiness
checks (target + verification patterns) do not apply to them either. `(support)`
is not localized and must be the final parenthesized marker. It is not a
substitute for a missing criterion on an implementation task — if a task writes
or changes observable behaviour, it must cite the `CRn` it satisfies.

**Resolution timestamp.** A completed task (`[x]`) carries a trailing
`— <ISO 8601 UTC>` with the exact moment it was resolved (full timestamp, so
same-day tasks keep their order). Pending tasks have none; blocked tasks use the
suffix for the reason. Order on the line: `description (CRn) — timestamp|reason`.

## 5. Lifecycle (`status`)

```
draft → approved → in-progress
in-progress → in-review → in-validation → done   [review required]
in-progress → in-validation → done               [no review required]
in-review → in-progress                           [review retry]
in-review → blocked → in-progress                 [review escalation]
in-validation → in-progress                       [human rejection]

(draft | approved | in-progress | blocked) → discarded   [terminal]
```

- **draft** — created after a human request or authorization. Do not implement yet.
- **approved** — the human reviewed it in the viewer and approved. Ready to build.
- **in-progress** — implementation underway; tick tasks as you go.
- **in-review** — implementation complete; awaiting an **independent review**
  (see §6). Only for types with `review_required: true` in `config.yml`; others
  go straight `in-progress → in-validation`.
- **in-validation** — implementation and any required independent review are
  complete; the **human** tests and accepts or rejects the change as a whole.
  Acceptance reaches `done`; rejection with a reason returns to `in-progress`.
- **blocked** — blocked; at least one `[!]` task or external impediment, or a
  review that escalated to a human. Note it in Log.
- **done** — terminal: all tasks `[x]`, criteria met, required review passed, and
  the human accepted the complete result.
- **discarded** — a terminal tombstone: the change was decided against. Reachable
  from an active state before the closing gates (not from `done`, `in-review` or
  `in-validation`) via
  `sl discard <id> "<reason>"` — the reason is **required** and logged. Prefer
  this over deleting the file: the decision and its rationale stay part of the
  truth, and `depends_on` references keep resolving. Hidden from the board by
  default; revealed by the viewer's "Discarded" toggle. Terminal changes are
  never resurrected; later work gets a new authorized change.

**Transitions are enforced.** `sl status` validates the graph above; a move
outside it (e.g. skipping `in-validation`, or reopening a `done`) is rejected.
`sl status` refuses both `done` (human acceptance belongs to the viewer) and
`discarded` — use the dedicated
`sl discard <id> "<reason>"` so a reason is always captured. The viewer only
performs the human-owned moves: `draft → approved` and
`in-validation → done|in-progress`. The agent performs the rest via the CLI.
After a human-owned move, continue with the existing execution rule: approval
uses §6.4, rejection uses §6.7, and acceptance uses §6.9 and §10.

## 6. Agent rules

1. **One concern per change; related work may grow deliberately.** If a request
   mixes unrelated concerns, propose separate changes for human authorization
   (e.g. a bug fix and a new feature). Work necessary to fulfill an active
   change's already authorized objective belongs in that change: update its
   Specification, Plan and Log. If related work materially expands observable
   scope, obtain explicit human authorization before adding it. Independent work
   is proposed as a separate change.
2. **Do not implement in `draft`.** Create the change, wait for human approval.
3. **Single source of truth.** Do not duplicate info across stages; link instead.
4. **Git workflow protects traceability.** Never implement approved changes on
   `main`, `master`, or `dev`; create/switch to a work branch or ask the human
   before continuing. Before implementation, inspect the worktree. If unrelated
   changes exist, do not include them silently: ask whether to stash, commit,
   ignore, or include them. After human approval, commit the approved change
   documentation before touching implementation code. Implement one change at a
   time. Commit a completed unit before continuing when another task, change, or
   modification of the same surface could make attribution ambiguous; do not
   wait until the end to reconstruct mixed diffs. Commit messages reference the
   id, e.g. `feat(scope): description [#0001]`. If shared files make a combined
   commit unavoidable, call it out explicitly in the Log or final response and
   name the changes that share the surface.

   **Rejected-correction isolation.** After review `fail --retry`, keep the
   candidate correction uncommitted while a fresh clean-context reviewer checks
   it. If review fails again, iterate on the same diff. After `pass`, commit the
   confirmed correction with its related ledger truth before asking for human
   validation.

   After `in-validation → in-progress`, keep the candidate correction
   uncommitted until the human confirms it fixes the reported failure. Iterate on
   the same diff if it fails again. In either path, do not start another task or
   change while a correction waits, because the worktree is the isolation
   boundary. After human acceptance, graduate/skip and commit the validated
   correction with its related ledger truth. These exceptions prevent false fix
   attempts from becoming permanent history; they do not relax intermediate
   commits for already verified units.
5. **Keep the change updated as you go:** tick tasks, move `status`, write to Log.
   The document reflects reality at all times.
6. **Independent review when configured.** When the implementation is complete,
   move to `in-review` and **delegate the review to a fresh subagent** — clean
   context (no implementation history, so no bias) and a model **sized to the
   difficulty** (don't spend a costly model on a trivial check). The reviewer
   verifies: every `CRn` is met, no residue (rule 8), and the Plan is truly done.
   Deep security/SAST/lint live in
   dedicated tools — the reviewer may invoke them and record the verdict, but Spec
   Ledger does not reimplement them. Record the verdict with `sl review` (§9):
   `pass → in-validation`; `fail --retry` (defect inside the contract → back to
   `in-progress`); `fail --block` (exceeds the contract → `blocked` for a human).
   *How* the subagent is spawned is the host agent's concern; the contract only
   fixes that it must be a clean-context subagent. Types without
   `review_required` move directly from `in-progress` to `in-validation`.
7. **Human validation before `done`.** The agent stops at `in-validation` and
   asks the human to test the complete result in the viewer. The agent never
   accepts on the human's behalf. A rejection requires a reason and returns the
   same change to `in-progress`; update its Specification/Plan and add ordinary
   tasks as needed, then repeat review (when configured) and validation. `done`
   and `discarded` never reopen.
8. **No residue:** no TODO/FIXME or dead code without explicit agreement.
9. **On completion**, graduate the truth: update or create the `specs/` doc(s)
   that capture the new persistent state (see §10).
10. **Prefer visuals.** When a diagram explains something better than prose
   (flows, state, architecture, relationships), use a ` ```mermaid ` block. The
   diagram text is the source; the viewer renders it. Humans grasp it faster.
11. **Delegation is the agent's call, but it must be economical.** Spec Ledger is
    agnostic to *how* work gets done: any stage may be delegated to subagents at
    the host agent's discretion, and the contract never prescribes the mechanism
    (that is the agent's and harness's responsibility). Delegation is expected
    when it reduces main-context pressure, lowers cost with a sufficient model,
    parallelizes genuinely independent work, or provides clean-context review.
    It is wasteful when it multiplies coordination without improving quality,
    speed, or context control.

    **Delegate for a reason.** Good delegation units have a clear question or
    ownership boundary: an investigation surface, a module, a package, a test
    area, a migration slice, or an independent verification. Request and
    Investigation may split independent codebase questions across explorers.
    Proposal and Specification may use a stronger model when ambiguity,
    architecture, safety, or product judgment is high. Implementation may split
    across workers only when write sets are disjoint and integration is obvious.
    Verification may be delegated when it catches risk without duplicating the
    implementer's work. Review (§6.6) is special: for configured types,
    delegation to a **clean-context** subagent is a *contract requirement* —
    there, independence is correctness, not an optimization.

    **Do not over-shard.** Do not create one subagent per file, per line, or per
    tiny mechanical edit. If many files need the same small change, prefer one
    well-scoped subagent, a batch edit, or a script that the main agent verifies.
    Do not run parallel subagents over the same files or conceptual surface
    unless the overlap is deliberate and the integration plan is explicit. If
    the main agent cannot state why a subtask is independent, what output it
    expects, and how it will integrate the result, keep the work in the main
    thread or regroup it.

    **Size the model to the task.** Use the strongest available models for
    ambiguous scope, architectural tradeoffs, security-sensitive reasoning,
    complex specification, and difficult reviews. Use sufficient cheaper models
    for localized exploration, inventories, straightforward implementation,
    mechanical edits, running tests, and checking narrow hypotheses. Escalate
    model strength when uncertainty or risk rises; de-escalate when the task is
    already specified and mostly execution.

    **Every delegation prompt names the contract.** State the reason for
    delegating, the owned files/area or investigation question, the expected
    output, the model-sized difficulty if relevant, and the integration
    criterion. Tell coding subagents that they are not alone in the codebase:
    they must not revert others' edits, and they must keep changes inside their
    assigned ownership.
12. **Triage friction at handoff; retrospect after completion.** Before handing
    the human a completed or blocked work result, review any friction, ambiguity,
    bug, or improvement already discovered while using Spec Ledger, then
    classify it:
    - If it is necessary to fulfill the purpose of an active change, update that
      change's Specification/Plan/Log; do not create another.
    - If it is an operational step of the current flow (verify, commit, graduate,
      archive, close), execute or record it in the current change; it is not a
      new change.
    - If it is independent, too large, or materially expands impact, propose its
      type, title, and reason to the human. Create the draft only after explicit
      authorization; a direct request such as “create the change” is already
      authorization. Batch proposals at the end of the turn when practical.
    - If it is too vague for backlog, mention it without creating a file.

    This triage must not mix independent concerns into active work or block work
    that is otherwise ready for validation. When a change reaches `done`, also
    share a brief retrospective of the completed cycle with the human. A
    `discarded` change records why it was decided against but does not imply a
    completed implementation cycle.

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
| acceptance ids and step keywords (`CR1`, `Given`, `When`, `Then`, `And`) | scenario content after the keyword |
| task markers and structural markers (`- [ ]`, `(CR1)`, `(support)`) | task prose |
| file/dir names, CLI | |

This contract is the canonical spec and stays in English regardless of the
repo's configured language.

## 9. Optional CLI helpers

Files are the source of truth; you may edit them directly. But the CLI does the
error-prone parts (UTC timestamps, status enums, task markers) for you. Run
`sl help` for the full list and `sl <command> --help` for exact options.

Critical flow commands:

- `sl register` — relink this repo's path and `.sl/AGENTS.md` after a move/clone.
- `sl new <type> <slug> "<title>"` — scaffold a change; the slug is English.
- `sl status <id> <status>` — move the lifecycle and log the transition. It does
  not accept `done` (the human accepts in the viewer) or `discarded` (use
  `sl discard <id> "<reason>"`); see §5.
- `sl task <id> done|block <n> [reason]` — mark a Plan task; `done` injects UTC.
- `sl log <id> "<message>"` and `sl owner <id> <name|->` — keep execution notes
  and ownership current.
- `sl review <id> pass` — record a passed independent review
  (`in-review → in-validation`).
- `sl review <id> fail --retry|--block "<reason>"` — route review failure back
  to `in-progress` (fixable) or `blocked` (escalates to a human).
- `sl check [id]` — validate a change or the whole repo before committing.

Closing and persistence commands:

- `sl graduate <change-id> <spec-slug>` — scaffold a **new** spec seeded from the change.
- `sl graduate <change-id> <spec-slug> --into` — graduate into an **existing**
  spec: refresh its `updated`, link it in the change Log and mark `reviewed`,
  without overwriting the spec body (the agent edits the body manually).
- `sl graduate <change-id> --skip [reason]` — mark a done change's graduation
  reviewed without a spec (bug/chore with no persistent truth); logs the reason.
- `sl graduate --pending` — list done changes whose graduation is not reviewed yet.
- `sl archive <id>` / `sl unarchive <id>` — hide/show a change in the viewer.
- `sl list [--status S] [--type T] [--json]` / `sl show <id> [--json]` — inspect
  state without manually parsing files.

Release commands:

- `sl release init <version>` — adopt release tracking at an existing stable
  SemVer version; the baseline includes all changes already `done`.
- `sl release plan [--json]` — calculate the next version and included changes
  without writing. JSON is the handoff contract for the operating agent.
- `sl release record <version>` — record the exactly calculated release in
  `.sl/releases/<version>.yml`; it does not edit stack manifests or perform Git,
  hosting or publishing operations.

### Release boundary

Release impact defaults live under `release.impacts` in `.sl/config.yml` and a
change may override its type with `release_impact`. Spec Ledger owns the
portable decision: which completed changes ship and what stable SemVer follows.
The operating agent owns technology-specific application and delivery: update
`package.json`, `pubspec.yaml`, `Cargo.toml`, Gradle, Xcode or monorepo surfaces;
run the project gates; then commit, tag and publish according to the local
contract. Never infer that every Spec Ledger repository uses npm or GitHub.

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
is the journey; a spec is the destination. `sl graduate <change-id> <spec-slug>`
scaffolds a **new** spec seeded from the change's Specification/Proposal and links
it back in the change's Log — then refine the wording by hand. To graduate into an
**existing** spec (the common case — extending `architecture.md` etc.), use
`--into`: it links and marks `reviewed` and refreshes the spec's `updated` without
overwriting the body, which you edit. Prefer diagrams (§6.10 / mermaid) where they
explain the system better than prose.

**Graduation review.** A done change either graduates to a spec or is reviewed as
needing none (a bug/chore with no persistent truth). Both set the optional
`reviewed: true` frontmatter flag. `sl graduate --pending` lists done changes
still unreviewed; resolve each with `sl graduate <id> <spec>` or
`sl graduate <id> --skip [reason]`. ("graduated to a spec" stays derivable from
the `graduado a spec` Log marker; `reviewed` only tracks that the question is
settled.)

## 11. Definition of Ready (implementation)

Spec Ledger is built for a split: a **strong model documents**, a **less capable
(but able) model implements**. So a change must carry enough that the implementer
needs no extra reasoning. The `tdd` flag in `config.yml` governs this (default
`true`); set it `false` only for exploratory repos. Repos may tune the concrete
shape with `readiness.target_patterns` and `readiness.verification_patterns`
(for example `src/**` + `test/**`, colocated `**/*.spec.ts`, or verification
commands such as `pnpm test`). For repos with manual/device verification,
prefer a structural convention such as `verification_patterns: ["verify:"]` and
write the concrete evidence in the task (`verify: manual Android device check`)
instead of listing every possible manual phrase in config.

When `tdd: true`, a change is **ready to implement** when:

1. **Specification is test-grade.** Every behavioral requirement is a `CRn` with
   **concrete values** (the actual input, not "a valid input"), the expected
   output/effect, and **literal** error messages. Each edge case is its own `CR`.
   No requirement lives only in prose — if it must hold, it is a `CR`.
2. **Plan is the implementation contract.** Every task references ≥1 `CR`, names
   the **target file(s)/area(s)** and the **verification** *in its description*
   according to the repo's readiness patterns, and is sized to one red-green
   cycle. The description is the part before the final `(CRn)` block and before
   any trailing `— ...` resolution suffix (see §4), so readiness evidence such as
   `verify:` must appear before `(CRn)`. The verification can be a test file next
   to the target, a conventional test directory, or a concrete command when that
   is how the repo proves the behavior. Pure support tasks (docs, scaffolding)
   may carry no `CR` — `sl check` will note them so the author confirms the
   omission is intentional.
3. **TDD is explicit.** The implementer writes the failing test from the `CR`,
   makes it pass, then refactors. The implementer never decides *what* to test —
   the `CR` fixes that; only *how*.

`sl check` enforces this lightly: for a change whose type activates
`## Specification`, it reports readiness gaps (`draft` as warnings,
`approved`/`in-progress` as errors) when a `CR` has no covering task, a task
references no `CR`, a task references an unknown `CR`, a criterion is missing
Given/When/Then, or a CR-bearing task does not name both target and verification
according to the repo's readiness patterns.
