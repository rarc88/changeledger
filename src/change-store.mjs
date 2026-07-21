import { mutateFileAtomic } from './atomic-write.mjs';
import { stateConfig } from './config.mjs';
import { assertSupportedSchema } from './config-migration.mjs';
import { objectRun } from './git.mjs';
import { assertRepoStateWritable } from './repo.mjs';
import { mutateStateChange } from './state-store.mjs';

export function mutateResolvedChange(
  resolved,
  mutate,
  { operation = 'update', actor = 'unknown' } = {},
) {
  assertSupportedSchema(resolved.config);
  const active = stateConfig(resolved.config);
  if (!active) {
    mutateFileAtomic(resolved.file, mutate);
    return { file: resolved.file, pending: false };
  }
  assertRepoStateWritable(resolved);
  const traceCode =
    /^(status:in-progress|status:in-review|status:in-validation|review:|validation:|graduate|fix)/.test(
      operation,
    );
  let codeRevision;
  let codeBranch;
  if (traceCode) {
    codeRevision = objectRun(['rev-parse', 'HEAD'], resolved.repoRoot).trim();
    const message = objectRun(['show', '-s', '--format=%B', codeRevision], resolved.repoRoot);
    const marker = `[#${resolved.change.frontmatter.id}]`;
    if (operation !== 'status:in-progress' && !message.includes(marker)) {
      throw new Error(
        `cannot record code traceability: revision ${codeRevision} lacks change marker ${marker}`,
      );
    }
    codeBranch = objectRun(['branch', '--show-current'], resolved.repoRoot).trim();
  }
  const result = mutateStateChange({
    repoRoot: resolved.repoRoot,
    branch: active.branch,
    id: resolved.change.frontmatter.id,
    expectedHead: resolved.state.head,
    operation,
    actor,
    codeRevision,
    codeBranch,
    mutate,
  });
  return { file: resolved.file, ...result };
}

export function assertResolvedOwner(resolved, actor) {
  if (!stateConfig(resolved.config)) return;
  const owner = resolved.change.frontmatter.owner;
  if (!owner) throw new Error(`change #${resolved.change.frontmatter.id} has no owner`);
  if (!actor || actor !== owner) {
    throw new Error(
      `change #${resolved.change.frontmatter.id} is owned by "${owner}"; transfer ownership explicitly before continuing`,
    );
  }
}
