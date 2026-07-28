# Independent Review

Review-required work must be checked by a fresh subagent with clean context and
a model sized to the review difficulty. Independence is correctness, not an
optimization.

Get the bounded prompt with `changeledger agent-prompt review`; the delegate
then loads `changeledger agent-context review <id>`. That self-contained capsule
owns the inspection checklist, read-only boundary and evidence contract. Do not
copy its checklist into this orchestrator context.

The orchestrator records exactly one verdict; the read-only reviewer reports its
finding but never runs the verdict command:

- `changeledger review <id> pass` — criteria and Plan pass; move to
  `in-validation`.
- `changeledger review <id> fail --retry "<reason>"` — fixable defect inside the
  authorized contract; return to `in-progress`.
- `changeledger review <id> fail --block "<reason>"` — correction requires scope
  or product judgment; move to `blocked` for the human.

The candidate reaches review only after host formatter and full gates. After
recording any verdict, apply the formatter again and repeat affected checks,
always including `changeledger check`, before commit or handoff. ChangeLedger
runs no configurable formatter, hook or external command as a mutation side effect.

A pass leaves `in-validation` for closure unless it confirms uncommitted
correction; then correction, tests and ledger form a commit. Retry keeps the diff
isolated.

After `fail --retry`, the correction remains uncommitted until another fresh
reviewer passes it. After the transition, run `changeledger context <id>` before
modifying implementation. After pass, commit correction + ledger before asking
for human validation.

Types without `review_required` move directly from `in-progress` to
`in-validation`; do not invent a review gate for them.
