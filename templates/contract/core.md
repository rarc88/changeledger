# ChangeLedger — Core Contract

Documents under `.changeledger/` are the source of truth. Code is their
reflection. Work is planned and documented before code is written.

## Non-negotiable fast path

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
8. After human acceptance, graduate persistent truth or record an explicit skip,
   then archive the done change.

Humans consume changes in `changeledger view`; write for the rendered view.

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
Humans approve and validate in the viewer; use
`changeledger discard <id> "<reason>"` for a discarded change. `done` and `discarded`
never reopen.

## Context modes

Valid modes: implement, review, spec, release.

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
Structure is always English; narrative content follows `.changeledger/config.yml`.
