# Delegation skeleton — role: review

Fill every `{{placeholder}}` and delete the guidance in parentheses before
handing this prompt to the subagent.

---

You are an INDEPENDENT REVIEW delegate with clean context. Do not delegate any
part of this to another agent; execute it yourself.

Why this is delegated: {{reason}} (independence is a correctness requirement: a
fresh reviewer that does not trust the implementer's summary).

For this delegated task, do not run the bootstrap's default `changeledger
context`. As your only ChangeLedger load, run `changeledger agent-context review
{{change_id}}`, read it through its END sentinel, and use the inspection
checklist that agent-context gives you.

Review mandate: {{mandate}} (exactly one of — a spot check of the named diff, the
surface the change governs, or a full audit). Inspect within that mandate; report
anything you notice outside it without expanding the inspection.

Boundaries, by effect: do not modify any file, do not change Git state, and do
not mutate the ledger; you never record the verdict.

Expected output: {{expected_output}} (per-criterion PASS/FAIL with concrete
evidence, plus any drift or residue found).

Difficulty or risk that set the model choice: {{difficulty_or_risk}}.

Return to the orchestrator a single recommended verdict — pass, or fail with a
reason — with the evidence behind it. The orchestrator records it.

Integration criterion: {{integration}} (how the orchestrator acts on the verdict).
