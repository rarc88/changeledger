import fs from 'node:fs';
import path from 'node:path';
import { resolveRepoPath } from './config.mjs';
import { parseYaml } from './yaml.mjs';

export const RELEASE_IMPACTS = ['none', 'patch', 'minor', 'major'];
export const DEFAULT_RELEASES_DIR = '.changeledger/releases';

const STABLE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseVersion(value) {
  const match = String(value ?? '').match(STABLE_SEMVER);
  if (!match) throw new Error(`Invalid stable SemVer "${value}" (expected X.Y.Z)`);
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function compareVersions(a, b) {
  const av = parseVersion(a);
  const bv = parseVersion(b);
  return av.major - bv.major || av.minor - bv.minor || av.patch - bv.patch;
}

export function bumpVersion(version, impact) {
  const current = parseVersion(version);
  if (!RELEASE_IMPACTS.includes(impact) || impact === 'none') {
    throw new Error(`Cannot bump version with release impact "${impact}"`);
  }
  if (impact === 'major') return `${current.major + 1}.0.0`;
  if (impact === 'minor') return `${current.major}.${current.minor + 1}.0`;
  return `${current.major}.${current.minor}.${current.patch + 1}`;
}

export function resolveReleasesDir(repoRoot) {
  return resolveRepoPath(repoRoot, DEFAULT_RELEASES_DIR, 'releases_dir');
}

// The single boundary of the return from `done` to `in-progress`, shared by
// `status` and the viewer's `reopen` so both refuse identically. A published
// release froze what that version contains, so the change can no longer grow;
// acceptance, graduation and archival are data or reversible, and gate nothing.
//
// `releases` are the manifests the ledger exposes — callers pass
// `loadRepo(...).releases`, never the `loadReleases` below, because that one
// reads `.changeledger/releases/` from the worktree and an activated repo keeps
// its manifests in the state ref with no such directory on disk: the lookup
// would silently answer "no release" for every change (20261018-131621 CR21).
export function assertNotShipped(releases, id) {
  const wanted = String(id);
  const release = (releases ?? []).find((candidate) =>
    (candidate.changes ?? []).some((changeId) => String(changeId) === wanted),
  );
  if (release) {
    throw new Error(
      `change ${id} shipped in release ${release.version}: new work needs a new change`,
    );
  }
}

export function loadReleases(repoRoot) {
  const releasesDir = resolveReleasesDir(repoRoot);
  const releases = [];
  if (!fs.existsSync(releasesDir)) return releases;
  for (const name of fs.readdirSync(releasesDir).sort()) {
    if (!name.endsWith('.yml')) continue;
    const file = path.join(releasesDir, name);
    try {
      releases.push({ file, name, ...parseYaml(fs.readFileSync(file, 'utf8')) });
    } catch (error) {
      throw new Error(`Invalid release manifest "${name}": ${error.message}`);
    }
  }
  return releases;
}

export async function loadReleasesAsync(repoRoot) {
  const releasesDir = resolveReleasesDir(repoRoot);
  const releases = [];
  try {
    const names = (await fs.promises.readdir(releasesDir)).sort();
    for (const name of names) {
      if (!name.endsWith('.yml')) continue;
      const file = path.join(releasesDir, name);
      try {
        releases.push({ file, name, ...parseYaml(await fs.promises.readFile(file, 'utf8')) });
      } catch (error) {
        throw new Error(`Invalid release manifest "${name}": ${error.message}`);
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return releases;
}
