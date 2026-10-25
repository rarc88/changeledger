# ChangeLedger — Core Contract

Work is documented before code: changes under `.changeledger/changes/` are authorized work;
specs under `.changeledger/specs/` are persistent truth. The human decides and the agent
executes. Every stage overlay is the authority for its stage; core never duplicates it; and an
overlay extends or specifies what is particular to its stage without repeating or contradicting
core.

## Classify intent before acting

Classifying the human's intent is free and mandatory on every message; loading a stage
context is not, so never load one speculatively.

| Intent | First action |
|---|---|
| asks, explores or wants understanding | answer from the repo: `changeledger search <terms>` before reading code |
| reports a problem or asks for new work | conversation first, then `changeledger context spec` only once the human authorizes documenting it |
| names a change or says "continue" | `changeledger context <id>` |
| asks what is pending | `changeledger list --status <s>`, `--pending findings`, `graduation`, `archive` |
| asks to review finished work | `changeledger context review` in a fresh clean context |
| asks to release | `changeledger context release` |
| requests an edit no change covers | ask the human: a `change` with Request and Log, or an operational edit |
| gives a verdict | transmit it with the lifecycle command; never infer one |

## Protect the orchestrator's context

Compaction causes drift and invented facts, and reading and writing code consume the most
context: delegate both by default and inline only trivially small work.

| Work | Owner |
|---|---|
| reading or searching beyond ~3 files to answer one question | subagent |
| implementation work with its own verify command | subagent |
| independent review of finished work | subagent with a fresh clean context |
| reading a change document, a spec or CLI output | orchestrator |
| talking to the human, deciding scope, integrating results | orchestrator, never delegated |

Every delegation is one level deep: a subagent never delegates further. One owner per write
surface; concurrent subagents must not share files. A review is delegated from the skeleton
`changeledger agent-prompt review`; any other prompt states what the delegation prompt
contract of `changeledger context implement` lists. A subagent returns findings or a diff
receipt, not narrative.

A **selection of work** is the unit delegated: related tasks travel together to one delegate,
independent ones go alone or in parallel. It becomes a **resolved selection** when its own
verification passes, and it is committed then, without waiting for the rest.

Size the delegate to the work: cheapest tier and low effort for mechanical lookups and edits;
mid tier for bounded reasoning over one surface; top tier and high effort for deep analysis,
ambiguity, cross-cutting design and adversarial review; mid tier when unsure. An undersized
hard task is paid for twice.

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
  by inference: wait if it affects the current task, otherwise report it without expanding
  scope.
- A human verdict is transmitted, never inferred; praise, “continue” or agent advice is not
  a decision.
- Once a change is `done`, reload `changeledger context <id>`: the close overlay owns
  graduation and archive.

## When no change is needed

If no approved or in-progress change applies, do not silently edit repository files: create
or update a change, or ask the human whether a purely operational, reversible edit with no
persistent truth or observable behavior change should be done directly; if unsure, document
it in ChangeLedger. Small work with observable behavior is still a `change`: it goes from
`in-progress` to `done` directly only when git shows it touches no code, and is otherwise
reviewed — see `changeledger context implement`.

Humans consume changes in `changeledger view`; write for the rendered view.

## Stage exit gates

Every stage verifies its own output at its exit transition; no stage depends on the next one
to learn whether its work is correct. The implementer proves the change meets its criteria
before requesting review; the reviewer is the last line of defence, not a design oracle nor a
source of requirements. A review finding that the previous stage's own exit criteria should
have caught is a defect of that stage, not a normal review round.

## Complexity ceiling

A change must be implementable and verifiable in one bounded pass; if it cannot, split it
before approval — `changeledger context spec` owns the sizing test and the split criteria.
After work has started, a failed verification is diagnosed, never auto-split: the review
context owns that classification.

## Commits

A change branch carries four commit classes and no others. **Draft**: one per drafted change
document, committed on its own — never several drafts in one commit. **Baseline**: exactly
one, the approved change document, before any code. **Implementation**: one per resolved
selection of work — its code, tests, ticked boxes and Log entries — committed once its local
gate passes, without waiting for the rest, so their number per change is not fixed. A
correction after a review `fail` or a human rejection is one more resolved selection,
committed before the change returns to `in-review`. **Handoff**: mandatory whenever work
stops on an impediment or a session ends with uncommitted state; record why it was needed.

Every selection is committed before the review is delegated, so the reviewer inspects a
closed `baseline..HEAD` and the deliverable cannot change between the report and history.

Granularity follows one test: whether the unit will be reverted, referenced or implemented
independently. A change document and a resolved selection pass it; a single Plan task and a
lifecycle transition do not — a transition travels inside the next real commit, since the Log
already records it.

Subjects follow `type(scope): description [#<id>]` with the real id and conventional type. One
change keeps its marker at the end of the subject; two or more keep the subject clean and use
one canonical body line, `ChangeLedger: [#A] [#B]` — never a comma list in one bracket. Ledger
meta-commits (status, review, log, archive) carry markers like any other; only merge commits,
`chore(release)` prep and a `ChangeLedger: none — <reason>` body are exempt.
`changeledger commit -m "<type>(<scope>): <desc>" [--id <id>]` composes and creates it,
resolving the single `in-progress` change when `--id` is omitted and failing without
committing if that is ambiguous or the subject is not conventional. Run `changeledger check
--commits [<base>]` before requesting review.

A combined commit is legitimate only when several changes share the same files. Record in the
Log what was combined and why, naming every change that shares the surface. Plan tasks are
never a reason: each resolved selection is committed on its own.

## Lifecycle

- `draft`: objective and frontier awaiting human approval; no implementation.
- `approved`: ready to start after the Git/worktree checks.
- `in-progress`: implementation underway.
- `in-review`: independent review required.
- `done`: delivered by the agent. Human acceptance is the merge of the change's branch
  into the integration branch; graduation stamps that instant as `accepted_at`
  telemetry, which gates nothing.
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
`approved` or `discarded`. Conversational decision commands are auditable transmitters,
never permission to infer a human verdict. The discard reason is required and logged, and
dependencies remain resolvable; `discarded` never reopens. A recorded release is the only
irreversible boundary: a change listed in one refuses the return with `change <id> shipped in
release <version>: new work needs a new change`. Graduation is not a boundary — `--into`
leaves the spec body alone. Archiving one change by id is undone in the document by editing
`archived: false`, but it also deletes that change's own local branch once merged, and that
is not undone.

## Context modes

Escalate to a mode before acting: `changeledger context spec` before
documenting, `changeledger context implement` or `changeledger context
<change-id>` before executing. `changeledger context --help` names what each
mode is for.

## Operational discovery

Query the CLI before scanning files:

- `changeledger list --status approved`: approved changes ready to implement.
- `changeledger list --pending findings|graduation|archive`: open findings, pending graduation decisions, archive candidates.
- `changeledger search <terms...>`: related changes (archived included) and specs, before investigating from scratch.
- `changeledger analyze [id]`: recorded consumption and cost per change, segment, model or version, instead of the usage records.

`changeledger help` and `changeledger <command> --help` give exact syntax. Structure is always
English. Each context delivers the effective policy for its task, so never read
`.changeledger/config.yml` raw to operate.
