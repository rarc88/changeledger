// The change lifecycle as an explicit, testable graph — the single authority on
// which status moves are legal. Shared by the CLI (`changeledger status`) and the viewer
// so both decide validity the same way. The viewer layers an extra human-only
// policy on top (approval); it never relaxes this graph.

import { isValidCliVersion } from './cli-version.mjs';

export const CANONICAL_STATUSES = [
  'draft',
  'approved',
  'in-progress',
  'in-review',
  'done',
  'discarded',
];

// from → set of allowed next states. Forward progress plus the review gate;
// regressions, skips and self-loops are absent and therefore rejected.
// `in-review` is the route of a change whose branch touches code; one that
// touches only the ledger, and an epic, deliver straight from in-progress
// (`assertTransition` decides between them). `done` means "delivered,
// pending human acceptance" — review may instead route back to in-progress,
// and so may `done` while the change is not yet published in a release.
// `discarded` is a terminal tombstone reachable only before delivery.
const TRANSITIONS = {
  draft: ['approved', 'discarded'],
  approved: ['in-progress', 'discarded'],
  'in-progress': ['in-review', 'done', 'discarded'],
  'in-review': ['done', 'in-progress'],
  done: ['in-progress'],
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
// The review gate (20261024-121022). `kind` is `change` or `epic`. An epic
// groups work and is never implemented, so it never enters review and delivers
// straight from in-progress. A change always may enter review; it delivers
// straight from in-progress only when the caller has established, from git,
// that its branch touches nothing outside the ledger (`touchesCode: false`).
// Code, or an undecided answer, keeps it on the reviewed route.
const CHANGE_KINDS = ['change', 'epic'];

export function assertTransition(from, to, { kind = 'change', touchesCode } = {}) {
  if (!CHANGE_KINDS.includes(kind)) {
    throw new Error(`unknown change kind "${kind}"; valid kinds: ${CHANGE_KINDS.join(', ')}`);
  }
  if (!canonical.has(from) || !canonical.has(to)) return;
  if (from === to) throw new Error(`change is already "${to}"`);
  if (!canTransition(from, to)) {
    throw new Error(`invalid lifecycle transition: ${from} → ${to}`);
  }
  if (from !== 'in-progress') return;
  if (kind === 'epic' && to === 'in-review') {
    throw new Error('epic changes do not enter review — move to done instead');
  }
  if (kind === 'change' && to === 'done' && touchesCode !== false) {
    throw new Error(
      touchesCode === true
        ? 'change touches code outside the ledger: move it to in-review and record a verdict'
        : 'cannot decide whether the change touches code — move it to in-review and record a verdict',
    );
  }
}

export const REVIEW_VERDICTS = ['pass', 'fail'];
export const TASK_ACTIONS = ['done', 'block'];

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const LOG_EVENT = /^- \*\*([^*]+)\*\* `\[([a-z]+)\]`(?: (.*))?$/;
const TRANSITION_PAYLOAD = /^([a-z-]+) → ([a-z-]+)(?: \(([^)]*)\))?(?:: ([\s\S]+))?$/;
// The merge-derived acceptance arm of `[validation]`. A short sha only: the
// payload is read back by tooling, so it carries the identity of the merge
// and nothing a human might paraphrase.
const ACCEPTED_PAYLOAD = /^accepted \(merged ([0-9a-f]{7,40})\)$/;

function parseAcceptedPayload(payload) {
  const accepted = payload.match(ACCEPTED_PAYLOAD);
  return accepted ? { outcome: 'accepted', sha: accepted[1] } : null;
}

function parseTransitionPayload(payload, type) {
  const transition = payload.match(TRANSITION_PAYLOAD);
  if (!transition) return null;
  const event = { from: transition[1], to: transition[2] };
  if (transition[3]) event.detail = transition[3];
  if (transition[4]) event.reason = transition[4];
  if (type === 'review' && event.from !== 'in-review') return null;
  if (type === 'validation' && event.from !== 'in-validation') return null;
  return event;
}

function parseAssignmentPayload(payload, field) {
  if (payload === 'cleared') return { [field]: null };
  if (!payload.startsWith('set: ') || payload.length === 5) return null;
  const automatic = payload.endsWith(' (auto)');
  const value = payload.slice(5, automatic ? -7 : undefined);
  if (!value) return null;
  return automatic ? { [field]: value, automatic: true } : { [field]: value };
}

