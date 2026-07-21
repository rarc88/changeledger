import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  approve,
  archive,
  archiveGraduated,
  discard,
  log,
  owner,
  reopen,
  review,
  status,
  task,
  validation,
} from '../src/commands/agent.mjs';
import { migrateConfig } from '../src/commands/config.mjs';
import { fix } from '../src/commands/fix.mjs';
import { skipGraduation } from '../src/commands/graduate.mjs';
import { newChange } from '../src/commands/new.mjs';
import { initReleaseHistory, recordRelease } from '../src/commands/release.mjs';
import { loadLedgerStore } from '../src/ledger-store.mjs';
import {
  applyConfigMigration,
  changeStatus,
  patchProjectConfig,
  readProjectConfigStructured,
  saveProjectConfig,
} from '../src/viewer/domain.mjs';
import { changeText, createStateRepo, git, stateConfig } from './helpers/state-repo.mjs';

const ID = '20260721-000000';

function assertSingleSuccessor(root, before, result) {
  const after = loadLedgerStore(root).load();
  assert.notEqual(after.revision, before.revision);
  assert.equal(git(root, ['rev-list', '--count', `${before.revision}..${after.revision}`]), '1');
  assert.equal(
    git(root, ['rev-list', '--parents', '-n', '1', after.revision]).split(' ').length,
    2,
  );
  assert.equal(
    fs.readFileSync(path.join(root, '.changeledger', 'legacy-sentinel'), 'utf8'),
    'unchanged\n',
  );
  if (typeof result === 'string' && result.startsWith('git:')) {
    assert.match(result, new RegExp(`^git:${after.revision}:`));
  }
  return after;
}

const lifecycleCases = [
  ['status', 'draft', (root) => status(ID, 'approved', root)],
  ['approve', 'draft', (root) => approve(ID, root)],
  ['review', 'in-review', (root) => review(ID, 'pass', {}, root)],
  ['validation', 'in-validation', (root) => validation(ID, 'pass', {}, root)],
  ['reopen', 'done', (root) => reopen(ID, 'reason', root)],
  ['owner', 'draft', (root) => owner(ID, 'alice', root)],
  ['discard', 'draft', (root) => discard(ID, 'obsolete', root)],
  ['archive', 'draft', (root) => archive(ID, root)],
  ['log', 'draft', (root) => log(ID, 'note', root)],
  ['task', 'draft', (root) => task(ID, 'done', 1, undefined, root)],
];

for (const [name, initialStatus, mutate] of lifecycleCases) {
  test(`193101 CR8 matrix lifecycle: ${name} publishes one state successor`, () => {
    const { root } = createStateRepo({ changes: [changeText({ status: initialStatus })] });
    const before = loadLedgerStore(root).load();
    const result = mutate(root);
    assertSingleSuccessor(root, before, result);
  });
}

test('193101 CR8 matrix creation: new writes only one state successor', () => {
  const { root } = createStateRepo();
  const before = loadLedgerStore(root).load();
  const result = newChange(
    { type: 'feature', slug: 'second', title: 'Second', now: '2026-07-21T01:00:00Z' },
    root,
  );
  const after = assertSingleSuccessor(root, before, result);
  assert.ok(after.changes.some((change) => change.frontmatter.id === '20260721-010000'));
});

test('193101 CR8 matrix bulk: archive --graduated is one state successor', () => {
  const { root } = createStateRepo({ changes: [changeText({ status: 'done' })] });
  skipGraduation(ID, 'no durable truth', root);
  const before = loadLedgerStore(root).load();
  const result = archiveGraduated({}, root);
  const after = assertSingleSuccessor(root, before, result[0].file);
  assert.equal(after.changes[0].frontmatter.archived, true);
});

function output() {
  const lines = [];
  return {
    lines,
    log(message) {
      lines.push(String(message));
    },
    error(message) {
      throw new Error(message);
    },
  };
}

test('193101 CR8 matrix bulk: regular fix publishes one state successor', () => {
  const broken = changeText().replace(
    '- [ ] Do it',
    '- [X] Do it\n  - **Resolved:** `2026-07-21T00:00:05Z`',
  );
  const { root } = createStateRepo({ changes: [broken] });
  const before = loadLedgerStore(root).load();
  const out = output();
  assert.equal(fix([ID], root, out), 0);
  const after = assertSingleSuccessor(root, before);
  assert.ok(out.lines.includes(`Ledger revision: ${after.revision}`));
});

test('193101 CR8 matrix bulk: structured-sections fix publishes one state successor', () => {
  const legacy = changeText()
    .replace('- [ ] Do it', '- [x] Do it — 2026-07-21T00:00:00Z')
    .replace('## Log\n', '## Log\n\n- **2026-07-21T00:00:00Z** — created\n');
  const { root } = createStateRepo({ changes: [legacy] });
  const before = loadLedgerStore(root).load();
  const out = output();
  assert.equal(fix(['--structured-sections'], root, out), 0);
  const after = assertSingleSuccessor(root, before);
  assert.ok(out.lines.includes(`Ledger revision: ${after.revision}`));
});

