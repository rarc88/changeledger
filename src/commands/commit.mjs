// Executable commit contract: composes the canonical `[#id]` marker and
// delegates to `git commit`, instead of relying on agents to remember the
// convention documented in prose (templates/contract/implement.md).

import fs from 'node:fs';
import path from 'node:path';
import { resolveRepoPath } from '../config.mjs';
import { gitPrefix, gitTopLevel, mutatingRun, stagedFiles } from '../git.mjs';
import { loadRepo } from '../repo.mjs';

const SUBJECT_RE = /^[a-zA-Z]+\([^()]+\):\s+\S.*/;
// The one name expected inside the changes directory without belonging to a
// declared change: the placeholder that lets an otherwise-empty directory be
// versioned. Matched as an exact basename, never as a pattern.
const GITKEEP = '.gitkeep';

// Absolute `target` with every symlink in its *existing* ancestry resolved, and
// the non-existent tail (a configured directory need not exist yet) appended
// back verbatim. Resolving only existing components is what makes this total; the
// gap it leaves cannot hide a symlink precisely because it does not exist.
// Applied only to paths this tool owns, never to a path read from the index.
function realpathNearest(target) {
  const tail = [];
  let current = path.resolve(target);
  for (;;) {
    try {
      return path.join(fs.realpathSync(current), ...tail);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(target);
      tail.unshift(path.basename(current));
      current = parent;
    }
  }
}

// `absPath` expressed the way Git reports a staged path. Ask the same outer
// repository that supplied the staged index for the existing ancestor's prefix
// and append only the non-existent tail; deriving the whole value with native
// path.relative() mixes Windows filesystem coordinates with Git's
// slash-delimited index coordinates.
function gitRelative(absPath, gitTop, run) {
  const tail = [];
  let current = path.resolve(absPath);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    tail.unshift(path.basename(current));
    current = parent;
  }
  const prefix = gitPrefix(fs.realpathSync(current), gitTop, run);
  const relative = `${prefix}${tail.join('/')}`;
  return relative.endsWith('/') ? relative.slice(0, -1) : relative;
}

// The raw string plus both its Unicode forms. Git precomposes a path to NFC
// before recording it (`core.precomposeunicode`, on by default on macOS) while
// the filesystem hands `readdir` back whatever it stored, which may be
// decomposed — so a declared document's own name legitimately reaches the
// comparison in either form. On a raw-byte platform (Linux, or with
// `core.precomposeunicode=false`) git reports exactly the raw form as read
// from disk instead, which need not equal either normalization of itself, so
// the raw string must be enrolled too. Enrolling all forms of the *expected*
// string is what keeps the comparison itself byte-identical, instead of
// normalizing the path git reported.
function unicodeForms(value) {
  return [...new Set([value, value.normalize('NFC'), value.normalize('NFD')])];
}

