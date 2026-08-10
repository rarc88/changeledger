import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  changeBranchFormat,
  effectiveConfigFromSnapshot,
  integrationBranch,
  loadEffectiveConfig,
  renderChangeBranch,
} from '../src/config.mjs';
import { readSnapshot, STATE_REF, writeActivation } from '../src/state-store.mjs';
import {
  buildTree,
  buildTreeEntries,
  commitTree,
  git,
  initStateRepo,
  updateRef,
} from './helpers/state-repo.mjs';

test('20260809-113242 CR8: loadEffectiveConfig keeps the worktree authority when inactive', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'config-inactive-'));
  const changeledgerDir = path.join(root, '.changeledger');
  fs.mkdirSync(changeledgerDir);
  fs.writeFileSync(path.join(changeledgerDir, 'config.yml'), 'project_name: worktree-name\n');

  assert.equal(loadEffectiveConfig(root, changeledgerDir).project_name, 'worktree-name');
});

test('20260809-113242 config authority: loadEffectiveConfig reads the activated state-ref blob', () => {
  const root = initStateRepo();
  const changeledgerDir = path.join(root, '.changeledger');
  fs.mkdirSync(changeledgerDir);
  fs.writeFileSync(path.join(changeledgerDir, 'config.yml'), 'project_name: stale-name\n');
  const tree = buildTree(root, {
    '.changeledger-state/manifest.yml': 'format_version: 1\nproject_id: demo\n',
    '.changeledger-state/config.yml': '# retained\nproject_name: ref-name\n',
  });
  const revision = commitTree(root, tree);
  updateRef(root, STATE_REF, revision);
  writeActivation(root, { stateRef: STATE_REF });

  assert.equal(loadEffectiveConfig(root, changeledgerDir).project_name, 'ref-name');
  assert.equal(
    loadEffectiveConfig(root, changeledgerDir, { raw: true }),
    '# retained\nproject_name: ref-name\n',
  );
});

// An activated host repo whose state ref owns `project_id: abc123`, plus a
// nested ChangeLedger project with no `.git` of its own: the activation probe
// walks up to the host, so only identity can tell the two ledgers apart.
function activatedHost({ marker = 'project_name: host-marker\n' } = {}) {
  const root = initStateRepo();
  const changeledgerDir = path.join(root, '.changeledger');
  fs.mkdirSync(changeledgerDir);
  fs.writeFileSync(path.join(changeledgerDir, 'config.yml'), marker);
  const tree = buildTree(root, {
    '.changeledger-state/manifest.yml': 'format_version: 1\nproject_id: abc123\n',
    '.changeledger-state/config.yml': '# retained\nproject_id: "abc123"\nproject_name: ref-name\n',
  });
  const revision = commitTree(root, tree);
  updateRef(root, STATE_REF, revision);
  writeActivation(root, { stateRef: STATE_REF });
  return { root, changeledgerDir, marker };
}

function nestedProject(
  root,
  { text = 'project_id: "nested99"\nproject_name: nested-name\n' } = {},
) {
  const repoRoot = path.join(root, 'nested');
  const changeledgerDir = path.join(repoRoot, '.changeledger');
  fs.mkdirSync(changeledgerDir, { recursive: true });
  fs.writeFileSync(path.join(changeledgerDir, 'config.yml'), text);
  return { repoRoot, changeledgerDir, text };
}

test('194234 CR1: a nested ledger reads its own config, not the host state ref', () => {
  const host = activatedHost();
  const nested = nestedProject(host.root);

  assert.equal(
    loadEffectiveConfig(nested.repoRoot, nested.changeledgerDir).project_name,
    'nested-name',
  );
  assert.equal(
    loadEffectiveConfig(nested.repoRoot, nested.changeledgerDir, { raw: true }),
    nested.text,
  );
  assert.equal(loadEffectiveConfig(host.root, host.changeledgerDir).project_name, 'ref-name');
});

// Location outranks identity: a `.changeledger` sitting directly under the git
// top-level is the repo's own ledger whatever its marker claims, so a stale
// `project_id` left in the worktree cannot make the repo disown its own state
// ref (the shape `20260809-113242` CR11 pins for the viewer's local mode).
test('194234 CR4: a top-level marker with a mismatched project_id still serves the ref', () => {
  const host = activatedHost({ marker: 'project_id: stale-id\nproject_name: stale-name\n' });

  assert.equal(loadEffectiveConfig(host.root, host.changeledgerDir).project_id, 'abc123');
  assert.equal(loadEffectiveConfig(host.root, host.changeledgerDir).project_name, 'ref-name');
  assert.equal(
    loadEffectiveConfig(host.root, host.changeledgerDir, { raw: true }),
    '# retained\nproject_id: "abc123"\nproject_name: ref-name\n',
  );
});