function parseGraduationPayload(payload) {
  const spec = payload.match(/^spec: `([^`]+)`(?: \((.*)\))?$/);
  if (spec) {
    const event = { outcome: 'spec', spec: spec[1] };
    if (spec[2]) event.detail = spec[2];
    return event;
  }
  if (payload === 'skipped') return { outcome: 'skipped' };
  if (payload.startsWith('skipped: ') && payload.length > 9) {
    return { outcome: 'skipped', reason: payload.slice(9) };
  }
  return null;
}

// `<semver>` for the first stamp of a change, `<previous> → <semver>` when the
// running version differs from the last stamped one. Both ends share the
// SemVer grammar `min_cli_version` is validated with.
function parseVersionPayload(payload) {
  const parts = payload.split(' → ');
  if (parts.length > 2 || !parts.every(isValidCliVersion)) return null;
  return parts.length === 2 ? { previous: parts[0], version: parts[1] } : { version: parts[0] };
}

export const LOG_EVENT_DEFINITIONS = Object.freeze({
  status: Object.freeze({
    form: '<from> → <to> [(detail)] [: reason]',
    canonicalPayload: 'draft → approved',
    transition: true,
    parse: (payload) => parseTransitionPayload(payload, 'status'),
  }),
  review: Object.freeze({
    form: 'in-review → <to> [(detail)] [: reason]',
    canonicalPayload: 'in-review → done',
    transition: true,
    parse: (payload) => parseTransitionPayload(payload, 'review'),
  }),
  // Acceptance keeps one event type across the two eras (20261018-131621
  // CR10). `accepted (merged <sha>)` is what `graduate` stamps now that
  // acceptance is a datum derived from the merge; the `in-validation → <to>`
  // arm is the retired gate's, and must keep parsing or every historical
  // acceptance line in the archive turns into an "invalid typed event"
  // diagnostic.
  validation: Object.freeze({
    form: 'in-validation → <to> [(detail)] [: reason] | accepted (merged <sha>)',
    canonicalPayload: 'in-validation → done',
    transition: true,
    parse: (payload) =>
      parseAcceptedPayload(payload) ?? parseTransitionPayload(payload, 'validation'),
  }),
  owner: Object.freeze({
    form: 'set: <owner> [(auto)] | cleared',
    canonicalPayload: 'set: ana',
    transition: false,
    parse: (payload) => parseAssignmentPayload(payload, 'owner'),
  }),
  branch: Object.freeze({
    form: 'set: <branch> [(auto)] | cleared',
    canonicalPayload: 'set: feature/x',
    transition: false,
    parse: (payload) => parseAssignmentPayload(payload, 'branch'),
  }),
  graduation: Object.freeze({
    form: 'spec: `<file>` [(detail)] | skipped [: reason]',
    canonicalPayload: 'spec: `architecture.md`',
    transition: false,
    parse: parseGraduationPayload,
  }),
  archive: Object.freeze({
    form: 'archived',
    canonicalPayload: 'archived',
    transition: false,
    parse: (payload) => (payload === 'archived' ? {} : null),
  }),
  note: Object.freeze({
    form: '<non-empty text>',
    canonicalPayload: 'arbitrary text',
    transition: false,
    parse: (payload) => (payload ? { message: payload } : null),
  }),
  version: Object.freeze({
    form: '<semver> | <semver> → <semver>',
    canonicalPayload: '0.17.0 → 0.18.0',
    transition: false,
    parse: parseVersionPayload,
  }),
});

export const LOG_EVENT_TYPES = Object.keys(LOG_EVENT_DEFINITIONS);
export const LOG_EVENT_PAYLOAD_FORMS = Object.freeze(
  Object.fromEntries(
    Object.entries(LOG_EVENT_DEFINITIONS).map(([type, definition]) => [type, definition.form]),
  ),
);

export function isIsoUtc(value) {
  return ISO_UTC.test(String(value));
}

export function parseLogEvent(line) {
  const match = String(line).match(LOG_EVENT);
  if (!match || !isIsoUtc(match[1])) return null;
  const [at, type, payload = ''] = match.slice(1);
  const parsed = LOG_EVENT_DEFINITIONS[type]?.parse(payload);
  return parsed ? { at, type, ...parsed } : null;
}

export function serializeLogEvent(event) {
  const at = String(event?.at ?? '');
  const type = String(event?.type ?? '');
  let payload;

  if (type === 'validation' && event.outcome === 'accepted') {
    payload = `accepted (merged ${event.sha})`;
  } else if (['status', 'review', 'validation'].includes(type)) {
    payload = `${event.from} → ${event.to}`;
    if (event.detail) payload += ` (${event.detail})`;
    if (event.reason) payload += `: ${event.reason}`;
  } else if (type === 'owner') {
    payload =
      event.owner == null ? 'cleared' : `set: ${event.owner}${event.automatic ? ' (auto)' : ''}`;
  } else if (type === 'branch') {
    payload =
      event.branch == null ? 'cleared' : `set: ${event.branch}${event.automatic ? ' (auto)' : ''}`;
  } else if (type === 'graduation') {
    payload =
      event.outcome === 'spec'
        ? `spec: \`${event.spec}\`${event.detail ? ` (${event.detail})` : ''}`
        : `skipped${event.reason ? `: ${event.reason}` : ''}`;
  } else if (type === 'archive') {
    payload = 'archived';
  } else if (type === 'version') {
    payload = event.previous ? `${event.previous} → ${event.version}` : event.version;
  } else if (type === 'note') {
    // The rendered line already prepends the literal `` `[note]` `` tag
    // (below); a caller-supplied message that repeats it verbatim at the very
    // start (`changeledger log <id> "[note] msg"`) would otherwise duplicate
    // it in the output. Strip exactly that one leading occurrence — an
    // interior `[note]` is ordinary message text and stays untouched.
    const NOTE_PREFIX = '[note] ';
    payload = event.message?.startsWith(NOTE_PREFIX)
      ? event.message.slice(NOTE_PREFIX.length)
      : event.message;
  }

  const line = `- **${at}** \`[${type}]\` ${payload ?? ''}`;
  if (!parseLogEvent(line)) throw new Error(`invalid ${type || 'unknown'} Log event`);
  return line;
}
