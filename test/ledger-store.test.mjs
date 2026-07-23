import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { status } from '../src/commands/agent.mjs';
import { buildAgentContext } from '../src/commands/agent-context.mjs';
import { check } from '../src/commands/check.mjs';
import { buildContext } from '../src/commands/context.mjs';
import { newChange } from '../src/commands/new.mjs';
import { registerRepo } from '../src/commands/register.mjs';
import { search } from '../src/commands/search.mjs';
import { defaultRun } from '../src/git.mjs';
import { loadLedgerStore, STATE_REF, validateServerStateRevision } from '../src/ledger-store.mjs';
import { loadRepo } from '../src/repo.mjs';
import { CONFIRMED_REF, PENDING_REF, PUBLIC_STATE_REF } from '../src/state-store.mjs';
import { serialize } from '../src/viewer/domain.mjs';
import { changeText, createStateRepo, stateConfig } from './helpers/state-repo.mjs';

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function fixture({ mutateState, objectFormat, authorityFormat = 1, seedConfirmed = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-state-store-'));
  const initArgs = ['init', '-q', '-b', 'dev'];
  if (objectFormat) initArgs.push(`--object-format=${objectFormat}`);
  git(root, initArgs);
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
  fs.writeFileSync(
    path.join(state, 'manifest.yml'),
    `format_version: 1\nproject_id: project-1\ninventory_digest: ${'a'.repeat(64)}\nminimum_client_version: 0.13.0\n`,
  );
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
  if (seedConfirmed) git(root, ['update-ref', 'refs/changeledger/confirmed', baseline]);

  git(root, ['checkout', '-q', 'dev']);
  fs.rmSync(path.join(root, '.changeledger', 'config.yml'));
  const replicaFields =
    authorityFormat === 2
      ? `inventory_digest: ${'a'.repeat(64)}\nminimum_client_version: 0.13.0\n`
      : '';
  fs.writeFileSync(
    path.join(root, '.changeledger', 'authority.yml'),
    `format_version: ${authorityFormat}\nstate_ref: refs/heads/changeledger/state\nbaseline: ${baseline}\nproject_id: project-1\n${replicaFields}`,
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
    `format_version: 1\nstate_ref: refs/heads/changeledger/state\nbaseline: ${'d'.repeat(40)}\nproject_id: project-1\n`,
  );
  assert.throws(() => loadLedgerStore(root).load(), /state authority is unavailable/);
});

test('193102 CR1/CR3/CR7: replica authority requires confirmed state without fallback', () => {
  const missing = fixture({ authorityFormat: 2 });
  assert.throws(
    () => loadLedgerStore(missing.root).load(),
    /state replica is unavailable; run `changeledger state sync`/,
  );

  const { root, baseline } = fixture({ authorityFormat: 2, seedConfirmed: true });
  git(root, ['remote', 'add', 'origin', root]);
  git(root, ['checkout', '-q', 'changeledger/state']);
  const changeFile = path.join(root, '.changeledger-state', 'changes', '20260721-000000-demo.md');
  fs.writeFileSync(
    changeFile,
    fs.readFileSync(changeFile, 'utf8').replace('title: Demo', 'title: New'),
  );
  git(root, ['add', changeFile]);
  git(root, ['commit', '-qm', 'test: advance public state']);
  const publicHead = git(root, ['rev-parse', 'HEAD']);
  git(root, ['checkout', '-q', 'dev']);
  git(root, ['update-ref', 'refs/changeledger/observed', publicHead]);

  const confirmed = loadLedgerStore(root).load();
  assert.equal(confirmed.revision, baseline);
  assert.equal(confirmed.changes[0].frontmatter.title, 'Demo');

  git(root, ['update-ref', 'refs/changeledger/pending', publicHead]);
  const pending = loadLedgerStore(root).load();
  assert.equal(pending.revision, publicHead);
  assert.equal(pending.changes[0].frontmatter.title, 'New');
});

test('202058 CR2: a confirmed ref forged to drop a change identity fails closed on read', () => {
  const { root, baseline } = fixture({ authorityFormat: 2, seedConfirmed: true });
  git(root, ['update-ref', 'refs/changeledger/observed', baseline]);
  git(root, ['checkout', '-q', 'changeledger/state']);
  fs.rmSync(path.join(root, '.changeledger-state', 'changes', '20260721-000000-demo.md'));
  git(root, ['add', '.changeledger-state']);
  git(root, ['commit', '-qm', 'test: forged snapshot drops the change']);
  const forged = git(root, ['rev-parse', 'HEAD']);
  git(root, ['checkout', '-q', 'dev']);
  git(root, ['update-ref', 'refs/changeledger/confirmed', forged]);

  assert.throws(
    () => loadLedgerStore(root).load(),
    /state revision .* removes changes identity "20260721-000000"/,
  );
});

