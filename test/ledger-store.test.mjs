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
import {
  loadLedgerStore,
  repoProvenance,
  STATE_REF,
  validateServerStateRevision,
} from '../src/ledger-store.mjs';
import { loadRepo } from '../src/repo.mjs';
import { CONFIRMED_REF, OBSERVED_REF, PENDING_REF, PUBLIC_STATE_REF } from '../src/state-store.mjs';
import { serialize } from '../src/viewer/domain.mjs';
import { changeText, createStateRepo, stateConfig } from './helpers/state-repo.mjs';

// This suite may run inside this repo's own pre-commit hook, which exports
// GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE for the outer repo. Left inherited,
// fixture git calls (notably `git worktree add`) would target the outer
// repo's index — strip them so tests are hook-safe.
const GIT_ENV = { ...process.env };
for (const key of [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_CEILING_DIRECTORIES',
]) {
  delete GIT_ENV[key];
}
function git(root, args) {
  return execFileSync('git', args, { cwd: root, env: GIT_ENV, encoding: 'utf8' }).trim();
}

// Installs `refs/changeledger/activation` at the given commit (defaulting to the
// authority commit on `dev`). The activation ref -- not the worktree file -- is
// what makes a v2 authority operative under 20260723-202646; the writer side
// lives in the state-migration delegate, so tests set the ref directly.
function activate(root, commit) {
  git(root, [
    'update-ref',
    'refs/changeledger/activation',
    commit ?? git(root, ['rev-parse', 'HEAD']),
  ]);
}

function fixture({
  mutateState,
  objectFormat,
  authorityFormat = 1,
  seedConfirmed = false,
  authorityText,
  // A v2 authority is only operative once activation is installed; default to
  // installing it so v2 fixtures load in state mode. Bootstrap/downgrade tests
  // opt out to exercise the "v2 file without activation" matrix rows.
  install = authorityFormat === 2,
} = {}) {
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
  const resolvedAuthorityText =
    typeof authorityText === 'function' ? authorityText(baseline) : authorityText;
  fs.writeFileSync(
    path.join(root, '.changeledger', 'authority.yml'),
    resolvedAuthorityText ??
      `format_version: ${authorityFormat}\nstate_ref: refs/heads/changeledger/state\nbaseline: ${baseline}\nproject_id: project-1\n${replicaFields}`,
  );
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'chore: authority']);
  const activationCommit = git(root, ['rev-parse', 'HEAD']);
  if (install) activate(root, activationCommit);
  return { root, baseline, activationCommit };
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

// A schema-valid activated v2 replica whose baseline holds two changes. The
// extra change is referenced by nothing (no spec graduated_from, no release),
// so a snapshot without it stays schema-valid: only the identity continuity
// policy can reject its removal. The repo is its own remote so sync fetches
// the local `changeledger/state` branch.
const EXTRA_CHANGE_PATH = '.changeledger-state/changes/20260721-000001-change.md';
function replicaStateRepo({ configText } = {}) {
  const { root, baseline } = createStateRepo({
    changes: [changeText(), changeText({ id: '20260721-000001', title: 'Extra' })],
    ...(configText ? { configText } : {}),
  });
  fs.writeFileSync(
    path.join(root, '.changeledger', 'authority.yml'),
    `format_version: 2\nstate_ref: ${PUBLIC_STATE_REF}\nbaseline: ${baseline}\nproject_id: project-1\ninventory_digest: ${'a'.repeat(64)}\nminimum_client_version: 0.13.0\n`,
  );
  git(root, ['add', '.changeledger/authority.yml']);
  git(root, ['commit', '-qm', 'chore: authority v2']);
  activate(root);
  git(root, ['update-ref', CONFIRMED_REF, baseline]);
  git(root, ['update-ref', OBSERVED_REF, baseline]);
  git(root, ['remote', 'add', 'origin', root]);
  return { root, baseline };
}

// Advances the public state branch with the given worktree mutation and
// returns the new head, leaving `dev` checked out again.
function advancePublicState(root, message, mutateWorktree) {
  git(root, ['checkout', '-q', 'changeledger/state']);
  mutateWorktree(path.join(root, '.changeledger-state'));
  git(root, ['add', '.changeledger-state']);
  git(root, ['commit', '-qm', message]);
  const head = git(root, ['rev-parse', 'HEAD']);
  git(root, ['checkout', '-q', 'dev']);
  return head;
}

