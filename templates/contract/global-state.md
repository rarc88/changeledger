# Global State

This repo keeps its ledger in the shared global state. A repo adopts it once with
`changeledger cutover` on its integration branch; every later clone joins with
`changeledger activate`. Run `changeledger sync [--status]` at the strategic points: when a
session opens, before delegating a review, at durable closure (graduation or archive) and at
every handoff. `changeledger sync --help` states what it does and why it never blocks the
local flow; the one obligation it leaves to you is that the same document changed differently
on both sides is reported, never resolved by inference — the human coordinates that
resolution. A branch that lands after the graduation is stamped by the next
`changeledger sync`.