// Validates the subject, resolves the change id(s) to append, and creates the
// commit. Never invokes git unless the subject and id resolution both succeed
// — no partial/incorrect commit is ever created. Returns the final subject.
export function commit(
  { message, ids = [], noChange } = {},
  cwd = process.cwd(),
  run = mutatingRun,
  log = console.log,
) {
  if (noChange !== undefined && ids.length > 0) {
    throw new Error('--no-change and --id are mutually exclusive');
  }

  if (!message || !SUBJECT_RE.test(message)) {
    throw new Error(
      `Subject must follow the conventional form "type(scope): description", got: "${message ?? ''}"`,
    );
  }

  let noChangeReason;
  if (noChange !== undefined) {
    if (/[\r\n]/.test(noChange)) {
      throw new Error('--no-change reason must not contain a newline');
    }
    noChangeReason = noChange.trim();
    if (!noChangeReason) {
      throw new Error('--no-change requires a non-empty reason');
    }
  }

  const repo = loadRepo(cwd);
  // An explicit --no-change is a positive declaration and must not depend on
  // ambient repository state: id resolution (including the single-in-progress
  // auto-resolve) is skipped entirely, even when a change happens to be
  // in-progress, so the declaration's effect never varies with what else is
  // going on in the repo.
  let resolvedIds = ids;
  if (noChange === undefined && !resolvedIds.length) {
    const active = repo.changes.filter((c) => c.frontmatter.status === 'in-progress');
    if (active.length !== 1) {
      if (active.length === 0) {
        throw new Error('No change is in-progress; pass --id <change-id> explicitly.');
      }
      const candidates = active.map((c) => c.frontmatter.id).join(', ');
      throw new Error(
        `Ambiguous: ${active.length} changes are in-progress (${candidates}); pass --id <change-id> explicitly.`,
      );
    }
    resolvedIds = [active[0].frontmatter.id];
  }

  // Read the index from git's own top-level directory, so the paths git reports
  // and the paths computed here share one coordinate system no matter where
  // `.changeledger` sits or what `diff.relative` says.
  const gitTopReal = realpathNearest(gitTopLevel(repo.repoRoot, run));
  const staged = stagedFiles(gitTopReal, run);
  log(`Staged: ${staged.join(', ')}`);

  // An exact allowlist, not a classifier. Three earlier strategies tried to
  // decide what an arbitrary staged path *is* — a `*.md` document? a collapsed
  // rename? an escaped form? which case? — and every axis one of them closed
  // opened a hole on another, because classifying strings the surrounding repo
  // controls is permeable by construction. So the question is inverted: compute
  // the exact strings git would report and abort on every staged entry under
  // the changes directory that is not one of them byte for byte. This
  // deliberately aborts on an unexpected-but-harmless entry (a `.DS_Store`, an
  // atomic-write leftover) rather than deciding it is safe to ignore; the error
  // names it. Inactive repos allow each declared change document plus .gitkeep.
  // Activated repos allow only .gitkeep: their selected documents live in the
  // state ref and must never be staged from a stale worktree, but the same
  // fail-closed directory boundary still applies.
  const changesDirRel = gitRelative(
    resolveRepoPath(repo.repoRoot, repo.config.changes_dir, 'changes_dir'),
    gitTopReal,
    run,
  );
  // A `changes_dir` that resolves to the repo root collapses the prefix this
  // guard matches against to the empty string: no staged path (git never
  // reports a leading `/`) would ever start with it, so every staged file
  // would silently sail through unjudged instead of being scrutinized. Abort
  // and name the collapse rather than commit with the guard muted (CR9).
  if (changesDirRel === '') {
    throw new Error(
      `changes_dir "${repo.config.changes_dir}" resolves to the repo root; the commit guard cannot judge staged paths — configure changes_dir to a subdirectory`,
    );
  }
  const expected = new Set(unicodeForms(`${changesDirRel}/${GITKEEP}`));
  if (!repo.state) {
    for (const change of repo.changes) {
      if (!resolvedIds.includes(String(change.frontmatter.id))) continue;
      for (const form of unicodeForms(`${changesDirRel}/${change.name}`)) expected.add(form);
    }
  }
  const prefixes = unicodeForms(`${changesDirRel}/`);
  // Case-insensitive always: a normal `git add` cannot fabricate a mis-cased
  // changes-directory path on a case-folding filesystem (git folds it), so the
  // only real vector is an index write that bypasses the worktree entirely
  // (`update-index --cacheinfo`, or a rebase/cherry-pick carrying a mis-cased
  // tree entry) — same on every platform. Normalizing unconditionally judges
  // that path exactly like its canonically-cased twin, on case-sensitive
  // filesystems too, instead of trusting a host-detection that the index
  // write already sidesteps.
  // Lowercasing widens only the judged scope (fail-closed): a mis-cased path
  // under the changes directory is still judged. The whitelist stays exact —
  // folding `expected` too would accept a mis-cased twin of a declared
  // document on case-sensitive filesystems, trading one bypass for another.
  const caseKey = (value) => value.toLowerCase();
  const prefixKeys = prefixes.map(caseKey);
  const undeclared = staged.filter(
    (file) => prefixKeys.some((prefix) => caseKey(file).startsWith(prefix)) && !expected.has(file),
  );
  if (undeclared.length) {
    const declared = repo.state ? '' : ` (declared: ${resolvedIds.join(', ')})`;
    throw new Error(
      `Staged path(s) under the changes directory not declared for this commit: ${undeclared.join(', ')}${declared}`,
    );
  }

  let subject;
  let args;
  if (noChange !== undefined) {
    // Em dash, single space either side — must match NONE_REASON_RE in
    // src/git.mjs byte for byte. bodyDeclaration() reads only the body's first
    // line, so this declaration must occupy that line on its own — never
    // sharing it with other content — but a free-text tail after it is fine;
    // only a second declaration there would blend with it.
    subject = message;
    args = ['commit', '-m', subject, '-m', `ChangeLedger: none — ${noChangeReason}`];
  } else {
    const markers = resolvedIds.map((id) => `[#${id}]`).join(' ');
    const multiple = resolvedIds.length > 1;
    subject = multiple ? message : `${message} ${markers}`;
    args = multiple
      ? ['commit', '-m', subject, '-m', `ChangeLedger: ${markers}`]
      : ['commit', '-m', subject];
  }
  run(args, repo.repoRoot);
  return subject;
}