test('202058 CR2: sync refuses to confirm a remote descendant that removes an identity', () => {
  const { root, baseline } = replicaStateRepo();
  const removal = advancePublicState(root, 'test: remote drops the extra change', () =>
    fs.rmSync(path.join(root, EXTRA_CHANGE_PATH)),
  );

  assert.throws(
    () => loadLedgerStore(root).replica.sync(),
    new RegExp(`state revision ${removal} removes changes identity "20260721-000001"`),
  );
  assert.equal(git(root, ['rev-parse', CONFIRMED_REF]), baseline);
  assert.equal(git(root, ['rev-parse', OBSERVED_REF]), baseline);
  assert.throws(() => git(root, ['rev-parse', '--verify', PENDING_REF]));
});

test('202058 CR2: a removal hidden in an intermediate synced commit still fails closed', () => {
  const { root, baseline } = replicaStateRepo();
  const extraText = changeText({ id: '20260721-000001', title: 'Extra' });
  const removal = advancePublicState(root, 'test: intermediate commit drops the change', () =>
    fs.rmSync(path.join(root, EXTRA_CHANGE_PATH)),
  );
  advancePublicState(root, 'test: tip restores the change', () =>
    fs.writeFileSync(path.join(root, EXTRA_CHANGE_PATH), extraText),
  );

  // The tip snapshot is complete, so a tip-against-parent read check cannot
  // see the intermediate disappearance; only the per-commit range policy can.
  assert.throws(
    () => loadLedgerStore(root).replica.sync(),
    new RegExp(`state revision ${removal} removes changes identity "20260721-000001"`),
  );
  assert.equal(git(root, ['rev-parse', CONFIRMED_REF]), baseline);
  assert.equal(git(root, ['rev-parse', OBSERVED_REF]), baseline);
});

test('202058 CR2: sync refuses to publish a forged pending that removes an identity', () => {
  const { root, baseline } = replicaStateRepo();
  const forged = advancePublicState(root, 'test: forged pending drops the extra change', () =>
    fs.rmSync(path.join(root, EXTRA_CHANGE_PATH)),
  );
  git(root, ['update-ref', 'refs/heads/changeledger/state', baseline]);
  git(root, ['update-ref', PENDING_REF, forged]);

  assert.throws(
    () => loadLedgerStore(root).replica.sync(),
    new RegExp(`invalid pending state ${forged}: .*removes changes identity "20260721-000001"`),
  );
  assert.equal(git(root, ['rev-parse', CONFIRMED_REF]), baseline);
  assert.equal(git(root, ['rev-parse', PENDING_REF]), forged);
});

test('202058 CR2: abort refuses to confirm a published range that removes an identity', () => {
  const { root, baseline } = replicaStateRepo();
  const pendingHead = advancePublicState(root, 'test: benign pending', () => {
    const file = path.join(root, '.changeledger-state/changes/20260721-000000-change.md');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('title: Demo', 'title: New'));
  });
  const removal = advancePublicState(root, 'test: remote removal above the pending', () =>
    fs.rmSync(path.join(root, EXTRA_CHANGE_PATH)),
  );
  git(root, ['update-ref', PENDING_REF, pendingHead]);

  assert.throws(
    () => loadLedgerStore(root).replica.abort({}),
    new RegExp(`state revision ${removal} removes changes identity "20260721-000001"`),
  );
  assert.equal(git(root, ['rev-parse', CONFIRMED_REF]), baseline);
  assert.equal(git(root, ['rev-parse', PENDING_REF]), pendingHead);
});

test('202058 CR2: confirm-observed refuses a remote that extends the pending with a removal', () => {
  const { root, baseline } = replicaStateRepo();
  const pendingHead = advancePublicState(root, 'test: benign pending', () => {
    const file = path.join(root, '.changeledger-state/changes/20260721-000000-change.md');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('title: Demo', 'title: New'));
  });
  const removal = advancePublicState(root, 'test: remote removal above the pending', () =>
    fs.rmSync(path.join(root, EXTRA_CHANGE_PATH)),
  );
  git(root, ['update-ref', PENDING_REF, pendingHead]);

  assert.throws(
    () => loadLedgerStore(root).replica.sync(),
    new RegExp(`state revision ${removal} removes changes identity "20260721-000001"`),
  );
  assert.equal(git(root, ['rev-parse', CONFIRMED_REF]), baseline);
  assert.equal(git(root, ['rev-parse', PENDING_REF]), pendingHead);
});

