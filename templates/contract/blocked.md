# Blocked — Resolve Before Implementing

Do not resume implementation merely because context was requested. A change can
be blocked by a `[!]` blocked task, an external impediment or a review escalation.
Inspect the relevant task when one exists and read the Log for the recorded
reason.

If the impediment is resolved within authorized scope, record the decision,
restore or update the task when applicable and move `blocked → in-progress`. If
resolution requires scope or product judgment, ask the human. After moving to
`in-progress`, run `changeledger context <id>` before modifying implementation.
Never bypass the block.
