import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildContext } from '../src/commands/context.mjs';
import { stateAbort, stateDoctor, stateStatus, stateSync } from '../src/commands/state.mjs';
import { loadLedgerStore } from '../src/ledger-store.mjs';
import { CONFIRMED_REF, PENDING_REF, PUBLIC_STATE_REF } from '../src/state-store.mjs';
import { changeStatus, readProjectConfigStructured } from '../src/viewer/domain.mjs';
import { changeText, createStateRepo, git } from './helpers/state-repo.mjs';

function fixture(options) {
  const created = createStateRepo(options);
  fs.writeFileSync(
    path.join(created.root, '.changeledger', 'authority.yml'),
    `format_version: 2\nstate_ref: ${PUBLIC_STATE_REF}\nbaseline: ${created.baseline}\nproject_id: project-1\ninventory_digest: ${'a'.repeat(64)}\nminimum_client_version: 0.13.0\n`,
  );
  git(created.root, ['add', '.changeledger/authority.yml']);
  git(created.root, ['commit', '-qm', 'test: replica authority']);
  git(created.root, ['update-ref', CONFIRMED_REF, created.baseline]);
  git(created.root, ['update-ref', 'refs/changeledger/observed', created.baseline]);
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-state-command-'));
  const initArgs = ['init', '--bare', '-q'];
  if ((options?.objectFormat ?? 'sha1') !== 'sha1') {
    initArgs.push(`--object-format=${options.objectFormat}`);
  }
  git(remote, initArgs);
  git(created.root, ['remote', 'add', 'origin', remote]);
  git(created.root, ['push', '-q', 'origin', PUBLIC_STATE_REF]);
  return { ...created, remote };
}

test('193102 CR1/CR7: state status is local-only and state sync advances the effective snapshot', () => {
  const created = fixture();
  git(created.root, ['checkout', '-q', 'changeledger/state']);
  const change = path.join(
    created.root,
    '.changeledger-state',
    'changes',
    '20260721-000000-change.md',
  );
  fs.writeFileSync(change, fs.readFileSync(change, 'utf8').replace('title: Demo', 'title: Remote'));
  git(created.root, ['add', change]);
  git(created.root, ['commit', '-qm', 'test: remote state']);
  const remoteHead = git(created.root, ['rev-parse', 'HEAD']);
  git(created.root, ['push', '-q', 'origin', PUBLIC_STATE_REF]);
  git(created.root, ['checkout', '-q', 'dev']);
  git(created.root, ['update-ref', PUBLIC_STATE_REF, created.baseline]);

  const before = stateStatus(created.root);
  assert.equal(before.condition, 'unknown');
  assert.equal(before.confirmed, created.baseline);
  assert.equal(loadLedgerStore(created.root).load().revision, created.baseline);

  const result = stateSync(created.root);
  assert.equal(result.action, 'advance-confirmed');
  const after = loadLedgerStore(created.root).load();
  assert.equal(after.revision, remoteHead);
  assert.equal(after.ledgerFreshness, 'fresh');
  assert.equal(after.ledgerConfirmation, 'confirmed');
  assert.equal(after.changes[0].frontmatter.title, 'Remote');
  assert.match(
    buildContext(undefined, created.root),
    new RegExp(
      `Ledger snapshot: ${remoteHead} — freshness: fresh; confirmation: confirmed; observed_at: ${after.ledgerObservedAt} \\(no implicit network refresh\\)`,
    ),
  );
});

test('193103 CR7/CR11: replica commands validate authority before reading or mutating refs', () => {
  const created = fixture();
  const authority = path.join(created.root, '.changeledger', 'authority.yml');
  fs.writeFileSync(
    authority,
    fs.readFileSync(authority, 'utf8').replace('inventory_digest: a', 'inventory_digest: b'),
  );
  git(created.root, ['update-ref', PENDING_REF, created.baseline]);

  assert.throws(() => stateStatus(created.root), /inventory_digest does not match authority/);
  assert.throws(
    () => stateAbort(created.root, { pending: true, offline: true }),
    /inventory_digest does not match authority/,
  );
  assert.throws(() => stateSync(created.root), /inventory_digest does not match authority/);
  assert.equal(git(created.root, ['rev-parse', PENDING_REF]), created.baseline);
  assert.equal(git(created.root, ['rev-parse', CONFIRMED_REF]), created.baseline);
});

