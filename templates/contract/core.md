# ChangeLedger — Core Contract

Work is documented before code: changes under `.changeledger/changes/` are authorized work;
specs under `.changeledger/specs/` are persistent truth. The human decides and the agent
executes. Every stage overlay is the authority for its stage; core never duplicates it; and an
overlay extends or specifies what is particular to its stage without repeating or contradicting
core.

## Classify intent before acting

Classifying the human's intent is free and mandatory on every message; loading a stage
context is not, so never load one speculatively and never reload one already held.

| Intent | First action |
|---|---|
| asks, explores or wants understanding | answer from the repo: `changeledger search <terms>` before reading code |
| reports a problem or asks for new work | conversation first, then `changeledger context spec` only once the human authorizes documenting it |
| names a change or says "continue" | `changeledger context <id>` |
| asks what is pending | `changeledger list --status <s>`, `--pending graduation`, `--pending archive` |
| asks to review finished work | `changeledger context review` in a fresh clean context |
| asks to release | `changeledger context release` |
| requests an edit no change covers | ask the human: a `change` with Request and Log, or an operational edit |
| gives a verdict | transmit it with the lifecycle command; never infer one |

## Protect the orchestrator's context

Context exhaustion causes compaction, and compaction causes drift and invented facts. Reading
code and writing code are the two heaviest consumers: delegate them by default and inline
only when trivially small.

| Work | Owner |
|---|---|
| reading or searching beyond ~3 files to answer one question | subagent |
| implementation work with its own verify command | subagent |
| independent review of finished work | subagent with a fresh clean context |
| reading a change document, a spec or CLI output | orchestrator |
| talking to the human, deciding scope, integrating results | orchestrator, never delegated |

Every delegation is one level deep: a subagent never delegates further. One owner per write
surface; concurrent subagents must not share files. Get the prompt skeleton from
`changeledger agent-prompt <role>`
(investigation | implementation | review | graduation-review);
the stage context owns what the prompt must contain. A subagent returns findings or a diff
receipt, not narrative.

A **selection of work** is the unit that is delegated, measured by completeness and coupling
rather than delegated task by task: related tasks travel together to the same delegate, and
independent ones go alone or all at once. It becomes a **resolved selection** when its own local
verification passes, and it is committed as it resolves, without waiting for the rest.

Size the delegate to the work, not to the caller's convenience: cheapest tier and low effort
for mechanical lookups and bounded mechanical edits; mid tier for bounded reasoning over a
single surface; top tier and high effort for deep analysis, ambiguity, cross-cutting design
and adversarial review. Default to mid tier when unsure. Under-sizing a hard task produces
rework the orchestrator pays for twice.

## Invariants

- No artifact without explicit human authorization, and none before there is
  enough clarity to document faithfully: a direct request such as “create the
  change” is authorization; never invent missing requirements.
- One concern per change. Work is in when it must be true for the approved objective to be
  met, and out when leaving it undone leaves the objective met: propose that work separately.
  The frontier may pre-authorize work inside it; changing the objective or the frontier goes
  back to the human.
- Never implement a `draft`.
- One change at a time, on a non-main branch.
- Keep lifecycle, tasks, ownership and Log current.
- Pre-existing divergence between specs and code is reported to the human, never reconciled
  by inference. Wait if it affects the current task; if unrelated, report it without
  expanding scope.
- A human verdict is transmitted, never inferred; praise, “continue” or agent advice is not
  a decision.
- No silent repository edits when no change applies.
- Once a change is `done`, reload `changeledger context <id>`: the close overlay owns
  graduation and archive.

## When no change is needed

If no approved or in-progress change applies, do not silently edit repository files. Create
or update a change, or ask the human whether a purely operational, reversible edit with no
persistent truth or observable behavior change should be done directly. If unsure, document
it in ChangeLedger. Small work with observable behavior is still a `change`, never a bypass of
documentation: it goes from `in-progress` to `done` directly only when git shows it touches no
code, otherwise it is reviewed like any other — see `changeledger context implement`.

Humans consume changes in `changeledger view`; write for the rendered view.

## Stage exit gates

Every stage verifies its own output; no stage depends on the next one to learn whether its
work is correct. The exit transition of a stage is its self-verification point: the
implementer proves the change meets its criteria before requesting review. The reviewer is
the last line of defence, not a design oracle and not a source of requirements. A review
finding that the previous stage's own exit criteria should have caught is a defect of that
stage, not a normal review round.

## Complexity ceiling

A change must be implementable and verifiable in one bounded pass. If it cannot, split it
before approval — an oversized change is the most common root cause of repeated review
rounds, and `changeledger context spec` owns the sizing test and the split criteria. After
work has started, a failed verification is diagnosed, never auto-split: the review
context owns that classification.

## Commits

