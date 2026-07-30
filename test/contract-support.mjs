import fs from 'node:fs';
import path from 'node:path';

// The single seat of contract-fragment enumeration, shared by every suite that
// guards the contract. It exists because the enumeration was pasted eight times
// and three copies were still top-level-only: an exhaustive-negative guard —
// one that asserts a retired obligation appears in NO fragment — proves nothing
// about the seats it never looked at, and the `agent-contexts/` and
// `agent-prompts/` capsules are versioned and shipped to consuming repos
// exactly like the top-level fragments. With one seat, a ninth guard cannot be
// born blind, and widening the reach happens here for all of them at once.
//
// The directory is resolved from this module rather than from `src/paths.mjs` on
// purpose: a guard that took its search root from the code under test could be
// pointed somewhere else by that code and go on passing.
const contractDir = new URL('../templates/contract/', import.meta.url);

// Every `.md` fragment under `templates/contract/` at any depth, as paths
// relative to that directory with `/` separators on every platform, sorted. A
// by-filename read (`contractFragment`) is not this: it names its target, so it
// cannot be blind to one. An inventory that pins the file list may derive from
// this and keep its exact equalities — then the pinned lists are also this
// helper's own reach test.
export function contractFragmentNames() {
  return fs
    .readdirSync(contractDir, { recursive: true })
    .filter((name) => name.endsWith('.md'))
    .map((name) => name.split(path.sep).join('/'))
    .sort();
}
