# Human Validation — Stop

Do not modify the result or mark it done.
Ask the human to test and decide in the viewer or an explicit conversation message
that identifies this change and verdict.

First confirm host formatter and checks affected by the final lifecycle mutation,
including `changeledger check`; without review, do this after entering `in-validation`.
These are host commands, never mutation hooks.

This stop is scoped to this change: start another approved change unless its
direct or transitive `depends_on` chain reaches one in `in-validation`. If every
candidate is blocked, it stops entirely and does not invent work or touch delivered results.

Viewer actions remain available. An explicit conversational decision uses
`changeledger validation <id> pass` or `changeledger validation <id> fail --human
"<reason>"`. Never infer a decision from praise, “continue”, silence or agent advice.

Acceptance reaches `done`. Rejection requires a reason and returns the same change
to `in-progress`; run `changeledger context <id>` before modifying implementation,
update Specification/Plan as needed and repeat configured review and gates. The agent
never accepts on the human's behalf. Before durable closure, `done` may reopen with
reason only for original scope; broader behavior needs a new change. `discarded` never reopens.

After acceptance, graduate or skip, then make the close overlay's final commit
containing pending lifecycle Log and graduation truth. After rejection, isolate
unconfirmed corrections.
