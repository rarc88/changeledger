// Executable commit contract: composes the canonical `[#id]` marker and
// delegates to `git commit`, instead of relying on agents to remember the
// convention documented in prose (templates/contract/implement.md).

import path from 'node:path';
import { resolveRepoPath } from '../config.mjs';
import { mutatingRun, stagedFiles } from '../git.mjs';
import { loadRepo } from '../repo.mjs';

const SUBJECT_RE = /^[a-zA-Z]+\([^()]+\):\s+\S.*/;
// Change document filenames are `{id}-{slug}.md` with `id` in `YYYYMMDD-HHMMSS`
// form (see src/check.mjs's ID_FORM) — the id of a staged path under
// `changes_dir` is derivable from its own filename, no frontmatter parse needed.
const CHANGE_ID_PREFIX_RE = /^(\d{8}-\d{6})-/;

// True when `filePath` (repo-root-relative) falls under `dirRelative`
// (also repo-root-relative).
function isUnderDir(filePath, dirRelative) {
  const rel = path.relative(dirRelative, filePath);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// Validates the subject, resolves the change id(s) to append, and creates the
// commit. Never invokes git unless the subject and id resolution both succeed
// — no partial/incorrect commit is ever created. Returns the final subject.
export function commit({ message, ids = [] } = {}, cwd = process.cwd(), run = mutatingRun) {
  if (!message || !SUBJECT_RE.test(message)) {
    throw new Error(
      `Subject must follow the conventional form "type(scope): description", got: "${message ?? ''}"`,
    );
  }

  const repo = loadRepo(cwd);
  let resolvedIds = ids;
  if (!resolvedIds.length) {
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

  const staged = stagedFiles(repo.repoRoot, run);
  const changesDirRel = path.relative(
    repo.repoRoot,
    resolveRepoPath(repo.repoRoot, repo.config.changes_dir, 'changes_dir'),
  );
  const undeclared = staged.filter((file) => {
    if (!isUnderDir(file, changesDirRel)) return false;
    const match = path.basename(file).match(CHANGE_ID_PREFIX_RE);
    const id = match ? match[1] : path.basename(file);
    return !resolvedIds.includes(id);
  });
  if (undeclared.length) {
    throw new Error(
      `Staged change document(s) not declared for this commit: ${undeclared.join(', ')} (declared: ${resolvedIds.join(', ')})`,
    );
  }

  const markers = resolvedIds.map((id) => `[#${id}]`).join(' ');
  const multiple = resolvedIds.length > 1;
  const subject = multiple ? message : `${message} ${markers}`;
  const args = multiple
    ? ['commit', '-m', subject, '-m', `ChangeLedger: ${markers}`]
    : ['commit', '-m', subject];
  run(args, repo.repoRoot);
  return subject;
}
