import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  approve,
  archive,
  archiveGraduated,
  discard,
  list,
  log,
  owner,
  reopen,
  review,
  show,
  status,
  task,
  validation,
} from '../src/commands/agent.mjs';
import { migrateConfig } from '../src/commands/config.mjs';
import { fix } from '../src/commands/fix.mjs';
import { skipGraduation } from '../src/commands/graduate.mjs';
import { newChange } from '../src/commands/new.mjs';
import { initReleaseHistory, recordRelease } from '../src/commands/release.mjs';
import { search } from '../src/commands/search.mjs';
import { loadLedgerStore } from '../src/ledger-store.mjs';
import {
  applyConfigMigration,
  changeStatus,
  patchProjectConfig,
  previewConfigMigration,
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

function lockStateRef(root) {
  const lock = path.join(root, '.git', 'refs', 'heads', 'changeledger', 'state.lock');
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  fs.writeFileSync(lock, 'locked by test\n');
  return () => fs.rmSync(lock, { force: true });
}

const quietOutput = () => ({ log() {}, warn() {}, error() {} });

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
  assert.ok(
    out.lines.includes(
      `Ledger revision: ${after.revision} (freshness: local) (confirmation: local) (observed at: unknown)`,
    ),
  );
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
  assert.ok(
    out.lines.includes(
      `Ledger revision: ${after.revision} (freshness: local) (confirmation: local) (observed at: unknown)`,
    ),
  );
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
  assert.ok(
    out.lines.includes(
      `Ledger revision: ${after.revision} (freshness: local) (confirmation: local) (observed at: unknown)`,
    ),
  );
  assert.deepEqual(after.specs[0].frontmatter.graduated_from, [ID]);
});

const stateNoopCases = [
  ['archive --graduated', (root) => archiveGraduated({}, root)],
  ['fix', (root) => fix([], root, quietOutput())],
  ['fix --structured-sections', (root) => fix(['--structured-sections'], root, quietOutput())],
  ['fix --graduation-links', (root) => fix(['--graduation-links'], root, quietOutput())],
  ['config migrate already-current', (root) => migrateConfig(root)],
];

for (const [name, invoke] of stateNoopCases) {
  test(`193101 hardening CR8: ${name} linearizes an empty state mutation`, () => {
    const { root } = createStateRepo();
    const before = loadLedgerStore(root).load();
    const unlock = lockStateRef(root);
    try {
      assert.throws(() => invoke(root), /Ledger state changed concurrently/);
    } finally {
      unlock();
    }
    assert.equal(loadLedgerStore(root).load().revision, before.revision);
  });
}

test('193101 hardening CR8: read-only state previews do not acquire the mutation CAS', () => {
  const { root } = createStateRepo();
  const unlock = lockStateRef(root);
  try {
    assert.equal(fix(['--dry-run'], root, quietOutput()), 0);
    assert.equal(fix(['--structured-sections', '--dry-run'], root, quietOutput()), 0);
    assert.equal(fix(['--graduation-links', '--dry-run'], root, quietOutput()), 0);
    assert.match(migrateConfig(root, { dryRun: true }), /already at schema 3/);
  } finally {
    unlock();
  }
});

test('193101 hardening CR8: successful empty mutations preserve S1 and report its receipt', () => {
  const { root } = createStateRepo();
  const before = loadLedgerStore(root).load();
  const lines = [];
  const output = { log: (line) => lines.push(line), warn() {}, error() {} };

  const archived = archiveGraduated({}, root);
  assert.equal(archived.length, 0);
  assert.equal(archived.ledgerRevision, before.revision);
  assert.equal(fix([], root, output), 0);
  assert.equal(fix(['--structured-sections'], root, output), 0);
  assert.equal(fix(['--graduation-links'], root, output), 0);
  const migrationReceipt = migrateConfig(root);
  assert.match(migrationReceipt, new RegExp(`Ledger revision: ${before.revision}`));
  assert.match(migrationReceipt, /confirmation: local/);
  assert.match(migrationReceipt, /observed at: unknown/);

  assert.equal(loadLedgerStore(root).load().revision, before.revision);
  assert.ok(
    lines.filter((line) => line.includes(`Ledger revision: ${before.revision}`)).length >= 3,
  );
});