test('193103 CR7: replica authority requires immutable provenance and a compatible client', () => {
  const missingDigest = fixture({ authorityFormat: 2, seedConfirmed: true });
  fs.writeFileSync(
    path.join(missingDigest.root, '.changeledger', 'authority.yml'),
    `format_version: 2\nstate_ref: ${PUBLIC_STATE_REF}\nbaseline: ${missingDigest.baseline}\nproject_id: project-1\nminimum_client_version: 0.13.0\n`,
  );
  assert.throws(
    () => loadLedgerStore(missingDigest.root).load(),
    /Invalid state authority inventory_digest/,
  );

  const futureClient = fixture({ authorityFormat: 2, seedConfirmed: true });
  fs.writeFileSync(
    path.join(futureClient.root, '.changeledger', 'authority.yml'),
    `format_version: 2\nstate_ref: ${PUBLIC_STATE_REF}\nbaseline: ${futureClient.baseline}\nproject_id: project-1\ninventory_digest: ${'a'.repeat(64)}\nminimum_client_version: 99.0.0\n`,
  );
  assert.throws(
    () => loadLedgerStore(futureClient.root).load(),
    /state authority requires client >= 99\.0\.0/,
  );

  const mismatched = fixture({ authorityFormat: 2, seedConfirmed: true });
  fs.writeFileSync(
    path.join(mismatched.root, '.changeledger', 'authority.yml'),
    `format_version: 2\nstate_ref: ${PUBLIC_STATE_REF}\nbaseline: ${mismatched.baseline}\nproject_id: project-1\ninventory_digest: ${'b'.repeat(64)}\nminimum_client_version: 0.13.0\n`,
  );
  assert.throws(
    () => loadLedgerStore(mismatched.root).load(),
    /state inventory_digest does not match authority/,
  );
});

test('193102 CR3: a replica mutation creates one pending successor without moving confirmed', () => {
  const { root, baseline } = fixture({
    authorityFormat: 2,
    seedConfirmed: true,
    mutateState(state) {
      fs.rmSync(path.join(state, 'specs'), { recursive: true });
      fs.rmSync(path.join(state, 'releases'), { recursive: true });
      fs.writeFileSync(path.join(state, 'config.yml'), stateConfig());
      fs.writeFileSync(path.join(state, 'changes', '20260721-000000-demo.md'), changeText());
    },
  });
  git(root, ['remote', 'add', 'origin', root]);
  const store = loadLedgerStore(root);
  const before = store.load();

  const after = store.mutate(
    { message: 'test: offline pending', expectedRevision: before.revision, offline: true },
    ({ snapshot, write }) => {
      write(
        snapshot.changes[0].statePath,
        snapshot.changes[0].text.replace('title: Demo', 'title: Pending'),
      );
    },
  );

  assert.notEqual(after.revision, baseline);
  assert.equal(after.changes[0].frontmatter.title, 'Pending');
  assert.equal(git(root, ['rev-parse', CONFIRMED_REF]), baseline);
  assert.equal(git(root, ['rev-parse', PENDING_REF]), after.revision);
  assert.equal(git(root, ['rev-parse', PUBLIC_STATE_REF]), baseline);
  assert.throws(
    () =>
      store.mutate(
        {
          message: 'test: second pending',
          expectedRevision: after.revision,
          offline: true,
        },
        () => {},
      ),
    /resolve the existing pending state before mutating again/,
  );
  assert.equal(git(root, ['rev-parse', PENDING_REF]), after.revision);
});

test('193102 CR2/CR7: an online replica mutation preflights and publishes through CAS', () => {
  const { root, baseline } = fixture({
    authorityFormat: 2,
    seedConfirmed: true,
    mutateState(state) {
      fs.rmSync(path.join(state, 'specs'), { recursive: true });
      fs.rmSync(path.join(state, 'releases'), { recursive: true });
      fs.writeFileSync(path.join(state, 'config.yml'), stateConfig());
      fs.writeFileSync(path.join(state, 'changes', '20260721-000000-demo.md'), changeText());
    },
  });
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-ledger-store-remote-'));
  git(remote, ['init', '--bare', '-q']);
  git(root, ['remote', 'add', 'origin', remote]);
  git(root, ['push', '-q', 'origin', PUBLIC_STATE_REF]);
  const store = loadLedgerStore(root);
  const before = store.load();

  const after = store.mutate(
    { message: 'test: online mutation', expectedRevision: before.revision },
    ({ snapshot, write }) => {
      write(
        snapshot.changes[0].statePath,
        snapshot.changes[0].text.replace('title: Demo', 'title: Published'),
      );
    },
  );

  assert.notEqual(after.revision, baseline);
  assert.equal(after.changes[0].frontmatter.title, 'Published');
  assert.equal(git(root, ['rev-parse', CONFIRMED_REF]), after.revision);
  assert.equal(git(remote, ['rev-parse', PUBLIC_STATE_REF]), after.revision);
  assert.throws(() => git(root, ['rev-parse', '--verify', PENDING_REF]));
});

