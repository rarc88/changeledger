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
// `repairLiveDocument` brings a live document to the two-type, four-stage
// form (20261024-121022); the command decides which documents are live.
// Recognition of the task line itself is not this module's own: it comes from
// `src/task.mjs`, the single seat, and is re-exported below so the identity of
// that seat is assertable.
import {
  CHANGE_TYPES,
  FRONTMATTER,
  fenceTracker,
  parseChange,
  RETIRED_STAGES,
  RETIRED_TYPES,
  stageHeadings,
} from './change.mjs';
import { matchLenientTaskLine } from './task.mjs';
import { parseYaml } from './yaml.mjs';

export { matchLenientTaskLine };

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

// The types and stages retired by 20261024-121022. A live document carrying
// one is rewritten: the type becomes `change`, keeping a trailing comment, and
// what the retired type implied (`RETIRED_TYPES`) is written right after it
// unless the frontmatter already declares that key; a `type:` line this
// cannot read is left for a manual fix. Each retired stage's body moves under
// `## Request` as a `###` subsection after the Request's own content, in
// document order, its own headings one level deeper so the hierarchy survives.
// An empty retired stage simply disappears. Which documents are live is the
// caller's question (`frozenReason`): this function never sees frozen history.
const TYPE_LINE = /^type:[ \t]*(["']?)([^"'\s#]+)\1([ \t]+#.*)?[ \t]*$/;

export function repairLiveDocument(text) {
  const applied = [];
  const manual = [];
  const frontmatter = text.match(FRONTMATTER);
  if (!frontmatter) return { text, applied, manual, changed: false };

  const head = repairType(frontmatter[0], frontmatter[1], applied, manual);
  const body = foldRetiredStages(text.slice(frontmatter[0].length), applied, manual);
  const repaired = `${head}${body}`;
  return { text: repaired, applied, manual, changed: repaired !== text };
}

function repairType(head, yaml, applied, manual) {
  const lines = head.split('\n');
  const at = lines.findIndex((line) => /^type:/.test(line));
  const line = at === -1 ? null : lines[at].match(TYPE_LINE);
  if (!line) {
    const declared = declaredType(yaml);
    if ((at !== -1 || declared !== undefined) && !CHANGE_TYPES.includes(declared)) {
      const shown = at === -1 ? '' : ` "${lines[at]}"`;
      manual.push(`cannot read the type line${shown}: set type to "change" by hand`);
    }
    return head;
  }
  const type = line[2];
  if (!Object.hasOwn(RETIRED_TYPES, type)) return head;
  applied.push(`type ${type} → change`);
  const implied = Object.entries(RETIRED_TYPES[type])
    .filter(([key]) => !lines.some((other) => other.startsWith(`${key}:`)))
    .map(([key, value]) => {
      applied.push(`${key}: ${value} (from ${type})`);
      return `${key}: ${value}`;
    });
  lines.splice(at, 1, `type: change${line[3] ?? ''}`, ...implied);
  return lines.join('\n');
}

function declaredType(yaml) {
  try {
    return parseYaml(yaml)?.type;
  } catch {
    return undefined;
  }
}

function foldRetiredStages(body, applied, manual) {
  const segments = splitSegments(body);
  const retired = segments.filter((segment) => RETIRED_STAGES.has(segment.key));
  if (!retired.length) return body;
  const request = segments.find((segment) => segment.key === 'request');
  if (!request) {
    for (const segment of retired) {
      manual.push(`## ${RETIRED_STAGES.get(segment.key)} has no ## Request to move under`);
    }
    return body;
  }

  const moved = [];
  for (const segment of retired) {
    const name = RETIRED_STAGES.get(segment.key);
    const content = trimBlankLines(segment.lines);
    if (!content.length) {
      applied.push(`removed empty ## ${name}`);
      continue;
    }
    moved.push('', `### ${name}`, '', ...demoteHeadings(content));
    applied.push(`## ${name} → ### ${name} under ## Request`);
  }
  if (moved.length) {
    const own = trimTrailingBlankLines(request.lines);
    let tail = request.lines.slice(own.length);
    const last = segments.filter((segment) => !retired.includes(segment)).at(-1) === request;
    if (!tail.length && !last) tail = [''];
    request.lines = [...own, ...moved, ...tail];
  }
  return segments
    .filter((segment) => !retired.includes(segment))
    .flatMap((segment) =>
      segment.heading === null ? segment.lines : [segment.heading, ...segment.lines],
    )
    .join('\n');
}

// Splits a body at its `## ` headings outside code fences; joining the
// segments back reproduces the body byte for byte.
function splitSegments(body) {
  const lines = body.split('\n');
  const headings = stageHeadings(lines);
  return [
    { key: null, heading: null, lines: lines.slice(0, headings[0]?.start ?? lines.length) },
    ...headings.map(({ start, end, title }) => ({
      key: title.toLowerCase(),
      heading: lines[start],
      lines: lines.slice(start + 1, end),
    })),
  ];
}

function demoteHeadings(lines) {
  const isFenced = fenceTracker();
  return lines.map((line) => (!isFenced(line) && /^#{3,5}\s/.test(line) ? `#${line}` : line));
}

function trimTrailingBlankLines(lines) {
  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) end -= 1;
  return lines.slice(0, end);
}

function trimBlankLines(lines) {
  const kept = trimTrailingBlankLines(lines);
  let start = 0;
  while (start < kept.length && !kept[start].trim()) start += 1;
  return kept.slice(start);
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
