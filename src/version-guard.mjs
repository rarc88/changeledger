// The repository's declared minimum CLI version (`min_cli_version`) against
// the installed one. Pure functions take the installed version as a parameter.
// No package manager output or network is consulted: the package version is the
// one stable fact about what is installed.

import { compareCliVersions, isValidCliVersion } from './cli-version.mjs';
import { loadEffectiveConfig } from './config.mjs';
import { readStateConfigText } from './state-store.mjs';
import { parseYaml } from './yaml.mjs';

// The key only exists from schema 6 on; older schemas keep their behavior.
const GUARDED_SCHEMA = 6;

export { compareCliVersions, isValidCliVersion };

// The declaration's own defect, or null. Shared with `check` so the command
// that validates a repo and the guard that refuses to work on it say the same.
export function minCliVersionDeclarationError(config) {
  if (!(config?.schema_version >= GUARDED_SCHEMA)) return null;
  const minVersion = config.min_cli_version;
  if (minVersion === undefined) {
    return 'config missing "min_cli_version" (required at schema 6)';
  }
  if (!isValidCliVersion(minVersion)) {
    return `config "min_cli_version" must be a concrete SemVer version; got ${JSON.stringify(minVersion)}`;
  }
  return null;
}

// Why `installedVersion` may not work on a repo with this effective config, or
// null when it may. A defective declaration fails closed.
export function cliVersionError(config, installedVersion) {
  if (!(config?.schema_version >= GUARDED_SCHEMA)) return null;
  const declarationError = minCliVersionDeclarationError(config);
  if (declarationError) return declarationError;
  const required = config.min_cli_version;
  if (compareCliVersions(installedVersion, required) >= 0) return null;
  return `ChangeLedger CLI ${installedVersion} is below this repository's minimum ${required}; update the global installation.`;
}

// Why `installedVersion` may not work on the repo rooted at `repoRoot`, or null
// when it may. Reads the effective config (the state ref once activated, never
// the worktree marker). An unreadable effective config declares no minimum to
// compare, so the guard stands aside: commands that actually need that config
// still fail when they load it themselves. `activate` can still reach a broken
// activation to repair it; it and `sync` compare the minimum of the revision
// they adopt themselves (`assertCliAdmitted` below).
export function repoCliVersionError(repoRoot, changeledgerDir, installedVersion) {
  let config;
  try {
    config = loadEffectiveConfig(repoRoot, changeledgerDir);
  } catch {
    return null;
  }
  return cliVersionError(config, installedVersion);
}

// Throws the guard's diagnostic when `installedVersion` may not work on the
// state `revision` declares. The `preAction` guard compares the effective config
// of the checkout as it is; a command about to make another revision
// authoritative (`activate` seeding or activating it, `sync` adopting a remote
// one) repeats the comparison on that revision before writing the ref that
// adopts it.
export function assertCliAdmitted(repoRoot, revision, installedVersion, run) {
  const config = parseYaml(readStateConfigText(repoRoot, { revision }, run));
  const message = cliVersionError(config, installedVersion);
  if (message) throw new Error(message);
}
