# Independent Review

Review-required work must be checked by a fresh subagent with clean context and
a model sized to the difficulty. Independence is correctness, not an
optimization. The reviewer verifies every criterion, every Plan task, tests,
the actual diff and absence of residue; it does not trust the implementer's
summary.

Deep security, SAST and lint belong to dedicated tools. The reviewer may run
them and record their evidence; ChangeLedger does not reimplement them.

Delegate for a clear reason and boundary. Do not over-shard by file or tiny edit,
and do not overlap write surfaces without an explicit integration plan.

- Pass: `changeledger review <id> pass` → `in-validation`.
- Fixable defect: `changeledger review <id> fail --retry "<reason>"` →
  `in-progress`.
- Scope/decision escalation: `changeledger review <id> fail --block "<reason>"`
  → `blocked` for the human.

After a retry, the correction stays uncommitted until another clean reviewer
passes it. After `fail --retry` moves the change to `in-progress`, run
`changeledger context <id>` before modifying implementation. Then commit the
passed correction + ledger before asking for human validation.
