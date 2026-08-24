// The change lifecycle as an explicit, testable graph — the single authority on
// which status moves are legal. Shared by the CLI (`changeledger status`) and the viewer
// so both decide validity the same way. The viewer layers an extra human-only
// policy on top (approval plus final acceptance); it never relaxes
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
// terminal tombstone reachable only before either closing gate. `done` has one
// policy-gated provisional reopen edge; generic status commands do not own it.
const TRANSITIONS = {
  draft: ['approved', 'discarded'],
  approved: ['in-progress', 'discarded'],
  'in-progress': ['in-review', 'in-validation', 'blocked', 'discarded'],
  'in-review': ['in-validation', 'in-progress', 'blocked'],
  'in-validation': ['done', 'in-progress'],
  blocked: ['in-progress', 'discarded'],
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
// The review gate, symmetric on both sides: a `review_required` type cannot skip
// from in-progress to human validation, and a type without it cannot enter
// review at all — it activates neither `specification` nor `plan`, so a reviewer
// would have no criterion and no task to inspect. All canonical changes must
// pass through `in-validation` before done. `opts.reviewRequired` comes from the
// change's type in config.yml.
export function assertTransition(from, to, { type, reviewRequired = false } = {}) {
  if (!canonical.has(from) || !canonical.has(to)) return;
  if (from === to) throw new Error(`change is already "${to}"`);
  if (!canTransition(from, to)) {
    throw new Error(`invalid lifecycle transition: ${from} → ${to}`);
  }
  if (reviewRequired && from === 'in-progress' && to === 'in-validation') {
    const subject = type ? `${type} changes` : 'changes';
    throw new Error(`${subject} must be reviewed before validation — move to in-review first`);
  }
  if (!reviewRequired && from === 'in-progress' && to === 'in-review') {
    if (!type) {
      throw new Error('cannot decide review entry: the change declares no type');
    }
    throw new Error(`${type} changes do not require review — move to in-validation instead`);
  }
}

export const REVIEW_VERDICTS = ['pass', 'fail'];
export const VALIDATION_VERDICTS = ['pass', 'fail'];
export const TASK_ACTIONS = ['done', 'block'];

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const LOG_EVENT = /^- \*\*([^*]+)\*\* `\[([a-z]+)\]`(?: (.*))?$/;
const TRANSITION_PAYLOAD = /^([a-z-]+) → ([a-z-]+)(?: \(([^)]*)\))?(?:: ([\s\S]+))?$/;

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

export const LOG_EVENT_DEFINITIONS = Object.freeze({
  status: Object.freeze({
    form: '<from> → <to> [(detail)] [: reason]',
    canonicalPayload: 'draft → approved',
    transition: true,
    parse: (payload) => parseTransitionPayload(payload, 'status'),
  }),
  review: Object.freeze({
    form: 'in-review → <to> [(detail)] [: reason]',
    canonicalPayload: 'in-review → in-validation',
    transition: true,
    parse: (payload) => parseTransitionPayload(payload, 'review'),
  }),
  validation: Object.freeze({
    form: 'in-validation → <to> [(detail)] [: reason]',
    canonicalPayload: 'in-validation → done',
    transition: true,
    parse: (payload) => parseTransitionPayload(payload, 'validation'),
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

  if (['status', 'review', 'validation'].includes(type)) {
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
