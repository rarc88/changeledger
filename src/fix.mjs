// Mechanical, unambiguous repairs for format defects `changeledger check` can
// only diagnose. Pure text-in/text-out — no IO. The `fix` command (and its
// `--dry-run`) do the reading/writing; `check` reuses `hasFixableDefects` to
// print a hint without duplicating the repair rules.
//
// Repairs (in order, per `## Plan` task line):
//   1. Checkbox marker variants `[ x ]` / `[X]` -> `[x]`.
//   2. A resolution suffix using a single hyphen instead of an em dash.
//   3. A near-ISO resolution timestamp normalized to strict ISO 8601 UTC.
//
// A task whose CR reference is not declared in `## Specification` is left
// completely untouched and reported under `manual` — the defect requires
// judgment (unknown criterion), not a mechanical rewrite.
//
// This module is also the converter from the old positional Plan grammar to the
// tag grammar (`--plan-tags`, 20260729-203257) and therefore the last legal home
// of positional parsing. Recognition of the task line itself is not its own: it
// comes from `src/task.mjs`, the single seat (CR6), and is re-exported below so
// the identity of that seat is assertable.
import { parseChange } from './change.mjs';
import { parseLogEvent, serializeLogEvent } from './lifecycle.mjs';
import { matchLenientTaskLine, matchTaskLine } from './task.mjs';

export { matchLenientTaskLine, matchTaskLine };

const NEAR_ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})(?:\.\d+)?(Z)?$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const LEGACY_LOG =
  /^- (?:\*\*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)\*\*|(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)) — (.*)$/;

export function computeFixes(text) {
  const criteria = new Set(parseChange(text).criteria ?? []);
  const lines = text.split('\n');
  const outLines = [];
  const applied = [];
  const manual = [];
  let inPlan = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (/^##\s+/.test(rawLine)) {
      inPlan = /^##\s+Plan\s*$/.test(rawLine);
      outLines.push(rawLine);
      continue;
    }
    if (!inPlan) {
      outLines.push(rawLine);
      continue;
    }
    const result = fixTaskLine(rawLine, criteria, i + 1);
    outLines.push(result.line);
    applied.push(...result.applied);
    manual.push(...result.manual);
  }

  return { text: outLines.join('\n'), applied, manual, changed: applied.length > 0 };
}

export function hasFixableDefects(text) {
  if (typeof text !== 'string') return false;
  try {
    return computeFixes(text).changed;
  } catch {
    return false;
  }
}

export function migrateStructuredSections(text) {
  const lines = String(text).split('\n');
  const output = [];
  const applied = [];
  const manual = [];
  let section = '';

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      section = heading[1].toLowerCase();
      output.push(line);
      continue;
    }

    if (section === 'plan') {
      const task = matchTaskLine(line);
      const alreadyStructured = /^ {2}- \*\*(?:Resolved|Blocked):\*\*/.test(lines[index + 1] ?? '');
      if (task && !alreadyStructured && task.mark !== ' ') {
        const separator = task.content.lastIndexOf(' — ');
        const separators = task.content.match(/ — /g)?.length ?? 0;
        const suffix = separator === -1 ? '' : task.content.slice(separator + 3);
        const description = separator === -1 ? task.content : task.content.slice(0, separator);
        if (task.mark === 'x' && ISO_UTC.test(suffix)) {
          output.push(`- [x] ${description}`, `  - **Resolved:** \`${suffix}\``);
          applied.push(`line ${index + 1}: migrated resolved task metadata`);
          continue;
        }
        if (task.mark === '!' && separator !== -1 && separators === 1 && suffix.trim()) {
          output.push(`- [!] ${description}`, `  - **Blocked:** ${suffix}`);
          applied.push(`line ${index + 1}: migrated blocked task metadata`);
          continue;
        }
        manual.push(`line ${index + 1}: ambiguous legacy task metadata`);
      }
    }

    if (section === 'log' && /^- /.test(line)) {
      if (parseLogEvent(line)) {
        output.push(line);
        continue;
      }
      const legacy = line.match(LEGACY_LOG);
      if (legacy) {
        output.push(serializeLogEvent(parseLegacyLogEvent(legacy[1] ?? legacy[2], legacy[3])));
        applied.push(`line ${index + 1}: migrated typed Log event`);
        continue;
      }
      manual.push(`line ${index + 1}: untyped Log entry has no migratable timestamp`);
    }

    output.push(line);
  }

  const migrated = output.join('\n');
  return { text: migrated, applied, manual, changed: migrated !== text };
}

