# Blocked — Resolve Before Implementing

Do not resume implementation merely because context was requested. A change can
be blocked by a `[!]` blocked task, an external impediment or a review escalation.
Inspect the relevant task when one exists and read the Log for the recorded
reason.

A diagnosed failure — a reviewer's `fail` verdict or a human rejection — is
classified before correction starts, and the class chooses the path:

- **Incomplete enumeration inside an already-verified strategy.** Normal
  correction: retry on the same diff and sweep the whole class of the defect
  instead of the flagged instance. The number of rounds does not close this path
  while the class holds.
- **A new class of defect** — the finding reveals a dimension the verified
  strategy did not cover. Stop and decide with the human. The broad exits
  illustrate that decision without closing it: redesign within the same scope,
  extension with re-approval, partition into smaller changes, or discard.

If the impediment is resolved within authorized scope, record the decision,
restore or update the task when applicable and move `blocked → in-progress`. If
resolution requires scope or product judgment, ask the human. After moving to
`in-progress`, run `changeledger context <id>` before modifying implementation.
Never bypass the block.
