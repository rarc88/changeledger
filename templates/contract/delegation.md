# Economical Delegation

ChangeLedger is agnostic to how work is executed. Delegate when it reduces main
context pressure, lowers cost with a sufficient model, parallelizes genuinely
independent work or supplies independent verification. Do not delegate when the
coordination costs more than the expected improvement in quality, speed or
context control.

## Delegate a real boundary

A good delegation unit is a question, module, package, test area, migration
slice or independent verification. The boundary must state what the delegate
owns, what it returns and how the result integrates.

- Request and Investigation may split independent codebase questions across
  explorers.
- Proposal and Specification may use stronger reasoning when ambiguity,
  architecture, safety or product judgment is high.
- Implementation may split only when write sets are disjoint and integration is
  obvious.
- Verification may be delegated when it catches risk without merely repeating
  the implementer's work.
- Configured review is special: a fresh clean-context subagent is a correctness
  requirement, not an optimization.

## Do not over-shard

Do not create one subagent per file, line or tiny mechanical edit. For the same
small change across many files, prefer one scoped delegate, a batch edit or a
script verified by the main agent. Do not run parallel agents over the same
files or conceptual surface unless overlap and integration are explicit.

If you cannot state why the task is independent, what output you expect and how
you will integrate it, keep the work in the main thread or regroup it.

## Size the model to the work

Use the strongest available models for ambiguous scope, architecture,
security-sensitive reasoning and difficult reviews. Use sufficient cheaper
models for inventories, localized exploration, mechanical edits and narrow
checks. Escalate when uncertainty or risk rises; de-escalate when the work is
well specified and mostly execution.

## Delegation prompt contract

Every prompt states:

- why the work is delegated;
- the owned files, area or investigation question;
- the expected output;
- the difficulty or risk that informed model choice;
- the integration criterion.

Tell coding delegates they share the codebase: stay inside assigned ownership,
do not revert others' edits and report overlapping changes instead of silently
resolving them.