// Materialization budget instrumentation: each `ls-tree --full-tree <rev>` is
// exactly one snapshot materialization of that revision (loadStateSnapshotAt ->
// loadStateTree -> treeEntries). Recording the revision per call lets a test
// pin both the exact count AND the "each distinct OID materialized at most once"
// invariant (no revision loaded twice), counting real git work, not wall-clock.
function materializationSpy() {
  const revisions = [];
  const run = (args, cwd, options) => {
    if (args[0] === 'ls-tree' && args.includes('--full-tree')) {
      revisions.push(args[args.indexOf('--full-tree') + 1]);
    }
    return defaultRun(args, cwd, options);
  };
  return { run, revisions };
}

const budgetState = (state) => {
  fs.rmSync(path.join(state, 'specs'), { recursive: true });
  fs.rmSync(path.join(state, 'releases'), { recursive: true });
  fs.writeFileSync(path.join(state, 'config.yml'), stateConfig());
  fs.writeFileSync(path.join(state, 'changes', '20260721-000000-demo.md'), changeText());
};

function retitle(from, to) {
  return ({ snapshot, write }) =>
    write(
      snapshot.changes[0].statePath,
      snapshot.changes[0].text.replace(`title: ${from}`, `title: ${to}`),
    );
}

// Runs one instrumented mutation and asserts the exact materialization budget
// plus the per-OID dedup invariant (the candidate is never re-read: a budget
// that counts only source-side revisions would rise if it were).
function assertBudget(root, { expected, options, from, to }) {
  const { run, revisions } = materializationSpy();
  const store = loadLedgerStore(root, { run });
  const before = store.load();
  revisions.length = 0;
  const after = store.mutate(
    { message: 'test: budget', expectedRevision: before.revision, ...options },
    retitle(from, to),
  );
  assert.equal(after.changes[0].frontmatter.title, to);
  assert.equal(
    revisions.length,
    expected,
    `expected ${expected} materializations, got ${revisions.length}: ${JSON.stringify(revisions)}`,
  );
  assert.equal(
    new Set(revisions).size,
    revisions.length,
    `each distinct OID must be materialized at most once, got duplicates: ${JSON.stringify(revisions)}`,
  );
}

function withRemote(root) {
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-ledger-store-remote-'));
  git(remote, ['init', '--bare', '-q']);
  git(root, ['remote', 'add', 'origin', remote]);
  git(root, ['push', '-q', 'origin', PUBLIC_STATE_REF]);
  return remote;
}

test('202100 correction: a manifest-touching v2 mutation cannot drop an identity at write', () => {
  const { root } = fixture({
    authorityFormat: 2,
    seedConfirmed: true,
    // The git-backed candidate path runs full validation; give it a complete
    // config so the dropped identity is the only defect in the candidate.
    mutateState(state) {
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
    },
  });
  const store = loadLedgerStore(root);
  const snapshot = store.load();
  assert.throws(
    () =>
      store.mutate(
        { message: 'test: drop spec', expectedRevision: snapshot.revision, offline: true },
        ({ write, remove }) => {
          // Writing MANIFEST forces the git-backed candidate path; the dropped
          // spec identity must fail fast here, not on the next load.
          write(
            '.changeledger-state/manifest.yml',
            `format_version: 1\nproject_id: project-1\ninventory_digest: ${'a'.repeat(64)}\nminimum_client_version: 0.13.0\n`,
          );
          remove('.changeledger-state/specs/demo.md');
        },
      ),
    /removes specs identity "demo.md"/,
  );
  // Fail-fast means fail BEFORE publishing: no pending may exist and the
  // snapshot must still load cleanly afterwards.
  assert.throws(() => git(root, ['rev-parse', '--verify', 'refs/changeledger/pending']));
  assert.equal(loadLedgerStore(root).load().specs.length, 1);
});

test('202100: a v1 mutation materializes only the source snapshot (candidate in memory)', () => {
  const { root } = fixture({ mutateState: budgetState });
  assertBudget(root, { expected: 1, from: 'Demo', to: 'Budgeted' });
});

