# ChangeLedger — Core Contract

Documents under `.changeledger/` are the source of truth. Code is their
reflection. Work is planned and documented before code is written.

## Read complete context before acting

Running `changeledger context` is discovery, not compliance by itself. Read the
complete output through the `CHANGELEDGER CONTEXT END` line, then follow the
current mode. If that line is missing, the output was truncated. Stop and re-run
the command directly, without pipes or filters, before creating or modifying
files.

1. Work starts with conversation. Read-only investigation may clarify a request,
   but create no change or implementation artifact until there is enough clarity
   to document faithfully **and** the human explicitly authorizes documentation. A direct request such
   as “create the change” is authorization; never invent missing requirements.
2. The human authorizes scope, approves drafts and accepts the final result. The
   agent decides how to divide and execute work within that authorized scope.
3. Capture every authorized change in `.changeledger/changes/`. The document
   wins when code and documentation disagree.
4. Never implement a `draft`. After approval, work one change at a time on a
   non-main branch and commit the approved change document before code.
5. Keep lifecycle, tasks, ownership and Log current while working.
6. For types that require review, use a fresh clean-context reviewer before
   human validation.
7. Stop at `in-validation`. The agent never accepts on the human's behalf.
8. After human acceptance, reload `changeledger context <id>` for the `done`
   change, then graduate persistent truth (a new spec is a two-step `--new`
   then `--into`) or run `changeledger graduate <id> --skip [reason]`; archive
   only after that decision.

If no approved or in-progress change applies, do not silently edit repository
files. Create or update a change, or ask the human whether a purely operational,
reversible edit with no persistent truth or observable behavior change should be
done directly. If unsure, document it in ChangeLedger.

Humans consume changes in `changeledger view`; write for the rendered view.

## Files and delegation

Files are the source of truth and may be edited directly. CLI helpers are
optional and preferred for error-prone operations such as timestamps, lifecycle
transitions and task markers.

Delegate only with a clear boundary and benefit. Each delegation prompt states
at least ownership, expected output and integration criterion; the task context
carries the full prompt contract. Coding agents must know
they share the codebase and must not revert others' work. Do not over-shard or
overlap write surfaces without an explicit integration plan. Size the model to
the task's difficulty and risk.

## Lifecycle

```text
draft → approved → in-progress
in-progress → in-review → in-validation → done   [review required]
in-progress → in-validation → done               [no review required]
in-review → in-progress                           [review retry]
in-review → blocked → in-progress                 [review escalation]
in-validation → in-progress                       [human rejection]
(draft | approved | in-progress | blocked) → discarded
```

- `draft`: documentation awaiting human approval; no implementation.
- `approved`: ready to start after the Git/worktree checks.
- `in-progress`: implementation underway.
- `in-review`: independent review required.
- `in-validation`: stop and wait for human acceptance or rejection.
- `blocked`: an impediment or decision needs resolution.
- `done`: terminal; the human accepted the complete result.
- `discarded`: terminal tombstone; never reopen it.

`changeledger status <id> <status>` enforces agent-owned transitions and does not accept `done` or `discarded`.
The viewer owns `draft → approved` and `in-validation → done|in-progress`; the
agent performs the other non-terminal moves. Use
`changeledger discard <id> "<reason>"`: the discard reason is required and
logged, and dependencies remain resolvable. `done` and `discarded` never reopen;
later reconsideration needs a newly authorized change.

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
- `changeledger graduate --pending`: find accepted changes whose graduation decision is unresolved.

Run `changeledger help` or `changeledger <command> --help` for exact CLI syntax.
Structure is always English. Each context delivers the effective policy that
applies to its task, so you never read `.changeledger/config.yml` raw to operate.
