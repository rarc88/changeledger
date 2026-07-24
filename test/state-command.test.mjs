import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildContext } from '../src/commands/context.mjs';
import {
  stateAbort,
  stateActivate,
  stateDoctor,
  stateStatus,
  stateSync,
} from '../src/commands/state.mjs';
import { ACTIVATION_REF, loadLedgerStore } from '../src/ledger-store.mjs';
import {
  createStateBaseline,
  prepareStateActivation,
  previewStateMigration,
} from '../src/state-migration.mjs';
import { CONFIRMED_REF, PENDING_REF, PUBLIC_STATE_REF } from '../src/state-store.mjs';
import { changeStatus, readProjectConfigStructured } from '../src/viewer/domain.mjs';
import { changeText, createStateRepo, git } from './helpers/state-repo.mjs';

// A real legacy repo -- config.yml, a changes dir, an `origin` remote -- built
// the way `changeledger init` would leave it, before any cutover ever ran.
// `git.integration_branch: dev` is required for `state activate --install` to
// recognize the integration ref.
function legacyIntegrationRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-precutover-'));
  git(root, ['init', '-q', '-b', 'dev']);
  git(root, ['config', 'user.name', 'Test User']);
  git(root, ['config', 'user.email', 'test@example.com']);
  fs.mkdirSync(path.join(root, '.changeledger', 'changes'), { recursive: true });
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# contract\n');
  fs.writeFileSync(
    path.join(root, '.changeledger', 'config.yml'),
    [
      'schema_version: 3',
      'project_id: project-1',
      'language: en',
      'tdd: false',
      'changes_dir: .changeledger/changes',
      'specs_dir: .changeledger/specs',
      'git:',
      '  integration_branch: dev',
      'statuses: [draft, approved, in-progress, in-review, in-validation, blocked, done, discarded]',
      'stages: [request, plan, log]',
      'types:',
      '  feature:',
      '    stages: [request, plan, log]',
      '    review_required: true',
      'release:',
      '  impacts:',
      '    feature: minor',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(root, '.changeledger', 'changes', '20260721-000000-demo.md'),
    changeText(),
  );
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'chore: legacy']);
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-precutover-remote-'));
  git(remote, ['init', '--bare', '-q']);
  git(root, ['remote', 'add', 'origin', remote]);
  git(root, ['push', '-q', '-u', 'origin', 'dev']);
  return { root, remote, head: git(root, ['rev-parse', 'dev']) };
}

function writePlan(root, text) {
  const file = path.join(root, 'migration-plan.yml');
  fs.writeFileSync(file, text);
  return file;
}

// The full migration pipeline: baseline + activation fast-forwarded onto `dev`
// and pushed to origin, exactly like a real cutover merged into the
// integration branch. `createStateBaseline` also pushes the state branch, so
// a clone of `dev` receives the authority's baseline commit for free.
function preparedIntegrationRepo() {
  const { root, remote, head } = legacyIntegrationRepo();
  const preview = previewStateMigration({ sources: ['local:refs/heads/dev'] }, root);
  const baseline = createStateBaseline({ planFile: writePlan(root, preview.text) }, root);
  const activation = prepareStateActivation({ baseline: baseline.baseline }, root);
  git(root, ['update-ref', 'refs/heads/dev', activation.commit]);
  git(root, ['push', '-q', 'origin', 'dev']);
  return { root, remote, head, baseline: baseline.baseline, activation };
}

function fixture(options) {
  const created = createStateRepo(options);
  fs.writeFileSync(
    path.join(created.root, '.changeledger', 'authority.yml'),
    `format_version: 2\nstate_ref: ${PUBLIC_STATE_REF}\nbaseline: ${created.baseline}\nproject_id: project-1\ninventory_digest: ${'a'.repeat(64)}\nminimum_client_version: 0.13.0\n`,
  );
  git(created.root, ['add', '.changeledger/authority.yml']);
  git(created.root, ['commit', '-qm', 'test: replica authority']);
  // Checkout-independent activation: the operative authority is resolved from
  // the commit the ref points at, not the worktree file, so state mode is
  // active regardless of which branch is checked out.
  git(created.root, ['update-ref', ACTIVATION_REF, git(created.root, ['rev-parse', 'HEAD'])]);
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
      `Ledger snapshot: ${remoteHead} — freshness: fresh; confirmation: confirmed; observed_at: ${after.ledgerObservedAt}; project: project-1; repo: .+ \\(no implicit network refresh\\)`,
    ),
  );
});

