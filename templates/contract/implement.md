# Implementing an Approved Change

## Scope and truth

The approved objective and frontier govern the code written within the change.
Specification and Plan are the implementer's contract: write them in `in-progress`
with the code in front, using the grammar of `changeledger context spec`, and
rewrite them as understanding improves, with the Log saying why. Never quietly
drift from them.

## Git protects traceability

Never implement approved changes on the integration branch or the release branch
(`git.integration_branch`, `git.release_branch`); while either is undeclared, the
same holds for the default branch and any other long-lived shared branch. Create
or switch to a work branch, or ask the human. When the change context publishes
`integration_branch`, create the change branch from it and integrate the finished
result into it; the release branch is reserved for releases and for the changes
that declare `integrates_into: release`. When the change context also publishes
`back_merge_branch`, bring the integrated result into that branch as well and
record it with `changeledger log <id>`. When `git.change_branch_format` is
declared, use the published `change_branch` exactly; absent or null imposes no
name, and mutable metadata never replaces its `{type}` and `{id}` placeholders.

Inspect the worktree first and ask the human whether to stash, commit, ignore or
include unrelated changes before changing it. Between `changeledger status <id>
in-progress` and the implementation commits, the expected uncommitted delta is
the change document — status field and the `[status]` lines the window
accumulates — plus the change's own code and tests; "unrelated" means any path
outside that set, which shrinks as each selection is committed. A clean worktree
is never a valid precondition in that window, and a delegation baseline states
this expected set instead of demanding one.

Nothing you write outside `.changeledger/` carries a change id or a criterion id
(`CRn`): the reference runs from the change to the code through `Target`,
`Verify` and the commit's `[#id]` marker, and a test is named by the behaviour
it proves.

Implement one change at a time, even while a delivered change waits in `done`.
Record an impediment as a `[!]` Plan task with its reason, and resolve it within
authorized scope or ask the human.

## Execute the Plan

With `tdd=on`, write the failing test from each criterion, make it pass, then
refactor. Tick tasks as they become true, not in a batch at the end. Leave no
TODO/FIXME, dead code or unrelated residue without explicit agreement.

Useful mutation commands:

- `changeledger status <id> <status>`
- `changeledger task <id> done|block <n> [reason]`
- `changeledger log <id> "<message>"`
- `changeledger owner <id> <name|->`
- `changeledger edit <change-id|spec:slug> --from <file|->` — the sole
  body-write path in an activated repo
- `changeledger apply --from <file|-> [--dry-run]`
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

`changeledger log --help` prints every type, its payload forms and the command that writes each, generated from the parser's own definitions. Each transition event records exactly one transition. Continuation prose is allowed, but every top-level `- ` line must be a valid typed event.

A `change` reaches `done` directly from `in-progress` only when nothing outside the
ledger directories is touched by its branch, still unmerged, or by its checkout's
uncommitted paths; otherwise it moves to `in-review` and is delivered by `review pass`. When implementation and every task are complete, run this
ordered gate — do not reconstruct it from memory:
1. Confirm every Plan task is complete and its verification passes.
2. Apply the local formatter and full gates, including `changeledger check`, to the exact review candidate.
3. `changeledger status <id> in-review`. The gate decides whether a reviewable
   candidate exists, so it never runs after this transition; the transition to `in-review` refuses a
   missing or empty Specification or Plan, or a Specification declaring no `### CRn`, and
   leaves the document untouched.
4. Reapply the formatter to the change document and run `changeledger check`; if the
   candidate changes again before the reviewer sees it, repeat every affected verification.
5. Create every outstanding implementation commit with `changeledger commit`: each
   resolved selection carries its own work, and the last also carries the ledger state,
   transitions included. Every selection precedes the review delegation, so the reviewer
   inspects a closed `baseline..HEAD` instead of a working tree.
6. Load `changeledger context review`.
7. Delegate to a fresh, read-only reviewer with clean context; it reports but never records the verdict itself.
8. Record the delegate's verdict yourself with `changeledger review <id> pass|fail` — never `log`+`status`.
9. After that mutation, apply the formatter again and repeat affected checks,
   including `changeledger check`, before commit or handing the result to the human.

A change that touches no code passes the same local gate, with every selection
committed, before `changeledger status <id> done`, then apply the same post-transition
formatter and affected-check gate. The host owns these
commands; ChangeLedger mutations never run configurable hooks or external formatters.

## Evidence obligations

Every prompt to an implementer also states these obligations:

- Scope discipline is pass/fail: name every residual you leave untouched instead of repairing it in passing; leaving a known residual out of the report fails like touching one.
- Reproduce the original defect and quote its literal output before changing anything.
- Show the new test failing before the fix, with its literal failure message, and passing after it.
- Report any orchestrator instruction that contradicts this contract instead of silently obeying it.
- Stop and report when the work turns out to need a wider scope.
- Report the decisions the document did not specify.
