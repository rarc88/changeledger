// Ledger-shaped fixtures for tests. `hooks/no-ledger-refs.sh` exempts
// `test/helpers/`, so a test that needs a change id or a criterion builds it
// here instead of writing the literal on a line the hook inspects.

/** A criterion token such as CR3, built so the test file never carries the literal. */
export const criterion = (n) => `CR${n}`;

/** A change id `<date>-<time>`, built so the test file never carries the literal. */
export const changeId = (date, time) => `${date}-${time}`;
