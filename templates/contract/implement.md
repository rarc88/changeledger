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
to a work branch or ask the human before continuing. When the config declares
`git.integration_branch`, create change branches from it and integrate the
finished result into it; `main` stays reserved for releases. Inspect the worktree first. If
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

Use the actual change id and the appropriate conventional type. One change keeps
its marker at the end of the subject. Referencing more than one change keeps the
subject clean and puts separate brackets in one canonical body line:
`ChangeLedger: [#A] [#B]` — never a comma list in one bracket. Ledger
meta-commits (status, review, log, archive) carry markers like any other commit;
only merge commits and `chore(release)` prep are exempt. `changeledger commit -m
"<type>(<scope>): <desc>" [--id <id>]...` composes and creates the commit for
you: it resolves the single `in-progress` change automatically when `--id` is
omitted, and fails without committing if that is ambiguous or the subject isn't
conventional. `changeledger check --commits [<base>]` lints `<base>..HEAD` for
either canonical marker placement with the same
exemptions — run it before requesting review. If shared files make a combined commit
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
- `changeledger commit -m "<type>(<scope>): <desc>" [--id <id>]...`

When implementation and every task are complete, move to `in-review` if the type
requires independent review by running this ordered gate — do not reconstruct it from memory:
1. Confirm every Plan task is complete and its verification passes.
2. `changeledger status <id> in-review`.
3. Apply the local formatter and full gates, including `changeledger check`, to the exact review candidate.
4. Load `changeledger context review` once; do not reload it to record the verdict unless context was lost (compaction, a new session).
5. Delegate to a fresh, read-only reviewer with clean context; it reports but never records the verdict itself.
6. Record the delegate's verdict yourself with `changeledger review <id> pass|fail` — never `log`+`status`.
7. After that mutation, apply the formatter again and repeat affected checks,
   including `changeledger check`, before commit or human validation.

Types without `review_required` move directly to `in-validation`, then apply the
same post-transition formatter and affected-check gate. The host owns these
commands; ChangeLedger mutations never run configurable hooks or external formatters.

`in-validation`: human accepts; agent rejects with `changeledger validation <id> fail "<reason>"`.

## Correction isolation

After review `fail --retry`, keep the candidate correction uncommitted while a
fresh clean-context reviewer checks it. If it fails again, iterate on that same
diff. Do not start another task or change while a correction waits: the
worktree is its isolation boundary. After `pass`, commit the confirmed correction,
tests and ledger before human validation; this is meaningful correction evidence,
not a status-only commit.

After a rejection (`in-validation → in-progress`), run
`changeledger context <id>` before modifying implementation; keep the correction
uncommitted until the human confirms it fixes the reported failure. Do not start
another task or change while a correction waits; iterate on
the same diff if it does not. After human acceptance, graduate or record a skip
and include correction plus ledger in the final closure commit.

These exceptions prevent false fix attempts from becoming permanent history;
they do not relax intermediate commits for already verified units.