test('202058 CR2: replay refuses a diverged remote whose range removes an identity', () => {
  const { root, baseline } = replicaStateRepo();
  const pendingHead = advancePublicState(root, 'test: benign pending', () => {
    const file = path.join(root, '.changeledger-state/changes/20260721-000000-change.md');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('title: Demo', 'title: New'));
  });
  git(root, ['update-ref', 'refs/heads/changeledger/state', baseline]);
  const removal = advancePublicState(root, 'test: diverged remote removes the extra change', () =>
    fs.rmSync(path.join(root, EXTRA_CHANGE_PATH)),
  );
  git(root, ['update-ref', PENDING_REF, pendingHead]);

  assert.throws(
    () => loadLedgerStore(root).replica.sync(),
    new RegExp(`state revision ${removal} removes changes identity "20260721-000001"`),
  );
  assert.equal(git(root, ['rev-parse', CONFIRMED_REF]), baseline);
  assert.equal(git(root, ['rev-parse', PENDING_REF]), pendingHead);
});

test('202058 CR2: a direct mutation refuses to adopt a remote removal during its pre-sync', () => {
  const { root, baseline } = replicaStateRepo();
  const removal = advancePublicState(root, 'test: remote drops the extra change', () =>
    fs.rmSync(path.join(root, EXTRA_CHANGE_PATH)),
  );
  const store = loadLedgerStore(root);

  assert.throws(
    () =>
      store.mutate({ message: 'test: mutate over removal', expectedRevision: baseline }, () => {}),
    new RegExp(`state revision ${removal} removes changes identity "20260721-000001"`),
  );
  assert.equal(git(root, ['rev-parse', CONFIRMED_REF]), baseline);
  assert.throws(() => git(root, ['rev-parse', '--verify', PENDING_REF]));
});

test('202058 CR2: a removal published between preflight and mutate fails the post-commit sync', () => {
  const { root, baseline } = replicaStateRepo();
  const store = loadLedgerStore(root);
  store.prepareMutation();
  const removal = advancePublicState(root, 'test: removal lands after the preflight', () =>
    fs.rmSync(path.join(root, EXTRA_CHANGE_PATH)),
  );

  assert.throws(
    () =>
      store.mutate(
        { message: 'test: raced mutation', expectedRevision: baseline },
        ({ snapshot, write }) => {
          const change = snapshot.changes[0];
          write(change.statePath, change.text.replace('title: Demo', 'title: Raced'));
        },
      ),
    new RegExp(`state revision ${removal} removes changes identity "20260721-000001"`),
  );
  // The local pending commit was already created; what matters is that the
  // truncated remote history was never adopted as confirmed truth.
  assert.equal(git(root, ['rev-parse', CONFIRMED_REF]), baseline);
});

// The activation ref is the sole authority every read resolves, so an object
// that is not a commit there is invalid state, never something to read truth
// from. `state-migration`'s resolver already classified it; the read path did
// not, which let `list`/`state status` serve a repo whose authority came from a
// tree (audit row AUTH-12).
const ACTIVATION_NOT_A_COMMIT =
  /state activation ref refs\/changeledger\/activation must point to a commit/;

function repointActivation(root, oid) {
  fs.writeFileSync(path.join(root, '.git', 'refs', 'changeledger', 'activation'), `${oid}\n`);
}

test('104052 CR4/CR7: reads refuse an activation ref that is a tree or a blob', () => {
  for (const kind of ['tree', 'blob']) {
    const { root, baseline } = replicaStateRepo();
    const authorityCommit = git(root, ['rev-parse', 'refs/changeledger/activation']);
    const oid =
      kind === 'tree'
        ? git(root, ['rev-parse', `${authorityCommit}^{tree}`])
        : git(root, ['rev-parse', `${authorityCommit}:.changeledger/authority.yml`]);
    repointActivation(root, oid);

    assert.throws(() => loadLedgerStore(root), ACTIVATION_NOT_A_COMMIT, `${kind} must fail closed`);
    // A blob used to fail with a different diagnostic by accident of the
    // plumbing (`cat-file blob <blob>:<path>` cannot resolve), not by a guard.
    assert.doesNotThrow(() => git(root, ['rev-parse', baseline]));
  }
});

test('104052 CR6: provenance refuses an activation object outside every commit', () => {
  const { root } = replicaStateRepo();
  const authorityCommit = git(root, ['rev-parse', 'refs/changeledger/activation']);
  const tree = git(root, ['rev-parse', `${authorityCommit}^{tree}`]);
  repointActivation(root, tree);
  assert.throws(() => repoProvenance(root), ACTIVATION_NOT_A_COMMIT);

  // A tree forged with mktree is contained in no commit, branch or tag at all.
  const forged = git(
    root,
    ['mktree'],
    `100644 blob ${git(root, ['hash-object', '-w', '--stdin'], 'x\n')}\tx\n`,
  );
  repointActivation(root, forged);
  assert.throws(() => repoProvenance(root), ACTIVATION_NOT_A_COMMIT);
});

