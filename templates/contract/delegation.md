# Economical Delegation

Do not delegate when the coordination costs more than the expected improvement in quality, speed or context control.

## Delegate a real boundary

The delegation unit is core's selection of work.

- Investigation work may split independent codebase questions across
  explorers.
- Specification work may use stronger reasoning when ambiguity,
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

The role skeleton core points you to carries a placeholder for every item a
prompt must state. Fill all of them, and add the one it does not carry: for
roles that write, the expected baseline (branch or commit) the delegate must
verify it is working from.

