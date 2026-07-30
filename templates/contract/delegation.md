# Economical Delegation

Do not delegate when the coordination costs more than the expected improvement in quality, speed or context control.

## Delegate a real boundary

The delegation unit is core's selection of work.

- Request and Investigation may split independent codebase questions across
  explorers.
- Proposal and Specification may use stronger reasoning when ambiguity,
  architecture, safety or product judgment is high.
- Implementation may split only when write sets are disjoint and integration is
  obvious.
- Verification may be delegated when it catches risk without merely repeating
  the implementer's work.

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
