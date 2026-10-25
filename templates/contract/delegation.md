# Economical Delegation

Delegate only when the expected gain in quality, speed or context control exceeds the
coordination cost.

## Delegate a real boundary

The delegation unit is core's selection of work. Split investigation into independent
questions, implementation only across disjoint write sets whose integration is obvious, and
verification only when it catches risk without repeating the implementer's work.

## Do not over-shard

No subagent per file, line or tiny mechanical edit: the same small change across many files
is one scoped delegate, a batch edit or a script you verify. If you cannot state why the task
is independent, what it returns and how you will integrate it, keep it in the main thread.

## Delegation prompt contract

The review skeleton carries placeholders for its own; every other prompt states them inline: why the
work is delegated; the objective and frontier it serves; the files it owns; for a role that
writes, the baseline (branch or commit) it verifies before starting; the command that
verifies its result; the return format; and that it must not delegate further.

## Triage at handoff

Before handing completed or stopped work to the human, classify friction and unfinished
observations:

- Necessary to the change's purpose: update its Specification, Plan and Log.
- An operational step (verify, commit, graduate, archive, close): execute or record it in
  the current flow.
- Outside the approved objective or beyond the frontier: record it with
  `changeledger finding <id>`; the human promotes it.
- Too vague to record: mention it in the handoff, create no file.

Never mix independent concerns into active work or hold up an otherwise-ready delivery.