test('202100: a v2 offline mutation at the root revision materializes it once', () => {
  const { root } = fixture({ authorityFormat: 2, seedConfirmed: true, mutateState: budgetState });
  assertBudget(root, { expected: 1, options: { offline: true }, from: 'Demo', to: 'Budgeted' });
});

test('202100: a v2 offline mutation at a non-root revision materializes source and parent once each', () => {
  // Advancing confirmed with one online mutation makes the source revision a
  // non-root commit, so the source load descends to its parent for the
  // non-disappearance check -- two distinct OIDs, each materialized once.
  const { root } = fixture({ authorityFormat: 2, seedConfirmed: true, mutateState: budgetState });
  withRemote(root);
  const seed = loadLedgerStore(root);
  const first = seed.load();
  seed.mutate(
    { message: 'test: advance confirmed', expectedRevision: first.revision },
    retitle('Demo', 'First'),
  );
  assertBudget(root, { expected: 2, options: { offline: true }, from: 'First', to: 'Budgeted' });
});

test('202100: a v2 online mutation at the root revision materializes the confirmed tip and the pending once each', () => {
  // Online cost explicitly includes the remote validations: the pre- and post-
  // pending replica syncs plus the source load. Their shared OIDs (the fetched
  // tip == the confirmed root the source reads) collapse to one materialization;
  // the newly created pending is the only other revision. Two distinct OIDs.
  const { root } = fixture({ authorityFormat: 2, seedConfirmed: true, mutateState: budgetState });
  withRemote(root);
  assertBudget(root, { expected: 2, from: 'Demo', to: 'Budgeted' });
});

test('202100: a v2 online mutation at a non-root revision materializes confirmed, parent and pending once each', () => {
  const { root } = fixture({ authorityFormat: 2, seedConfirmed: true, mutateState: budgetState });
  withRemote(root);
  const seed = loadLedgerStore(root);
  const first = seed.load();
  seed.mutate(
    { message: 'test: advance confirmed', expectedRevision: first.revision },
    retitle('Demo', 'First'),
  );
  assertBudget(root, { expected: 3, from: 'First', to: 'Budgeted' });
});

test('202100: a mutation adding a spec keeps sort order equivalent to a fresh load', () => {
  const { root } = fixture({
    authorityFormat: 2,
    seedConfirmed: true,
    mutateState(state) {
      fs.writeFileSync(path.join(state, 'config.yml'), stateConfig());
      fs.writeFileSync(path.join(state, 'changes', '20260721-000000-demo.md'), changeText());
      fs.writeFileSync(
        path.join(state, 'specs', 'demo.md'),
        '---\ntitle: Demo\nupdated: 2026-07-21T00:00:00Z\ntags: [feature]\ngraduated_from: []\n---\n\n# Demo\n',
      );
      fs.rmSync(path.join(state, 'releases'), { recursive: true });
    },
  });
  const store = loadLedgerStore(root);
  const before = store.load();
  const after = store.mutate(
    { message: 'test: add spec', expectedRevision: before.revision, offline: true },
    ({ write }) => {
      write(
        '.changeledger-state/specs/aaa-new.md',
        '---\ntitle: New\nupdated: 2026-07-21T00:00:00Z\ntags: [feature]\ngraduated_from: []\n---\n\n# New\n',
      );
    },
  );
  const fresh = loadLedgerStore(root).load();
  assert.deepEqual(
    after.specs.map((s) => s.name),
    fresh.specs.map((s) => s.name),
  );
  assert.deepEqual(
    after.specs.map((s) => s.name),
    ['aaa-new.md', 'demo.md'],
  );
});

test('170613: candidate specs/releases order matches a fresh load for mixed-case names', () => {
  const { root } = fixture({
    authorityFormat: 2,
    seedConfirmed: true,
    mutateState(state) {
      fs.writeFileSync(path.join(state, 'config.yml'), stateConfig());
      fs.writeFileSync(path.join(state, 'changes', '20260721-000000-demo.md'), changeText());
      fs.rmSync(path.join(state, 'specs', 'demo.md'));
      fs.writeFileSync(
        path.join(state, 'specs', 'a.md'),
        '---\ntitle: A\nupdated: 2026-07-21T00:00:00Z\ntags: [feature]\ngraduated_from: []\n---\n\n# A\n',
      );
      fs.rmSync(path.join(state, 'releases'), { recursive: true });
    },
  });
  const store = loadLedgerStore(root);
  const before = store.load();
  const after = store.mutate(
    { message: 'test: add mixed-case spec', expectedRevision: before.revision, offline: true },
    ({ write }) => {
      write(
        '.changeledger-state/specs/B.md',
        '---\ntitle: B\nupdated: 2026-07-21T00:00:00Z\ntags: [feature]\ngraduated_from: []\n---\n\n# B\n',
      );
    },
  );
  const fresh = loadLedgerStore(root).load();
  // 'B' (0x42) sorts before 'a' (0x61) ordinally, but after it under
  // localeCompare -- this pair is exactly where the two comparators disagree.
  assert.deepEqual(
    after.specs.map((s) => s.name),
    fresh.specs.map((s) => s.name),
  );
  assert.deepEqual(
    after.specs.map((s) => s.name),
    ['B.md', 'a.md'],
  );
});

