// Single mutation seam for `.changeledger/**` content (20260808-151643,
// closing stage 1 of `global-state-scope.md`). Every mutator — the eleven in
// `commands/agent.mjs`, `commands/graduate.mjs`, `commands/fix.mjs`,
// `commands/release.mjs`, `commands/new.mjs`, and the viewer's three config
// writes — decides its target's shape once (a worktree `file` when inactive,
// a state-tree `relPath` when active) and then routes through here instead of
// calling `atomic-write.mjs` or `state-store.mjs` directly. Deciding the
// branch in exactly one place means the CAS conflict, the commit message
// convention and the cross-file atomicity all live in one seam instead of
// being reimplemented at each call site.

import fs from 'node:fs';
import path from 'node:path';
import { mutateFileAtomic, writeFileAtomic } from './atomic-write.mjs';
import { mutateState, readActivation } from './state-store.mjs';

// Cheap, subprocess-free gate before ever consulting git for activation —
// mirrors `repo.mjs`'s own (unexported) `isInsideGitRepo`: a directory built
// by `fs.mkdtempSync` with no `git init` anywhere above it — the shape every
// inactive fixture in this suite uses — must incur zero git subprocesses.
// Duplicated here rather than exported from `repo.mjs` because this module
// needs the same gate at a different call site: a mutator must decide its
// target's shape (worktree file vs. tree relPath) before it can even locate
// the document, whereas `loadRepo`'s gate only runs inside a read.
function isInsideGitRepo(repoRoot) {
  let dir = path.resolve(repoRoot);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return true;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

// Whether `repoRoot` is an activated ChangeLedger repo — `false` for a
// directory outside any git repo (zero subprocesses) or one with no
// activation record; never throws for either of those ordinary cases.
export function repoIsActivated(repoRoot, run) {
  return isInsideGitRepo(repoRoot) ? Boolean(readActivation(repoRoot, run)) : false;
}

// Mutates one ledger document. `target` carries whichever address the
// caller already resolved: `{ file }` (a worktree absolute path) for an
// inactive repo, or `{ relPath, text }` (the tree-relative path and the
// current text already read from the loaded snapshot at
// `repo.state.revision`) for an active one. `mutate` receives the current
// text and returns the next text, or `undefined` to skip the write —
// the same skip contract `mutateFileAtomic` already has.
export function mutateLedgerFile(repo, target, mutate, options = {}) {
  if (!repo.state) {
    return mutateFileAtomic(target.file, mutate, options);
  }
  const after = mutate(target.text);
  if (after === undefined) return undefined;
  writeLedgerFiles(repo, [{ relPath: target.relPath, text: after }], options);
  return after;
}

// Writes one or more ledger documents as a single unit. Inactive: each entry
// lands at its worktree `file` independently (today's mechanics — no
// cross-file atomicity, unchanged). Active: every entry's `relPath`/`text` is
// staged together and lands in exactly one CAS commit over
// `repo.state.revision` — this is what lets `graduate` retire its manual
// spec-write rollback in active mode instead of replicating it.
export function writeLedgerFiles(repo, entries, { message, run } = {}) {
  if (!repo.state) {
    for (const entry of entries) writeFileAtomic(entry.file, entry.text);
    return undefined;
  }
  if (typeof message !== 'string' || message === '') {
    throw new Error('writeLedgerFiles requires a commit message');
  }
  const mutator = (stage) => {
    for (const entry of entries) stage.write(entry.relPath, entry.text);
  };
  return run
    ? mutateState(repo.repoRoot, { expectedRevision: repo.state.revision, message }, mutator, run)
    : mutateState(repo.repoRoot, { expectedRevision: repo.state.revision, message }, mutator);
}