// Converter from the old positional Plan grammar to the tag grammar
// (20260729-203257 CR5). Deterministic and idempotent: it only ever moves a
// trailing marker or a single `verify:` clause out of the description and into a
// child, so a document already in the tag grammar comes out byte-identical.
//
// The positional literals below are the LEGAL residue of the old grammar — this
// function's whole subject matter — and exist nowhere else in `src/`.
const FINAL_CR_GROUP = /\(([^)]*\bCR\d+[^)]*)\)\s*$/;
const FINAL_SUPPORT = /\s*\(support\)\s*$/;
const VERIFY_CLAUSE = 'verify:';

export function migratePlanTags(text) {
  const lines = String(text).split('\n');
  const output = [];
  const applied = [];
  const manual = [];
  let inPlan = false;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^##\s+/.test(line)) {
      inPlan = /^##\s+Plan\s*$/.test(line);
      output.push(line);
      continue;
    }
    const task = inPlan ? matchTaskLine(line) : null;
    if (!task) {
      output.push(line);
      continue;
    }

    const converted = convertLegacyTask(task.content, index + 1);
    manual.push(...converted.manual);
    if (!converted.children.length) {
      output.push(line);
      continue;
    }
    output.push(`- [${task.mark}] ${converted.description}`, ...converted.children);
    applied.push(`line ${index + 1}: migrated Plan task tags`);
  }

  const migrated = output.join('\n');
  return { text: migrated, applied, manual, changed: migrated !== text };
}

function convertLegacyTask(content, lineNo) {
  const manual = [];
  const children = [];
  let description = content.trim();

  const group = description.match(FINAL_CR_GROUP);
  const criteria = group ? (group[1].match(/CR\d+/g) ?? []) : [];
  if (group) description = description.slice(0, group.index).trim();

  const support = FINAL_SUPPORT.test(description);
  if (support) description = description.replace(FINAL_SUPPORT, '').trim();

  // Exactly one clause is unambiguous. Zero leaves nothing to move; several leave
  // no deterministic tail. Both cases keep the description intact and say so.
  const occurrences = description.split(VERIFY_CLAUSE).length - 1;
  let verify = '';
  if (occurrences === 1) {
    const at = description.indexOf(VERIFY_CLAUSE);
    verify = description.slice(at + VERIFY_CLAUSE.length).trim();
    if (verify)
      description = description
        .slice(0, at)
        .replace(/[;,]?\s*$/, '')
        .trim();
  }
  if (!verify) {
    manual.push(
      occurrences <= 1
        ? `line ${lineNo}: no verify: clause to migrate — add **Verify:** by hand`
        : `line ${lineNo}: ${occurrences} verify: clauses — add **Verify:** by hand`,
    );
  }

  // A description reduced to nothing would stop being a task line: refuse.
  if (!description) {
    manual.push(`line ${lineNo}: migrating would leave the task without a description`);
    return { description: content.trim(), children: [], manual };
  }

  if (verify) children.push(`  - **Verify:** ${verify}`);
  if (criteria.length) children.push(`  - **Criteria:** ${criteria.join(', ')}`);
  if (support) children.push('  - **Support:**');
  return { description, children, manual };
}

