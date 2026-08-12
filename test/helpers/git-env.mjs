// Shared hook-safety plumbing for every test fixture that shells out to a
// real `git`. Inside this repo's own pre-commit hook, git exports absolute
// GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE (and friends) pointing at the SHARED
// real repository. A fixture that runs `execFileSync('git', …, { cwd })`
// without stripping those inherits them and silently redirects writes past
// `cwd` into the real `.git` (e.g. `core.bare=true`, test identity in
// config) — this happened for real on 2026-08-10. Every fixture git
// invocation must route through `sanitizedEnv` (or `gitEnv`, its cwd-scoped
// alias below) so `cwd` is the only thing that decides which repo it hits.

export const GIT_LOCATION_ENV_VARS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_CEILING_DIRECTORIES',
];

// `extra` overlays additional entries (e.g. a scratch GIT_INDEX_FILE) after
// the location vars are stripped, so a caller can reintroduce exactly one of
// them on purpose without reopening the hole for the rest.
export function sanitizedEnv(extra) {
  const env = { ...process.env, LC_ALL: 'C' };
  for (const key of GIT_LOCATION_ENV_VARS) delete env[key];
  return extra ? { ...env, ...extra } : env;
}
