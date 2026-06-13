// Pure text transforms on a change file. They preserve the rest of the document
// and are the basis for the `sl status`/`log`/`task` mutation commands.

const FM = /^(---\n[\s\S]*?\n---\n)/;

export function setStatus(text, status) {
  const m = text.match(FM);
  if (!m) throw new Error('missing frontmatter');
  const fm = m[1].replace(/^status:.*$/m, `status: ${status}`);
  return fm + text.slice(m[1].length);
}

export function appendLog(text, iso, message) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^##\s+Log\s*$/.test(l));
  if (start === -1) throw new Error('no ## Log section');

  let end = lines.length;
  for (let j = start + 1; j < lines.length; j++) {
    if (/^##\s+/.test(lines[j])) { end = j; break; }
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
      if (count === n) { target = j; break; }
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
