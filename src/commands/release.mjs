import fs from 'node:fs';
import path from 'node:path';
import { withFileLock, writeFileAtomic } from '../atomic-write.mjs';
import { assertSupportedSchema } from '../config-migration.mjs';
import { loadLedgerStore } from '../ledger-store.mjs';
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
  return planFor(loadRepo(cwd));
}

export function initReleaseHistory(version, cwd = process.cwd(), now = nowUtc()) {
  parseVersion(version);
  assertTimestamp(now);
  const initial = loadRepo(cwd);
  assertSupportedSchema(initial.config);
  const store = loadLedgerStore(cwd);
  if (store.mode === 'state') {
    if (initial.releases.length) throw new Error('Release history is already initialized.');
    let manifest;
    const statePath = `.changeledger-state/releases/${version}.yml`;
    const after = store.mutate(
      { message: `changeledger: release init ${version}` },
      ({ snapshot, write }) => {
        if (snapshot.releases.length) throw new Error('Release history is already initialized.');
        manifest = {
          version,
          created: now,
          baseline: true,
          changes: snapshot.changes
            .filter((change) => change.frontmatter.status === 'done')
            .map((change) => String(change.frontmatter.id)),
        };
        write(statePath, stringifyYaml(manifest));
      },
    );
    return {
      file: after.releases.find((release) => release.name === `${version}.yml`)?.file,
      manifest,
    };
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
    writeNewManifest(file, manifest);
    return { file, manifest };
  });
}

export function recordRelease(version, cwd = process.cwd(), now = nowUtc()) {
  parseVersion(version);
  assertTimestamp(now);
  const initial = loadRepo(cwd);
  assertSupportedSchema(initial.config);
  const store = loadLedgerStore(cwd);
  if (store.mode === 'state') {
    const plan = releasePlan(cwd);
    if (!plan.releasable) throw new Error('No releasable changes (highest impact is none).');
    if (version !== plan.nextVersion) {
      throw new Error(`Version "${version}" does not match the calculated ${plan.nextVersion}.`);
    }
    let manifest;
    let committedPlan;
    const statePath = `.changeledger-state/releases/${version}.yml`;
    const after = store.mutate(
      { message: `changeledger: release ${version}` },
      ({ snapshot, write }) => {
        const currentPlan = planFor(snapshot);
        if (!currentPlan.releasable || currentPlan.nextVersion !== version) {
          throw new Error('release plan changed concurrently; retry the operation');
        }
        if (snapshot.releases.some((release) => release.name === `${version}.yml`)) {
          throw new Error(`Release manifest already exists: ${version}.yml`);
        }
        committedPlan = currentPlan;
        manifest = {
          version,
          created: now,
          changes: currentPlan.changes.map((change) => change.id),
        };
        write(statePath, stringifyYaml(manifest));
      },
    );
    return {
      file: after.releases.find((release) => release.name === `${version}.yml`)?.file,
      manifest,
      plan: committedPlan,
    };
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
    writeNewManifest(file, manifest);
    return { file, manifest, plan };
  });
}

function planFor(repo) {
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

function writeNewManifest(file, manifest) {
  if (fs.existsSync(file))
    throw new Error(`Release manifest already exists: ${path.basename(file)}`);
  writeFileAtomic(file, stringifyYaml(manifest));
}

function assertTimestamp(value) {
  if (!ISO_UTC.test(value)) throw new Error(`Invalid release timestamp "${value}"`);
}
