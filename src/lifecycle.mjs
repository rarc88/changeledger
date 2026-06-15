// The change lifecycle as an explicit, testable graph — the single authority on
// which status moves are legal. Shared by the CLI (`sl status`) and the viewer
// so both decide validity the same way. The viewer layers an extra human-only
// policy on top (it permits only draft → approved); it never relaxes this graph.

export const CANONICAL_STATUSES = [
  'draft',
  'approved',
  'in-progress',
  'in-review',
  'blocked',
  'done',
];

// from → set of allowed next states. Forward progress plus the blocked round
// trip and the review gate; regressions, skips and self-loops are absent and
// therefore rejected. `in-review` sits between in-progress and done for types
// that require review; the review verdict routes back to in-progress (retry) or
// blocked (escalate). See the review gate below.
const TRANSITIONS = {
  draft: ['approved'],
  approved: ['in-progress'],
  'in-progress': ['in-review', 'blocked', 'done'],
  'in-review': ['done', 'in-progress', 'blocked'],
  blocked: ['in-progress'],
  done: [],
};

const canonical = new Set(CANONICAL_STATUSES);

export function canTransition(from, to) {
  return (TRANSITIONS[from] ?? []).includes(to);
}

// Throws when a move is illegal. Enforced only between canonical statuses; a
// repo with custom statuses keeps the prior enum-only behavior, since this graph
// cannot reason about states it does not model.
//
// The review gate: a `review_required` type cannot jump in-progress → done — it
// must pass through `in-review` (an independent review). `opts.reviewRequired`
// comes from the change's type in config.yml. See AGENTS.md §5/§6.
export function assertTransition(from, to, { type, reviewRequired = false } = {}) {
  if (!canonical.has(from) || !canonical.has(to)) return;
  if (from === to) throw new Error(`change is already "${to}"`);
  if (!canTransition(from, to)) {
    throw new Error(`invalid lifecycle transition: ${from} → ${to}`);
  }
  if (reviewRequired && from === 'in-progress' && to === 'done') {
    throw new Error(`${type} changes must be reviewed before done — move to in-review first`);
  }
}