// Unlike the activation ref, the replica refs live under `refs/changeledger/*`,
// where git happily writes a non-commit: `update-ref` refuses only under
// `refs/heads/*`. So this is the weakest vector of the whole class and needs no
// hand-edited loose ref. The write side has asserted the tip since 20260724-212722;
// the read side had not, which let `list`/`state status`/`check` report a tag OID
// as the ledger revision.
test('104052 CR9: every replica read refuses a tip that is not a commit', async () => {
  const { exportStateRecovery } = await import('../src/state-migration.mjs');
  for (const ref of [CONFIRMED_REF, OBSERVED_REF, PENDING_REF]) {
    const { root, baseline } = replicaStateRepo();
    git(root, ['tag', '-a', '-m', 'evil', 'evil', baseline]);
    const tag = git(root, ['rev-parse', 'refs/tags/evil']);
    git(root, ['update-ref', ref, tag]);
    const expected = new RegExp(`state replica tip ${tag} must point to a commit`);

    // Every consumer of the shared resolver, not just the snapshot loader: the
    // first fix guarded `gitStateRevision` alone, so `state status` still exited
    // 0 reporting the tag OID and recovery still materialized a branch from it.
    assert.throws(() => loadLedgerStore(root).load(), expected, `load must reject ${ref}`);
    assert.throws(
      () => loadLedgerStore(root).replica.status(),
      expected,
      `state status must reject ${ref}`,
    );
    assert.throws(() => exportStateRecovery(root), expected, `recovery must reject ${ref}`);
  }
});

// The clause above only proves the diagnostic. Proving that NOTHING is written
// needs a repo where recovery could actually succeed: `stateConfig` declares no
// `git.integration_branch`, and recovery also requires confirmed === observed, so
// in the loop's fixtures the branch could never be born and asserting its absence
// would pass for the wrong reason. This case removes both obstacles.
test('104052 CR9: no recovery branch is born from a non-commit tip', async () => {
  const { exportStateRecovery } = await import('../src/state-migration.mjs');
  const { root, baseline } = replicaStateRepo({
    configText: `${stateConfig()}git:\n  integration_branch: dev\n`,
  });
  git(root, ['tag', '-a', '-m', 'evil', 'evil', baseline]);
  const tag = git(root, ['rev-parse', 'refs/tags/evil']);
  git(root, ['update-ref', CONFIRMED_REF, tag]);
  git(root, ['update-ref', OBSERVED_REF, tag]);

  // The branch check is asserted BEFORE the diagnostic on purpose: as
  // `assert.throws(...)` first, a missing guard fails there and this clause is
  // never reached, which is how it stayed unverifiable through two rounds.
  let failure = null;
  try {
    exportStateRecovery(root);
  } catch (caught) {
    failure = caught;
  }
  assert.equal(
    git(root, ['for-each-ref', '--format=%(refname)', 'refs/heads/changeledger/recover-*']),
    '',
    'no recovery branch may be materialized from a non-commit tip',
  );
  assert.match(String(failure), new RegExp(`state replica tip ${tag} must point to a commit`));
});

test('104052 CR5: recovery is not materialized from a non-commit authority', async () => {
  // Declares `git.integration_branch` on purpose: without it recovery refuses
  // before reaching the guard, so asserting that no branch exists would pass for
  // the wrong reason. CR9's case cannot stand in for this one -- its corruption is
  // a replica tip guarded in `readStateReplica`, while this is an activation ref
  // guarded in `activationCommitOid`: different site, different guard, different
  // module.
  const { root } = replicaStateRepo({
    configText: `${stateConfig()}git:\n  integration_branch: dev\n`,
  });
  const { exportStateRecovery } = await import('../src/state-migration.mjs');
  const authorityCommit = git(root, ['rev-parse', 'refs/changeledger/activation']);
  repointActivation(root, git(root, ['rev-parse', `${authorityCommit}^{tree}`]));

  // Branch check before the diagnostic: as `assert.throws(...)` first, a missing
  // guard fails there and this clause is never evaluated.
  let failure = null;
  try {
    exportStateRecovery(root);
  } catch (caught) {
    failure = caught;
  }
  assert.equal(
    git(root, ['for-each-ref', '--format=%(refname)', 'refs/heads/changeledger/recover-*']),
    '',
    'no recovery branch may be materialized from a non-commit authority',
  );
  assert.match(String(failure), ACTIVATION_NOT_A_COMMIT);
});