test('193101 hardening CR8: an already-resolved task is an effective state no-op', () => {
  const { root } = createStateRepo({ changes: [changeText({ status: 'done' })] });
  const before = loadLedgerStore(root).load();

  task(ID, 'done', 1, undefined, root);

  assert.equal(loadLedgerStore(root).load().revision, before.revision);
});

test('193101 hardening CR8: an identical raw config save is an effective state no-op', () => {
  const { root } = createStateRepo();
  const read = readProjectConfigStructured(project(root), 'project-1');
  const before = loadLedgerStore(root).load();

  const saved = saveProjectConfig(project(root), {
    project: 'project-1',
    config_revision: read.body.config_revision,
    ledger_revision: read.body.ledger_revision,
    content: read.body.content,
  });

  assert.equal(saved.code, 200);
  assert.equal(saved.body.ledger_revision, before.revision);
  assert.equal(loadLedgerStore(root).load().revision, before.revision);
});

for (const [name, patch] of [
  ['empty patch', {}],
  ['identity value patch', { language: 'en' }],
]) {
  test(`193101 hardening CR8: config ${name} preserves exact state bytes`, () => {
    const { root } = createStateRepo();
    const read = readProjectConfigStructured(project(root), 'project-1');
    const before = loadLedgerStore(root).load();

    const patched = patchProjectConfig(project(root), {
      project: 'project-1',
      config_revision: read.body.config_revision,
      ledger_revision: read.body.ledger_revision,
      patch,
    });

    assert.equal(patched.code, 200);
    assert.equal(patched.body.config_revision, read.body.config_revision);
    assert.equal(patched.body.ledger_revision, before.revision);
    const after = loadLedgerStore(root).load();
    assert.equal(after.revision, before.revision);
    assert.equal(after.configText, read.body.content);
  });
}

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
  const releaseStore = loadLedgerStore(root);
  const releaseSnapshot = releaseStore.load();
  releaseStore.mutate(
    { message: 'test: add releasable change', expectedRevision: releaseSnapshot.revision },
    ({ write }) => {
      write(
        `.changeledger-state/changes/${thirdId}-change.md`,
        changeText({ id: thirdId, type: 'bug', status: 'done' }),
      );
    },
  );
  before = loadLedgerStore(root).load();
  const recorded = recordRelease('1.0.1', root, '2026-07-21T02:00:00Z');
  after = assertSingleSuccessor(root, before, recorded.file);
  assert.deepEqual(recorded.manifest.changes, [thirdId]);
  assert.equal(after.releases.at(-1).version, '1.0.1');
});

function project(root) {
  return [{ id: 'project-1', name: 'Project', path: root, alive: true }];
}

function advanceUnrelatedState(store, label) {
  const before = store.load();
  return store.mutate(
    { message: `test: advance ${label}`, expectedRevision: before.revision },
    ({ snapshot, write }) => {
      const change = snapshot.changes[0];
      write(change.statePath, change.text.replace('title: Demo', `title: ${label}`));
    },
  );
}

