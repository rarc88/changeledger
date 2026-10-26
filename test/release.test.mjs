import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseChange } from '../src/change.mjs';
import { writeLedgerFiles } from '../src/change-store.mjs';
import { checkRepo } from '../src/check.mjs';
import { status } from '../src/commands/agent.mjs';
import { initReleaseHistory, recordRelease, releasePlan } from '../src/commands/release.mjs';
import { bumpVersion } from '../src/release.mjs';
import { loadRepo } from '../src/repo.mjs';
import { STATE_REF, STATE_ROOT, writeActivation } from '../src/state-store.mjs';
import { initGitFixture, sanitizedEnv } from './helpers/git-env.mjs';
import { buildTree, commitTree, updateRef } from './helpers/state-repo.mjs';

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
    type = 'change',
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

// Moves every worktree change built by `writeChange` into the state ref's
// snapshot and activates the repo; the worktree copies are removed, so a
// fallback read/write would fail outright.
function activate(root) {
  const changesDir = path.join(root, '.changeledger', 'changes');
  const files = {
    '.changeledger-state/manifest.yml': 'format_version: 1\nproject_id: demo\n',
    '.changeledger-state/config.yml': fs.readFileSync(
      path.join(root, '.changeledger', 'config.yml'),
      'utf8',
    ),
  };
  if (fs.existsSync(changesDir)) {
    for (const name of fs.readdirSync(changesDir)) {
      files[`.changeledger-state/changes/${name}`] = fs.readFileSync(
        path.join(changesDir, name),
        'utf8',
      );
    }
    fs.rmSync(changesDir, { recursive: true, force: true });
  }
  initGitFixture(root);
  const tree = buildTree(root, files);
  const revision = commitTree(root, tree, { message: 'chore: state' });
  updateRef(root, STATE_REF, revision);
  writeActivation(root, { stateRef: STATE_REF });
}

function stateRefTip(root) {
  return execFileSync('git', ['rev-parse', STATE_REF], {
    encoding: 'utf8',
    cwd: root,
    env: sanitizedEnv(),
  }).trim();
}