test('104052 CR7: an annotated tag activation resolves to its authority commit', () => {
  const { root } = replicaStateRepo();
  const authorityCommit = git(root, ['rev-parse', 'refs/changeledger/activation']);
  git(root, ['tag', '-a', '-m', 'pinned', 'pinned-activation', authorityCommit]);
  const tag = git(root, ['rev-parse', 'pinned-activation']);
  assert.notEqual(tag, authorityCommit);
  repointActivation(root, tag);

  assert.equal(loadLedgerStore(root).load().changes.length, 2);
  assert.equal(repoProvenance(root).project_id, 'project-1');
});

test('212722 CR1: sync rejects a hand-corrupted remote tip that is not a commit', () => {
  const { root, baseline } = replicaStateRepo();
  git(root, ['tag', '-a', '-m', 'evil', 'evil-tag', baseline]);
  const tag = git(root, ['rev-parse', 'evil-tag']);
  // git update-ref and receive-pack both refuse a non-commit branch tip, so
  // reproduce the hostile/corrupted remote by writing the loose ref by hand.
  fs.writeFileSync(path.join(root, '.git', 'refs', 'heads', 'changeledger', 'state'), `${tag}\n`);

  assert.throws(
    () => loadLedgerStore(root).replica.sync(),
    new RegExp(`state replica tip ${tag} must point to a commit`),
  );
  assert.equal(git(root, ['rev-parse', CONFIRMED_REF]), baseline);
  assert.equal(git(root, ['rev-parse', OBSERVED_REF]), baseline);
  assert.throws(() => git(root, ['rev-parse', '--verify', PENDING_REF]));
});

test('212722 CR2: abort rejects the same non-commit remote tip preserving the pending', () => {
  const { root, baseline } = replicaStateRepo();
  const pendingHead = advancePublicState(root, 'test: benign pending', () => {
    const file = path.join(root, '.changeledger-state/changes/20260721-000000-change.md');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('title: Demo', 'title: New'));
  });
  git(root, ['update-ref', PENDING_REF, pendingHead]);
  git(root, ['tag', '-a', '-m', 'evil', 'evil-tag', pendingHead]);
  const tag = git(root, ['rev-parse', 'evil-tag']);
  fs.writeFileSync(path.join(root, '.git', 'refs', 'heads', 'changeledger', 'state'), `${tag}\n`);

  assert.throws(
    () => loadLedgerStore(root).replica.abort({}),
    new RegExp(`state replica tip ${tag} must point to a commit`),
  );
  assert.equal(git(root, ['rev-parse', CONFIRMED_REF]), baseline);
  assert.equal(git(root, ['rev-parse', PENDING_REF]), pendingHead);
});

test('202058 CR2: a preserving remote advance still syncs and confirms', () => {
  const { root } = replicaStateRepo();
  const advanced = advancePublicState(root, 'test: preserving advance', () => {
    const file = path.join(root, '.changeledger-state/changes/20260721-000000-change.md');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('title: Demo', 'title: New'));
  });

  const result = loadLedgerStore(root).replica.sync();
  assert.equal(result.confirmed, true);
  assert.equal(result.effective, advanced);
  assert.equal(git(root, ['rev-parse', CONFIRMED_REF]), advanced);
});

test('193103 CR7: replica authority requires immutable provenance and a compatible client', () => {
  // The operative authority is the activation commit's committed file, so the
  // invalid content must be what activation pins -- install it that way.
  const missingDigest = fixture({
    authorityFormat: 2,
    seedConfirmed: true,
    authorityText: (baseline) =>
      `format_version: 2\nstate_ref: ${PUBLIC_STATE_REF}\nbaseline: ${baseline}\nproject_id: project-1\nminimum_client_version: 0.13.0\n`,
  });
  assert.throws(
    () => loadLedgerStore(missingDigest.root).load(),
    /Invalid state authority inventory_digest/,
  );

  const futureClient = fixture({
    authorityFormat: 2,
    seedConfirmed: true,
    authorityText: (baseline) =>
      `format_version: 2\nstate_ref: ${PUBLIC_STATE_REF}\nbaseline: ${baseline}\nproject_id: project-1\ninventory_digest: ${'a'.repeat(64)}\nminimum_client_version: 99.0.0\n`,
  });
  assert.throws(
    () => loadLedgerStore(futureClient.root).load(),
    /state authority requires client >= 99\.0\.0/,
  );

  const mismatched = fixture({
    authorityFormat: 2,
    seedConfirmed: true,
    authorityText: (baseline) =>
      `format_version: 2\nstate_ref: ${PUBLIC_STATE_REF}\nbaseline: ${baseline}\nproject_id: project-1\ninventory_digest: ${'b'.repeat(64)}\nminimum_client_version: 0.13.0\n`,
  });
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
  const { root } = fixture({ authorityFormat: 2, seedConfirmed: true, install: false });
  preCutoverWorktree(root);
  assert.throws(
    () => loadLedgerStore(root).load(),
    /state authority is missing[\s\S]*refs\/changeledger\/confirmed[\s\S]*state activate/,
  );
});

