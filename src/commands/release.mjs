import fs from 'node:fs';
import path from 'node:path';
import { withFileLock, writeFileAtomic } from '../atomic-write.mjs';
import { writeLedgerFiles } from '../change-store.mjs';
import { assertSupportedSchema } from '../config-migration.mjs';
import { nowUtc } from '../paths.mjs';
import {
  bumpVersion,
  compareVersions,
  parseVersion,
  RELEASE_IMPACTS,
  resolveReleasesDir,
} from '../release.mjs';
import { loadRepo } from '../repo.mjs';
import { stringifyYaml } from '../yaml.mjs';

const IMPACT_RANK = new Map(RELEASE_IMPACTS.map((impact, index) => [impact, index]));
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

export function releasePlan(cwd = process.cwd()) {
  const repo = loadRepo(cwd);
  if (!repo.releases.length) {
    throw new Error(
      'Release history is not initialized. Run `changeledger release init <version>`.',
    );
  }

  const currentVersion = latestVersion(repo.releases);
  const releasedIds = new Set(
    repo.releases.flatMap((release) => release.changes ?? []).map(String),
  );
  const changes = repo.changes
    .filter((change) => change.frontmatter.status === 'done')
    .filter((change) => !releasedIds.has(String(change.frontmatter.id)))
    .map((change) => ({
      id: String(change.frontmatter.id),
      title: change.frontmatter.title,
      type: change.frontmatter.type,
      releaseImpact: effectiveImpact(change, repo.config),
    }));

  const impact = changes.reduce(
    (highest, change) =>
      IMPACT_RANK.get(change.releaseImpact) > IMPACT_RANK.get(highest)
        ? change.releaseImpact
        : highest,
    'none',
  );

  return {
    currentVersion,
    nextVersion: impact === 'none' ? null : bumpVersion(currentVersion, impact),
    impact,
    releasable: impact !== 'none',
    changes,
  };
}

export function initReleaseHistory(version, cwd = process.cwd(), now = nowUtc()) {
  parseVersion(version);
  assertTimestamp(now);
  const initial = loadRepo(cwd);
  assertSupportedSchema(initial.config);

  // Active: the true concurrency guard is the CAS write below (a stale
  // `expectedRevision` fails outright), so no worktree lock file is created —
  // one would be a write to a repo this path must leave untouched. Inactive:
  // the file lock is unchanged, guarding the check-then-write race a plain
  // filesystem otherwise allows.
  if (initial.state) {
    if (initial.releases.length) throw new Error('Release history is already initialized.');
    const manifest = {
      version,
      created: now,
      baseline: true,
      changes: initial.changes
        .filter((change) => change.frontmatter.status === 'done')
        .map((change) => String(change.frontmatter.id)),
    };
    writeNewManifest(initial, version, manifest);
    return { file: `releases/${version}.yml`, manifest };
  }

  const releasesDir = resolveReleasesDir(initial.repoRoot);
  fs.mkdirSync(releasesDir, { recursive: true });
  const historyLock = path.join(releasesDir, '.history');

  return withFileLock(historyLock, () => {
    const repo = loadRepo(cwd);
    if (repo.releases.length) throw new Error('Release history is already initialized.');
    const manifest = {
      version,
      created: now,
      baseline: true,
      changes: repo.changes
        .filter((change) => change.frontmatter.status === 'done')
        .map((change) => String(change.frontmatter.id)),
    };
    const file = path.join(releasesDir, `${version}.yml`);
    writeNewManifest(repo, version, manifest, file);
    return { file, manifest };
  });
}

export function recordRelease(version, cwd = process.cwd(), now = nowUtc()) {
  parseVersion(version);
  assertTimestamp(now);
  const initial = loadRepo(cwd);
  assertSupportedSchema(initial.config);

  if (initial.state) {
    const plan = releasePlan(cwd);
    if (!plan.releasable) throw new Error('No releasable changes (highest impact is none).');
    if (version !== plan.nextVersion) {
      throw new Error(`Version "${version}" does not match the calculated ${plan.nextVersion}.`);
    }
    const manifest = {
      version,
      created: now,
      changes: plan.changes.map((change) => change.id),
    };
    writeNewManifest(initial, version, manifest);
    return { file: `releases/${version}.yml`, manifest, plan };
  }

  const releasesDir = resolveReleasesDir(initial.repoRoot);
  const historyLock = path.join(releasesDir, '.history');

  return withFileLock(historyLock, () => {
    const plan = releasePlan(cwd);
    if (!plan.releasable) throw new Error('No releasable changes (highest impact is none).');
    if (version !== plan.nextVersion) {
      throw new Error(`Version "${version}" does not match the calculated ${plan.nextVersion}.`);
    }
    const manifest = {
      version,
      created: now,
      changes: plan.changes.map((change) => change.id),
    };
    const file = path.join(releasesDir, `${version}.yml`);
    writeNewManifest(null, version, manifest, file);
    return { file, manifest, plan };
  });
}

function latestVersion(releases) {
  return [...releases]
    .map((release) => release.version)
    .sort(compareVersions)
    .at(-1);
}

function effectiveImpact(change, config) {
  const override = change.frontmatter.release_impact;
  if (override !== undefined) {
    if (!RELEASE_IMPACTS.includes(override)) {
      throw new Error(`Change #${change.frontmatter.id} has invalid release_impact "${override}".`);
    }
    return override;
  }
  const impact = config.release?.impacts?.[change.frontmatter.type];
  if (!RELEASE_IMPACTS.includes(impact)) {
    throw new Error(
      `Change #${change.frontmatter.id} type "${change.frontmatter.type}" has no valid release impact; configure release.impacts.${change.frontmatter.type} or set release_impact.`,
    );
  }
  return impact;
}

// `repo` present (its `.state` truthy) routes through the store as one CAS
// commit; `repo` null/inactive keeps the original worktree write at `file`.
function writeNewManifest(repo, version, manifest, file) {
  const text = stringifyYaml(manifest);
  if (repo?.state) {
    const relPath = `releases/${version}.yml`;
    if (repo.releases.some((release) => release.name === `${version}.yml`)) {
      throw new Error(`Release manifest already exists: ${version}.yml`);
    }
    writeLedgerFiles(repo, [{ relPath, text }], { message: `release: ${version}` });
    return;
  }
  if (fs.existsSync(file))
    throw new Error(`Release manifest already exists: ${path.basename(file)}`);
  writeFileAtomic(file, text);
}

function assertTimestamp(value) {
  if (!ISO_UTC.test(value)) throw new Error(`Invalid release timestamp "${value}"`);
}