test('194234 CR2: the activated repo keeps the ref route on a divergent or malformed marker', () => {
  const authority = '# retained\nproject_id: "abc123"\nproject_name: ref-name\n';
  for (const [name, marker] of [
    ['divergent', 'project_id: "abc123"\nproject_name: divergent\n'],
    ['malformed', 'statuses: [\n'],
    ['no project_id', 'project_name: anonymous\n'],
  ]) {
    const host = activatedHost({ marker });

    assert.equal(
      loadEffectiveConfig(host.root, host.changeledgerDir).project_name,
      'ref-name',
      name,
    );
    assert.equal(
      loadEffectiveConfig(host.root, host.changeledgerDir, { raw: true }),
      authority,
      name,
    );
  }
});

// 20260809-194235 — `loadRepo`'s bootstrap derives the effective config from
// the snapshot it has already read, instead of enumerating the state tree a
// second time through `readStateConfigText`. That is only sound while both
// routes answer the identity question identically, so the equivalence is
// pinned here rather than argued: whatever the marker claims, and wherever it
// sits relative to the git top-level, the two must agree.
test('194235: the snapshot route resolves the config exactly as the text route', () => {
  for (const marker of [
    'project_id: "nested99"\nproject_name: nested-name\n', // claims another ledger
    'project_id: "abc123"\nproject_name: same-id\n', // same identity
    'project_name: anonymous\n', // claims no identity
    'statuses: [\n', // unparseable
    '- a\n- b\n', // not a mapping
  ]) {
    const host = activatedHost({ marker });
    const nested = nestedProject(host.root, { text: marker });

    for (const [where, repoRoot, changeledgerDir] of [
      ['top-level', host.root, host.changeledgerDir],
      ['nested', nested.repoRoot, nested.changeledgerDir],
    ]) {
      const label = `${where}: ${JSON.stringify(marker)}`;
      assert.deepEqual(
        effectiveConfigFromSnapshot(changeledgerDir, readSnapshot(repoRoot).config),
        loadEffectiveConfig(repoRoot, changeledgerDir),
        label,
      );
    }
  }
});

function activatedConfigEntries(entries) {
  const root = initStateRepo();
  const changeledgerDir = path.join(root, '.changeledger');
  fs.mkdirSync(changeledgerDir);
  fs.writeFileSync(path.join(changeledgerDir, 'config.yml'), 'project_name: worktree-fallback\n');
  const tree = buildTreeEntries(root, entries);
  const revision = commitTree(root, tree);
  updateRef(root, STATE_REF, revision);
  writeActivation(root, { stateRef: STATE_REF });
  return { root, changeledgerDir };
}

test('20260809-113242 CR9: active config rejects a symlink entry without worktree fallback', () => {
  const { root, changeledgerDir } = activatedConfigEntries([
    {
      path: '.changeledger-state/manifest.yml',
      text: 'format_version: 1\nproject_id: demo\n',
    },
    {
      path: '.changeledger-state/config.yml',
      mode: '120000',
      text: 'project_name: ref-name\n',
    },
  ]);

  assert.throws(
    () => loadEffectiveConfig(root, changeledgerDir),
    (error) =>
      error.message ===
      'tree contains unsupported Git entry 120000 blob at .changeledger-state/config.yml',
  );
});

test('20260809-113242 CR9: active raw config rejects invalid UTF-8 without worktree fallback', () => {
  const root = initStateRepo();
  const badOid = git(root, ['hash-object', '-w', '--stdin'], {
    input: Buffer.from([0xff, 0xfe]),
  });
  const changeledgerDir = path.join(root, '.changeledger');
  fs.mkdirSync(changeledgerDir);
  fs.writeFileSync(path.join(changeledgerDir, 'config.yml'), 'project_name: worktree-fallback\n');
  const tree = buildTreeEntries(root, [
    {
      path: '.changeledger-state/manifest.yml',
      text: 'format_version: 1\nproject_id: demo\n',
    },
    { path: '.changeledger-state/config.yml', oid: badOid },
  ]);
  const revision = commitTree(root, tree);
  updateRef(root, STATE_REF, revision);
  writeActivation(root, { stateRef: STATE_REF });

  assert.throws(
    () => loadEffectiveConfig(root, changeledgerDir, { raw: true }),
    (error) => error.message === 'state path .changeledger-state/config.yml is not valid UTF-8',
  );
});

