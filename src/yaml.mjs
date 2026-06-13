// Minimal YAML parser for the controlled subset Spec Ledger uses:
// scalars, inline arrays, nested maps by 2-space indentation, comments.
// Block sequences (- item) are intentionally NOT supported — the format never
// uses them. `sl check` and tests guard the inputs.

const NESTED = Symbol('nested');

export function parseYaml(text) {
  const entries = [];
  for (const raw of text.split('\n')) {
    const line = stripComment(raw);
    if (line.trim() === '') continue;
    const indent = line.length - line.trimStart().length;
    const body = line.trim();
    const colon = body.indexOf(':');
    if (colon === -1) throw new Error(`Invalid YAML line: ${raw}`);
    const key = body.slice(0, colon).trim();
    const valuePart = body.slice(colon + 1).trim();
    entries.push({ indent, key, value: parseValue(valuePart) });
  }
  const [obj] = build(entries, 0, entries.length ? entries[0].indent : 0);
  return obj;
}

function build(entries, start, indent) {
  const obj = {};
  let i = start;
  while (i < entries.length) {
    const e = entries[i];
    if (e.indent < indent) break;
    if (e.value === NESTED) {
      const childIndent = entries[i + 1]?.indent ?? indent + 2;
      const [child, next] = build(entries, i + 1, childIndent);
      obj[e.key] = child;
      i = next;
    } else {
      obj[e.key] = e.value;
      i++;
    }
  }
  return [obj, i];
}

function parseValue(str) {
  if (str === '') return NESTED;
  if (str.startsWith('[') && str.endsWith(']')) {
    const inner = str.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map((s) => coerce(s.trim()));
  }
  return coerce(str);
}

function coerce(str) {
  if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
    return str.slice(1, -1);
  }
  if (/^-?\d+$/.test(str)) return Number(str);
  if (str === 'true') return true;
  if (str === 'false') return false;
  return str;
}

// Remove a trailing `# comment` that is not inside quotes (YAML requires a space
// before the #, or the # to start the line).
function stripComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '#' && !inSingle && !inDouble && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}
