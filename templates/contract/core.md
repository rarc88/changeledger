# ChangeLedger — Core Contract

Work is documented before code: changes under `.changeledger/changes/` are authorized work;
specs under `.changeledger/specs/` are persistent truth. The human decides and the agent
executes. Every stage overlay is the authority for its stage; core never duplicates it.

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
| requests an edit no change covers | ask the human: `quick` type or operational edit |
| gives a verdict | transmit it with the lifecycle command; never infer one |

## Protect the orchestrator's context

Context exhaustion causes compaction, and compaction causes drift and invented facts. Reading
code and writing code are the two heaviest consumers: delegate them by default and inline
only when trivially small.

| Work | Owner |
|---|---|
| reading or searching beyond ~3 files to answer one question | subagent |
| any implementation task with its own verify command | subagent |
| independent review of finished work | subagent with a fresh clean context |
| reading a change document, a spec or CLI output | orchestrator |
| talking to the human, deciding scope, integrating results | orchestrator, never delegated |

Every delegation is one level deep: a subagent never delegates further. One owner per write
surface; concurrent subagents must not share files. Get the prompt skeleton from
`changeledger agent-prompt <role>` (investigation | implementation | review | post-review);
the stage context owns what the prompt must contain. A subagent returns findings or a diff
receipt, not narrative. `post-review` is a read-only inspection of a change already in
`in-validation`; it never issues a verdict or moves the change.

Size the delegate to the work, not to the caller's convenience: cheapest tier and low effort
for mechanical lookups and bounded mechanical edits; mid tier for bounded reasoning over a
single surface; top tier and high effort for deep analysis, ambiguity, cross-cutting design
and adversarial review. Default to mid tier when unsure. Under-sizing a hard task produces
rework the orchestrator pays for twice.

## Invariants

- No artifact without explicit human authorization, and none before there is
  enough clarity to document faithfully: a direct request such as “create the
  change” is authorization; never invent missing requirements.
- Never implement a `draft`.
- One change at a time, on a non-main branch.
- Keep lifecycle, tasks, ownership and Log current.
- Pre-existing divergence between specs and code is reported to the human, never reconciled
  by inference. Wait if it affects the current task; if unrelated, report it without
  expanding scope.
- A human verdict is transmitted, never inferred; praise, “continue” or agent advice is not
  a decision.
- No silent repository edits when no change applies.
- After human acceptance, reload `changeledger context <id>`: the close overlay owns
  graduation and archive.

## When no change is needed

If no approved or in-progress change applies, do not silently edit repository files. Create
or update a change, or ask the human whether a purely operational, reversible edit with no
persistent truth or observable behavior change should be done directly. If unsure, document
it in ChangeLedger. For small, reversible, single-concern work with observable behavior, use
the `quick` type instead of bypassing documentation — see `changeledger context spec`.

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
work has started, a failed verification is diagnosed, never auto-split: the blocked and
review contexts own that classification.

## Commits

A change branch carries five commit classes and no others. **Draft**: one per drafted change document,
committed on its own — never several drafts in one commit. **Baseline**: exactly one, the approved change
document, before any code. **Implementation**: exactly one, the change's complete work — code, tests, ticked
boxes and Log entries — created once the local gate passes and before the review is delegated, so
`baseline..HEAD` is a fixed range the reviewer inspects and the deliverable cannot change between the
report and history. **Correction**: zero or more, each left uncommitted until a fresh reviewer confirms it.
**Handoff**: mandatory whenever work stops in `blocked` or a session ends with uncommitted state; record
why it was needed.

Granularity follows one test: whether the unit will be reverted, referenced or implemented independently.
A lifecycle transition is not — the Log already records it, so its commit would only duplicate that — and
is never a commit of its own; it travels inside the next real class. A change document is: a later
implementation branch builds on it, `changeledger check --commits` references it by id, and it can be
discarded alone. A single Plan task is not: it is reverted, referenced and implemented with the rest of the
change, so the change is the implementation unit. So a change yields two commits, one more per confirmed
correction and one per handoff, never one per transition and never one per Plan task.

