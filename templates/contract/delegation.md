# Economical Delegation

ChangeLedger is agnostic to how work is executed.
Do not delegate when the coordination costs more than the expected improvement in quality, speed or context control.

## Delegate a real boundary

The delegation unit is core's selection of work: a question, module, package,
test area, migration slice or independent verification. The boundary must state
what the delegate owns, what it returns and how the result integrates.

- Request and Investigation may split independent codebase questions across
  explorers.
- Proposal and Specification may use stronger reasoning when ambiguity,
  architecture, safety or product judgment is high.
- Implementation may split only when write sets are disjoint and integration is
  obvious.
- Verification may be delegated when it catches risk without merely repeating
  the implementer's work.
- Configured review is special: a fresh clean-context subagent is a correctness
  requirement, not an optimization — and read-only: it reports, the
  orchestrator alone records the verdict.

## Do not over-shard

Do not create one subagent per file, line or tiny mechanical edit. For the same
small change across many files, prefer one scoped delegate, a batch edit or a
script verified by the main agent.

If you cannot state why the task is independent, what output you expect and how
you will integrate it, keep the work in the main thread or regroup it.

## Delegation prompt contract

Every prompt states:

- why the work is delegated;
- the owned files, area or investigation question;
- the expected output;
- the difficulty or risk that informed model choice;
- the integration criterion;
- for roles that write, the expected baseline (branch or commit) the delegate must verify it is working from.

Tell coding delegates they share the codebase: stay inside assigned ownership,
do not revert others' edits and report overlapping changes instead of silently
resolving them.

Every prompt to an implementer or corrector also states these obligations:

- Scope discipline is pass/fail: leaving a known residual out of your report is a failure, same as touching one, so name every residual you leave untouched instead of repairing it in passing.
- Reproduce the original defect and quote its literal output before changing anything.
- Show the new test failing before the fix, with its literal failure message, and passing after it.
- Mutate one thing at a time, confirm it fails for the right reason, restore it by editing — never with git — and prove the file is clean before the next mutant.
- Treat figures, line numbers and pointers you were handed as data to verify, not as facts.
- Report any orchestrator instruction that contradicts this contract instead of silently obeying it.
- Stop and report when the work turns out to need a different type or a wider scope.
- Report the list of decisions the document did not specify.
