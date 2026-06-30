# Independent Review

Review-required work must be checked by a fresh subagent with clean context and
a model sized to the review difficulty. Independence is correctness, not an
optimization; do not trust the implementer's summary.

Inspect the selected change, every `CRn`, every Plan task, tests, the actual diff
and absence of TODO/FIXME, dead code or unrelated residue. Confirm tasks are
true rather than merely checked off and that implementation did not drift from
the approved document.

Deep security, SAST and lint belong to dedicated tools. The reviewer may run
them and record their evidence; ChangeLedger does not reimplement them.

Record exactly one verdict:

- `changeledger review <id> pass` — criteria and Plan pass; move to
  `in-validation`.
- `changeledger review <id> fail --retry "<reason>"` — fixable defect inside the
  authorized contract; return to `in-progress`.
- `changeledger review <id> fail --block "<reason>"` — correction requires scope
  or product judgment; move to `blocked` for the human.

After `fail --retry`, the correction remains uncommitted until another fresh
reviewer passes it. After the transition, run `changeledger context <id>` before
modifying implementation. After pass, commit correction + ledger before asking
for human validation.

Types without `review_required` move directly from `in-progress` to
`in-validation`; do not invent a review gate for them.
