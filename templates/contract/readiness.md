# Definition of Ready

With `tdd: true`, an approved change is ready only when:

1. Every behavioral requirement is a concrete `CRn` with actual inputs, exact
   outputs/effects and literal errors. Edge cases get separate criteria.
2. Every implementation task names target file(s)/area(s), verification, and the
   criteria it satisfies. It is sized to one red-green cycle.
3. TDD is explicit: write the failing test from the criterion, make it pass, then
   refactor. The implementer chooses how, not what, to test.

Repos may configure `readiness.target_patterns` and
`readiness.verification_patterns`. For manual checks, prefer a structural rule
such as `verification_patterns: ["verify:"]`, then write evidence like
`verify: manual Android device check` instead of listing every possible manual phrase.

`changeledger check` reports missing Given/When/Then, uncovered or unknown CRs,
tasks without traceability, and CR-bearing tasks without a configured target and
verification (`draft` warnings; approved/in-progress errors).