test('202057 correction: absent authority with only a v2 pending ref fails closed', () => {
  const { root, baseline } = fixture({ authorityFormat: 2, install: false });
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

test('104052 CR10: offline abort still discards a pending that is not a commit', () => {
  const { root, baseline } = replicaStateRepo();
  git(root, ['tag', '-a', '-m', 'evil', 'evil', baseline]);
  const tag = git(root, ['rev-parse', 'refs/tags/evil']);
  git(root, ['update-ref', PENDING_REF, tag]);

  // Classifying every read would leave the documented escape hatch unreachable
  // exactly when it is needed. Discarding a ref adopts nothing, so it is allowed
  // on the corruption every other read refuses.
  const result = loadLedgerStore(root).replica.abort({ offline: true });
  assert.equal(result.aborted, true);
  assert.equal(result.offline, true);
  assert.throws(() => git(root, ['rev-parse', '--verify', PENDING_REF]));
  assert.equal(loadLedgerStore(root).load().changes.length, 2, 'reads recover after the repair');
});

test('104052 CR9: a v1 authority state_ref that is not a commit is refused', () => {
  const { root, baseline } = fixture();
  git(root, ['tag', '-a', 'evil', baseline, '-m', 'evil']);
  const tag = git(root, ['rev-parse', 'refs/tags/evil']);
  // Under `refs/heads/*` git refuses a non-commit, so the loose ref is written
  // by hand -- the same vector the published-baseline fixtures use.
  fs.writeFileSync(path.join(root, '.git', 'refs', 'heads', 'changeledger', 'state'), `${tag}\n`);

  assert.throws(
    () => loadLedgerStore(root).load(),
    /state replica tip refs\/heads\/changeledger\/state must point to a commit/,
  );
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
  assert.match(
    context,
    new RegExp(`Ledger snapshot: ${snapshot.revision} — .*project: project-1; repo: .+`),
  );
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
  assert.match(context, /Ledger snapshot: .*project: project-1; repo: .+/);
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

// --- 20260723-202646: checkout-independent activation resolver ---------------

test('202646 CR1: activation drives state mode when the worktree authority is absent', () => {
  const { root, activationCommit } = fixture({ authorityFormat: 2, seedConfirmed: true });
  // The revision the properly-activated (post-cutover) checkout resolves...
  const postCutover = loadLedgerStore(root).load();
  assert.equal(postCutover.mode, 'state');
  assert.equal(git(root, ['rev-parse', 'refs/changeledger/activation']), activationCommit);

  // ...must be identical after downgrading to a pre-cutover checkout that has no
  // authority.yml: activation, not the worktree file, decides the truth.
  preCutoverWorktree(root);
  const preCutover = loadLedgerStore(root).load();
  assert.equal(preCutover.mode, 'state');
  assert.equal(preCutover.revision, postCutover.revision);
  assert.equal(fs.existsSync(path.join(root, '.changeledger', 'authority.yml')), false);
});

test('202646 CR2: every worktree shares the activation and resolves the same revision', () => {
  const { root } = fixture({ authorityFormat: 2, seedConfirmed: true });
  const main = loadLedgerStore(root).load();
  assert.equal(main.mode, 'state');

  // A linked worktree checked out on the pre-cutover base commit (no
  // authority.yml in its tree) still shares refs/changeledger/* via the common
  // dir, so it must resolve the identical state revision.
  const base = git(root, ['rev-parse', 'dev^']);
  const linked = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-linked-worktree-'));
  git(root, ['worktree', 'add', '-q', '--detach', linked, base]);
  assert.equal(fs.existsSync(path.join(linked, '.changeledger', 'authority.yml')), false);

  const fromLinked = loadLedgerStore(linked).load();
  assert.equal(fromLinked.mode, 'state');
  assert.equal(fromLinked.revision, main.revision);
});

test('202646 CR4: a divergent worktree v2 authority fails closed with the exact conflict', () => {
  const { root, activationCommit } = fixture({ authorityFormat: 2, seedConfirmed: true });
  // A v2 file that parses but diverges from the activation authority (different
  // inventory_digest) is the conflict case, not a silently ignored artifact.
  fs.writeFileSync(
    path.join(root, '.changeledger', 'authority.yml'),
    `format_version: 2\nstate_ref: ${PUBLIC_STATE_REF}\nbaseline: ${git(root, ['rev-parse', 'dev^'])}\nproject_id: project-1\ninventory_digest: ${'c'.repeat(64)}\nminimum_client_version: 0.13.0\n`,
  );
  assert.throws(
    () => loadLedgerStore(root).load(),
    new Error(
      `state authority conflict: refs/changeledger/activation (${activationCommit}) differs from .changeledger/authority.yml`,
    ),
  );
});

test('202646 CR4: activation ignores an absent, v1 or identical v2 worktree authority', () => {
  // Identical v2 (the fixture default) loads in state mode.
  const identical = fixture({ authorityFormat: 2, seedConfirmed: true });
  assert.equal(loadLedgerStore(identical.root).load().mode, 'state');

  // A stale v1 file is ignored: the load still resolves via activation.
  const v1File = fixture({ authorityFormat: 2, seedConfirmed: true });
  const v1Revision = loadLedgerStore(v1File.root).load().revision;
  fs.writeFileSync(
    path.join(v1File.root, '.changeledger', 'authority.yml'),
    `format_version: 1\nstate_ref: ${PUBLIC_STATE_REF}\nbaseline: ${v1File.baseline}\nproject_id: project-1\n`,
  );
  const afterV1 = loadLedgerStore(v1File.root).load();
  assert.equal(afterV1.mode, 'state');
  assert.equal(afterV1.revision, v1Revision);

  // An absent file (pre-cutover checkout) is ignored too.
  const absent = fixture({ authorityFormat: 2, seedConfirmed: true });
  preCutoverWorktree(absent.root);
  assert.equal(loadLedgerStore(absent.root).load().mode, 'state');
});

test('235906: ref read failures never degrade or allow a mutation', () => {
  const activationFailure = fixture({ authorityFormat: 2, seedConfirmed: true });
  preCutoverWorktree(activationFailure.root);
  const unreadableActivation = (args, cwd, options) => {
    if (args[0] === 'rev-parse' && args.at(-1) === 'refs/changeledger/activation') {
      throw new Error('EACCES: activation ref is unreadable');
    }
    return defaultRun(args, cwd, options);
  };
  assert.throws(
    () => loadLedgerStore(activationFailure.root, { run: unreadableActivation }),
    /activation ref is unreadable/,
  );
  assert.throws(
    () => repoProvenance(activationFailure.root, { run: unreadableActivation }),
    /activation ref is unreadable/,
  );

  const replicaFailure = fixture({ authorityFormat: 2, seedConfirmed: true });
  preCutoverWorktree(replicaFailure.root);
  const unreadableReplica = (args, cwd, options) => {
    if (args[0] === 'rev-parse' && args.at(-1) === 'refs/changeledger/activation') {
      const error = new Error('missing activation');
      error.cause = { status: 1 };
      throw error;
    }
    if (args[0] === 'rev-parse' && args.at(-1) === CONFIRMED_REF) {
      throw new Error('EACCES: confirmed ref is unreadable');
    }
    return defaultRun(args, cwd, options);
  };
  assert.throws(
    () => loadLedgerStore(replicaFailure.root, { run: unreadableReplica }),
    /confirmed ref is unreadable/,
  );

  const activeReplicaFailure = fixture({ authorityFormat: 2, seedConfirmed: true });
  const unreadableActiveConfirmed = (args, cwd, options) => {
    if (args[0] === 'rev-parse' && args.at(-1) === CONFIRMED_REF) {
      throw new Error('EACCES: active confirmed ref is unreadable');
    }
    return defaultRun(args, cwd, options);
  };
  assert.throws(
    () => loadLedgerStore(activeReplicaFailure.root, { run: unreadableActiveConfirmed }).load(),
    /active confirmed ref is unreadable/,
  );

  const mutationFailure = fixture({ authorityFormat: 2, seedConfirmed: true });
  let failNextPendingRead = false;
  const unreadableMutationPending = (args, cwd, options) => {
    if (failNextPendingRead && args[0] === 'rev-parse' && args.at(-1) === PENDING_REF) {
      failNextPendingRead = false;
      throw new Error('EACCES: mutation pending ref is unreadable');
    }
    return defaultRun(args, cwd, options);
  };
  const mutationStore = loadLedgerStore(mutationFailure.root, {
    run: unreadableMutationPending,
  });
  const beforeMutation = mutationStore.load();
  const readMutationRef = (ref) => {
    try {
      return git(mutationFailure.root, ['rev-parse', '--verify', ref]);
    } catch {
      return null;
    }
  };
  const beforeMutationRefs = {
    confirmed: readMutationRef(CONFIRMED_REF),
    observed: readMutationRef('refs/changeledger/observed'),
    pending: readMutationRef(PENDING_REF),
  };
  const beforeMutationObjects = git(mutationFailure.root, ['count-objects', '-v']);
  let mutatorCalled = false;
  failNextPendingRead = true;
  assert.throws(
    () =>
      mutationStore.mutate(
        {
          message: 'test: must not mutate with unreadable pending',
          expectedRevision: beforeMutation.revision,
        },
        () => {
          mutatorCalled = true;
        },
      ),
    /mutation pending ref is unreadable/,
  );
  assert.equal(mutatorCalled, false);
  assert.deepEqual(
    {
      confirmed: readMutationRef(CONFIRMED_REF),
      observed: readMutationRef('refs/changeledger/observed'),
      pending: readMutationRef(PENDING_REF),
    },
    beforeMutationRefs,
  );
  assert.equal(git(mutationFailure.root, ['count-objects', '-v']), beforeMutationObjects);
});

test('202646 bootstrap: a v2 worktree authority without activation fails closed', () => {
  const { root } = fixture({ authorityFormat: 2, seedConfirmed: true, install: false });
  assert.throws(
    () => loadLedgerStore(root).load(),
    new Error(
      'state authority format_version: 2 is not installed; run `changeledger state activate --install --integration-ref <full-ref>`',
    ),
  );
});

test('202646 CR7: a legacy repo with no activation and no authority is unchanged', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-legacy-noact-'));
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
  assert.equal(repoProvenance(root).project_id, 'legacy');
});

test('202646 CR9: repoProvenance resolves project_id from activation, not the checkout', () => {
  const { root, activationCommit } = fixture({ authorityFormat: 2, seedConfirmed: true });
  // Pre-cutover checkout whose visible config names a different project.
  preCutoverWorktree(root);
  assert.match(
    fs.readFileSync(path.join(root, '.changeledger', 'config.yml'), 'utf8'),
    /project_id: local/,
  );
  const provenance = repoProvenance(root);
  assert.equal(provenance.project_id, 'project-1');
  assert.equal(provenance.repository_path, root);

  // A CR4 conflict must surface here too, never degrade to a silent fallback.
  const conflicting = fixture({ authorityFormat: 2, seedConfirmed: true });
  fs.writeFileSync(
    path.join(conflicting.root, '.changeledger', 'authority.yml'),
    `format_version: 2\nstate_ref: ${PUBLIC_STATE_REF}\nbaseline: ${git(conflicting.root, ['rev-parse', 'dev^'])}\nproject_id: project-1\ninventory_digest: ${'c'.repeat(64)}\nminimum_client_version: 0.13.0\n`,
  );
  assert.throws(
    () => repoProvenance(conflicting.root),
    new RegExp(
      `state authority conflict: refs/changeledger/activation \\(${activationCommit.length === 64 ? '[0-9a-f]{64}' : '[0-9a-f]{40}'}\\)`,
    ),
  );
});

test('202646 CR4/CR9: activation precedence holds across SHA-1 and SHA-256', () => {
  for (const objectFormat of ['sha1', 'sha256']) {
    let created;
    try {
      created = fixture({ objectFormat, authorityFormat: 2, seedConfirmed: true });
    } catch (error) {
      if (
        objectFormat === 'sha256' &&
        /unknown option|unsupported|not supported/i.test(error.message)
      ) {
        continue;
      }
      throw error;
    }
    // Activation drives state mode and provenance regardless of object format.
    assert.equal(loadLedgerStore(created.root).load().mode, 'state', objectFormat);
    assert.equal(repoProvenance(created.root).project_id, 'project-1', objectFormat);

    // And a divergent worktree v2 conflicts, naming the full-length OID.
    fs.writeFileSync(
      path.join(created.root, '.changeledger', 'authority.yml'),
      `format_version: 2\nstate_ref: ${PUBLIC_STATE_REF}\nbaseline: ${created.baseline}\nproject_id: project-1\ninventory_digest: ${'c'.repeat(64)}\nminimum_client_version: 0.13.0\n`,
    );
    assert.throws(
      () => loadLedgerStore(created.root).load(),
      new Error(
        `state authority conflict: refs/changeledger/activation (${created.activationCommit}) differs from .changeledger/authority.yml`,
      ),
      objectFormat,
    );
    assert.equal(
      created.activationCommit.length,
      objectFormat === 'sha256' ? 64 : 40,
      objectFormat,
    );
  }
});
