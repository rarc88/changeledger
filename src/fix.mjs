// Mechanical, unambiguous repairs for format defects `changeledger check` can
// only diagnose. Pure text-in/text-out — no IO. The `fix` command (and its
// `--dry-run`) do the reading/writing; `check` reuses `hasFixableDefects` to
// print a hint without duplicating the repair rules.
//
// Repairs (in order, per `## Plan` task line):
//   1. Checkbox marker variants `[ x ]` / `[X]` -> `[x]`.
//   2. A `(CRn) — verify: X` block reordered to `; verify: X (CRn)`.
//   3. A resolution suffix using a single hyphen instead of an em dash.
//   4. A near-ISO resolution timestamp normalized to strict ISO 8601 UTC.
//
// A task whose CR reference is not declared in `## Specification` is left
// completely untouched and reported under `manual` — the defect requires
// judgment (unknown criterion), not a mechanical rewrite.
import { parseChange } from './change.mjs';

const TASK_LINE = /^(\s*-\s)\[([^\]]*)\](\s+)(.*)$/;
const REORDERED_VERIFY = /^(.*?)\s*\(([^)]*\bCR\d+[^)]*)\)\s*—\s*verify:\s*(.+)$/;
const NEAR_ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})(?:\.\d+)?(Z)?$/;

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

function fixTaskLine(rawLine, declaredCR, lineNo) {
  const m = rawLine.match(TASK_LINE);
  if (!m) return { line: rawLine, applied: [], manual: [] };
  const [, prefix, markerRaw, gap, restRaw] = m;

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

  const reorder = rest.match(REORDERED_VERIFY);
  if (reorder) {
    const [, target, crBlock, verify] = reorder;
    rest = `${target.trim()}; verify: ${verify.trim()} (${crBlock.trim()})`;
    applied.push(`line ${lineNo}: reordered verify suffix before (${crBlock.trim()})`);
  }

  if ((state === 'done' || state === 'blocked') && !rest.includes(' — ')) {
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
