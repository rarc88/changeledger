// The change lifecycle as an explicit, testable graph — the single authority on
// which status moves are legal. Shared by the CLI (`sl status`) and the viewer
// so both decide validity the same way. The viewer layers an extra human-only
// policy on top (it permits only draft → approved); it never relaxes this graph.

export const CANONICAL_STATUSES = ['draft', 'approved', 'in-progress', 'blocked', 'done'];

// from → set of allowed next states. Forward progress plus the blocked round
// trip; regressions, skips and self-loops are absent and therefore rejected.
const TRANSITIONS = {
  draft: ['approved'],
  approved: ['in-progress'],
  'in-progress': ['blocked', 'done'],
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
export function assertTransition(from, to) {
  if (!canonical.has(from) || !canonical.has(to)) return;
  if (from === to) throw new Error(`change is already "${to}"`);
  if (!canTransition(from, to)) {
    throw new Error(`invalid lifecycle transition: ${from} → ${to}`);
  }
}
