# ChangeLedger — Core Contract

Documents under `.changeledger/` are ChangeLedger's persistent truth. Work using
ChangeLedger is documented before code; work performed without the CLI may diverge.

## Read complete context before acting

Running `changeledger context` is discovery, not compliance by itself. Capture the first invocation completely in one pass
and read through the `CHANGELEDGER CONTEXT END` line, then follow the current mode. Never request a preview, summary
or voluntary line, byte or token cap; if the tool exposes an output budget,
reserve enough for the whole response. A missing END after this deliberate full
capture is exceptional recovery: stop and re-run with a larger capture before
planning or acting on the partial output.

While the complete core remains available in the active conversation, a new
human message alone does not trigger a reload. Load only the specialized mode or
change-id context required by a real task or lifecycle transition.

Every BEGIN line carries `rev:<hash>`. After a compaction, retest a retained
capture with `changeledger context [mode] --have <rev>` before recapturing it in
full: a match returns a short `unchanged` confirmation, a mismatch returns the
complete output, and the very first capture of a session is always full.

1. Work starts with conversation. Read-only investigation may clarify a request,
   but create no change or implementation artifact until there is enough clarity
   to document faithfully **and** the human explicitly authorizes documentation. A direct request such
   as “create the change” is authorization; never invent missing requirements.
2. The human authorizes scope, approves drafts and accepts the final result. A
   decision may come from the viewer or an explicit active conversation message
   identifying the change and verdict; praise, “continue”, or agent inference is
   not a decision. The agent executes but never makes human decisions.
3. Capture every authorized change in `.changeledger/changes/`. Any pre-existing
   divergence between specs and code must be reported to the human, never
   reconciled by inference. Wait if it affects the current task; if unrelated,
   report it without expanding scope. An approved change governs code in scope.
4. Never implement a `draft`. After approval, implement one change at a time on
   a non-main branch and commit the approved change document before code.
5. Keep lifecycle, tasks, ownership and Log current while working.
6. For types that require review, use a fresh clean-context reviewer before
   human validation.
7. `in-validation` stops only that change; the agent never accepts on the human's behalf, but may reject with a reason and start another approved change unless its `depends_on` chain (direct or transitive) reaches an `in-validation` change.
8. After human acceptance, reload `changeledger context <id>` for the `done`
   change, then graduate persistent truth or run `changeledger graduate <id>
   --skip [reason]`; archive only after that decision. The close overlay owns
   the full graduation recipe.

If no approved or in-progress change applies, do not silently edit repository
files. Create or update a change, or ask the human whether a purely operational,
reversible edit with no persistent truth or observable behavior change should be
done directly. If unsure, document it in ChangeLedger. For small, reversible,
single-concern work with observable behavior, use the `quick` type instead of
bypassing documentation — see `changeledger context spec`.

Humans consume changes in `changeledger view`; write for the rendered view.

## Files and delegation

Files are the source of truth and may be edited directly. CLI helpers are
optional and preferred for error-prone operations such as timestamps, lifecycle
transitions and task markers.

Delegate only with a clear boundary and benefit. Each delegation prompt states at least
ownership, expected output and integration criterion; the task context carries the full
prompt contract. Get a complete role skeleton to fill in with `changeledger agent-prompt
<role>` (investigation | implementation | review | audit). Coding agents must know they
share the codebase and must not revert others' work. Do not over-shard or overlap write
surfaces without an explicit integration plan. Size the model to the task's difficulty
and risk. `audit` is a read-only post-review inspection of a change already in
`in-validation`; it never issues a verdict or moves the change.

## Lifecycle

- `draft`: documentation awaiting human approval; no implementation.
- `approved`: ready to start after the Git/worktree checks.
- `in-progress`: implementation underway.
- `in-review`: independent review required.
- `in-validation`: stop for human acceptance or a reasoned rejection.
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
implement` or `changeledger context <change-id>`. Run each only after reading
the complete base output. Every mode and change-id context extends the core
context already read; it never repeats it.

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
- Global-state adoption is explicit: `state migrate --preview --source <remote>:<full-ref> --output <plan>`, resolve identities, then `state migrate --create --plan <plan>` and `state activate --prepare --baseline <S0>`; diagnose locally before `--online`.
Cutover commands never update integration/worktree. After state advances use `state export --recovery-branch`; they do not provide remote enforcement or rollout. Add `--json` for receipts.

Run `changeledger help` or `changeledger <command> --help` for exact CLI syntax.
Structure is always English. Each context delivers the effective policy that
applies to its task, so you never read `.changeledger/config.yml` raw to operate.
