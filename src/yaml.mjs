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
  if (str.length >= 2 && str.startsWith('"') && str.endsWith('"')) {
    return unescapeDouble(str.slice(1, -1));
  }
  if (str.length >= 2 && str.startsWith("'") && str.endsWith("'")) {
    return str.slice(1, -1).replace(/''/g, "'");
  }
  if (/^-?\d+$/.test(str)) return Number(str);
  if (str === 'true') return true;
  if (str === 'false') return false;
  return str;
}

const DQ_ESCAPES = { '"': '"', '\\': '\\', n: '\n', t: '\t' };

function unescapeDouble(s) {
  return s.replace(/\\(["\\nt])/g, (_, c) => DQ_ESCAPES[c]);
}

// Serializes a scalar back to YAML for the supported subset, quoting only when a
// bare value would round-trip to a different type (number/bool), be truncated by
// a comment, parse as a mapping/sequence, or carry control/edge whitespace.
// Booleans and numbers serialize bare; everything else is treated as a string.
export function serializeScalar(value) {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  const s = String(value ?? '');
  return needsQuoting(s) ? quoteDouble(s) : s;
}

function needsQuoting(s) {
  if (s === '') return true;
  if (s !== s.trim()) return true; // leading/trailing whitespace
  if (/^-?\d+$/.test(s)) return true; // would coerce to a number
  if (s === 'true' || s === 'false') return true; // would coerce to a boolean
  if (/[\n\t]/.test(s)) return true; // control characters
  if (/(^#)|(\s#)/.test(s)) return true; // comment sequence
  if (/:(\s|$)/.test(s)) return true; // mapping indicator
  if (/^[[\]{}&*!|>'"%@`,?]/.test(s)) return true; // leading flow/indicator char
  return false;
}

function quoteDouble(s) {
  const esc = s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
  return `"${esc}"`;
}

// Remove a trailing `# comment` that is not inside quotes (YAML requires a space
// before the #, or the # to start the line).
function stripComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\' && inDouble) {
      i++; // skip the escaped character so `\"` does not close the string
      continue;
    }
    if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '#' && !inSingle && !inDouble && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}