test('202100: a mutation cannot drift config project_id away from the authority', () => {
  const { root } = fixture({ authorityFormat: 2, seedConfirmed: true });
  const store = loadLedgerStore(root);
  const before = store.load();
  assert.throws(
    () =>
      store.mutate(
        { message: 'test: divergent project_id', expectedRevision: before.revision, offline: true },
        ({ snapshot, write }) => {
          write(
            snapshot.configStatePath,
            snapshot.configText.replace('project_id: project-1', 'project_id: different'),
          );
        },
      ),
    /project_id/,
  );
});

test('193102 CR3: a replica no-op rejects a pending state created during its mutation', () => {
  const { root, baseline } = fixture({ authorityFormat: 2, seedConfirmed: true });
  git(root, ['remote', 'add', 'origin', root]);
  const pending = git(root, ['rev-parse', PUBLIC_STATE_REF]);
  const store = loadLedgerStore(root);
  const before = store.load();

  assert.equal(before.revision, baseline);
  assert.throws(
    () =>
      store.mutate(
        { message: 'test: replica no-op race', expectedRevision: before.revision, offline: true },
        () => git(root, ['update-ref', PENDING_REF, pending]),
      ),
    /Ledger state changed concurrently/,
  );
  assert.equal(git(root, ['rev-parse', CONFIRMED_REF]), baseline);
  assert.equal(git(root, ['rev-parse', PENDING_REF]), pending);
});

test('202057 CR1: a v1 authority with local v2 replica refs fails closed on read and mutation', () => {
  const { root } = fixture({ authorityFormat: 1, seedConfirmed: true });
  assert.throws(
    () => loadLedgerStore(root).load(),
    /authority v1.*replica v2|replica v2.*authority v1/i,
  );
  assert.throws(
    () =>
      loadLedgerStore(root).mutate(
        { message: 'test: downgrade mutation', expectedRevision: 'irrelevant' },
        () => {},
      ),
    /authority v1.*replica v2|replica v2.*authority v1/i,
  );

  const observedOnly = fixture({ authorityFormat: 1 });
  git(observedOnly.root, ['update-ref', 'refs/changeledger/observed', observedOnly.baseline]);
  assert.throws(
    () => loadLedgerStore(observedOnly.root).load(),
    /authority v1.*replica v2|replica v2.*authority v1/i,
  );

  const pendingOnly = fixture({ authorityFormat: 1, seedConfirmed: true });
  git(pendingOnly.root, ['update-ref', 'refs/changeledger/pending', pendingOnly.baseline]);
  assert.throws(
    () => loadLedgerStore(pendingOnly.root).load(),
    /authority v1.*replica v2|replica v2.*authority v1/i,
  );
});

test('202057 CR2: a genuine v1 repo without any v2 replica ref is unaffected', () => {
  const { root, baseline } = fixture({ authorityFormat: 1 });
  const snapshot = loadLedgerStore(root).load();
  assert.equal(snapshot.revision, baseline);
  assert.equal(snapshot.ledgerFreshness, 'local');
});

// A pre-cutover branch (or a manual deletion) leaves the legacy worktree
// layout -- `.changeledger/config.yml`, no `authority.yml` -- while the repo's
// v2 replica refs still point at post-cutover state.
const preCutoverWorktree = (root) => {
  fs.rmSync(path.join(root, '.changeledger', 'authority.yml'));
  fs.writeFileSync(
    path.join(root, '.changeledger', 'config.yml'),
    'project_id: local\nchanges_dir: .changeledger/changes\ntypes:\n  feature:\n    stages: [request]\n',
  );
};

test('202057 correction: absent authority with a v2 confirmed ref fails closed, not worktree', () => {
  const { root } = fixture({ authorityFormat: 2, seedConfirmed: true });
  preCutoverWorktree(root);
  assert.throws(
    () => loadLedgerStore(root).load(),
    /state authority is missing[\s\S]*refs\/changeledger\/confirmed[\s\S]*state activate/,
  );
});

test('202057 correction: absent authority with only a v2 pending ref fails closed', () => {
  const { root, baseline } = fixture({ authorityFormat: 2 });
  git(root, ['update-ref', 'refs/changeledger/pending', baseline]);
  preCutoverWorktree(root);
  assert.throws(
    () => loadLedgerStore(root).load(),
    /state authority is missing[\s\S]*refs\/changeledger\/pending/,
  );
});

