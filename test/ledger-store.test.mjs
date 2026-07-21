import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadLedgerStore } from '../src/ledger-store.mjs';

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function fixture({ mutateState } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-state-store-'));
  git(root, ['init', '-q', '-b', 'dev']);
  git(root, ['config', 'user.name', 'Test User']);
  git(root, ['config', 'user.email', 'test@example.com']);
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  fs.mkdirSync(path.join(root, '.changeledger'), { recursive: true });
  fs.writeFileSync(path.join(root, '.changeledger', 'config.yml'), 'project_id: local\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'chore: base']);

  git(root, ['checkout', '-q', '-b', 'changeledger/state']);
  const state = path.join(root, '.changeledger-state');
  fs.mkdirSync(path.join(state, 'changes'), { recursive: true });
  fs.mkdirSync(path.join(state, 'specs'), { recursive: true });
  fs.mkdirSync(path.join(state, 'releases'), { recursive: true });
  fs.writeFileSync(path.join(state, 'manifest.yml'), 'format_version: 1\nproject_id: project-1\n');
  fs.writeFileSync(
    path.join(state, 'config.yml'),
    'project_id: project-1\nlanguage: es\nchanges_dir: ignored\ntypes:\n  feature:\n    stages: [request]\n',
  );
  fs.writeFileSync(
    path.join(state, 'changes', '20260721-000000-demo.md'),
    '---\nid: "20260721-000000"\ntitle: Demo\ntype: feature\nstatus: done\ncreated: 2026-07-21T00:00:00Z\ndepends_on: []\n---\n\n## Request\n\nDemo.\n',
  );
  fs.writeFileSync(
    path.join(state, 'specs', 'demo.md'),
    '---\ntitle: Demo\nupdated: 2026-07-21T00:00:00Z\ntags: [feature]\ngraduated_from: ["20260721-000000"]\n---\n\n# Demo\n',
  );
  fs.writeFileSync(
    path.join(state, 'releases', '1.0.0.yml'),
    'version: 1.0.0\nchanges: ["20260721-000000"]\n',
  );
  mutateState?.(state);
  git(root, ['add', '.changeledger-state']);
  git(root, ['commit', '-qm', 'chore: state']);
  const baseline = git(root, ['rev-parse', 'HEAD']);

  git(root, ['checkout', '-q', 'dev']);
  fs.rmSync(path.join(root, '.changeledger', 'config.yml'));
  fs.writeFileSync(
    path.join(root, '.changeledger', 'authority.yml'),
    `format_version: 1\nstate_ref: refs/heads/changeledger/state\nbaseline: ${baseline}\nproject_id: project-1\n`,
  );
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'chore: authority']);
  return { root, baseline };
}

test('193101 CR1/CR2/CR6: state store loads one complete Git snapshot, not worktree files', () => {
  const { root, baseline } = fixture();
  const store = loadLedgerStore(root);
  const snapshot = store.load();

  assert.equal(snapshot.mode, 'state');
  assert.equal(snapshot.revision, baseline);
  assert.equal(snapshot.manifest.project_id, 'project-1');
  assert.equal(snapshot.config.project_id, 'project-1');
  assert.equal(snapshot.changes[0].frontmatter.id, '20260721-000000');
  assert.equal(snapshot.specs[0].name, 'demo.md');
  assert.equal(snapshot.releases[0].name, '1.0.0.yml');
  assert.match(snapshot.changes[0].file, new RegExp(`^git:${baseline}:`));
  assert.equal(fs.existsSync(path.join(root, '.changeledger', 'changes')), false);
});

test('193101 CR1: missing collections are empty, but manifest and config are mandatory', () => {
  const { root } = fixture({
    mutateState(state) {
      fs.rmSync(path.join(state, 'changes'), { recursive: true });
      fs.rmSync(path.join(state, 'specs'), { recursive: true });
      fs.rmSync(path.join(state, 'releases'), { recursive: true });
    },
  });
  const snapshot = loadLedgerStore(root).load();
  assert.deepEqual([snapshot.changes, snapshot.specs, snapshot.releases], [[], [], []]);

  const missing = fixture({ mutateState: (state) => fs.rmSync(path.join(state, 'manifest.yml')) });
  assert.throws(
    () => loadLedgerStore(missing.root).load(),
    /missing .changeledger-state\/manifest.yml/,
  );
});

test('193101 CR1/CR3: invalid state authority fails closed without loading legacy files', () => {
  const mismatch = fixture({
    mutateState(state) {
      fs.writeFileSync(path.join(state, 'manifest.yml'), 'format_version: 1\nproject_id: other\n');
    },
  });
  assert.throws(() => loadLedgerStore(mismatch.root).load(), /project_id does not match authority/);

  const { root } = fixture();
  fs.writeFileSync(
    path.join(root, '.changeledger', 'authority.yml'),
    'format_version: 1\nstate_ref: refs/heads/changeledger/state\nbaseline: deadbeef\nproject_id: project-1\n',
  );
  assert.throws(() => loadLedgerStore(root).load(), /state authority is unavailable/);
});

test('193101 CR3: a legacy repository retains the worktree adapter', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-worktree-store-'));
  fs.mkdirSync(path.join(root, '.changeledger', 'changes'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.changeledger', 'config.yml'),
    'project_id: legacy\nchanges_dir: .changeledger/changes\ntypes:\n  feature:\n    stages: [request]\n',
  );
  fs.writeFileSync(
    path.join(root, '.changeledger', 'changes', '20260721-000000-demo.md'),
    '---\nid: "20260721-000000"\ntitle: Demo\ntype: feature\nstatus: draft\ncreated: 2026-07-21T00:00:00Z\ndepends_on: []\n---\n\n## Request\n\nDemo.\n',
  );

  const snapshot = loadLedgerStore(root).load();
  assert.equal(snapshot.mode, 'worktree');
  assert.equal(snapshot.revision, null);
  assert.equal(snapshot.changes.length, 1);
});

test('193101 CR7: the state tree rejects files outside the closed layout', () => {
  const { root } = fixture({
    mutateState(state) {
      fs.writeFileSync(path.join(state, 'unexpected.txt'), 'nope\n');
    },
  });
  assert.throws(() => loadLedgerStore(root).load(), /invalid state path/);
});