test('193101 CR8 matrix config: viewer raw save and patch use state successors', () => {
  const { root } = createStateRepo();
  let read = readProjectConfigStructured(project(root), 'project-1');
  assert.equal(read.body.ledger_freshness, 'local');
  assert.equal(
    previewConfigMigration(
      project(root),
      'project-1',
      read.body.revision,
      read.body.ledger_revision,
    ).body.ledger_freshness,
    'local',
  );
  let before = loadLedgerStore(root).load();
  const saved = saveProjectConfig(project(root), {
    project: 'project-1',
    revision: read.body.revision,
    ledger_revision: read.body.ledger_revision,
    content: read.body.content.replace('language: en', 'language: es'),
  });
  assert.equal(saved.code, 200);
  let after = assertSingleSuccessor(root, before);
  assert.equal(saved.body.ledger_revision, after.revision);
  assert.equal(saved.body.ledger_freshness, 'local');

  read = readProjectConfigStructured(project(root), 'project-1');
  before = after;
  const patched = patchProjectConfig(project(root), {
    project: 'project-1',
    revision: read.body.revision,
    ledger_revision: read.body.ledger_revision,
    patch: { language: 'fr' },
  });
  assert.equal(patched.code, 200);
  after = assertSingleSuccessor(root, before);
  assert.equal(patched.body.ledger_revision, after.revision);
  assert.equal(patched.body.ledger_freshness, 'local');
  assert.equal(after.config.language, 'fr');
});

const viewerLifecycleCases = [
  ['approve', 'draft', 'approved', undefined],
  ['validation-pass', 'in-validation', 'done', undefined],
  ['validation-fail', 'in-validation', 'in-progress', 'needs correction'],
  ['reopen', 'done', 'in-progress', 'reopen reason'],
];

for (const [name, initialStatus, targetStatus, reason] of viewerLifecycleCases) {
  test(`193101 hardening CR8: viewer ${name} rejects state advanced before preload`, () => {
    const { root } = createStateRepo({ changes: [changeText({ status: initialStatus })] });
    const store = loadLedgerStore(root);
    const observed = store.load();
    const advanced = advanceUnrelatedState(store, `Before ${name}`);
    const result = changeStatus(project(root), {
      project: 'project-1',
      id: ID,
      status: targetStatus,
      reason,
      ledger_revision: observed.revision,
    });
    assert.equal(result.code, 409);
    const current = store.load();
    assert.equal(current.revision, advanced.revision);
    assert.equal(current.changes[0].frontmatter.status, initialStatus);
  });

  test(`193101 hardening CR8: viewer ${name} rejects state advanced after preload`, () => {
    const { root } = createStateRepo({ changes: [changeText({ status: initialStatus })] });
    const store = loadLedgerStore(root);
    const observed = store.load();
    let advanced;
    const result = changeStatus(
      project(root),
      {
        project: 'project-1',
        id: ID,
        status: targetStatus,
        reason,
        ledger_revision: observed.revision,
      },
      {
        beforeMutation() {
          advanced = advanceUnrelatedState(store, `After ${name}`);
        },
      },
    );
    assert.equal(result.code, 409);
    const current = store.load();
    assert.equal(current.revision, advanced.revision);
    assert.equal(current.changes[0].frontmatter.status, initialStatus);
  });
}

const viewerConfigCases = [
  [
    'raw-save',
    (projects, read, options) =>
      saveProjectConfig(
        projects,
        {
          project: 'project-1',
          config_revision: read.config_revision,
          ledger_revision: read.ledger_revision,
          content: read.content.replace('language: en', 'language: es'),
        },
        options,
      ),
  ],
  [
    'form-patch',
    (projects, read, options) =>
      patchProjectConfig(
        projects,
        {
          project: 'project-1',
          config_revision: read.config_revision,
          ledger_revision: read.ledger_revision,
          patch: { language: 'fr' },
        },
        options,
      ),
  ],
  [
    'migration-apply',
    (projects, read, options) =>
      applyConfigMigration(
        projects,
        {
          project: 'project-1',
          config_revision: read.config_revision,
          ledger_revision: read.ledger_revision,
        },
        options,
      ),
  ],
];

