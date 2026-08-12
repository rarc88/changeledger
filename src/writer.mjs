// Pure text transforms on a change file. They preserve the rest of the document
// and are the basis for the `changeledger status`/`log`/`task` mutation commands.

import { parseDocument } from 'yaml';
import { serializeLogEvent } from './lifecycle.mjs';
import { parseTaskBlocks, taskMetadataLine } from './task.mjs';
import { serializeScalar } from './yaml.mjs';

const FM = /^---\n([\s\S]*?)\n---\n?/;

export function setStatus(text, status) {
  return mutateFrontmatter(text, (fm, doc) => {
    return replaceRequiredValue(fm, doc, 'status', status);
  });
}

// Sets, updates or removes the optional `owner:` frontmatter line. A falsy owner
// removes it. New lines are placed right after `depends_on`.
export function setOwner(text, owner) {
  return mutateFrontmatter(text, (fm, doc) => {
    return patchOptionalPair(fm, doc, 'owner', owner || null);
  });
}

// Sets, updates or removes the optional `branch:` frontmatter line. A falsy
// branch removes it. New lines are placed right after `depends_on`.
export function setBranch(text, branch) {
  return mutateFrontmatter(text, (fm, doc) => {
    return patchOptionalPair(fm, doc, 'branch', branch || null);
  });
}

// Sets or removes the optional `archived: true` frontmatter line.
export function setArchived(text, archived) {
  return mutateFrontmatter(text, (fm, doc) => {
    return patchOptionalPair(fm, doc, 'archived', archived ? true : null);
  });
}

// Sets or removes the optional `reviewed: true` frontmatter line. It marks the
// graduation question as resolved (graduated to a spec, or deliberately skipped).
export function setReviewed(text, reviewed) {
  return mutateFrontmatter(text, (fm, doc) => {
    return patchOptionalPair(fm, doc, 'reviewed', reviewed ? true : null);
  });
}

// Refreshes a spec's `updated:` frontmatter line, leaving title, tags and body
// untouched. Used when graduating a change into an existing spec.
export function setSpecUpdated(text, iso) {
  return mutateFrontmatter(text, (fm, doc) => {
    return replaceRequiredValue(fm, doc, 'updated', iso);
  });
}

// Records the changes whose accepted truth was graduated into a spec. The list
// is append-only and idempotent so retrying a completed write cannot duplicate
// provenance; the Markdown body remains byte-for-byte untouched.
export function setSpecGraduatedFrom(text, changeId) {
  const current = specGraduatedFrom(text);
  const id = String(changeId);
  if (!current.includes(id)) current.push(id);
  return setSpecGraduatedFromList(text, current);
}

export function setSpecGraduatedFromList(text, changeIds) {
  return mutateFrontmatter(text, (fm, doc) => {
    const next = [...new Set(changeIds.map(String))];
    return patchSerializedPair(fm, doc, 'graduated_from', inlineStringList(next), 'tags');
  });
}

function specGraduatedFrom(text) {
  const m = text.match(FM);
  if (!m) throw new Error('missing frontmatter');
  const doc = parseDocument(m[1], { merge: false, uniqueKeys: true });
  if (doc.errors.length) throw doc.errors[0];
  const current = doc.toJS()?.graduated_from;
  if (current !== undefined && !Array.isArray(current)) {
    throw new Error('graduated_from must be a list');
  }
  return (current ?? []).map(String);
}

function mutateFrontmatter(text, mutate) {
  const m = text.match(FM);
  if (!m) throw new Error('missing frontmatter');
  const doc = parseDocument(m[1], { keepSourceTokens: true, merge: false, uniqueKeys: true });
  if (doc.errors.length) throw doc.errors[0];
  if (!doc.contents || !Array.isArray(doc.contents.items)) {
    throw new Error('frontmatter must be a YAML mapping');
  }
  const fm = mutate(m[1], doc);
  return `${text.slice(0, 4)}${fm}${text.slice(4 + m[1].length)}`;
}

function replaceRequiredValue(fm, doc, key, value) {
  const pair = requirePair(doc, key);
  if (!pair.value?.range) throw new Error(`missing ${key} value in frontmatter`);
  return replaceRange(fm, pair.value.range[0], pair.value.range[1], serializeScalar(value));
}

function patchOptionalPair(fm, doc, key, value) {
  const pair = findPair(doc, key);
  if (pair) {
    if (value == null) return deletePair(fm, pair);
    if (!pair.value?.range) throw new Error(`missing ${key} value in frontmatter`);
    return replaceRange(fm, pair.value.range[0], pair.value.range[1], serializeScalar(value));
  }
  if (value == null) return fm;

  const anchor = requirePair(doc, 'depends_on');
  if (!anchor.value?.range) throw new Error('missing depends_on value in frontmatter');
  const at = anchor.value.range[2];
  const line = `${key}: ${serializeScalar(value)}\n`;
  return `${fm.slice(0, at)}${at > 0 && fm[at - 1] === '\n' ? line : `\n${line}`}${fm.slice(at)}`;
}

