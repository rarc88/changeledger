import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { status } from '../src/commands/agent.mjs';
import { buildAgentContext } from '../src/commands/agent-context.mjs';
import { check } from '../src/commands/check.mjs';
import { newChange } from '../src/commands/new.mjs';
import { search } from '../src/commands/search.mjs';
import { loadLedgerStore } from '../src/ledger-store.mjs';
import { loadRepo } from '../src/repo.mjs';
import { serialize } from '../src/viewer/domain.mjs';
import { changeText, createStateRepo } from './helpers/state-repo.mjs';

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

  git(root, ['checkout', '-q', '--orphan', 'changeledger/state']);
  git(root, ['rm', '-qrf', '--ignore-unmatch', '.']);
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

test('193101 CR2: repository readers use the selected snapshot instead of legacy paths', () => {
  const { root, baseline } = fixture();
  const repo = loadRepo(root);
  assert.equal(repo.mode, 'state');
  assert.equal(repo.revision, baseline);
  assert.equal(serialize(repo).ledger_revision, baseline);
  assert.deepEqual(
    search('Demo', {}, root).map((hit) => hit.ref),
    ['spec:demo', '#20260721-000000'],
  );
  const output = { log: (text) => (output.text = text), warn() {}, error() {} };
  check(['--json'], root, output);
  assert.equal(JSON.parse(output.text).revision, baseline);
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

test('193101 CR8: a state mutation validates and publishes one successor without touching legacy files', () => {
  const { root } = fixture({
    mutateState(state) {
      fs.rmSync(path.join(state, 'specs'), { recursive: true });
      fs.rmSync(path.join(state, 'releases'), { recursive: true });
      fs.writeFileSync(
        path.join(state, 'config.yml'),
        [
          'project_id: project-1',
          'changes_dir: .changeledger-state/changes',
          'statuses: [draft, approved, in-progress, in-validation, blocked, done, discarded]',
          'stages: [request, log]',
          'types:',
          '  feature:',
          '    stages: [request]',
          '',
        ].join('\n'),
      );
      fs.writeFileSync(
        path.join(state, 'changes', '20260721-000000-demo.md'),
        '---\nid: "20260721-000000"\ntitle: Demo\ntype: feature\nstatus: draft\ncreated: 2026-07-21T00:00:00Z\ndepends_on: []\n---\n\n## Request\n\nDemo.\n',
      );
    },
  });
  const store = loadLedgerStore(root);
  const before = store.load();

  const after = store.mutate({ message: 'test: update ledger snapshot' }, ({ snapshot, write }) => {
    const change = snapshot.changes[0];
    write(change.statePath, change.text.replace('title: Demo', 'title: Updated'));
  });

  assert.notEqual(after.revision, before.revision);
  assert.equal(after.changes[0].frontmatter.title, 'Updated');
  assert.equal(fs.existsSync(path.join(root, '.changeledger', 'changes')), false);
  assert.equal(
    git(root, ['show', `${before.revision}:.changeledger-state/changes/20260721-000000-demo.md`]),
    before.changes[0].text.trim(),
  );
});

test('193101 CR8: an invalid candidate leaves the state ref at S1', () => {
  const { root } = fixture();
  const store = loadLedgerStore(root);
  const before = store.load();

  assert.throws(
    () =>
      store.mutate({ message: 'test: invalid ledger snapshot' }, ({ snapshot, write }) => {
        write(snapshot.changes[0].statePath, 'not a change document\n');
      }),
    /Ledger state validation failed/,
  );
  assert.equal(store.load().revision, before.revision);
});

test('193101 CR8: lifecycle status writes only the state successor', () => {
  const { root } = fixture({
    mutateState(state) {
      fs.rmSync(path.join(state, 'specs'), { recursive: true });
      fs.rmSync(path.join(state, 'releases'), { recursive: true });
      fs.writeFileSync(
        path.join(state, 'config.yml'),
        [
          'project_id: project-1',
          'changes_dir: .changeledger-state/changes',
          'statuses: [draft, approved, in-progress, in-validation, blocked, done, discarded]',
          'stages: [request, log]',
          'types:',
          '  feature:',
          '    stages: [request]',
          '',
        ].join('\n'),
      );
      fs.writeFileSync(
        path.join(state, 'changes', '20260721-000000-demo.md'),
        '---\nid: "20260721-000000"\ntitle: Demo\ntype: feature\nstatus: draft\ncreated: 2026-07-21T00:00:00Z\ndepends_on: []\n---\n\n## Request\n\nDemo.\n',
      );
    },
  });
  const before = loadLedgerStore(root).load();

  status('20260721-000000', 'approved', root);

  const after = loadLedgerStore(root).load();
  assert.notEqual(after.revision, before.revision);
  assert.equal(after.changes[0].frontmatter.status, 'approved');
  assert.equal(fs.existsSync(path.join(root, '.changeledger', 'changes')), false);
});

test('193101 CR2: agent context selects its change from the state snapshot', () => {
  const { root } = fixture();
  const context = buildAgentContext('investigation', '20260721-000000', root);
  assert.match(context, /title: Demo/);
  assert.match(context, /Effective policy: language=es/);
});

test('193101 CR8: new creates a change only in the state successor', () => {
  const { root } = fixture({
    mutateState(state) {
      fs.rmSync(path.join(state, 'specs'), { recursive: true });
      fs.rmSync(path.join(state, 'releases'), { recursive: true });
      fs.writeFileSync(
        path.join(state, 'config.yml'),
        [
          'project_id: project-1',
          'changes_dir: .changeledger-state/changes',
          'statuses: [draft, approved, in-progress, in-validation, blocked, done, discarded]',
          'stages: [request, log]',
          'types:',
          '  feature:',
          '    stages: [request]',
          '',
        ].join('\n'),
      );
      fs.writeFileSync(
        path.join(state, 'changes', '20260721-000000-demo.md'),
        '---\nid: "20260721-000000"\ntitle: Demo\ntype: feature\nstatus: draft\ncreated: 2026-07-21T00:00:00Z\ndepends_on: []\n---\n\n## Request\n\nDemo.\n',
      );
    },
  });
  const before = loadLedgerStore(root).load();

  const file = newChange(
    {
      type: 'feature',
      slug: 'state-change',
      title: 'State change',
      now: '2026-07-21T01:00:00Z',
    },
    root,
  );

  const after = loadLedgerStore(root).load();
  assert.match(file, /^git:/);
  assert.notEqual(after.revision, before.revision);
  assert.ok(after.changes.some((change) => change.frontmatter.id === '20260721-010000'));
  assert.equal(fs.existsSync(path.join(root, '.changeledger', 'changes')), false);
});

test('193101 CR7: state snapshots and mutations are portable across SHA-1 and SHA-256', () => {
  for (const objectFormat of ['sha1', 'sha256']) {
    let created;
    try {
      created = createStateRepo({ objectFormat, changes: [changeText()] });
    } catch (error) {
      if (
        objectFormat === 'sha256' &&
        /unknown option|unsupported|not supported/i.test(error.message)
      ) {
        continue;
      }
      throw error;
    }
    const store = loadLedgerStore(created.root);
    const before = store.load();
    status('20260721-000000', 'approved', created.root);
    const after = store.load();
    assert.notEqual(after.revision, before.revision, objectFormat);
    assert.equal(after.changes[0].frontmatter.status, 'approved', objectFormat);
    assert.equal(after.revision.length, objectFormat === 'sha256' ? 64 : 40);
  }
});