test('20260809-113242 CR9: active config rejects a foreign state path without worktree fallback', () => {
  const { root, changeledgerDir } = activatedConfigEntries([
    {
      path: '.changeledger-state/manifest.yml',
      text: 'format_version: 1\nproject_id: demo\n',
    },
    { path: '.changeledger-state/config.yml', text: 'project_name: ref-name\n' },
    { path: 'foreign.txt', text: 'foreign\n' },
  ]);

  assert.throws(
    () => loadEffectiveConfig(root, changeledgerDir),
    (error) => error.message === 'invalid state path: foreign.txt',
  );
});

// 20260711-210115 CR1: optional `git.integration_branch` resolves from config.

test('210115 CR1: integrationBranch returns the configured branch', () => {
  assert.equal(integrationBranch({ git: { integration_branch: 'dev' } }), 'dev');
  assert.equal(integrationBranch({ git: { integration_branch: ' dev ' } }), 'dev');
});

test('210115 CR1: integrationBranch is undefined when the key is absent', () => {
  assert.equal(integrationBranch({}), undefined);
  assert.equal(integrationBranch({ git: {} }), undefined);
  assert.equal(integrationBranch({ git: { integration_branch: null } }), undefined);
  assert.equal(integrationBranch(undefined), undefined);
});

test('20260731-161654 CR1: integrationBranch rejects a non-mapping git section', () => {
  for (const git of ['dev', [], true]) {
    assert.throws(() => integrationBranch({ git }), /config "git" must be a mapping/);
  }
});

test('210115 CR1: integrationBranch fails fast on a non-string or empty value', () => {
  for (const bad of ['', '   ', 7, true, ['dev'], {}]) {
    assert.throws(
      () => integrationBranch({ git: { integration_branch: bad } }),
      /config "git\.integration_branch" must be a non-empty string/,
    );
  }
});

test('161655 CR1: change branch rendering is deterministic from immutable fields', () => {
  const config = { git: { change_branch_format: 'changes/{type}/{id}' } };
  const change = { type: 'feature', id: '20260731-161655' };

  assert.equal(changeBranchFormat(config), 'changes/{type}/{id}');
  assert.equal(renderChangeBranch(config, change), 'changes/feature/20260731-161655');
  assert.equal(renderChangeBranch(config, change), 'changes/feature/20260731-161655');
});

test('161655 CR1: placeholder-shaped type text is inserted opaquely', () => {
  const config = { git: { change_branch_format: 'work/{type}/{id}' } };

  assert.equal(
    renderChangeBranch(config, { type: 'bug{id}', id: '20260731-161655' }),
    'work/bug{id}/20260731-161655',
  );
});

test('161655 CR1: replacement-pattern type text is inserted opaquely', () => {
  const config = { git: { change_branch_format: 'work/{type}/{id}' } };

  assert.equal(
    renderChangeBranch(config, { type: 'bug$&', id: '20260731-161655' }),
    'work/bug$&/20260731-161655',
  );
});

test('161655 CR7: absent and null branch formats preserve opt-out behavior', () => {
  const change = { type: 'feature', id: '20260731-161655' };
  for (const config of [{}, { git: {} }, { git: { change_branch_format: null } }]) {
    assert.equal(changeBranchFormat(config), undefined);
    assert.equal(renderChangeBranch(config, change), undefined);
  }
});

test('161655 CR3: ambiguous and malformed branch formats fail closed', () => {
  const change = { type: 'feature', id: '20260731-161655' };
  const cases = [
    ['{type}', /must contain "\{id\}" exactly once/],
    ['{id}/{id}', /must contain "\{id\}" exactly once/],
    ['{owner}/{id}', /unknown placeholder "\{owner\}"/],
    ['{type/{id}', /contains malformed placeholders/],
    ['bad..{id}', /renders an invalid Git branch: bad\.\.20260731-161655/],
  ];

  for (const [format, diagnostic] of cases) {
    assert.throws(
      () => renderChangeBranch({ git: { change_branch_format: format } }, change),
      diagnostic,
      format,
    );
  }
});

test('161655 CR3: configured branch format must be a non-empty string', () => {
  for (const value of ['', '   ', 7, true, [], {}]) {
    assert.throws(
      () => changeBranchFormat({ git: { change_branch_format: value } }),
      /config "git\.change_branch_format" must be a non-empty string/,
    );
  }
});
