import { mutateFileAtomic } from './atomic-write.mjs';
import { stateConfig } from './config.mjs';
import { assertSupportedSchema } from './config-migration.mjs';
import { objectRun } from './git.mjs';
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
  const result = mutateStateChange({
    repoRoot: resolved.repoRoot,
    branch: active.branch,
    id: resolved.change.frontmatter.id,
    expectedHead: resolved.state.head,
    operation,
    actor,
    codeRevision: objectRun(['rev-parse', 'HEAD'], resolved.repoRoot).trim(),
    codeBranch: objectRun(['branch', '--show-current'], resolved.repoRoot).trim(),
    mutate,
  });
  return { file: resolved.file, ...result };
}