test('193102 CR7: initial sync rejects a valid state outside the authority baseline', () => {
  const created = fixture();
  git(created.root, ['update-ref', '-d', CONFIRMED_REF]);
  git(created.root, ['update-ref', '-d', 'refs/changeledger/observed']);
  const foreign = createStateRepo({
    specs: {
      'foreign.md':
        '---\ntitle: Foreign\nupdated: 2026-07-22T00:00:00Z\ntags: [foreign]\n---\n\n# Foreign\n',
    },
  });
  git(foreign.root, ['remote', 'add', 'target', created.remote]);
  git(foreign.root, ['push', '-q', 'target', `+${PUBLIC_STATE_REF}:${PUBLIC_STATE_REF}`]);

  assert.throws(() => stateSync(created.root), /does not descend from authority baseline/);
  assert.throws(() => git(created.root, ['rev-parse', '--verify', CONFIRMED_REF]));
  assert.throws(() => loadLedgerStore(created.root).load(), /run `changeledger state sync`/);
});

test('193103 CR7/CR11: initial sync validates authority after fetching an absent baseline', () => {
  const created = fixture();
  git(created.root, ['push', '-q', 'origin', 'dev']);
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-fresh-clone-'));
  const clone = path.join(parent, 'clone');
  execFileSync(
    'git',
    ['clone', '-q', '--no-local', '--single-branch', '-b', 'dev', created.remote, clone],
    { cwd: parent, encoding: 'utf8' },
  );
  assert.throws(() => git(clone, ['cat-file', '-e', `${created.baseline}^{commit}`]));

  const result = stateSync(clone);

  assert.equal(result.effective, created.baseline);
  assert.equal(git(clone, ['rev-parse', CONFIRMED_REF]), created.baseline);
  assert.equal(loadLedgerStore(clone).load().revision, created.baseline);
});

test('193102 CR3: CLI mutation preflight initializes a replica before constructing the change', () => {
  const created = fixture();
  git(created.root, ['update-ref', '-d', CONFIRMED_REF]);
  git(created.root, ['update-ref', '-d', 'refs/changeledger/observed']);
  const cli = path.resolve('bin/changeledger.mjs');

  const output = execFileSync(
    process.execPath,
    [cli, 'new', 'feature', 'initialized', 'Initialized'],
    { cwd: created.root, encoding: 'utf8' },
  );

  assert.match(output, /Created/);
  const snapshot = loadLedgerStore(created.root).load();
  assert.equal(snapshot.ledgerConfirmation, 'confirmed');
  assert.ok(snapshot.changes.some((change) => change.frontmatter.title === 'Initialized'));
});

test('193102 CR3: viewer mutation preflight initializes a replica before resolving the target', () => {
  const created = fixture();
  git(created.root, ['update-ref', '-d', CONFIRMED_REF]);
  git(created.root, ['update-ref', '-d', 'refs/changeledger/observed']);

  const result = changeStatus(
    [{ id: 'project-1', name: 'Project', path: created.root, alive: true }],
    {
      project: 'project-1',
      id: '20260721-000000',
      status: 'approved',
      ledger_revision: created.baseline,
    },
  );

  assert.equal(result.code, 200);
  assert.equal(result.body.ledger_confirmation, 'confirmed');
  assert.equal(loadLedgerStore(created.root).load().changes[0].frontmatter.status, 'approved');
});

test('193102 CR7: dry-runs and viewer reads never consume the mutation preflight', () => {
  const created = fixture();
  fs.rmSync(created.remote, { recursive: true });
  const cli = path.resolve('bin/changeledger.mjs');

  assert.doesNotThrow(() =>
    execFileSync(process.execPath, [cli, 'fix', '--dry-run'], {
      cwd: created.root,
      encoding: 'utf8',
    }),
  );
  assert.doesNotThrow(() =>
    execFileSync(process.execPath, [cli, 'config', 'migrate', '--dry-run'], {
      cwd: created.root,
      encoding: 'utf8',
    }),
  );
  assert.equal(
    readProjectConfigStructured(
      [{ id: 'project-1', name: 'Project', path: created.root, alive: true }],
      'project-1',
    ).code,
    200,
  );
});

