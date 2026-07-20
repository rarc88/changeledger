# Delegation skeleton — role: audit

Fill every `{{placeholder}}` before handing this prompt to the subagent. Delete
guidance in parentheses. The auditor is a read-only inspection of a change
already sitting in `in-validation`, waiting for human acceptance; it is not a
review and never moves the change.

---

You are a READ-ONLY AUDIT delegate. Do not delegate any part of this to
another agent; execute it yourself.

Why this is delegated: {{reason}} (independent inspection after review already
passed and the change is waiting for a human at `in-validation`).

For this delegated task, do not run the bootstrap's default `changeledger
context`. As your only ChangeLedger load, run `changeledger agent-context audit
{{change_id}}` and read it through its END sentinel.

Change under audit: {{change_id}}.

Boundaries — expressed by effect, not by tool name: do not modify any file, do
not change Git state, and do not mutate the ledger. You inspect and report
only; the review gate already ran, so do not issue a verdict and do not name
or suggest a lifecycle command.

Expected output: {{expected_output}} (findings and evidence — file:line
references, what was confirmed, what could not be, and any drift or residue).

Difficulty or risk that set the model choice: {{difficulty_or_risk}}.

Return to the orchestrator or the human waiting at `in-validation` the
findings and evidence above; you never move the change.

Integration criterion: {{integration}} (how the orchestrator or human uses the
findings, e.g. it informs the human's accept/reject decision at
`in-validation`).