test('202057 correction: absent authority with no v2 replica ref keeps the worktree adapter', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-authority-absent-'));
  git(root, ['init', '-q']);
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
  assert.equal(snapshot.changes.length, 1);
});

test('193101 correction CR3: authority baseline must be an exact full commit OID', () => {
  const { root } = fixture();
  fs.writeFileSync(
    path.join(root, '.changeledger', 'authority.yml'),
    'format_version: 1\nstate_ref: refs/heads/changeledger/state\nbaseline: refs/heads/changeledger/state\nproject_id: project-1\n',
  );
  assert.throws(() => loadLedgerStore(root).load(), /baseline must be an exact commit OID/);
});

test('193101 hardening CR3: authority baseline OID must name a commit object itself', () => {
  for (const objectFormat of ['sha1', 'sha256']) {
    const { root, baseline } = fixture({ objectFormat });
    git(root, ['tag', '-a', 'baseline-tag', baseline, '-m', 'annotated baseline']);
    const candidates = [
      git(root, ['rev-parse', 'refs/tags/baseline-tag']),
      git(root, ['rev-parse', `${baseline}^{tree}`]),
      git(root, ['rev-parse', `${baseline}:.changeledger-state/manifest.yml`]),
    ];

    for (const candidate of candidates) {
      fs.writeFileSync(
        path.join(root, '.changeledger', 'authority.yml'),
        `format_version: 1\nstate_ref: refs/heads/changeledger/state\nbaseline: ${candidate}\nproject_id: project-1\n`,
      );
      assert.throws(
        () => loadLedgerStore(root).load(),
        /baseline must identify a commit object/,
        `${objectFormat} must reject ${git(root, ['cat-file', '-t', candidate])}`,
      );
    }
  }
});

test('193101 hardening CR8: state mutation requires an explicit snapshot baseline', () => {
  const { root } = fixture();
  const store = loadLedgerStore(root);
  const before = store.load();
  assert.throws(
    () =>
      store.mutate({ message: 'test: missing baseline' }, ({ snapshot, write }) => {
        write(snapshot.changes[0].statePath, snapshot.changes[0].text.replace('Demo', 'Unsafe'));
      }),
    /expectedRevision is required/,
  );
  assert.equal(store.load().revision, before.revision);
});

test('193101 hardening CR8: a no-op mutation still linearizes against its snapshot', () => {
  const { root } = createStateRepo();
  const store = loadLedgerStore(root);
  const observed = store.load();
  let advanced;

  assert.throws(
    () =>
      store.mutate(
        { message: 'test: outer no-op', expectedRevision: observed.revision },
        ({ snapshot }) => {
          advanced = store.mutate(
            { message: 'test: concurrent successor', expectedRevision: snapshot.revision },
            ({ snapshot: current, write }) => {
              const change = current.changes[0];
              write(change.statePath, change.text.replace('title: Demo', 'title: Advanced'));
            },
          );
        },
      ),
    /Ledger state changed concurrently/,
  );
  assert.equal(store.load().revision, advanced.revision);
});

test('193101 hardening CR8: effective identity deltas preserve S1 without a commit', () => {
  const { root } = createStateRepo();
  const store = loadLedgerStore(root);
  const before = store.load();

  const after = store.mutate(
    { message: 'test: identity delta', expectedRevision: before.revision },
    ({ snapshot, write, remove }) => {
      write(snapshot.configStatePath, snapshot.configText);
      remove('.changeledger-state/specs/missing.md');
    },
  );

  assert.equal(after.revision, before.revision);
  assert.equal(store.load().revision, before.revision);
});