for (const objectFormat of ['sha1', 'sha256']) {
  test(`193102 CR4: production store replays disjoint pending state with ${objectFormat}`, () => {
    let created;
    try {
      created = fixture({ objectFormat });
    } catch (error) {
      if (objectFormat === 'sha256' && /unknown|unsupported|sha256/i.test(error.message)) return;
      throw error;
    }

    const store = loadLedgerStore(created.root);
    const before = store.load();
    const pending = store.mutate(
      { message: 'test: local pending', expectedRevision: before.revision, offline: true },
      ({ snapshot, write }) => {
        write(
          snapshot.changes[0].statePath,
          snapshot.changes[0].text.replace('title: Demo', 'title: Local pending'),
        );
      },
    );
    assert.equal(pending.ledgerConfirmation, 'pending publication');

    git(created.root, ['checkout', '-q', 'changeledger/state']);
    const remoteSpec = path.join(created.root, '.changeledger-state', 'specs', 'remote.md');
    fs.writeFileSync(
      remoteSpec,
      '---\ntitle: Remote\nupdated: 2026-07-22T00:00:00Z\ntags: [remote]\n---\n\n# Remote\n',
    );
    git(created.root, ['add', remoteSpec]);
    git(created.root, ['commit', '-qm', 'test: disjoint remote state']);
    const observed = git(created.root, ['rev-parse', 'HEAD']);
    git(created.root, ['push', '-q', 'origin', PUBLIC_STATE_REF]);
    git(created.root, ['checkout', '-q', 'dev']);

    const result = loadLedgerStore(created.root).replica.sync();
    assert.equal(result.action, 'replay-pending');
    assert.equal(result.confirmed, true);
    assert.equal(result.pending, false);
    assert.notEqual(result.effective, observed);
    assert.throws(() => git(created.root, ['rev-parse', '--verify', PENDING_REF]));

    const after = loadLedgerStore(created.root).load();
    assert.equal(after.revision, result.effective);
    assert.equal(after.ledgerConfirmation, 'confirmed');
    assert.equal(after.changes[0].frontmatter.title, 'Local pending');
    assert.equal(after.specs[0].frontmatter.title, 'Remote');
  });
}

test('193102 CR3/CR6: state abort requires --pending and supports explicit offline discard', () => {
  const created = fixture();
  const store = loadLedgerStore(created.root);
  const before = store.load();
  const pending = store.mutate(
    { message: 'test: pending', expectedRevision: before.revision, offline: true },
    ({ snapshot, write }) => {
      write(
        snapshot.changes[0].statePath,
        snapshot.changes[0].text.replace('title: Demo', 'title: Pending'),
      );
    },
  );
  assert.equal(pending.ledgerConfirmation, 'pending publication');
  assert.throws(() => stateAbort(created.root), /requires --pending/);
  const result = stateAbort(created.root, { pending: true, offline: true });
  assert.equal(result.aborted, true);
  assert.throws(() => git(created.root, ['rev-parse', '--verify', PENDING_REF]));
  assert.equal(loadLedgerStore(created.root).load().revision, created.baseline);
});

test('204130 CR1: abort that leaves the replica behind reports stale and the next step', () => {
  const created = staleAbortFixture();

  const result = stateAbort(created.root, { pending: true });
  assert.equal(result.aborted, true);
  assert.equal(result.confirmed, false);
  assert.equal(result.stale, true);
  assert.equal(stateStatus(created.root).condition, 'stale');
});

function staleAbortFixture() {
  const created = fixture();
  const store = loadLedgerStore(created.root);
  const before = store.load();
  store.mutate(
    { message: 'test: local pending', expectedRevision: before.revision, offline: true },
    ({ snapshot, write }) => {
      write(
        snapshot.changes[0].statePath,
        snapshot.changes[0].text.replace('title: Demo', 'title: Pending'),
      );
    },
  );

  git(created.root, ['checkout', '-q', 'changeledger/state']);
  const change = path.join(
    created.root,
    '.changeledger-state',
    'changes',
    '20260721-000000-change.md',
  );
  fs.writeFileSync(change, fs.readFileSync(change, 'utf8').replace('title: Demo', 'title: Remote'));
  git(created.root, ['add', change]);
  git(created.root, ['commit', '-qm', 'test: remote advance']);
  git(created.root, ['push', '-q', 'origin', PUBLIC_STATE_REF]);
  git(created.root, ['checkout', '-q', 'dev']);
  git(created.root, ['update-ref', PUBLIC_STATE_REF, created.baseline]);
  return created;
}

test('204130 CR1: CLI abort --pending reports the stale receipt in human output', () => {
  const created = staleAbortFixture();
  const cli = path.resolve('bin/changeledger.mjs');

  const output = execFileSync(process.execPath, [cli, 'state', 'abort', '--pending'], {
    cwd: created.root,
    encoding: 'utf8',
  });

  assert.match(output, /Pending mutation aborted/);
  assert.match(output, /Replica is stale; run `changeledger state sync` to catch up\./);
});