function patchSerializedPair(fm, doc, key, serialized, anchorKey) {
  const pair = findPair(doc, key);
  if (pair) {
    if (!pair.value?.range) throw new Error(`missing ${key} value in frontmatter`);
    return replaceRange(fm, pair.value.range[0], pair.value.range[1], serialized);
  }
  const anchor = requirePair(doc, anchorKey);
  if (!anchor.value?.range) throw new Error(`missing ${anchorKey} value in frontmatter`);
  const at = anchor.value.range[2];
  const before = at > 0 && fm[at - 1] !== '\n' ? '\n' : '';
  const after = at === fm.length || fm[at] === '\n' ? '' : '\n';
  return `${fm.slice(0, at)}${before}${key}: ${serialized}${after}${fm.slice(at)}`;
}

function inlineStringList(values) {
  return `[${values.map((value) => JSON.stringify(value)).join(', ')}]`;
}

function findPair(doc, key) {
  return doc.contents.items.find((item) => item.key?.value === key);
}

function requirePair(doc, key) {
  const pair = findPair(doc, key);
  if (!pair) throw new Error(`missing ${key} in frontmatter`);
  return pair;
}

function deletePair(fm, pair) {
  const start = pair.key.range[0];
  const valueEnd = pair.value?.range?.[2] ?? pair.key.range[2];
  const newline = fm.indexOf('\n', valueEnd);
  const end = fm[valueEnd - 1] === '\n' ? valueEnd : newline === -1 ? fm.length : newline + 1;
  return replaceRange(fm, start, end, '');
}

function replaceRange(text, start, end, replacement) {
  return `${text.slice(0, start)}${replacement}${text.slice(end)}`;
}

export function appendLogEvent(text, event) {
  const entry = serializeLogEvent(event);
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^##\s+Log\s*$/.test(l));
  // The Log is the lifecycle transition ledger, present in every change once its
  // status moves. Some types (e.g. chore) don't scaffold it, so create it.
  if (start === -1) {
    const body = `${text.replace(/\s*$/, '')}\n\n## Log\n\n${entry}\n`;
    return body;
  }

  let end = lines.length;
  for (let j = start + 1; j < lines.length; j++) {
    if (/^##\s+/.test(lines[j])) {
      end = j;
      break;
    }
  }
  let at = end;
  while (at > start + 1 && lines[at - 1].trim() === '') at--;

  lines.splice(at, 0, entry);
  return lines.join('\n');
}

// state: 'done' | 'blocked' | 'todo'. n is 1-based within the ## Plan checklist.
export function setTask(text, n, state, { iso, reason } = {}) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^##\s+Plan\s*$/.test(l));
  if (start === -1) throw new Error('no ## Plan section');

  let end = lines.length;
  for (let j = start + 1; j < lines.length; j++) {
    if (/^##\s+/.test(lines[j])) {
      end = j;
      break;
    }
  }
  const parsed = parseTaskBlocks(lines.slice(start + 1, end));
  if (parsed.issues.length) throw new Error(parsed.issues[0].message);
  const task = parsed.tasks[n - 1];
  if (!task) throw new Error(`no task #${n} in ## Plan`);
  if (state === 'done' && task.state === 'done') return text;

  const base = start + 1;
  const target = base + task.lineIndex;
  // Only the state children are rewritten; `Target`/`Verify`/`Criteria`/`Support`
  // are description, not resolution, and survive every status move. The new state
  // child lands at the end of the block so those stay next to their description.
  const stateTargets = task.stateMetadataLineIndices.map((index) => base + index);
  const blockEnd =
    base + Math.max(task.lineIndex, ...task.continuationLineIndices, ...task.metadataLineIndices);
  const marker = state === 'done' ? 'x' : state === 'blocked' ? '!' : ' ';

  if (state === 'done') {
    if (!iso) throw new Error('done task needs a timestamp');
  } else if (state === 'blocked') {
    if (!String(reason ?? '').trim()) throw new Error('blocked task needs a reason');
  }

  lines[target] = lines[target].replace(/^- \[( |x|!)\]/, `- [${marker}]`);
  for (const index of [...stateTargets].sort((a, b) => b - a)) lines.splice(index, 1);
  const metadata = taskMetadataLine(state, { iso, reason });
  if (metadata) lines.splice(blockEnd + 1 - stateTargets.length, 0, metadata);
  return lines.join('\n');
}
