# Definition of Ready

ChangeLedger supports a deliberate split: a strong model documents and a less
capable but able model implements. The approved change must contain enough
precision that implementation does not redefine what should be tested.

The `tdd` flag in `.changeledger/config.yml` defaults to `true`; set `tdd` to
`false` only for exploratory repos where behavior is intentionally still being
discovered.

With `tdd: true`, a change is ready only when:

1. **Specification is test-grade.** Every behavioral requirement is a `CRn`
   with actual inputs rather than “a valid input”, exact outputs/effects and
   literal error messages. Give every edge case its own criterion. Nothing that
   must hold may live only in prose.
2. **Plan is the implementation contract.** Every implementation task cites at
   least one CR, names target file(s)/area(s) and contains concrete verification
   in its description before the final `(CRn)` block. Size it to one red-green
   cycle.
3. **TDD is explicit.** Write the failing test from the criterion, make it pass,
   then refactor. The implementer chooses how to test, not what behavior to
   prove.

Verification may be a colocated test, conventional test directory, concrete
command or manual `verify:` clause. Examples:

```markdown
- [ ] Update `src/parser.mjs`; verify: `node --test test/parser.test.mjs` (CR1)
- [ ] Update Android rendering; verify: manual Android device check (CR2)
```

Repos tune recognition with `readiness.target_patterns` and
`readiness.verification_patterns`. For device/manual checks, prefer the stable
structural convention `verification_patterns: ["verify:"]`; put the actual
evidence in the task instead of listing every possible manual phrase in config.

`changeledger check` reports missing Given/When/Then, uncovered or unknown CRs,
tasks without traceability and CR-bearing tasks without configured target and
verification. Gaps are warnings in `draft` and errors in `approved` or
`in-progress`. Truly operational `(support)` tasks are exempt; observable
implementation is not.
