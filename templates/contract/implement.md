# Implementing an Approved Change

## Scope and truth

Keep one concern per change. Work necessary for the authorized objective belongs
in its Specification, Plan and Log. If related work materially expands observable scope, obtain explicit human
authorization before adding it; propose independent work separately.

Follow the Specification exactly: the approved change governs the code written
within its scope, so never quietly drift that contract. A pre-existing
divergence not introduced by the current work requires human resolution; if it
affects the task, report it and wait, otherwise report it without expanding
scope. Keep status, tasks, owner and Log current throughout execution.

## Git protects traceability

Never implement approved changes on `main`, `master`, or `dev`; create or switch
to a work branch or ask the human before continuing. When the config declares
`git.integration_branch`, create change branches from it and integrate the
finished result into it; `main` stays reserved for releases. Inspect the worktree first. If
unrelated changes exist, do not include them silently; ask the human whether to
stash, commit, ignore or include them before changing the worktree.

Between `changeledger status <id> in-progress` and the implementation commits, the
change document stays modified and uncommitted — its `status` field and every
`[status]` line the window accumulated, at least the entry into `in-progress` and
the exit into `in-review` — and so do the change's own code and tests, which those
commits are the first to carry. Together they are the only expected delta, and
"unrelated changes" above means a path belonging to neither the change document nor
the change's authorized scope. The window is not one event: core's Implementation class
governs when each selection is committed, so the expected delta shrinks selection by
selection and what stays uncommitted is what no selection has resolved yet. Core's commit classes
carry those transitions inside the implementation commits rather than a commit of
their own, so a clean worktree is not a valid precondition anywhere in that window,
and a delegation baseline states this expected set instead of demanding a clean tree.

Implement one change at a time, even while another already-delivered change waits
in `in-validation`.

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

Those commands write what a draft never carries, so their grammar belongs where
they run. `task` resolves markers, and resolution metadata is structural: `[x]` requires one `Resolved` child with a backticked ISO UTC timestamp, `[!]` one `Blocked` child with a non-empty reason, and `[ ]` none. Descriptions and reasons may contain arbitrary punctuation; unknown, duplicate, missing or orphan metadata is invalid.

Every top-level Log entry has a strict ISO UTC timestamp and canonical type:

```markdown
- **2026-06-13T14:20:00Z** `[status]` draft → approved
- **2026-06-13T14:30:00Z** `[note]` arbitrary text — even `[status]` and `|`
```

Types are `status`, `review`, `validation`, `owner`, `graduation`, `archive` and `note`. Lifecycle commands write their type; `changeledger log` writes an opaque `note` that cannot simulate an operational event. Continuation prose is allowed, but every top-level `- ` line must be a valid typed event.

When implementation and every task are complete, move to `in-review` if the type
requires independent review by running this ordered gate — do not reconstruct it from memory:
1. Confirm every Plan task is complete and its verification passes.
2. Apply the local formatter and full gates, including `changeledger check`, to the exact review candidate.
3. `changeledger status <id> in-review`. The gate decides whether a reviewable
   candidate exists, so it never runs after this transition; the transition itself
   refuses a candidate whose readiness is invalid and leaves the document untouched.
4. Reapply the formatter to the change document and run `changeledger check`; if the
   candidate changes again before the reviewer sees it, repeat every affected verification.
5. Create every outstanding implementation commit with `changeledger commit`: each
   resolved selection carries its own work, and the last also carries the ledger state,
   transitions included. Every selection precedes the review delegation, so the reviewer
   inspects a closed `baseline..HEAD` instead of a working tree.
6. Load `changeledger context review` once; do not reload it to record the verdict unless context was lost (compaction, a new session).
7. Delegate to a fresh, read-only reviewer with clean context; it reports but never records the verdict itself.
8. Record the delegate's verdict yourself with `changeledger review <id> pass|fail` — never `log`+`status`.
9. After that mutation, apply the formatter again and repeat affected checks,
   including `changeledger check`, before commit or human validation.

Types without `review_required` pass the same local gate before
`changeledger status <id> in-validation`, then apply the same post-transition
formatter and affected-check gate. The host owns these
commands; ChangeLedger mutations never run configurable hooks or external formatters.

`in-validation`: human accepts; agent rejects with `changeledger validation <id> fail "<reason>"`.

## Correction isolation

After review `fail --retry`, keep the candidate correction uncommitted while a
fresh clean-context reviewer checks it. Confirming it requires returning the
change with `changeledger status <id> in-review` before that delegation: the
transition re-validates the candidate and the review role loads nowhere else.
If it fails again, iterate on that same diff. Do not start another task or
change while a correction waits: the worktree is its isolation boundary. After `pass`, commit the confirmed correction,
tests and ledger before human validation; this is meaningful correction evidence,
not a status-only commit.

After a rejection (`in-validation → in-progress`), run
`changeledger context <id>` before modifying implementation; keep the correction
uncommitted until the human confirms it fixes the reported failure. Do not start
another task or change while a correction waits; iterate on
the same diff if it does not. After human acceptance, graduate or record a skip
and include correction plus ledger in the final closure commit.

These exceptions prevent false fix attempts from becoming permanent history;
they cover corrections only, and never license leaving the implementation commits
unmade before review.

## Evidence obligations

Every prompt to an implementer or corrector also states these obligations:

- Scope discipline is pass/fail: leaving a known residual out of your report is a failure, same as touching one, so name every residual you leave untouched instead of repairing it in passing.
- Reproduce the original defect and quote its literal output before changing anything.
- Show the new test failing before the fix, with its literal failure message, and passing after it.
- Mutate one thing at a time, confirm it fails for the right reason, restore it by editing — never with git — and prove the file is clean before the next mutant.
- Treat figures, line numbers and pointers you were handed as data to verify, not as facts.
- Report any orchestrator instruction that contradicts this contract instead of silently obeying it.
- Stop and report when the work turns out to need a different type or a wider scope.
- Report the list of decisions the document did not specify.
- Deliverable prose — test comments and Log notes — that quantifies universally (every, all, no, cannot, always) has the edge that would falsify it executed before it is written, or is narrowed to the incident actually observed.