test('193103 CR7/CR11: replica commands validate authority before reading or mutating refs', () => {
  const created = fixture();
  // The operative authority now lives in the activation commit, not the worktree
  // file. Tamper both together (so no worktree/activation conflict masks it) to
  // prove validateAuthority still rejects a manifest mismatch before any ref move.
  const authority = path.join(created.root, '.changeledger', 'authority.yml');
  fs.writeFileSync(
    authority,
    fs.readFileSync(authority, 'utf8').replace('inventory_digest: a', 'inventory_digest: b'),
  );
  git(created.root, ['add', '.changeledger/authority.yml']);
  git(created.root, ['commit', '-qm', 'test: tamper operative authority']);
  git(created.root, ['update-ref', ACTIVATION_REF, git(created.root, ['rev-parse', 'HEAD'])]);
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

test('20260723-202646 CR8: a post-cutover clone without activation stays in bootstrap', () => {
  const created = fixture();
  git(created.root, ['push', '-q', 'origin', 'dev']);
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-fresh-clone-'));
  const clone = path.join(parent, 'clone');
  execFileSync(
    'git',
    ['clone', '-q', '--no-local', '--single-branch', '-b', 'dev', created.remote, clone],
    { cwd: parent, encoding: 'utf8' },
  );
  // A fresh clone receives neither refs/changeledger/* nor the baseline object.
  assert.throws(() => git(clone, ['cat-file', '-e', `${created.baseline}^{commit}`]));
  assert.throws(() => git(clone, ['rev-parse', '--verify', ACTIVATION_REF]));

  // With a v2 worktree authority but no activation ref the clone is in bootstrap
  // mode: ordinary reads and mutations fail closed until `state activate --install`.
  assert.throws(
    () => loadLedgerStore(clone).load(),
    /state authority format_version: 2 is not installed/,
  );
});

test('20260723-202646 CR8: a post-cutover clone installs and syncs end-to-end', () => {
  const { remote } = preparedIntegrationRepo();
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-fresh-clone-'));
  const clone = path.join(parent, 'clone');
  // A plain (non-single-branch) clone brings every branch the remote
  // advertises, including `changeledger/state` -- the authority's baseline
  // commit is reachable locally, so install needs no further fetch.
  execFileSync('git', ['clone', '-q', '-b', 'dev', remote, clone], {
    cwd: parent,
    encoding: 'utf8',
  });

  // Ordinary commands fail closed with the exact bootstrap message.
  assert.throws(
    () => loadLedgerStore(clone).load(),
    new Error(
      'state authority format_version: 2 is not installed; ' +
        'run `changeledger state activate --install --integration-ref <full-ref>`',
    ),
  );

  // Install directly from the remote-tracking integration ref the clone already
  // received: no additional fetch is required.
  const install = stateActivate(clone, {
    install: true,
    integrationRef: 'refs/remotes/origin/dev',
  });
  assert.equal(install.written, true);
  assert.equal(install.network, false);
  assert.equal(git(clone, ['rev-parse', '--verify', ACTIVATION_REF]), install.activation);

  // `state sync` now works end-to-end against the fixture remote.
  const sync = stateSync(clone);
  assert.equal(sync.confirmed, true);

  const snapshot = loadLedgerStore(clone).load();
  assert.equal(snapshot.mode, 'state');
  assert.equal(snapshot.ledgerConfirmation, 'confirmed');
  assert.equal(snapshot.changes[0].frontmatter.title, 'Demo');
});

test('20260723-202646 CR6: a pre-cutover clone bootstraps via install without a fetch', () => {
  const prepared = preparedIntegrationRepo();
  // "legacy" is the real pre-cutover commit: legacy config.yml layout, no
  // authority.yml at all, pushed alongside the post-cutover `dev` tip.
  git(prepared.root, ['branch', 'legacy', prepared.head]);
  git(prepared.root, ['push', '-q', 'origin', 'legacy']);

  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-precutover-clone-'));
  const clone = path.join(parent, 'clone');
  // A plain clone fetches every branch, including the integration branch's tip
  // as refs/remotes/origin/dev, before checking out the pre-cutover branch.
  execFileSync('git', ['clone', '-q', '-b', 'legacy', prepared.remote, clone], {
    cwd: parent,
    encoding: 'utf8',
  });

  assert.equal(fs.existsSync(path.join(clone, '.changeledger', 'authority.yml')), false);
  assert.throws(() => git(clone, ['rev-parse', '--verify', ACTIVATION_REF]));
  assert.equal(loadLedgerStore(clone).load().mode, 'worktree');

  const install = stateActivate(clone, {
    install: true,
    integrationRef: 'refs/remotes/origin/dev',
  });
  assert.equal(install.written, true);
  assert.equal(install.network, false, 'install must not fetch beyond what clone already brought');

  const sync = stateSync(clone);
  assert.equal(sync.confirmed, true);
  assert.equal(loadLedgerStore(clone).load().mode, 'state');
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

test('203029 CR1: state status and sync name their project and repository in human output', () => {
  const created = fixture();
  const cli = path.resolve('bin/changeledger.mjs');
  const run = (...args) =>
    execFileSync(process.execPath, [cli, ...args], { cwd: created.root, encoding: 'utf8' });

  const status = run('state', 'status');
  assert.match(status, /^Project: project-1$/m);
  assert.match(status, new RegExp(`^Repository: .*${path.basename(created.root)}$`, 'm'));

  const sync = run('state', 'sync');
  assert.match(sync, /\(project: project-1\)/);
  assert.match(sync, new RegExp(`\\(repo: .*${path.basename(created.root)}\\)`));
});

test('203029 CR1: check, fix and config migrate receipts name project and repository', () => {
  const created = fixture();
  const cli = path.resolve('bin/changeledger.mjs');
  const run = (...args) =>
    execFileSync(process.execPath, [cli, ...args], { cwd: created.root, encoding: 'utf8' });

  // The fixture's AGENTS.md carries no contract reference, so check exits 1;
  // the receipt line must still attribute the findings to their repo.
  const checked = spawnSync(process.execPath, [cli, 'check'], {
    cwd: created.root,
    encoding: 'utf8',
  });
  assert.match(checked.stdout, /\(project: project-1\)/);
  assert.match(checked.stdout, new RegExp(`\\(repo: .*${path.basename(created.root)}\\)`));
  const checkedJson = JSON.parse(
    spawnSync(process.execPath, [cli, 'check', '--json'], {
      cwd: created.root,
      encoding: 'utf8',
    }).stdout,
  );
  assert.equal(checkedJson.project_id, 'project-1');
  assert.ok(checkedJson.repository_path);

  const fixed = run('fix', '--dry-run');
  assert.match(fixed, /\(project: project-1\)/);

  const migrated = run('config', 'migrate', '--dry-run');
  assert.match(migrated, /\(project: project-1\)/);

  // --commits over an empty range: the human scope line and the JSON receipt
  // must both attribute the lint to the resolved repo.
  const commitsHuman = run('check', '--commits', 'dev');
  assert.match(commitsHuman, /\(project: project-1\)/);
  const commitsJson = JSON.parse(run('check', '--commits', 'dev', '--json'));
  assert.equal(commitsJson.project_id, 'project-1');
  assert.ok(commitsJson.repository_path);
});

test('203029 CR2: state sync and abort failures emit provenance receipts, JSON under --json', () => {
  const created = fixture();
  const cli = path.resolve('bin/changeledger.mjs');
  const run = (...args) =>
    spawnSync(process.execPath, [cli, ...args], { cwd: created.root, encoding: 'utf8' });

  // Failure under --json must still be machine-readable with provenance.
  const abort = run('state', 'abort', '--json');
  assert.notEqual(abort.status, 0);
  const abortReceipt = JSON.parse(abort.stderr);
  assert.equal(abortReceipt.ok, false);
  assert.match(abortReceipt.error, /state abort requires --pending/);
  assert.equal(abortReceipt.project_id, 'project-1');
  assert.ok(abortReceipt.repository_path);

  // Human failure carries a structured receipt line with provenance.
  git(created.root, ['remote', 'set-url', 'origin', '/nonexistent-remote-path']);
  const sync = run('state', 'sync');
  assert.notEqual(sync.status, 0);
  assert.match(sync.stderr, /"projectId":"project-1"/);
  assert.match(sync.stderr, /"repositoryPath":"/);
  assert.match(sync.stderr, /^Error: /m);
});

test('203029 CR2: a state doctor failure still names the resolved repository', () => {
  const created = fixture();
  const cli = path.resolve('bin/changeledger.mjs');

  let error;
  try {
    execFileSync(process.execPath, [cli, 'state', 'doctor', '--json'], {
      cwd: created.root,
      encoding: 'utf8',
    });
  } catch (e) {
    error = e;
  }
  assert.ok(error, 'doctor without --activation-ref must fail');
  const receipt = JSON.parse(error.stderr);
  assert.equal(receipt.ok, false);
  assert.equal(receipt.project_id, 'project-1');
  assert.equal(fs.realpathSync(receipt.repository_path), fs.realpathSync(created.root));
});

test('203029 CR2: a genuinely unresolvable identity degrades project_id to null without hiding repository_path', () => {
  const cli = path.resolve('bin/changeledger.mjs');
  const outsideAnyRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-no-repo-'));

  let error;
  try {
    execFileSync(process.execPath, [cli, 'state', 'doctor', '--json'], {
      cwd: outsideAnyRepo,
      encoding: 'utf8',
    });
  } catch (e) {
    error = e;
  }
  assert.ok(error, 'doctor without --activation-ref must fail even outside a repo');
  const receipt = JSON.parse(error.stderr);
  assert.equal(receipt.ok, false);
  assert.match(receipt.error, /--activation-ref/);
  assert.equal(receipt.project_id, null);
  assert.equal(fs.realpathSync(receipt.repository_path), fs.realpathSync(outsideAnyRepo));
});

test('20260723-170611 CR1: a state failure without --json emits the receipt and error once', () => {
  const created = fixture();
  const cli = path.resolve('bin/changeledger.mjs');

  let error;
  try {
    execFileSync(process.execPath, [cli, 'state', 'doctor'], {
      cwd: created.root,
      encoding: 'utf8',
    });
  } catch (e) {
    error = e;
  }
  assert.ok(error, 'doctor without --activation-ref must fail');
  assert.equal(error.status, 1);

  const receiptLines = error.stderr.match(/^Receipt: /gm) ?? [];
  const errorLines = error.stderr.match(/^Error: /gm) ?? [];
  assert.equal(receiptLines.length, 1, 'receipt must be printed exactly once');
  assert.equal(errorLines.length, 1, 'error message must be printed exactly once');
  assert.match(error.stderr, /--activation-ref/);
});

test('20260723-170611 CR2: a state failure with --json still emits a single JSON receipt', () => {
  const created = fixture();
  const cli = path.resolve('bin/changeledger.mjs');

  let error;
  try {
    execFileSync(process.execPath, [cli, 'state', 'doctor', '--json'], {
      cwd: created.root,
      encoding: 'utf8',
    });
  } catch (e) {
    error = e;
  }
  assert.ok(error, 'doctor without --activation-ref must fail');
  assert.equal(error.status, 1);

  const receipt = JSON.parse(error.stderr.trim());
  assert.equal(receipt.ok, false);
  assert.doesNotMatch(error.stderr, /^Error: /m);
});
