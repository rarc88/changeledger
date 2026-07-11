// Executable commit contract: composes the canonical `[#id]` marker and
// delegates to `git commit`, instead of relying on agents to remember the
// convention documented in prose (templates/contract/implement.md).

import { mutatingRun } from '../git.mjs';
import { loadRepo } from '../repo.mjs';

const SUBJECT_RE = /^[a-zA-Z]+\([^()]+\):\s+\S.*/;

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

  const subject = `${message} ${resolvedIds.map((id) => `[#${id}]`).join(' ')}`;
  run(['commit', '-m', subject], repo.repoRoot);
  return subject;
}
