// Source scanning shared by the guards that read the tree instead of trusting
// a hand-maintained list.
//
// `seatsCalling` parses. The first cut swept text with regexes and substrings,
// and review demonstrated five classes of silent miss on this tree: a seat in
// a `function*`, in a class method or behind `let` was attributed to whatever
// top-level declaration happened to precede it — and therefore reported under
// a name already in the inventory; an `import { x as y }` rename, an alias
// through a variable and a dynamic `import()` were invisible; `bin/` and the
// viewer's `.js` were never read; and a `//` inside a string or a `/*` inside
// a regex literal blanked real code. A guard whose product is confidence
// cannot carry five unnamed holes, so the scan moved to an AST.
//
// `callsTo` and `withoutComments` stay text-based: their one caller is the
// identity guard in `test/git.test.mjs`, which asks a different question of
// the TEST tree and was not part of what review falsified.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';

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
// numbers still match the original. Text-level and therefore blind to strings
// and regex literals — which is why the seat sweep no longer uses it.
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

// Production code, every extension and every directory it lives in. `bin/` is
// 1.283 lines of command wiring and the viewer ships `.js`; leaving either out
// made a seat there invisible.
const ROOTS = ['src', 'bin'];
const EXTENSIONS = ['.mjs', '.js'];

function sourceFiles() {
  const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
  const files = [];
  for (const root of ROOTS) {
    const base = path.join(repoRoot, root);
    if (!fs.existsSync(base)) continue;
    for (const entry of fs.readdirSync(base, { recursive: true })) {
      const name = String(entry);
      if (!EXTENSIONS.some((extension) => name.endsWith(extension))) continue;
      const full = path.join(base, name);
      if (!fs.statSync(full).isFile()) continue;
      files.push({
        // Posix-normalised: a seat name is compared against a literal in the
        // pinned inventory, and a Windows runner would otherwise report
        // `commands\agent.mjs` and fail on every entry at once.
        name: `${root}/${name.split(path.sep).join('/')}`,
        source: fs.readFileSync(full, 'utf8'),
      });
    }
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

const FUNCTION_NODES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

// The name a seat is reported under. Never a line number — that churns on
// every edit above it — and never "the last declaration at column zero",
// which is what attributed a generator's body to the function before it.
function nameOf(node, parent) {
  if (node.type === 'FunctionDeclaration') return node.id?.name ?? '(anonymous)';
  if (parent?.type === 'VariableDeclarator' && parent.id?.type === 'Identifier') {
    return parent.id.name;
  }
  if (parent?.type === 'MethodDefinition' || parent?.type === 'PropertyDefinition') {
    return parent.key?.name ?? parent.key?.value ?? '(computed)';
  }
  if (parent?.type === 'Property') return parent.key?.name ?? parent.key?.value ?? '(computed)';
  return '(anonymous)';
}

function walk(node, visit, stack = [], parent = null) {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit, stack, parent);
    return;
  }
  if (typeof node.type !== 'string') return;

  let scope = stack;
  if (FUNCTION_NODES.has(node.type)) {
    const owner = node.type === 'ClassDeclaration' ? null : nameOf(node, parent);
    scope = [...stack, owner];
  } else if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
    scope = [...stack, node.id?.name ?? '(anonymous class)'];
  }

  visit(node, scope, parent);
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue;
    walk(node[key], visit, scope, node);
  }
}

// Every local name bound to `primitive` in this module: the plain import, an
// `import { x as y }` rename, and a namespace import whose member access reads
// as `ns.primitive`.
function localBindings(ast, primitive) {
  const names = new Set();
  const namespaces = new Set();
  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration') continue;
    for (const spec of node.specifiers) {
      if (spec.type === 'ImportSpecifier' && spec.imported.name === primitive) {
        names.add(spec.local.name);
      }
      if (spec.type === 'ImportNamespaceSpecifier') namespaces.add(spec.local.name);
    }
  }
  return { names, namespaces };
}

function calleeName(callee, { names, namespaces }, primitive) {
  if (callee.type === 'Identifier' && names.has(callee.name)) return true;
  if (callee.type !== 'MemberExpression' || callee.computed) return false;
  if (callee.property?.name !== primitive) return false;
  // `ns.primitive(...)` only when `ns` is this module's namespace import, or
  // when nothing local shadows the name — an unrelated `holder.setArchived()`
  // on some other object is not a seat.
  return callee.object?.type === 'Identifier' && namespaces.has(callee.object.name);
}

// Every `file:function` that calls `primitive`, read from the AST. A call the
// walker cannot attribute to a named function is reported as
// `file:(module scope)` rather than dropped: a sweep that cannot name a seat
// must fail, not skip.
export function seatsCalling(primitive) {
  const seats = new Set();
  for (const { name, source } of sourceFiles()) {
    let ast;
    try {
      ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
    } catch (error) {
      throw new Error(`${name} does not parse, so its seats cannot be read: ${error.message}`);
    }
    const bindings = localBindings(ast, primitive);
    // A module that does not import the primitive cannot call it — except
    // through a dynamic `import()`, which is the one shape left unresolved and
    // is named as such in `test/seats.test.mjs`.
    if (bindings.names.size === 0 && bindings.namespaces.size === 0) continue;

    walk(ast, (node, scope) => {
      if (node.type !== 'CallExpression') return;
      if (!calleeName(node.callee, bindings, primitive)) return;
      // Anonymous frames are dropped, not appended: a callback inside
      // `archive` is part of that seat, not a seat of its own, and naming it
      // `archive.(anonymous)` would make every refactor of a callback read as
      // inventory drift. A class method keeps its owner — `Class.method`.
      const named = scope.filter((frame) => frame && frame !== '(anonymous)');
      seats.add(`${name}:${named.length ? named.join('.') : '(module scope)'}`);
    });
  }
  return seats;
}

// Every module that statically imports `primitive`, whatever it then does
// with the binding. Coarser than `seatsCalling` and sound where it is not: an
// alias through a local variable, a destructured re-bind or a call the walker
// cannot attribute still has to import the primitive first.
export function modulesImporting(primitive) {
  const modules = new Set();
  for (const { name, source } of sourceFiles()) {
    const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
    const { names, namespaces } = localBindings(ast, primitive);
    if (names.size || namespaces.size) modules.add(name);
  }
  return modules;
}

// The one way to reach a primitive without importing it: `await import(...)`
// resolved at run time. Returns the modules that both use a dynamic import
// and name one of `primitives`, so the hole is closed by a guard rather than
// left as a paragraph nobody executes.
export function modulesReachingDynamically(primitives) {
  const suspects = new Set();
  for (const { name, source } of sourceFiles()) {
    const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
    let dynamic = false;
    const mentioned = new Set();
    walk(ast, (node) => {
      if (node.type === 'ImportExpression') dynamic = true;
      if (node.type === 'Identifier' && primitives.includes(node.name)) mentioned.add(node.name);
      if (node.type === 'Literal' && primitives.includes(node.value)) mentioned.add(node.value);
    });
    if (dynamic && mentioned.size) suspects.add(`${name} (${[...mentioned].sort().join(', ')})`);
  }
  return suspects;
}
