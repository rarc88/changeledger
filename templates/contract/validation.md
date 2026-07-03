# Human Validation — Stop

Implementation and required review are complete. Do not modify the result or
mark it done. Ask the human to test the whole change in the viewer.

This stop is scoped to this change: the agent may start the next approved
change unless its `depends_on` chain, direct or transitive, reaches this or
another `in-validation` change. If every remaining approved change is
blocked, it stops entirely and does not invent work or touch delivered
results.

Acceptance reaches `done`. Rejection requires a reason and returns the same
change to `in-progress`; run `changeledger context <id>` before modifying
implementation, update Specification/Plan as needed and repeat review when
configured. The agent never accepts on the human's behalf. Before graduation,
skip, archive or release, the human may reopen `done` with a reason only to
complete the original authorized scope; broader behavior needs a new change.
`discarded` never reopens.

The validation transition alone does not require a dedicated commit. After
acceptance, resolve graduation or skip first; the close overlay then requires one
final closure commit containing the pending lifecycle Log and graduation truth.
After rejection, follow correction isolation instead of committing an
unconfirmed attempt.
