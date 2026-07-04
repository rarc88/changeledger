# Implementing an Approved Change

## Scope and truth

Keep one concern per change. Work necessary for the authorized objective belongs
in its Specification, Plan and Log. If related work materially expands observable scope, obtain explicit human
authorization before adding it; propose independent work separately.

Follow the Specification exactly. If code and document diverge, update code;
never quietly drift the approved contract. Keep status, tasks, owner and Log
current throughout execution.

## Git protects traceability

Never implement approved changes on `main`, `master`, or `dev`; create or switch
to a work branch or ask the human before continuing. Inspect the worktree first. If
unrelated changes exist, do not include them silently; ask the human whether to
stash, commit, ignore or include them before changing the worktree.

After `approved → in-progress`, create a baseline commit of the approved change
document before code. Implement one change at a time, even while another
already-delivered change waits in `in-validation`.

Commit completed units with their tasks and Log when later work could obscure
attribution. Do not create a dedicated commit for a lifecycle-only transition.
Coalesce it with the nearest meaningful commit; for example, include
`in-progress → in-review` with the final implementation unit. Do not wait until
the end to reconstruct mixed diffs. If a handoff precedes the next
meaningful commit, one consolidated checkpoint persists pending state; record
why and never create one per transition.

Commit messages use the canonical shape:

```text
feat(scope): description [#20260629-234939]
```

Use the actual change id and the appropriate conventional type. If shared files make a combined commit
unavoidable, record it in Log or the handoff and name every change sharing the
surface.

## Execute the Plan

Write the failing test from each criterion, make it pass, then refactor. Tick
tasks as they become true, not in a batch at the end. Leave no TODO/FIXME, dead
code or unrelated residue without explicit agreement.

Useful mutation commands:

- `changeledger status <id> <status>`
- `changeledger task <id> done|block <n> [reason]`
- `changeledger log <id> "<message>"`
- `changeledger owner <id> <name|->`
- `changeledger review <id> pass|fail`
- `changeledger check [id]`

When implementation and every task are complete, move to `in-review` if the
type requires independent review, loading `changeledger context review`
once first — it stays valid for the rest of the cycle, do not reload it just
to record the verdict unless context was lost (compaction, a new session) —
and recording the delegate's verdict yourself with `review <id> pass|fail`
(never `log`+`status`). Otherwise move to `in-validation` and stop — its
closing has no CLI, only the human does it.

## Correction isolation

After review `fail --retry`, keep the candidate correction uncommitted while a
fresh clean-context reviewer checks it. If it fails again, iterate on that same
diff. Do not start another task or change while a correction waits: the
worktree is its isolation boundary. After `pass`, commit the confirmed correction,
tests and ledger before human validation; this is meaningful correction evidence,
not a status-only commit.

After human rejection (`in-validation → in-progress`), run
`changeledger context <id>` before modifying implementation; keep the correction
uncommitted until the human confirms it fixes the reported failure. Do not start
another task or change while a correction waits; iterate on
the same diff if it does not. After human acceptance, graduate or record a skip
and include correction plus ledger in the final closure commit.

These exceptions prevent false fix attempts from becoming permanent history;
they do not relax intermediate commits for already verified units.
