# Independent Review

Review-required work must be checked by a fresh subagent with clean context and
a model sized to the review difficulty. Independence is correctness, not an
optimization.

Get the bounded prompt with `changeledger agent-prompt review`; the delegate
then loads `changeledger agent-context review <id>`, the capsule that owns the
inspection checklist, read-only boundary and return format.

Before delegating, declare the mandate of this review — a spot check of the named
diff, the surface the change governs, or a full audit — and record that mandate
as a Log note with `changeledger log <id>`. The delegate receives it already
filled in: the reviewer inspects within the declared mandate and reports
whatever it finds outside it without expanding the inspection.

The review prompt adds the evidence standard the capsule does not carry:

- Mark every claim as confirmed by running it or as reasoned from the code.
- Trace every helper a suspect path calls before reporting a validation as missing.
- Take the decisions the implementer reports the document did not specify as scrutiny points, not as settled.
- Hold the orchestrator's own edits to the deliverable to the same standard as the implementer's.

The orchestrator records exactly one verdict; the read-only reviewer reports its
finding but never runs the verdict command:

- `changeledger review <id> pass` — criteria and Plan pass; move to `done`.
- `changeledger review <id> fail "<reason>"` — defect found; return to `in-progress`.

A diagnosed failure is classified before correction starts, and the class chooses the
path. The classification is identical for a reviewer's `fail` verdict and for a human
rejection of delivered work:

- **Incomplete enumeration inside an already-verified strategy.** Normal correction:
  retry on the same diff and sweep the whole class of the defect instead of the flagged
  instance. The number of rounds does not close this path while the class holds.
- **A new class of defect** — the finding reveals a dimension the verified strategy did
  not cover. Stop and decide with the human. The broad exits illustrate that decision
  without closing it: redesign within the same scope, extension with re-approval,
  partition into smaller changes, or discard.

The candidate reaches review only after the host formatter and full gates pass; a
failure there means no reviewable candidate exists yet. When a local gate — not a
reviewer — fails once the candidate already reached `in-review`, return it with
`changeledger status <id> in-progress`, the no-verdict path, and
never `changeledger review <id> fail` for a failure no reviewer emitted. After
recording any verdict, apply the formatter again and repeat affected checks,
always including `changeledger check`, before commit or handoff.

After a `fail`, the correction is committed like any resolved selection and the change
returns to `in-review`; a fresh reviewer then inspects `baseline..HEAD` again under the
mandate the orchestrator declares. The correction cycle is bounded: at the third round
on the same change, stop and return the choice between re-scoping and follow-up work to
the human — the change's Log already counts the rounds. An adversarial probe that
presupposes an actor the tool trusts by design — whoever can already commit to the
repository, INTENT.md's trust model — is reported as an observation measured against
that model, never recorded as a defect.