A change branch carries five commit classes and no others. **Draft**: one per drafted change document,
committed on its own — never several drafts in one commit. **Baseline**: exactly one, the approved change
document, before any code. **Implementation**: one per resolved selection of work — its code, tests, ticked
boxes and Log entries — created once the local gate passes and committed as soon as that selection is
resolved, without waiting for the rest, so the number of implementation commits per change is not fixed.
**Correction**: zero or more, each left uncommitted until a fresh reviewer confirms it.
**Handoff**: mandatory whenever work stops on an impediment or a session ends with uncommitted
state; record why it was needed.

Every selection is committed before the review is delegated, so `baseline..HEAD` is closed the instant the
review is delegated: the reviewer inspects a fixed range and the deliverable cannot change between the
report and history.

Granularity follows one test: whether the unit will be reverted, referenced or implemented
independently. A change document and a resolved selection pass it; a single Plan task and a lifecycle
transition do not — a transition travels inside the next real class, since the Log already records it.
So a change yields one commit per resolved selection, one more per confirmed correction and one per
handoff, never one per transition.

Subjects follow `type(scope): description [#<id>]` with the real id and conventional type. One change keeps
its marker at the end of the subject; two or more keep the subject clean and use one canonical body line,
`ChangeLedger: [#A] [#B]` — never a comma list in one bracket. Ledger meta-commits (status, review, log,
archive) carry markers like any other; only merge commits, `chore(release)` prep and a `ChangeLedger: none — <reason>` body are exempt.
`changeledger commit -m "<type>(<scope>): <desc>" [--id <id>]` composes and creates it, resolving the single
`in-progress` change when `--id` is omitted and failing without committing if that is ambiguous or the
subject is not conventional. Run `changeledger check --commits [<base>]` before requesting review.

A combined commit is legitimate only when separation is impossible: several changes share the same files.
Record in the Log what was combined and why, naming every change that shares the surface. Plan tasks are
never a reason — separating them is always possible, since each resolved selection is committed on its own.

## Lifecycle

- `draft`: objective and frontier awaiting human approval; no implementation.
- `approved`: ready to start after the Git/worktree checks.
- `in-progress`: implementation underway.
- `in-review`: independent review required.
- `done`: delivered by the agent. Human acceptance is the merge of the change's branch
  into the integration branch; graduation stamps that instant as `accepted_at`
  telemetry, which gates nothing. A branch that lands after the graduation is
  stamped by the next `changeledger sync`.
- `discarded`: terminal tombstone; never reopen it.

Who owns each transition and how it is performed:

| Transition | Owner | Mechanism |
|---|---|---|
| draft → approved | human | viewer or `changeledger approve <id>` after an explicit prompt |
| approved → in-progress; in-progress → in-review | agent | `changeledger status` |
| in-progress → done (no review) | agent | `changeledger status` |
| in-review → done | orchestrator | `changeledger review <id> pass` |
| in-review → in-progress | orchestrator | `changeledger review <id> fail "<reason>"` |
| done → in-progress | agent or human | `changeledger status` or viewer |
| draft/approved/in-progress → discarded | agent (authorized) | `changeledger discard <id> "<reason>"` |

`changeledger status <id> <status>` performs agent-owned moves and does not accept
`approved` or `discarded`. Conversational decision commands
are auditable transmitters, never permission to infer a human verdict.
The discard reason is required and logged, and dependencies remain resolvable; `discarded` never reopens.
A recorded release is the only irreversible boundary: a change listed in one refuses the
return with `change <id> shipped in release <version>: new work needs a new change`.
Graduation is not a boundary — `--into` leaves the spec body alone. Archiving one
change by id is undone in the document by editing `archived: false`, but it also
deletes that change's own local branch once merged, and that is not undone.

## Context modes

Escalate to a mode before acting: `changeledger context spec` before
documenting, `changeledger context implement` or `changeledger context
<change-id>` before executing. `changeledger context --help` names what each
mode is for.

## Synchronizing the global state

A repo that is not yet activated adopts the global state once with
`changeledger cutover` on its integration branch; every later clone joins with
`changeledger activate`. Run `sync` at the strategic points: when a session
opens, before delegating a review, at durable closure (graduation or archive)
and at every handoff. `changeledger sync --help` states what it does and why it
never blocks the local flow; the one obligation it leaves to you is that the
same document changed differently on both sides is reported, never resolved by
inference — the human coordinates that resolution.

## Operational discovery

Prefer structured CLI queries before scanning files:

- `changeledger list --status approved`: find approved changes ready to implement.
- `changeledger list --pending graduation`: find unresolved graduation decisions.
- `changeledger list --pending archive`: preview graduated or skipped changes.
- `changeledger search <terms...>`: find related changes (incl. archived) and specs by content before investigating from scratch.
- `changeledger analyze [id]`: query recorded consumption and cost per change, segment, model or version instead of reading the usage records.

Run `changeledger help` or `changeledger <command> --help` for exact CLI syntax.
Structure is always English. Each context delivers the effective policy that
applies to its task, so you never read `.changeledger/config.yml` raw to operate.
