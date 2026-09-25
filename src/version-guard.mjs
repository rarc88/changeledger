// The repository's declared minimum CLI version (`min_cli_version`) against
// the installed one. Pure functions take the installed version as a parameter.
// No package manager output or network is consulted: the package version is the
// one stable fact about what is installed.

import { loadEffectiveConfig } from './config.mjs';

// Full SemVer syntax (semver.org), prereleases included: the running CLI can
// itself be a prerelease (e.g. "0.17.0-dev"), so a declaration it writes must
// be accepted. `release.mjs`'s `parseVersion` stays stricter on purpose:
// release manifests never carry a prerelease tag.
const FULL_SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

// The key only exists from schema 6 on; older schemas keep their behavior.
const GUARDED_SCHEMA = 6;

export function isValidCliVersion(value) {
  return typeof value === 'string' && FULL_SEMVER.test(value);
}

function parseCliVersion(value) {
  const match = typeof value === 'string' ? value.match(FULL_SEMVER) : null;
  if (!match) throw new Error(`not a SemVer version: ${JSON.stringify(value)}`);
  return {
    core: [match[1], match[2], match[3]].map(Number),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  };
}

const NUMERIC = /^\d+$/;

function compareIdentifiers(a, b) {
  const aNumeric = NUMERIC.test(a);
  const bNumeric = NUMERIC.test(b);
  if (aNumeric && bNumeric) return Math.sign(Number(a) - Number(b));
  if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

// SemVer precedence (semver.org §11): -1, 0 or 1. Build metadata is ignored and
// a prerelease sorts below its release, so "0.17.0-dev" < "0.17.0".
export function compareCliVersions(a, b) {
  const left = parseCliVersion(a);
  const right = parseCliVersion(b);
  for (let i = 0; i < 3; i++) {
    if (left.core[i] !== right.core[i]) return Math.sign(left.core[i] - right.core[i]);
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return Math.sign(right.prerelease.length - left.prerelease.length);
  }
  const length = Math.min(left.prerelease.length, right.prerelease.length);
  for (let i = 0; i < length; i++) {
    const order = compareIdentifiers(left.prerelease[i], right.prerelease[i]);
    if (order !== 0) return order;
  }
  return Math.sign(left.prerelease.length - right.prerelease.length);
}

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