function stateDocText(root, revision, relPath) {
  return execFileSync('git', ['cat-file', 'blob', `${revision}:${STATE_ROOT}/${relPath}`], {
    encoding: 'utf8',
    cwd: root,
    env: sanitizedEnv(),
  });
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

test('161652 CR3: release writes reject a future schema before creating history', () => {
  for (const [name, record] of [
    ['init', (root) => initReleaseHistory('0.1.0', root, '2026-07-31T16:00:00Z')],
    ['record', (root) => recordRelease('0.1.1', root, '2026-07-31T16:00:00Z')],
  ]) {
    const root = fixture();
    const configFile = path.join(root, '.changeledger', 'config.yml');
    fs.writeFileSync(
      configFile,
      fs.readFileSync(configFile, 'utf8').replace(/^schema_version: \d+$/m, 'schema_version: 8'),
    );
    const releasesDir = path.join(root, '.changeledger', 'releases');
    assert.throws(
      () => record(root),
      /^Error: config schema 8 is newer than supported schema 7; update ChangeLedger before writing$/,
      name,
    );
    assert.equal(fs.existsSync(releasesDir), false, name);
  }
});

test('CR2/CR3: plan includes unreleased done changes and resolves overrides', () => {
  const root = fixture();
  writeChange(root, '20260624-000001');
  initReleaseHistory('0.1.0', root, '2026-06-24T01:00:00Z');
  writeChange(root, '20260624-000002', { archived: true });
  writeChange(root, '20260624-000003', { impact: 'major' });
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

test('CR3: plan rejects an invalid default impact', () => {
  const root = fixture();
  initReleaseHistory('0.1.0', root);
  writeChange(root, '20260624-000001');
  const configFile = path.join(root, '.changeledger', 'config.yml');
  fs.writeFileSync(
    configFile,
    fs
      .readFileSync(configFile, 'utf8')
      .replace(/^ {2}default_impact: .*$/m, '  default_impact: big'),
  );
  assert.throws(
    () => releasePlan(root),
    /^Error: config "release\.default_impact" must be one of: none, patch, minor, major$/,
  );
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
  writeChange(root, '20260624-000001', { type: 'epic' });
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
  writeChange(root, '20260624-000001');

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

test('CR9: an invalid default impact identifies the config file and the key', () => {
  const root = fixture();
  const repo = loadRepo(root);
  repo.config.release.default_impact = 'banana';
  const error = checkRepo(repo).errors.find((item) => /default_impact/.test(item.message));
  assert.equal(error.file, '.changeledger/config.yml');
  assert.equal(
    error.message,
    'config "release.default_impact" must be one of: none, patch, minor, major',
  );
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

// 20260808-151643 — active-mode routing.

test('CR1: release init on an active repo writes the manifest to the ref, one commit', () => {
  const root = fixture();
  writeChange(root, '20260624-000001');
  writeChange(root, '20260624-000002', { status: 'draft' });
  activate(root);
  const before = stateRefTip(root);

  const result = initReleaseHistory('0.1.0', root, '2026-06-24T01:00:00Z');

  assert.equal(result.file, 'releases/0.1.0.yml');
  const tip = stateRefTip(root);
  assert.notEqual(tip, before);
  assert.equal(
    execFileSync('git', ['rev-list', '--count', `${before}..${tip}`], {
      encoding: 'utf8',
      cwd: root,
      env: sanitizedEnv(),
    }).trim(),
    '1',
  );
  assert.match(stateDocText(root, tip, 'releases/0.1.0.yml'), /20260624-000001/);
  assert.throws(() => initReleaseHistory('0.1.0', root), /already initialized/);
  assert.equal(loadRepo(root).releases.length, 1);
  assert.equal(fs.existsSync(path.join(root, STATE_ROOT)), false);
});

test('CR7/CR8 (active): recordRelease on an active repo is exact and lands in one commit', () => {
  const root = fixture();
  writeChange(root, '20260624-000001', { impact: 'minor' });
  activate(root);
  initReleaseHistory('0.1.0', root, '2026-06-24T00:00:00Z');
  fs.mkdirSync(path.join(root, '.changeledger', 'changes'), { recursive: true });
  writeChange(root, '20260624-000002', { impact: 'patch' });
  // writeChange writes to a worktree the active repo no longer reads; move
  // the new change into the ref the same way `activate` did.
  const text = fs.readFileSync(
    path.join(root, '.changeledger', 'changes', '20260624-000002-x.md'),
    'utf8',
  );
  fs.rmSync(path.join(root, '.changeledger', 'changes'), { recursive: true, force: true });
  const before = stateRefTip(root);
  // seed via the real store seam so the tree bases on the current tip
  writeLedgerFiles(
    { repoRoot: root, state: { revision: before } },
    [{ relPath: 'changes/20260624-000002-x.md', text }],
    { message: 'chore: seed change' },
  );

  const beforeRecord = stateRefTip(root);
  const result = recordRelease('0.1.1', root, '2026-06-24T02:00:00Z');
  assert.deepEqual(result.manifest.changes, ['20260624-000002']);
  const tip = stateRefTip(root);
  assert.equal(
    execFileSync('git', ['rev-list', '--count', `${beforeRecord}..${tip}`], {
      encoding: 'utf8',
      cwd: root,
      env: sanitizedEnv(),
    }).trim(),
    '1',
  );
  assert.equal(fs.existsSync(path.join(root, STATE_ROOT)), false);
});

// 20261018-131621 — release membership is the only boundary of the return from
// `done` to `in-progress`, and it is read from the ledger in both layouts.

const RELEASED_VERSION = '0.19.0';

// `status` resolves git identity and the current checkout; these fixtures are
// plain directories, so both seams are stubbed out rather than left to the
// host's git.
const quiet = { ownerHandle: () => '', checkoutBranch: () => '' };

function writeReleaseFile(root, version, changes) {
  const dir = path.join(root, '.changeledger', 'releases');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${version}.yml`),
    `version: ${version}\ncreated: 2026-06-24T01:00:00Z\nchanges: [${changes.map((id) => `"${id}"`).join(', ')}]\n`,
  );
}

function shippedMessage(id, version) {
  return `change ${id} shipped in release ${version}: new work needs a new change`;
}

test('20261018-131621 CR7: a done change outside every release returns to in-progress', () => {
  const root = fixture();
  const id = '20260624-000001';
  const file = writeChange(root, id);
  writeReleaseFile(root, RELEASED_VERSION, ['20260624-999999']);

  status(id, 'in-progress', root, quiet);

  const parsed = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(parsed.frontmatter.status, 'in-progress');
  assert.match(
    parsed.stages.find((s) => s.key === 'log').body,
    /`\[status\]` done → in-progress \(human\)$/m,
  );
});

test('20261018-131621 CR8: accepted_at does not close the return to in-progress', () => {
  const root = fixture();
  const id = '20260624-000001';
  const file = writeChange(root, id);
  fs.writeFileSync(
    file,
    fs
      .readFileSync(file, 'utf8')
      .replace('depends_on: []', 'depends_on: []\naccepted_at: 2026-10-18T10:00:00Z'),
  );

  status(id, 'in-progress', root, quiet);

  const parsed = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(parsed.frontmatter.status, 'in-progress');
  assert.equal(parsed.frontmatter.accepted_at, '2026-10-18T10:00:00Z');
  assert.match(
    parsed.stages.find((s) => s.key === 'log').body,
    /`\[status\]` done → in-progress \(human\)$/m,
  );
});

test('20261018-131621 CR9: a change shipped in a release is refused, with or without a reason', () => {
  const root = fixture();
  const id = '20260624-000001';
  const file = writeChange(root, id);
  writeReleaseFile(root, RELEASED_VERSION, [id]);
  const before = fs.readFileSync(file, 'utf8');
  const expected = shippedMessage(id, RELEASED_VERSION);

  assert.throws(
    () => status(id, 'in-progress', root, quiet),
    (e) => e.message === expected,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before);

  // The viewer's seat is this same command carrying the human's reason
  // (20261018-131621 CR16); end to end it is pinned in test/view.test.mjs.
  assert.throws(
    () => status(id, 'in-progress', root, { ...quiet, reason: 'late' }),
    (e) => e.message === expected,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('20261018-131621 CR21: release membership is read from the ledger, not the worktree', () => {
  const root = fixture();
  const id = '20260624-000001';
  writeChange(root, id);
  activate(root);
  initReleaseHistory(RELEASED_VERSION, root, '2026-06-24T01:00:00Z');
  const before = stateRefTip(root);

  // The boundary that must hold: in an activated repo the manifest lives in the
  // state ref and `.changeledger/releases/` never exists, so a membership check
  // reading the worktree would find no releases and let the change back out.
  assert.equal(fs.existsSync(path.join(root, '.changeledger', 'releases')), false);
  assert.deepEqual(loadRepo(root).releases[0].changes, [id]);

  assert.throws(
    () => status(id, 'in-progress', root, quiet),
    (e) => e.message === shippedMessage(id, RELEASED_VERSION),
  );
  assert.equal(stateRefTip(root), before);
  assert.equal(fs.existsSync(path.join(root, '.changeledger', 'releases')), false);
});

// --- 20261024-121022: one default impact, one override per change ----------

function setDefaultImpact(root, impact) {
  const configFile = path.join(root, '.changeledger', 'config.yml');
  const text = fs.readFileSync(configFile, 'utf8');
  fs.writeFileSync(
    configFile,
    impact === undefined
      ? text.replace(/^release:\n {2}default_impact: .*\n/m, '')
      : text.replace(/^ {2}default_impact: .*$/m, `  default_impact: ${impact}`),
  );
}

test('20261024-121022 CR9: the default impact weighs a change, its override wins, and an epic weighs none', () => {
  const root = fixture();
  initReleaseHistory('0.1.0', root);
  setDefaultImpact(root, 'minor');
  writeChange(root, '20260624-000001');
  writeChange(root, '20260624-000002', { impact: 'patch' });
  writeChange(root, '20260624-000003', { type: 'epic' });
  // An epic's own `release_impact` does not count either: its children carry
  // the impact, so an override there would double it.
  writeChange(root, '20260624-000004', { type: 'epic', impact: 'major' });

  const plan = releasePlan(root);
  assert.deepEqual(
    plan.changes.map((change) => [change.id, change.releaseImpact]),
    [
      ['20260624-000001', 'minor'],
      ['20260624-000002', 'patch'],
      ['20260624-000003', 'none'],
      ['20260624-000004', 'none'],
    ],
  );
  assert.equal(plan.nextVersion, '0.2.0');
});

test('20261024-121022 CR9: without release.default_impact a change weighs patch', () => {
  const root = fixture();
  initReleaseHistory('0.1.0', root);
  setDefaultImpact(root, undefined);
  assert.equal(loadRepo(root).config.release, undefined);
  writeChange(root, '20260624-000001');
  const plan = releasePlan(root);
  assert.deepEqual(
    plan.changes.map((change) => change.releaseImpact),
    ['patch'],
  );
  assert.equal(plan.nextVersion, '0.1.1');
});
