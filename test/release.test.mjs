import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkRepo } from '../src/check.mjs';
import { initReleaseHistory, recordRelease, releasePlan } from '../src/commands/release.mjs';
import { bumpVersion } from '../src/release.mjs';
import { loadRepo } from '../src/repo.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-release-'));
  fs.mkdirSync(path.join(root, '.changeledger', 'changes'), { recursive: true });
  fs.copyFileSync(
    path.join(projectRoot, 'templates', 'config.yml'),
    path.join(root, '.changeledger', 'config.yml'),
  );
  return root;
}

function writeChange(root, id, options = {}) {
  const {
    status = 'done',
    type = 'feature',
    impact,
    archived = false,
    title = `Change ${id}`,
  } = options;
  const optional = [
    archived ? 'archived: true' : '',
    impact === undefined ? '' : `release_impact: ${impact}`,
  ]
    .filter(Boolean)
    .join('\n');
  const text = `---
id: "${id}"
title: ${title}
type: ${type}
status: ${status}
created: 2026-06-24T00:00:00Z
depends_on: []
${optional}
---

## Request

X
`;
  const file = path.join(root, '.changeledger', 'changes', `${id}-x.md`);
  fs.writeFileSync(file, text);
  return file;
}

test('CR1: release init creates one baseline with all current done changes', () => {
  const root = fixture();
  writeChange(root, '20260624-000001');
  writeChange(root, '20260624-000002', { status: 'draft' });

  const result = initReleaseHistory('0.1.0', root, '2026-06-24T01:00:00Z');
  assert.deepEqual(result.manifest.changes, ['20260624-000001']);
  assert.equal(result.manifest.baseline, true);
  assert.throws(() => initReleaseHistory('0.1.0', root), /already initialized/);
  assert.equal(loadRepo(root).releases.length, 1);
});

test('CR2/CR3: plan includes unreleased done changes and resolves overrides', () => {
  const root = fixture();
  writeChange(root, '20260624-000001');
  initReleaseHistory('0.1.0', root, '2026-06-24T01:00:00Z');
  writeChange(root, '20260624-000002', { type: 'bug', archived: true });
  writeChange(root, '20260624-000003', { type: 'refactor', impact: 'major' });
  writeChange(root, '20260624-000004', { status: 'in-progress' });

  const plan = releasePlan(root);
  assert.deepEqual(
    plan.changes.map((change) => change.id),
    ['20260624-000002', '20260624-000003'],
  );
  assert.deepEqual(
    plan.changes.map((change) => change.releaseImpact),
    ['patch', 'major'],
  );
  assert.equal(plan.impact, 'major');
  assert.equal(plan.nextVersion, '1.0.0');
});

test('CR3: plan rejects a type without a default or override', () => {
  const root = fixture();
  initReleaseHistory('0.1.0', root);
  writeChange(root, '20260624-000001');
  const configFile = path.join(root, '.changeledger', 'config.yml');
  fs.writeFileSync(
    configFile,
    fs.readFileSync(configFile, 'utf8').replace('    feature: minor\n', ''),
  );
  assert.throws(() => releasePlan(root), /has no valid release impact/);
});

test('CR4: stable SemVer bumping resets lower components, including 0.x major', () => {
  assert.equal(bumpVersion('2.3.4', 'patch'), '2.3.5');
  assert.equal(bumpVersion('2.3.4', 'minor'), '2.4.0');
  assert.equal(bumpVersion('0.4.9', 'major'), '1.0.0');
  assert.throws(() => bumpVersion('01.2.3', 'patch'), /stable SemVer/);
});

test('CR5/CR6: plan is read-only and none-only work is a successful no-op', () => {
  const root = fixture();
  initReleaseHistory('0.1.0', root);
  writeChange(root, '20260624-000001', { type: 'chore' });
  const before = fs.readdirSync(path.join(root, '.changeledger', 'releases'));
  const plan = releasePlan(root);
  assert.equal(plan.releasable, false);
  assert.equal(plan.nextVersion, null);
  assert.equal(plan.impact, 'none');
  assert.deepEqual(fs.readdirSync(path.join(root, '.changeledger', 'releases')), before);
});

test('CR7/CR8: record is exact and atomic without touching stack manifests', () => {
  const root = fixture();
  const packageFile = path.join(root, 'package.json');
  fs.writeFileSync(packageFile, '{"version":"9.9.9"}\n');
  initReleaseHistory('0.1.0', root);
  writeChange(root, '20260624-000001', { type: 'bug' });

  assert.throws(() => recordRelease('0.3.0', root), /calculated 0.1.1/);
  assert.equal(fs.existsSync(path.join(root, '.changeledger', 'releases', '0.3.0.yml')), false);
  const result = recordRelease('0.1.1', root, '2026-06-24T02:00:00Z');
  assert.deepEqual(result.manifest.changes, ['20260624-000001']);
  assert.equal(fs.readFileSync(packageFile, 'utf8'), '{"version":"9.9.9"}\n');
  assert.throws(() => recordRelease('0.1.1', root), /No releasable changes/);
});

test('CR9: check validates release impact and manifest consistency', () => {
  const root = fixture();
  const file = writeChange(root, '20260624-000001', { impact: 'banana' });
  const repo = loadRepo(root);
  repo.releases = [
    {
      name: 'wrong.yml',
      version: '0.1.0',
      created: 'not-a-date',
      changes: ['missing', 'missing'],
    },
  ];
  const errors = checkRepo(repo).errors;
  const messages = errors.map((error) => error.message);
  assert.ok(
    errors.some(
      (error) =>
        error.file === path.basename(file) && /release_impact "banana" must be/.test(error.message),
    ),
  );
  assert.ok(messages.some((message) => /filename must match version/.test(message)));
  assert.ok(messages.some((message) => /created not ISO/.test(message)));
  assert.ok(messages.some((message) => /references missing change/.test(message)));
  assert.ok(messages.some((message) => /contains duplicate change/.test(message)));
});

test('CR9: invalid configured impacts identify config file and exact value', () => {
  const root = fixture();
  const repo = loadRepo(root);
  repo.config.release.impacts.feature = 'banana';
  const error = checkRepo(repo).errors.find((item) => /release impact/.test(item.message));
  assert.equal(error.file, '.changeledger/config.yml');
  assert.match(error.message, /"banana"/);
  assert.match(error.message, /"feature"/);
});

test('CR9: check rejects repeated baselines and non-done released changes', () => {
  const root = fixture();
  writeChange(root, '20260624-000001', { status: 'draft' });
  const repo = loadRepo(root);
  repo.releases = [
    {
      name: '0.1.0.yml',
      version: '0.1.0',
      created: '2026-06-24T00:00:00Z',
      baseline: true,
      changes: ['20260624-000001'],
    },
    {
      name: '0.2.0.yml',
      version: '0.2.0',
      created: '2026-06-24T01:00:00Z',
      baseline: true,
      changes: [],
    },
  ];
  const messages = checkRepo(repo).errors.map((error) => error.message);
  assert.ok(messages.some((message) => /status is not done/.test(message)));
  assert.ok(messages.some((message) => /multiple baselines/.test(message)));
});
