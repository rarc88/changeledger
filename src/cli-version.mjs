// SemVer syntax and precedence for CLI versions. Pure and import-free: the
// viewer serves it to the browser (through `lifecycle.mjs`).

// Full SemVer syntax (semver.org), prereleases included: the running CLI can
// itself be a prerelease (e.g. "0.17.0-dev"), so a declaration it writes must
// be accepted. `release.mjs`'s `parseVersion` stays stricter on purpose:
// release manifests never carry a prerelease tag.
const FULL_SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

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
