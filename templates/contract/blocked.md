# Blocked — Resolve Before Implementing

Do not resume implementation merely because context was requested. Inspect the
blocked task and Log. If the impediment is resolved within authorized scope,
record the decision, restore the task and move `blocked → in-progress`. If it
requires scope or product judgment, ask the human. After moving to `in-progress`,
run `changeledger context <id>` before modifying implementation. Never bypass the
block.