for (const [name, invoke] of viewerConfigCases) {
  test(`193101 hardening CR8: viewer config ${name} rejects unrelated state advanced before preload`, () => {
    const { root } = createStateRepo({ configText: stateConfig({ schemaVersion: 2 }) });
    const store = loadLedgerStore(root);
    const read = readProjectConfigStructured(project(root), 'project-1').body;
    const advanced = advanceUnrelatedState(store, `Before config ${name}`);
    const result = invoke(project(root), read);
    assert.equal(result.code, 409);
    assert.equal(store.load().revision, advanced.revision);
  });

  test(`193101 hardening CR8: viewer config ${name} rejects unrelated state advanced after preload`, () => {
    const { root } = createStateRepo({ configText: stateConfig({ schemaVersion: 2 }) });
    const store = loadLedgerStore(root);
    const read = readProjectConfigStructured(project(root), 'project-1').body;
    let advanced;
    const result = invoke(project(root), read, {
      beforeMutation() {
        advanced = advanceUnrelatedState(store, `After config ${name}`);
      },
    });
    assert.equal(result.code, 409);
    assert.equal(store.load().revision, advanced.revision);
  });
}

test('193101 hardening CR2: viewer migration preview rejects a stale ledger snapshot', () => {
  const { root } = createStateRepo({ configText: stateConfig({ schemaVersion: 2 }) });
  const store = loadLedgerStore(root);
  const read = readProjectConfigStructured(project(root), 'project-1').body;
  const advanced = advanceUnrelatedState(store, 'Before migration preview');
  const result = previewConfigMigration(
    project(root),
    'project-1',
    read.config_revision,
    read.ledger_revision,
  );
  assert.equal(result.code, 409);
  assert.equal(store.load().revision, advanced.revision);
});

test('193101 hardening CR2: migration preview requires and returns both revisions', () => {
  const { root } = createStateRepo({ configText: stateConfig({ schemaVersion: 2 }) });
  const read = readProjectConfigStructured(project(root), 'project-1').body;

  const missing = previewConfigMigration(
    project(root),
    'project-1',
    undefined,
    read.ledger_revision,
  );
  assert.equal(missing.code, 400);
  assert.match(missing.body.error, /config_revision is required/);

  const preview = previewConfigMigration(
    project(root),
    'project-1',
    read.config_revision,
    read.ledger_revision,
  );
  assert.equal(preview.code, 200);
  assert.equal(preview.body.config_revision, read.config_revision);
  assert.equal(preview.body.ledger_revision, read.ledger_revision);
});

test('193101 hardening CR8: current state migration is a linearized no-op', () => {
  const { root } = createStateRepo();
  const store = loadLedgerStore(root);
  const before = store.load();
  const read = readProjectConfigStructured(project(root), 'project-1').body;

  const result = applyConfigMigration(project(root), {
    project: 'project-1',
    config_revision: read.config_revision,
    ledger_revision: read.ledger_revision,
  });

  assert.equal(result.code, 200);
  assert.equal(result.body.already_current, true);
  assert.equal(result.body.config_revision, read.config_revision);
  assert.equal(result.body.ledger_revision, before.revision);
  assert.equal(store.load().revision, before.revision);
});

test('193101 CR8 matrix lifecycle: viewer exposes the state revision it creates', () => {
  const { root } = createStateRepo();
  const before = loadLedgerStore(root).load();
  const result = changeStatus(project(root), {
    project: 'project-1',
    id: ID,
    status: 'approved',
    ledger_revision: before.revision,
  });
  assert.equal(result.code, 200);
  const after = assertSingleSuccessor(root, before);
  assert.equal(result.body.ledger_revision, after.revision);
  assert.equal(result.body.ledger_freshness, 'local');
  assert.equal(result.body.ledger_confirmation, 'local');
  assert.equal(result.body.ledger_observed_at, null);
});

