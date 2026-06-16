// Pure text transforms on a change file. They preserve the rest of the document
// and are the basis for the `sl status`/`log`/`task` mutation commands.

import { parseDocument } from 'yaml';

const FM = /^---\n([\s\S]*?)\n---\n?/;

export function setStatus(text, status) {
  return mutateFrontmatter(text, (doc) => {
    setRequired(doc, 'status', status);
  });
}

// Sets, updates or removes the optional `owner:` frontmatter line. A falsy owner
// removes it. New lines are placed right after `depends_on`.
export function setOwner(text, owner) {
  return mutateFrontmatter(text, (doc) => {
    doc.delete('owner');
    if (owner) {
      requireKey(doc, 'depends_on');
      doc.set('owner', owner);
      moveKeyAfter(doc, 'owner', 'depends_on');
    }
  });
}

// Sets or removes the optional `archived: true` frontmatter line.
export function setArchived(text, archived) {
  return mutateFrontmatter(text, (doc) => {
    doc.delete('archived');
    if (archived) {
      requireKey(doc, 'depends_on');
      doc.set('archived', true);
      moveKeyAfter(doc, 'archived', 'depends_on');
    }
  });
}

// Sets or removes the optional `reviewed: true` frontmatter line. It marks the
// graduation question as resolved (graduated to a spec, or deliberately skipped).
export function setReviewed(text, reviewed) {
  return mutateFrontmatter(text, (doc) => {
    doc.delete('reviewed');
    if (reviewed) {
      requireKey(doc, 'depends_on');
      doc.set('reviewed', true);
      moveKeyAfter(doc, 'reviewed', 'depends_on');
    }
  });
}

// Refreshes a spec's `updated:` frontmatter line, leaving title, tags and body
// untouched. Used when graduating a change into an existing spec.
export function setSpecUpdated(text, iso) {
  return mutateFrontmatter(text, (doc) => {
    setRequired(doc, 'updated', iso);
  });
}

function mutateFrontmatter(text, mutate) {
  const m = text.match(FM);
  if (!m) throw new Error('missing frontmatter');
  const doc = parseDocument(m[1], { merge: false, uniqueKeys: true });
  if (doc.errors.length) throw doc.errors[0];
  if (!doc.contents || !Array.isArray(doc.contents.items)) {
    throw new Error('frontmatter must be a YAML mapping');
  }
  mutate(doc);
  const fm = doc.toString({ lineWidth: 0 });
  return `---\n${fm.endsWith('\n') ? fm : `${fm}\n`}---\n${text.slice(m[0].length)}`;
}

function setRequired(doc, key, value) {
  requireKey(doc, key);
  doc.set(key, value);
}

function requireKey(doc, key) {
  if (!doc.has(key)) throw new Error(`missing ${key} in frontmatter`);
}

function moveKeyAfter(doc, key, after) {
  const items = doc.contents?.items;
  if (!Array.isArray(items)) return;
  const from = items.findIndex((item) => item.key?.value === key);
  const to = items.findIndex((item) => item.key?.value === after);
  if (from === -1 || to === -1 || from === to + 1) return;
  const [item] = items.splice(from, 1);
  const nextTo = items.findIndex((candidate) => candidate.key?.value === after);
  items.splice(nextTo + 1, 0, item);
}

export function appendLog(text, iso, message) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^##\s+Log\s*$/.test(l));
  // The Log is the lifecycle transition ledger, present in every change once its
  // status moves. Some types (e.g. chore) don't scaffold it, so create it.
  if (start === -1) {
    const body = `${text.replace(/\s*$/, '')}\n\n## Log\n\n- **${iso}** — ${message}\n`;
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

  lines.splice(at, 0, `- **${iso}** — ${message}`);
  return lines.join('\n');
}

// state: 'done' | 'blocked' | 'todo'. n is 1-based within the ## Plan checklist.
export function setTask(text, n, state, { iso, reason } = {}) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^##\s+Plan\s*$/.test(l));
  if (start === -1) throw new Error('no ## Plan section');

  let count = 0;
  let target = -1;
  for (let j = start + 1; j < lines.length; j++) {
    if (/^##\s+/.test(lines[j])) break;
    if (/^- \[( |x|!)\]/.test(lines[j].trim())) {
      count++;
      if (count === n) {
        target = j;
        break;
      }
    }
  }
  if (target === -1) throw new Error(`no task #${n} in ## Plan`);

  const line = lines[target];
  const dash = line.indexOf(' — ');
  const head = dash === -1 ? line : line.slice(0, dash);

  if (state === 'done') {
    if (!iso) throw new Error('done task needs a timestamp');
    lines[target] = `${head.replace(/- \[[ !]\]/, '- [x]')} — ${iso}`;
  } else if (state === 'blocked') {
    if (!reason) throw new Error('blocked task needs a reason');
    lines[target] = `${head.replace(/- \[[ x]\]/, '- [!]')} — ${reason}`;
  } else {
    lines[target] = head.replace(/- \[[x!]\]/, '- [ ]');
  }
  return lines.join('\n');
}
