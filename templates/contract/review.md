# Independent Review

Review-required work must be checked by a fresh subagent with clean context and
a model sized to the review difficulty. Independence is correctness, not an
optimization.

Get the bounded prompt with `changeledger agent-prompt review`; the delegate
then loads `changeledger agent-context review <id>`. That self-contained capsule
owns the inspection checklist, read-only boundary and return format. Do not copy
its checklist into this orchestrator context.

Before delegating, declare the mandate of this review — a spot check of the named
diff, the surface the change governs, or a full audit — and record that mandate
as a Log note of the change with `changeledger log <id>`. The delegate receives it
already filled in: the reviewer inspects within the declared mandate and reports
whatever it finds outside it without expanding the inspection.

The review prompt adds the evidence standard the capsule does not carry:

- Mark every claim as confirmed by running it or as reasoned from the code.
- Trace every helper a suspect path calls before reporting a validation as missing.
- Take the implementer's list of decisions the document did not specify as scrutiny points, not as settled.
- Hold the orchestrator's own edits to the deliverable to the same standard as the implementer's.
- Treat a universal quantifier in deliverable prose whose falsifying edge was not executed as a defect that fails the review, not as style.

The orchestrator records exactly one verdict; the read-only reviewer reports its
finding but never runs the verdict command:

- `changeledger review <id> pass` — criteria and Plan pass; move to
  `in-validation`.
- `changeledger review <id> fail --retry "<reason>"` — fixable defect inside the
  authorized contract; return to `in-progress`.
- `changeledger review <id> fail --block "<reason>"` — correction requires scope
  or product judgment; move to `blocked` for the human.

Classify the finding before choosing `--retry` or `--block`: the blocked context
owns those classes and the exits each one allows.

The candidate reaches review only after the host formatter and full gates pass; a
failure there means no reviewable candidate exists yet. When a local gate — not a
reviewer — fails once the candidate already reached `in-review`, return it with
`changeledger status <id> in-progress`, the no-verdict path, and
never `changeledger review <id> fail --retry` for a failure no reviewer emitted. After
recording any verdict, apply the formatter again and repeat affected checks,
always including `changeledger check`, before commit or handoff. ChangeLedger
runs no configurable formatter, hook or external command as a mutation side effect.

A pass leaves `in-validation` for closure unless it confirms uncommitted
correction; then correction, tests and ledger form a commit. Retry keeps the diff
isolated. A confirmation review fails only for the named defect left open or a
regression the correction introduced; anything latent or adjacent it finds is
reported as a follow-up for the orchestrator to judge, not grounds to fail it.
The correction cycle is bounded: at the third round on the same change, stop
and return the choice between re-scoping and follow-up work to the human — the
change's Log already counts the rounds. An adversarial probe that presupposes
an actor the tool trusts by design — whoever can already commit to the
repository, INTENT.md's trust model — is reported as an observation measured
against that model, never recorded as a defect.

After `fail --retry`, the correction remains uncommitted until another fresh
reviewer passes it. After the transition, run `changeledger context <id>` before
modifying implementation. After pass, commit correction + ledger before asking
for human validation.

Types without `review_required` move directly from `in-progress` to
`in-validation`; do not invent a review gate for them.
