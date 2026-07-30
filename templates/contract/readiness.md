# Definition of Ready

The approved change must contain enough precision that implementation does not
redefine what should be tested.

The `tdd` flag in `.changeledger/config.yml` defaults to `true`; set `tdd` to
`false` only for exploratory repos where behavior is intentionally still being
discovered.

With `tdd: true`, a change is ready only when:

1. **Specification is test-grade.** Every behavioral requirement is a `CRn`
   with actual inputs rather than “a valid input”, exact outputs/effects and
   literal error messages. Give every edge case its own criterion. Nothing that
   must hold may live only in prose.
2. **Plan is the implementation contract.** Every implementation task cites at
   least one CR in its `Criteria` child, names target file(s)/area(s) in
   `Target` and concrete verification in `Verify`. Size it to one red-green
   cycle.
3. **TDD is explicit.** Write the failing test from the criterion, make it pass,
   then refactor. The implementer chooses how to test, not what behavior to
   prove.
4. **External interfaces are declared.** For every external interface the change
   depends on, state whether its output is stable for automated consumption; a
   criterion may not assume stability nobody established. No check verifies the
   declaration; review does.
5. **The Request is fully mapped.** Every ask in `## Request` maps to at least
   one criterion or is explicitly named as excluded. No check judges semantic
   coverage; review scrutinises it.

A `Verify` value may be a colocated test, conventional test directory, concrete
command or manual `verify:` clause. Example values:

```markdown
  - **Verify:** `node --test test/parser.test.mjs`
  - **Verify:** verify: manual Android device check
```

When starting work in a repo, the agent verifies that `readiness.target_patterns`
and `readiness.verification_patterns` match that repo's stack, and configures
them when they do not. `target_patterns` judges only the `Target` value and
`verification_patterns` only the `Verify` value. For device/manual
checks, prefer the stable structural convention
`verification_patterns: ["verify:"]`; start the `Verify` value with `verify:` and
put the evidence there instead of listing every possible manual phrase in config.

`changeledger check` reports missing Given/When/Then, uncovered or unknown CRs,
tasks without traceability and CR-bearing tasks without configured target and
verification. Every diagnostic is a warning in `draft` and an error in
`approved` and `in-progress`, and `changeledger approve` judges the draft at
that stricter severity: an unready draft is refused, exit non-zero, document
untouched. Truly operational `Support` tasks are exempt; observable
implementation is not.