test('204130 CR1: CLI abort --pending --json includes stale: true', () => {
  const created = staleAbortFixture();
  const cli = path.resolve('bin/changeledger.mjs');

  const output = execFileSync(process.execPath, [cli, 'state', 'abort', '--pending', '--json'], {
    cwd: created.root,
    encoding: 'utf8',
  });

  const receipt = JSON.parse(output);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.stale, true);
});

test('204130 CR1: an abort that is not left stale does not carry the flag', () => {
  const created = fixture();
  const store = loadLedgerStore(created.root);
  const before = store.load();
  store.mutate(
    { message: 'test: local pending', expectedRevision: before.revision, offline: true },
    ({ snapshot, write }) => {
      write(
        snapshot.changes[0].statePath,
        snapshot.changes[0].text.replace('title: Demo', 'title: Pending'),
      );
    },
  );
  const aborted = stateAbort(created.root, { pending: true, offline: true });
  assert.equal(aborted.stale, false);
});

test('204130 CR2: doctor without --activation-ref points to replica status', () => {
  assert.throws(
    () => stateDoctor('.', {}),
    /state doctor validates a migration activation.*--activation-ref.*changeledger state status/s,
  );
});

test('193102 CR3/CR7: CLI propagates --offline to the shared mutation boundary', () => {
  const created = fixture();
  fs.rmSync(created.remote, { recursive: true });
  const output = execFileSync(
    process.execPath,
    [path.resolve('bin/changeledger.mjs'), 'owner', '20260721-000000', 'alice', '--offline'],
    { cwd: created.root, encoding: 'utf8' },
  );

  assert.match(output, /confirmation: pending publication/);
  assert.ok(git(created.root, ['rev-parse', '--verify', PENDING_REF]));
  assert.equal(loadLedgerStore(created.root).load().changes[0].frontmatter.owner, 'alice');
});

test('193102 CR3: status owns --offline while read-only context does not advertise it', () => {
  const created = fixture({ changes: [changeText({ status: 'approved' })] });
  const cli = path.resolve('bin/changeledger.mjs');
  const statusHelp = execFileSync(process.execPath, [cli, 'status', '--help'], {
    cwd: created.root,
    encoding: 'utf8',
  });
  const contextHelp = execFileSync(process.execPath, [cli, 'context', '--help'], {
    cwd: created.root,
    encoding: 'utf8',
  });
  assert.match(statusHelp, /--offline/);
  assert.doesNotMatch(contextHelp, /--offline/);

  fs.rmSync(created.remote, { recursive: true });
  const output = execFileSync(
    process.execPath,
    [cli, 'status', '20260721-000000', 'in-progress', '--offline'],
    { cwd: created.root, encoding: 'utf8' },
  );
  assert.match(output, /confirmation: pending publication/);
  assert.equal(loadLedgerStore(created.root).load().changes[0].frontmatter.status, 'in-progress');
});

test('193102 CR7: every CLI read receipt includes freshness, confirmation and observation', () => {
  const created = fixture();
  stateSync(created.root);
  const snapshot = loadLedgerStore(created.root).load();
  const cli = path.resolve('bin/changeledger.mjs');
  const run = (...args) =>
    execFileSync(process.execPath, [cli, ...args], { cwd: created.root, encoding: 'utf8' });

  const listJson = JSON.parse(run('list', '--json'));
  const showJson = JSON.parse(run('show', '20260721-000000', '--json'));
  const searchJson = JSON.parse(run('search', 'Demo', '--json'));
  const checkJson = JSON.parse(run('check', '20260721-000000', '--json'));
  for (const receipt of [listJson, showJson, searchJson]) {
    assert.equal(receipt.ledger_revision, snapshot.revision);
    assert.equal(receipt.ledger_freshness, 'fresh');
    assert.equal(receipt.ledger_confirmation, 'confirmed');
    assert.equal(receipt.ledger_observed_at, snapshot.ledgerObservedAt);
  }
  assert.equal(checkJson.revision, snapshot.revision);
  assert.equal(checkJson.freshness, 'fresh');
  assert.equal(checkJson.confirmation, 'confirmed');
  assert.equal(checkJson.observed_at, snapshot.ledgerObservedAt);

  for (const output of [run('list'), run('show', '20260721-000000'), run('search', 'Demo')]) {
    assert.match(output, /freshness: fresh/);
    assert.match(output, /confirmation: confirmed/);
    assert.match(output, new RegExp(`observed at: ${snapshot.ledgerObservedAt}`));
  }
  assert.match(
    buildContext(undefined, created.root),
    new RegExp(`confirmation: confirmed; observed_at: ${snapshot.ledgerObservedAt}`),
  );
});
