// Source scanning shared by the guards that read the tree instead of trusting
// a hand-maintained list. `callsTo` came from `test/git.test.mjs`, where it
// backs the identity-injection guard; `test/seats.test.mjs` needs the same
// reader, and a second copy would be the duplication that guard exists to
// prevent.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Extracts the full text of every `<name>(` call in `source`, balancing
// parentheses so a call spread over several lines is read whole. Returns
// `{ start, end, line, text }` per call, so a violation can be reported where
// it lives.
export function callsTo(source, name) {
  const calls = [];
  const opener = `${name}(`;
  for (let at = source.indexOf(opener); at !== -1; at = source.indexOf(opener, at + 1)) {
    // `setStatus(` must not match `unsetStatus(`: the opener is a suffix of the
    // longer name, and `indexOf` does not know about identifier boundaries.
    if (at > 0 && /[\w$]/.test(source[at - 1])) continue;
    let depth = 0;
    let end = at + opener.length - 1;
    for (; end < source.length; end += 1) {
      if (source[end] === '(') depth += 1;
      else if (source[end] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    calls.push({
      start: at,
      end,
      line: source.slice(0, at).split('\n').length,
      text: source.slice(at, end + 1),
    });
  }
  return calls;
}

// Blanks every comment, preserving length and newlines so offsets and line
// numbers still match the original. A seat named in prose is not a seat, and
// the sweeps below would otherwise count every explanatory mention of a
// primitive as a caller.
export function withoutComments(source) {
  let out = '';
  let state = 'code';
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    const next = source[i + 1];
    if (state === 'code') {
      if (c === '/' && next === '/') {
        state = 'line';
        out += '  ';
        i += 1;
      } else if (c === '/' && next === '*') {
        state = 'block';
        out += '  ';
        i += 1;
      } else {
        out += c;
      }
      continue;
    }
    if (state === 'line') {
      if (c === '\n') {
        state = 'code';
        out += '\n';
      } else out += ' ';
      continue;
    }
    if (c === '*' && next === '/') {
      state = 'code';
      out += '  ';
      i += 1;
    } else out += c === '\n' ? '\n' : ' ';
  }
  return out;
}

const DECLARATION =
  /^(?:export\s+)?(?:async\s+)?(?:function\s+([A-Za-z_$][\w$]*)|const\s+([A-Za-z_$][\w$]*)\s*=)/gm;

// The top-level declaration a position sits inside: the last one that opens at
// column zero before it. Nested arrows resolve to their enclosing export, which
// is the granularity a seat is named at — `file:function`, never `file:line`,
// because a line number churns on every edit above it.
export function enclosingDeclaration(source, index) {
  let name = null;
  DECLARATION.lastIndex = 0;
  for (let m = DECLARATION.exec(source); m !== null; m = DECLARATION.exec(source)) {
    if (m.index > index) break;
    name = m[1] ?? m[2];
  }
  return name;
}

export function sourceFiles(root = 'src') {
  const base = path.join(fileURLToPath(new URL('../../', import.meta.url)), root);
  return fs
    .readdirSync(base, { recursive: true })
    .map(String)
    .filter((name) => name.endsWith('.mjs'))
    .sort()
    .map((name) => ({
      // Posix-normalised: a seat name is compared against a literal in the
      // pinned inventory, and a Windows runner would otherwise report
      // `commands\agent.mjs` and fail on every entry at once.
      name: `${root}/${name.split(path.sep).join('/')}`,
      source: fs.readFileSync(path.join(base, name), 'utf8'),
    }));
}

// Every `file:function` that calls `primitive`, read from the tree. The
// primitive's own definition is not a call of it, and neither is a mention in
// a comment.
export function seatsCalling(primitive, root = 'src') {
  const seats = new Set();
  for (const { name, source } of sourceFiles(root)) {
    const scannable = withoutComments(source);
    for (const call of callsTo(scannable, primitive)) {
      const declaration = enclosingDeclaration(scannable, call.start);
      if (!declaration || declaration === primitive) continue;
      seats.add(`${name}:${declaration}`);
    }
  }
  return seats;
}
