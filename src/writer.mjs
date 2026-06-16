// Pure text transforms on a change file. They preserve the rest of the document
// and are the basis for the `sl status`/`log`/`task` mutation commands.

import { serializeScalar } from './yaml.mjs';

const FM = /^(---\n[\s\S]*?\n---\n)/;

export function setStatus(text, status) {
  const m = text.match(FM);
  if (!m) throw new Error('missing frontmatter');
  const fm = replaceRequired(m[1], /^status:.*$/m, `status: ${status}`, 'status');
  return fm + text.slice(m[1].length);
}

// Sets, updates or removes the optional `owner:` frontmatter line. A falsy owner
// removes it. New lines are placed right after `depends_on`.
export function setOwner(text, owner) {
  const m = text.match(FM);
  if (!m) throw new Error('missing frontmatter');
  let fm = m[1];
  fm = fm.replace(/^owner:.*\n/m, '');
  if (owner) {
    fm = replaceRequired(
      fm,
      /^(depends_on:.*\n)/m,
      `$1owner: ${serializeScalar(owner)}\n`,
      'depends_on',
    );
  }
  return fm + text.slice(m[1].length);
}

// Sets or removes the optional `archived: true` frontmatter line.
export function setArchived(text, archived) {
  const m = text.match(FM);
  if (!m) throw new Error('missing frontmatter');
  let fm = m[1].replace(/^archived:.*\n/m, '');
  if (archived) {
    fm = replaceRequired(fm, /^(depends_on:.*\n)/m, '$1archived: true\n', 'depends_on');
  }
  return fm + text.slice(m[1].length);
}

// Sets or removes the optional `reviewed: true` frontmatter line. It marks the
// graduation question as resolved (graduated to a spec, or deliberately skipped).
export function setReviewed(text, reviewed) {
  const m = text.match(FM);
  if (!m) throw new Error('missing frontmatter');
  let fm = m[1].replace(/^reviewed:.*\n/m, '');
  if (reviewed) {
    fm = replaceRequired(fm, /^(depends_on:.*\n)/m, '$1reviewed: true\n', 'depends_on');
  }
  return fm + text.slice(m[1].length);
}

// Refreshes a spec's `updated:` frontmatter line, leaving title, tags and body
// untouched. Used when graduating a change into an existing spec.
export function setSpecUpdated(text, iso) {
  const m = text.match(FM);
  if (!m) throw new Error('missing frontmatter');
  const fm = replaceRequired(m[1], /^updated:.*$/m, `updated: ${iso}`, 'updated');
  return fm + text.slice(m[1].length);
}

function replaceRequired(text, pattern, replacement, field) {
  if (!pattern.test(text)) throw new Error(`missing ${field} in frontmatter`);
  return text.replace(pattern, replacement);
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
