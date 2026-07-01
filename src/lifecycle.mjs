// The change lifecycle as an explicit, testable graph — the single authority on
// which status moves are legal. Shared by the CLI (`changeledger status`) and the viewer
// so both decide validity the same way. The viewer layers an extra human-only
// policy on top (approval plus final acceptance/rejection); it never relaxes
// this graph.

export const CANONICAL_STATUSES = [
  'draft',
  'approved',
  'in-progress',
  'in-review',
  'in-validation',
  'blocked',
  'done',
  'discarded',
];

// from → set of allowed next states. Forward progress plus the blocked round
// trip and the review/validation gates; regressions, skips and self-loops are
// absent and therefore rejected. `in-review` is optional by type;
// `in-validation` is the universal human gate before done. Review or validation
// may route back to in-progress, while review may also block. `discarded` is a
// terminal tombstone reachable only before either closing gate.
const TRANSITIONS = {
  draft: ['approved', 'discarded'],
  approved: ['in-progress', 'discarded'],
  'in-progress': ['in-review', 'in-validation', 'blocked', 'discarded'],
  'in-review': ['in-validation', 'in-progress', 'blocked'],
  'in-validation': ['done', 'in-progress'],
  blocked: ['in-progress', 'discarded'],
  done: [],
  discarded: [],
};

const canonical = new Set(CANONICAL_STATUSES);

export function canTransition(from, to) {
  return (TRANSITIONS[from] ?? []).includes(to);
}

// Throws when a move is illegal. Enforced only between canonical statuses; a
// repo with custom statuses keeps the prior enum-only behavior, since this graph
// cannot reason about states it does not model.
//
// The review gate: a `review_required` type cannot skip from in-progress to
// human validation. All canonical changes must pass through `in-validation`
// before done. `opts.reviewRequired` comes from the change's type in config.yml.
export function assertTransition(from, to, { type, reviewRequired = false } = {}) {
  if (!canonical.has(from) || !canonical.has(to)) return;
  if (from === to) throw new Error(`change is already "${to}"`);
  if (!canTransition(from, to)) {
    throw new Error(`invalid lifecycle transition: ${from} → ${to}`);
  }
  if (reviewRequired && from === 'in-progress' && to === 'in-validation') {
    throw new Error(`${type} changes must be reviewed before validation — move to in-review first`);
  }
}

// A lifecycle event recorded in `## Log`. `status:` lines carry an explicit
// origin; review/validation verdict lines imply it (the writer only emits them
// from in-review / in-validation). Non-lifecycle entries (owner, graduation,
// free notes) return null.
const LOG_EVENT =
  /\*\*([^*]+)\*\*\s*—\s*(?:status:\s*([a-z-]+)\s*→\s*([a-z-]+)|(review)\s*→\s*([a-z-]+)|(validation)\s*→\s*([a-z-]+))/;

export function parseLogEvent(line) {
  const m = line.match(LOG_EVENT);
  if (!m) return null;
  const at = m[1].trim();
  if (m[2]) return { at, from: m[2], to: m[3], explicit: true };
  if (m[4]) return { at, from: 'in-review', to: m[5], explicit: false };
  return { at, from: 'in-validation', to: m[7], explicit: false };
}