function parseLegacyLogEvent(at, message) {
  for (const [type, prefix, from] of [
    ['status', 'status: ', null],
    ['review', 'review → ', 'in-review'],
    ['validation', 'validation → ', 'in-validation'],
  ]) {
    if (!message.startsWith(prefix)) continue;
    const payload =
      type === 'status'
        ? message.slice(prefix.length)
        : `${from} → ${message.slice(prefix.length)}`;
    const transition = payload.match(/^([a-z-]+) → ([a-z-]+)(?: \(([^)]*)\))?(?:: ([\s\S]+))?$/);
    if (transition) {
      const event = { at, type, from: transition[1], to: transition[2] };
      if (transition[3]) event.detail = transition[3];
      if (transition[4]) event.reason = transition[4];
      return event;
    }
  }

  if (message === 'owner cleared') return { at, type: 'owner', owner: null };
  const owner = message.match(/^owner → (.+?)( \(auto\))?$/);
  if (owner) {
    return {
      at,
      type: 'owner',
      owner: owner[1],
      ...(owner[2] ? { automatic: true } : {}),
    };
  }
  const graduated = message.match(/^graduado a spec `([^`]+)`(?: \((.*)\))?$/i);
  if (graduated) {
    return {
      at,
      type: 'graduation',
      outcome: 'spec',
      spec: graduated[1],
      ...(graduated[2] ? { detail: graduated[2] } : {}),
    };
  }
  const skipped = message.match(/^graduation skipped(?:: ([\s\S]+))?$/);
  if (skipped) {
    return {
      at,
      type: 'graduation',
      outcome: 'skipped',
      ...(skipped[1] ? { reason: skipped[1] } : {}),
    };
  }
  if (message === 'archived') return { at, type: 'archive' };
  return { at, type: 'note', message };
}

function fixTaskLine(rawLine, declaredCR, lineNo) {
  const m = matchLenientTaskLine(rawLine);
  if (!m) return { line: rawLine, applied: [], manual: [] };
  const { prefix, marker: markerRaw, gap, content: restRaw } = m;

  // A task referencing an undeclared criterion needs judgment, not a rewrite —
  // leave the entire line untouched.
  const referenced = restRaw.match(/CR\d+/g) ?? [];
  const unknown = [...new Set(referenced.filter((cr) => !declaredCR.has(cr)))];
  if (unknown.length) {
    return {
      line: rawLine,
      applied: [],
      manual: [`line ${lineNo}: references unknown criterion ${unknown.join(', ')}`],
    };
  }

  const applied = [];
  let rest = restRaw;

  let marker = markerRaw;
  if (marker.trim().toLowerCase() === 'x' && marker !== 'x') {
    marker = 'x';
    applied.push(`line ${lineNo}: checkbox marker normalized to [x]`);
  }
  const state = marker === 'x' ? 'done' : marker === '!' ? 'blocked' : 'todo';

  // The resolution suffix is the LAST separator: a description may legitimately
  // contain an em dash, so only a hyphen sitting after every em dash is a defect.
  if (
    (state === 'done' || state === 'blocked') &&
    rest.lastIndexOf(' - ') > rest.lastIndexOf(' — ')
  ) {
    const hyphenIdx = rest.lastIndexOf(' - ');
    if (hyphenIdx !== -1) {
      rest = `${rest.slice(0, hyphenIdx)} — ${rest.slice(hyphenIdx + 3)}`;
      applied.push(`line ${lineNo}: resolution suffix hyphen normalized to em dash`);
    }
  }

  if (state === 'done') {
    const dash = rest.lastIndexOf(' — ');
    if (dash !== -1) {
      const suffix = rest.slice(dash + 3);
      const normalized = normalizeIsoTimestamp(suffix);
      if (normalized && normalized !== suffix) {
        rest = `${rest.slice(0, dash)} — ${normalized}`;
        applied.push(`line ${lineNo}: resolution timestamp normalized to ISO 8601 UTC`);
      }
    }
  }

  if (!applied.length) return { line: rawLine, applied: [], manual: [] };
  return { line: `${prefix}[${marker}]${gap}${rest}`, applied, manual: [] };
}

function normalizeIsoTimestamp(text) {
  const m = text.trim().match(NEAR_ISO);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const pad = (v) => v.padStart(2, '0');
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${mi}:${s}Z`;
}