Subjects follow `type(scope): description [#<id>]` with the real id and conventional type. One change keeps
its marker at the end of the subject; two or more keep the subject clean and use one canonical body line,
`ChangeLedger: [#A] [#B]` — never a comma list in one bracket. Ledger meta-commits (status, review, log,
archive) carry markers like any other; only merge commits, `chore(release)` prep and a `ChangeLedger: none — <reason>` body are exempt.
`changeledger commit -m "<type>(<scope>): <desc>" [--id <id>]` composes and creates it, resolving the single
`in-progress` change when `--id` is omitted and failing without committing if that is ambiguous or the
subject is not conventional. Run `changeledger check --commits [<base>]` before requesting review.

A combined commit is legitimate only when separation is impossible: several changes share the same files.
Record in the Log what was combined and why, naming every change that shares the surface. Plan tasks are
never a reason — they all travel in the one implementation commit. A failed `pre-commit` hook
leaves the index staged, so inspect the staged set (`git diff --cached --name-only`) before retrying: fixing
the cause is not enough if the index kept the previous attempt's files.

## Lifecycle

- `draft`: documentation awaiting human approval; no implementation.
- `approved`: ready to start after the Git/worktree checks.
- `in-progress`: implementation underway.
- `in-review`: independent review required.
- `in-validation`: stop for human acceptance or a reasoned rejection. It stops
  only that change: never accept on the human's behalf, but reject with a reason
  and start another approved change unless its direct or transitive `depends_on`
  chain reaches one in `in-validation`.
- `blocked`: an impediment or decision needs resolution.
- `done`: the human accepted the complete result; provisional until durable closure.
- `discarded`: terminal tombstone; never reopen it.

Who owns each transition and how it is performed:

| Transition | Owner | Mechanism |
|---|---|---|
| draft → approved | human | viewer or `changeledger approve <id>` after an explicit prompt |
| approved → in-progress; blocked → in-progress; in-progress → in-review | agent | `changeledger status` |
| in-progress → in-validation (no review) | agent | `changeledger status` |
| in-review → in-validation | orchestrator | `changeledger review <id> pass` |
| in-review → in-progress | orchestrator | `changeledger review <id> fail --retry` |
| in-review → blocked | orchestrator | `changeledger review <id> fail --block` |
| in-validation → done | human | viewer or `changeledger validation <id> pass` after an explicit prompt |
| in-validation → in-progress | agent or human | viewer; agent `validation <id> fail "<reason>"`; human prompt adds `--human` |
| done → in-progress (pending closure) | agent or human | `changeledger reopen <id> "<reason>"` or viewer |
| draft/approved/in-progress/blocked → discarded | agent (authorized) | `changeledger discard <id> "<reason>"` |

`changeledger status <id> <status>` performs agent-owned moves and does not accept
`approved`, `done`, `discarded` or reopening. Conversational decision commands
are auditable transmitters, never permission to infer a human verdict.
The discard reason is required and logged, and dependencies remain resolvable; `discarded` never reopens.
A `done` change can reopen only to finish its original scope before graduation/skip, archive or release;
after durable closure, later work needs a new change.

## Context modes

Valid modes: implement, review, spec, release.

Escalate to a mode before acting. Before documenting, run
`changeledger context spec`. Before executing, run `changeledger context
implement` or `changeledger context <change-id>`. Every context capture is read
complete in one pass — core, mode and change-id alike; a partial view is
invalid. Every mode and change-id context extends the core context already read;
it never repeats it.

- `changeledger context spec`: author or refine a change.
- `changeledger context implement`: execute an approved change.
- `changeledger context review`: independently verify completed work.
- `changeledger context release`: plan portable delivery metadata.
- `changeledger context <change-id>`: infer the correct context from lifecycle.

## Operational discovery

Prefer structured CLI queries before scanning files:

- `changeledger list --status approved`: find approved changes ready to implement.
- `changeledger list --pending graduation`: find unresolved graduation decisions; add `--owner NAME` or `--unowned` to scope the query, then graduate every id individually.
- `changeledger list --pending archive`: preview graduated or skipped changes; use the same optional owner filter on `archive --graduated` for an equivalent action.
- `changeledger search <terms...>`: find related changes (incl. archived) and specs by content before investigating from scratch.

Run `changeledger help` or `changeledger <command> --help` for exact CLI syntax.
Structure is always English. Each context delivers the effective policy that
applies to its task, so you never read `.changeledger/config.yml` raw to operate.