test('193101 hardening CR8: an effective identity delta rejects a concurrent successor', () => {
  const { root } = createStateRepo();
  const store = loadLedgerStore(root);
  const observed = store.load();
  let advanced;

  assert.throws(
    () =>
      store.mutate(
        { message: 'test: identity race', expectedRevision: observed.revision },
        ({ snapshot, write }) => {
          write(snapshot.configStatePath, snapshot.configText);
          advanced = store.mutate(
            { message: 'test: concurrent successor', expectedRevision: snapshot.revision },
            ({ snapshot: current, write: writeCurrent }) => {
              const change = current.changes[0];
              writeCurrent(change.statePath, change.text.replace('title: Demo', 'title: Advanced'));
            },
          );
        },
      ),
    /Ledger state changed concurrently/,
  );
  assert.equal(store.load().revision, advanced.revision);
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

test('193101 correction CR7: state writes reject a parallel lookalike root', () => {
  const { root } = fixture();
  const store = loadLedgerStore(root);
  const before = store.load();
  assert.throws(
    () =>
      store.mutate(
        { message: 'test: hidden parallel state', expectedRevision: before.revision },
        ({ write }) => {
          write('xchangeledger-state/changes/hidden.md', changeText({ id: '20260721-000001' }));
        },
      ),
    /invalid state path/,
  );
  assert.equal(store.load().revision, before.revision);
});

test('193101 correction CR6/CR8: every state transaction guards current and candidate schemas', () => {
  const future = createStateRepo({ configText: stateConfig({ schemaVersion: 4 }) });
  const futureStore = loadLedgerStore(future.root);
  const futureRevision = futureStore.load().revision;
  assert.throws(
    () =>
      futureStore.mutate(
        { message: 'test: must reject future source', expectedRevision: futureRevision },
        ({ snapshot, write }) => {
          write(snapshot.changes[0].statePath, snapshot.changes[0].text.replace('Demo', 'Changed'));
        },
      ),
    /config schema 4 is newer than supported schema 3/,
  );
  assert.equal(futureStore.load().revision, futureRevision);

  const supported = createStateRepo();
  const supportedStore = loadLedgerStore(supported.root);
  const supportedRevision = supportedStore.load().revision;
  assert.throws(
    () =>
      supportedStore.mutate(
        { message: 'test: must reject future candidate', expectedRevision: supportedRevision },
        ({ snapshot, write }) => {
          write(
            snapshot.configStatePath,
            snapshot.configText.replace('schema_version: 3', 'schema_version: 4'),
          );
        },
      ),
    /config schema 4 is newer than supported schema 3/,
  );
  assert.equal(supportedStore.load().revision, supportedRevision);
});

test('193101 correction CR8: expected revision prevents bulk preflight from crossing snapshots', () => {
  const { root } = createStateRepo();
  const store = loadLedgerStore(root);
  const initial = store.load();
  const advanced = store.mutate(
    { message: 'test: concurrent advance', expectedRevision: initial.revision },
    ({ snapshot, write }) => {
      write(snapshot.changes[0].statePath, snapshot.changes[0].text.replace('Demo', 'Advanced'));
    },
  );
  assert.throws(
    () =>
      store.mutate(
        { message: 'test: stale bulk', expectedRevision: initial.revision },
        ({ snapshot, write }) => {
          write(
            snapshot.changes[0].statePath,
            snapshot.changes[0].text.replace('Advanced', 'Stale'),
          );
        },
      ),
    /changed concurrently; retry/,
  );
  assert.equal(store.load().revision, advanced.revision);
  assert.match(store.load().changes[0].text, /Advanced/);
});

test('193101 correction CR8: lifecycle rejects a ref advance after its S1 preflight', () => {
  const { root } = createStateRepo({ changes: [changeText({ status: 'approved' })] });
  const store = loadLedgerStore(root);
  const before = store.load();
  assert.throws(
    () =>
      status('20260721-000000', 'in-progress', root, {
        actor: 'agent',
        ownerHandle() {
          store.mutate(
            {
              message: 'test: concurrent lifecycle advance',
              expectedRevision: before.revision,
            },
            ({ snapshot, write }) => {
              write(
                snapshot.changes[0].statePath,
                snapshot.changes[0].text.replace('title: Demo', 'title: Concurrent'),
              );
            },
          );
          return 'test-user';
        },
      }),
    /changed concurrently; retry/,
  );
  const after = store.load();
  assert.notEqual(after.revision, before.revision);
  assert.equal(after.changes[0].frontmatter.status, 'approved');
});

test('193101 correction CR2/CR3/CR6: context and register use authority-only state', () => {
  const { root } = createStateRepo();
  const snapshot = loadLedgerStore(root).load();
  const context = buildContext('20260721-000000', root);
  assert.match(context, new RegExp(`Ledger snapshot: ${snapshot.revision}`));
  assert.match(context, /# Selected change/);
  assert.match(context, /title: Demo/);
  const previousHome = process.env.CHANGELEDGER_HOME;
  process.env.CHANGELEDGER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-registry-'));
  try {
    const registered = registerRepo(root, { warn() {} });
    assert.equal(registered.id, 'project-1');
  } finally {
    if (previousHome === undefined) delete process.env.CHANGELEDGER_HOME;
    else process.env.CHANGELEDGER_HOME = previousHome;
  }
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

  const after = store.mutate(
    { message: 'test: update ledger snapshot', expectedRevision: before.revision },
    ({ snapshot, write }) => {
      const change = snapshot.changes[0];
      write(change.statePath, change.text.replace('title: Demo', 'title: Updated'));
    },
  );

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
      store.mutate(
        { message: 'test: invalid ledger snapshot', expectedRevision: before.revision },
        ({ snapshot, write }) => {
          write(snapshot.changes[0].statePath, 'not a change document\n');
        },
      ),
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

test('193101 correction CR7: state paths use raw NUL framing across Git formats', () => {
  const specText = [
    '---',
    'title: Portable path',
    'updated: 2026-07-22T00:00:00Z',
    'tags: [portability]',
    '---',
    '',
    '# Portable path',
    '',
  ].join('\n');
  const names = [
    'café.md',
    'carriage\rreturn.md',
    'colon:name.md',
    'line\nbreak.md',
    'quote"back\\slash\tname.md',
  ];

  for (const objectFormat of ['sha1', 'sha256']) {
    let created;
    try {
      created = createStateRepo({
        objectFormat,
        specs: Object.fromEntries(names.map((name) => [name, specText])),
      });
    } catch (error) {
      if (
        objectFormat === 'sha256' &&
        /unknown option|unsupported|not supported/i.test(error.message)
      ) {
        continue;
      }
      throw error;
    }

    for (const quotePath of ['true', 'false']) {
      git(created.root, ['config', 'core.quotePath', quotePath]);
      const snapshot = loadLedgerStore(created.root).load();
      assert.deepEqual(
        snapshot.specs.map((spec) => spec.name).sort(),
        names.toSorted(),
        `${objectFormat} with core.quotePath=${quotePath}`,
      );
    }

    const store = loadLedgerStore(created.root);
    const before = store.load();
    const target = before.specs.find((spec) => spec.name === 'line\nbreak.md');
    const after = store.mutate(
      { message: 'test: update unusual path', expectedRevision: before.revision },
      ({ write }) => write(target.statePath, target.text.replace('# Portable', '# Updated')),
    );
    assert.notEqual(after.revision, before.revision, objectFormat);
    assert.match(
      after.specs.find((spec) => spec.name === target.name).text,
      /# Updated path/,
      objectFormat,
    );
  }
});

test('193101 correction CR7: state path grammar rejects suffix line breaks', () => {
  const { root } = createStateRepo();
  const store = loadLedgerStore(root);
  const before = store.load();

  assert.throws(
    () =>
      store.mutate(
        { message: 'test: reject suffix break', expectedRevision: before.revision },
        ({ write }) => write('.changeledger-state/specs/look-valid.md\n', '# Invalid\n'),
      ),
    /invalid state path/,
  );
  assert.equal(store.load().revision, before.revision);
});

test('170612 CR2: full snapshot load rejects a non-regular Git mode (symlink)', () => {
  const created = createStateRepo();
  git(created.root, ['checkout', '-q', 'changeledger/state']);
  fs.symlinkSync('manifest.yml', path.join(created.state, 'specs', 'x.md'));
  git(created.root, ['add', '.changeledger-state']);
  git(created.root, ['commit', '-qm', 'test: symlink spec entry']);
  const rev = git(created.root, ['rev-parse', 'HEAD']);
  git(created.root, ['checkout', '-q', 'dev']);
  const authority = {
    format_version: 1,
    baseline: rev,
    project_id: 'project-1',
    state_ref: STATE_REF,
  };
  assert.throws(
    () => validateServerStateRevision(created.root, authority, rev, defaultRun),
    (error) =>
      /unsupported Git entry 120000/.test(error.message) &&
      /\.changeledger-state\/specs\/x\.md/.test(error.message),
  );
});

test('170612 CR3: full snapshot load keeps accepting 100644 and 100755 blobs', () => {
  const created = createStateRepo();
  git(created.root, ['config', 'core.fileMode', 'true']);
  git(created.root, ['checkout', '-q', 'changeledger/state']);
  const rel = '.changeledger-state/changes/20260721-111111-exec.md';
  const abs = path.join(created.root, rel);
  fs.writeFileSync(abs, changeText({ id: '20260721-111111', title: 'Exec' }));
  fs.chmodSync(abs, 0o755);
  git(created.root, ['add', rel]);
  git(created.root, ['commit', '-qm', 'test: executable change entry']);
  const rev = git(created.root, ['rev-parse', 'HEAD']);
  git(created.root, ['checkout', '-q', 'dev']);
  assert.equal(git(created.root, ['ls-tree', rev, rel]).split(' ')[0], '100755');
  const authority = {
    format_version: 1,
    baseline: rev,
    project_id: 'project-1',
    state_ref: STATE_REF,
  };
  const snapshot = validateServerStateRevision(created.root, authority, rev, defaultRun);
  assert.ok(snapshot.changes.some((change) => change.frontmatter.id === '20260721-111111'));
});
