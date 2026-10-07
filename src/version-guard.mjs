// The repository's declared minimum CLI version (`min_cli_version`) against
// the installed one. Pure functions take the installed version as a parameter.
// No package manager output or network is consulted: the package version is the
// one stable fact about what is installed.

import { compareCliVersions, isValidCliVersion } from './cli-version.mjs';
import { loadEffectiveConfig } from './config.mjs';

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
// still fail when they load it themselves, and `activate` must stay able to
// repair a broken activation regardless.
export function repoCliVersionError(repoRoot, changeledgerDir, installedVersion) {
  let config;
  try {
    config = loadEffectiveConfig(repoRoot, changeledgerDir);
  } catch {
    return null;
  }
  return cliVersionError(config, installedVersion);
}