test('193101 correction CR8: viewer rejects a lifecycle action observed on stale state', () => {
  const { root } = createStateRepo();
  const store = loadLedgerStore(root);
  const observed = store.load();
  const advanced = store.mutate(
    { message: 'test: advance viewer state', expectedRevision: observed.revision },
    ({ snapshot, write }) => {
      const change = snapshot.changes[0];
      write(change.statePath, change.text.replace('title: Demo', 'title: Advanced'));
    },
  );

  const result = changeStatus(project(root), {
    project: 'project-1',
    id: ID,
    status: 'approved',
    ledger_revision: observed.revision,
  });

  assert.equal(result.code, 409);
  assert.match(result.body.error, /changed concurrently; reload/);
  const current = store.load();
  assert.equal(current.revision, advanced.revision);
  assert.equal(current.changes[0].frontmatter.status, 'draft');
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
        ledger_revision: read.body.ledger_revision,
      });
      assert.equal(result.code, 200);
      revision = result.body.ledger_revision;
    } else {
      const result = migrateConfig(root);
      revision = result.match(/Ledger revision: (\S+)/)?.[1];
      assert.match(result, /freshness: local/);
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
      store.mutate(
        { message: 'test: invalid bulk', expectedRevision: before.revision },
        ({ snapshot, write }) => {
          write(snapshot.changes[0].statePath, 'invalid\n');
          write('.changeledger-state/changes/second.md', changeText({ id: 'second' }));
        },
      ),
    /Ledger state validation failed/,
  );
  assert.equal(store.load().revision, before.revision);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'unchanged\n');
});

test('193101 correction CR2/CR8: state read and lifecycle CLI outputs expose revision and freshness', () => {
  const { root } = createStateRepo();
  const revision = loadLedgerStore(root).load().revision;
  const listed = list({}, root);
  assert.equal(listed.ledgerRevision, revision);
  assert.equal(listed.ledgerFreshness, 'local');
  assert.equal(show(ID, root).ledger_revision, revision);
  const hits = search('Demo', {}, root);
  assert.equal(hits.ledgerRevision, revision);

  const cli = path.resolve('bin/changeledger.mjs');
  const listJson = JSON.parse(
    execFileSync(process.execPath, [cli, 'list', '--json'], { cwd: root, encoding: 'utf8' }),
  );
  assert.equal(listJson.ledger_revision, revision);
  assert.equal(listJson.ledger_freshness, 'local');
  assert.equal(Array.isArray(listJson.changes), true);
  const shown = JSON.parse(
    execFileSync(process.execPath, [cli, 'show', ID, '--json'], {
      cwd: root,
      encoding: 'utf8',
    }),
  );
  assert.equal(shown.ledger_revision, revision);
  assert.equal(shown.ledger_freshness, 'local');
  const searched = JSON.parse(
    execFileSync(process.execPath, [cli, 'search', 'Demo', '--json'], {
      cwd: root,
      encoding: 'utf8',
    }),
  );
  assert.equal(searched.ledger_revision, revision);
  assert.equal(searched.ledger_freshness, 'local');
  assert.equal(Array.isArray(searched.hits), true);
  const mutation = execFileSync(process.execPath, [cli, 'owner', ID, 'alice'], {
    cwd: root,
    encoding: 'utf8',
  });
  const after = loadLedgerStore(root).load();
  assert.match(mutation, new RegExp(`Ledger revision: ${after.revision}`));
  assert.match(mutation, /freshness: local/);
});

test('193101 correction CR2: state fix dry-run exposes the snapshot it inspected', () => {
  const broken = changeText().replace('- [ ] Do it', '- [X] Do it');
  const { root, baseline } = createStateRepo({ changes: [broken] });
  const out = output();
  assert.equal(fix(['--dry-run'], root, out), 0);
  assert.ok(
    out.lines.includes(
      `Ledger revision: ${baseline} (freshness: local) (confirmation: local) (observed at: unknown)`,
    ),
    out.lines.join('\n'),
  );
});

test('193101 correction CR2: empty state archive output still identifies inspected S1', () => {
  const { root, baseline } = createStateRepo();
  const cli = path.resolve('bin/changeledger.mjs');
  const result = execFileSync(process.execPath, [cli, 'archive', '--graduated'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.match(result, /Archived 0 change\(s\)/);
  assert.match(result, new RegExp(`Ledger revision: ${baseline} \\(freshness: local\\)`));
});