test('193101 CR8 matrix bulk: graduation-links fix publishes one state successor', () => {
  const graduated = changeText({ status: 'done' }).replace(
    '## Log\n',
    '## Log\n\n- **2026-07-21T00:00:00Z** `[graduation]` spec: `arch.md`\n',
  );
  const spec =
    '---\ntitle: Arch\nupdated: 2026-07-21T00:00:00Z\ntags: [architecture]\n---\n\n# Arch\n';
  const { root } = createStateRepo({ changes: [graduated], specs: { 'arch.md': spec } });
  const before = loadLedgerStore(root).load();
  const out = output();
  assert.equal(fix(['--graduation-links'], root, out), 0);
  const after = assertSingleSuccessor(root, before);
  assert.ok(out.lines.includes(`Ledger revision: ${after.revision}`));
  assert.deepEqual(after.specs[0].frontmatter.graduated_from, [ID]);
});

test('193101 CR8 matrix durable truth: graduation skip is one state successor', () => {
  const { root } = createStateRepo({ changes: [changeText({ status: 'done' })] });
  const before = loadLedgerStore(root).load();
  const result = skipGraduation(ID, 'no durable truth', root);
  const after = assertSingleSuccessor(root, before, result);
  assert.equal(after.changes[0].frontmatter.reviewed, true);
});

test('193101 CR5/CR8 matrix durable truth: release init and record are atomic successors', () => {
  const oldId = '20260721-000001';
  const newId = '20260721-000002';
  const { root } = createStateRepo({
    changes: [
      changeText({ id: oldId, status: 'done' }),
      changeText({ id: newId, type: 'bug', status: 'done' }),
    ],
  });
  let before = loadLedgerStore(root).load();
  const initialized = initReleaseHistory('1.0.0', root, '2026-07-21T01:00:00Z');
  let after = assertSingleSuccessor(root, before, initialized.file);
  assert.deepEqual(initialized.manifest.changes, [oldId, newId]);

  const thirdId = '20260721-000003';
  loadLedgerStore(root).mutate({ message: 'test: add releasable change' }, ({ write }) => {
    write(
      `.changeledger-state/changes/${thirdId}-change.md`,
      changeText({ id: thirdId, type: 'bug', status: 'done' }),
    );
  });
  before = loadLedgerStore(root).load();
  const recorded = recordRelease('1.0.1', root, '2026-07-21T02:00:00Z');
  after = assertSingleSuccessor(root, before, recorded.file);
  assert.deepEqual(recorded.manifest.changes, [thirdId]);
  assert.equal(after.releases.at(-1).version, '1.0.1');
});

function project(root) {
  return [{ id: 'project-1', name: 'Project', path: root, alive: true }];
}

test('193101 CR8 matrix config: viewer raw save and patch use state successors', () => {
  const { root } = createStateRepo();
  let read = readProjectConfigStructured(project(root), 'project-1');
  let before = loadLedgerStore(root).load();
  const saved = saveProjectConfig(project(root), {
    project: 'project-1',
    revision: read.body.revision,
    content: read.body.content.replace('language: en', 'language: es'),
  });
  assert.equal(saved.code, 200);
  let after = assertSingleSuccessor(root, before);
  assert.equal(saved.body.ledger_revision, after.revision);

  read = readProjectConfigStructured(project(root), 'project-1');
  before = after;
  const patched = patchProjectConfig(project(root), {
    project: 'project-1',
    revision: read.body.revision,
    patch: { language: 'fr' },
  });
  assert.equal(patched.code, 200);
  after = assertSingleSuccessor(root, before);
  assert.equal(patched.body.ledger_revision, after.revision);
  assert.equal(after.config.language, 'fr');
});

test('193101 CR8 matrix lifecycle: viewer exposes the state revision it creates', () => {
  const { root } = createStateRepo();
  const before = loadLedgerStore(root).load();
  const result = changeStatus(project(root), {
    project: 'project-1',
    id: ID,
    status: 'approved',
  });
  assert.equal(result.code, 200);
  const after = assertSingleSuccessor(root, before);
  assert.equal(result.body.ledger_revision, after.revision);
});

test('193101 CR8 matrix config: viewer and CLI migrations use state successors', () => {
  for (const surface of ['viewer', 'cli']) {
    const { root } = createStateRepo({ configText: stateConfig({ schemaVersion: 2 }) });
    const before = loadLedgerStore(root).load();
    let revision;
    if (surface === 'viewer') {
      const read = readProjectConfigStructured(project(root), 'project-1');
      const result = applyConfigMigration(project(root), {
        project: 'project-1',
        revision: read.body.revision,
      });
      assert.equal(result.code, 200);
      revision = result.body.ledger_revision;
    } else {
      const result = migrateConfig(root);
      revision = result.match(/Ledger revision: (\S+)/)?.[1];
    }
    const after = assertSingleSuccessor(root, before);
    assert.equal(revision, after.revision);
    assert.equal(after.config.schema_version, 3);
  }
});

test('193101 CR8: failed bulk candidate leaves S1 and legacy worktree untouched', () => {
  const broken = changeText().replace('- [ ] Do it', '- [X] Do it');
  const { root } = createStateRepo({ changes: [broken] });
  const store = loadLedgerStore(root);
  const before = store.load();
  const sentinel = path.join(root, '.changeledger', 'legacy-sentinel');
  assert.throws(
    () =>
      store.mutate({ message: 'test: invalid bulk' }, ({ snapshot, write }) => {
        write(snapshot.changes[0].statePath, 'invalid\n');
        write('.changeledger-state/changes/second.md', changeText({ id: 'second' }));
      }),
    /Ledger state validation failed/,
  );
  assert.equal(store.load().revision, before.revision);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'unchanged\n');
});
