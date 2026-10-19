// `changeledger sync` — 20260811-151426. Every scenario runs against REAL git
// repositories: a bare repo on a local path standing in for the remote, plus
// real clones of it. No network is ever reachable from this suite — "sin red"
// is a remote URL pointing at a path that does not exist, so the failure is
// git's own transport failure and not a mocked one.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sync as syncCommand } from '../src/commands/sync.mjs';
import { capturedRun } from '../src/git.mjs';
import { ACTIVATION_REF, mutateState, readSnapshot, STATE_REF } from '../src/state-store.mjs';
import { encodeProjectPath } from '../src/usage-collector.mjs';
import { initGitFixture, sanitizedEnv } from './helpers/git-env.mjs';
import {
  buildTree,
  changeText,
  commitTree,
  defaultStateFiles,
  git,
  ledgerChangeText,
  ledgerConfigText,
  ledgerSpecText,
  seedLedgerRepo,
  updateRef,
} from './helpers/state-repo.mjs';

const BIN = fileURLToPath(new URL('../bin/changeledger.mjs', import.meta.url));
const CLI_ENV = sanitizedEnv();
const TRACKING_REF = 'refs/remotes/origin/changeledger/state';

// `spawnSync`, not `execFileSync`: a `sync` that succeeds may still have
// written a warning to stderr (an unreachable remote is exit 0 WITH a
// diagnostic), and execFileSync only surfaces stderr when the process fails.
function cli(root, ...args) {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd: root,
    env: CLI_ENV,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  return { code: result.status ?? 1, out: result.stdout ?? '', err: result.stderr ?? '' };
}

// Records every git argv the command runs while still executing it for real,
// so a claim about which subprocesses ran is measured, not asserted.
function spyRun() {
  const argv = [];
  const run = (args, cwd, options) => {
    argv.push(args);
    return capturedRun(args, cwd, options);
  };
  return { run, argv };
}

function silentOutput() {
  return { log() {}, warn() {}, error() {} };
}

function refOid(root, ref) {
  return git(root, ['rev-parse', ref]);
}

function optionalOid(root, ref) {
  try {
    return refOid(root, ref);
  } catch {
    return null;
  }
}

function tmpdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// The state files a `list` can actually serve: `defaultStateFiles`' spec is
// plumbing-shaped (no frontmatter) and `list` refuses it on its own terms.
function listableStateFiles() {
  return defaultStateFiles({
    projectId: 'fixture01',
    extra: { '.changeledger-state/specs/demo-spec.md': ledgerSpecText() },
  });
}

// An activated ChangeLedger repo whose ledger lives in the state ref, with no
// remote configured yet.
function activatedRepo({ files = listableStateFiles() } = {}) {
  const { root } = seedLedgerRepo();
  const revision = commitTree(root, buildTree(root, files), { message: 'chore: state' });
  updateRef(root, STATE_REF, revision);
  assert.equal(cli(root, 'activate').code, 0);
  return { root, revision };
}

// A bare remote on a local path, one activated repo that already published the
// state ref to it, and a second activated clone of the same remote — the shape
// every multi-author scenario below starts from. The clone creates its own
// local state ref from the fetched remote-tracking copy: `git clone` maps
// `refs/heads/changeledger/state` to `refs/remotes/origin/...` and creates no
// local branch for it, and `sync` deliberately never takes that decision for a
// checkout that is not activated yet.
function syncFixture({ files } = {}) {
  const remote = tmpdir('changeledger-sync-remote-');
  initGitFixture(remote, { args: ['--bare', '-b', 'main'] });
  const { root: a, revision } = activatedRepo({ files });
  git(a, ['remote', 'add', 'origin', remote]);
  git(a, ['push', '-q', 'origin', 'main', STATE_REF]);

  const parent = tmpdir('changeledger-sync-clone-');
  const b = path.join(parent, 'clone');
  git(parent, ['clone', '-q', remote, b]);
  git(b, ['config', 'user.name', 'Test User']);
  git(b, ['config', 'user.email', 'test@example.com']);
  updateRef(b, STATE_REF, refOid(b, TRACKING_REF));
  assert.equal(cli(b, 'activate').code, 0);

  return { remote, a, b, revision };
}

// Writes one document into a repo's journal, exactly as a local flow would:
// through the store's own CAS mutation, never by rewriting the ref.
function writeDocument(root, relPath, text) {
  const revision = refOid(root, STATE_REF);
  mutateState(
    root,
    { expectedRevision: revision, message: `chore: write ${relPath}` },
    ({ write }) => write(relPath, text),
  );
  return refOid(root, STATE_REF);
}

function addChange(root, id) {
  return writeDocument(root, `changes/${id}-demo.md`, ledgerChangeText({ id }));
}

function listedIds(root) {
  const { code, out } = cli(root, 'list', '--all', '--json');
  assert.equal(code, 0, out);
  return JSON.parse(out).map((change) => change.id);
}

// --- CR1: the remote ahead advances the local ref ---------------------------

test('20260811-151426 CR1: a remote ahead fast-forwards the local state ref and list serves the new documents', () => {
  const { a, b, remote } = syncFixture();
  addChange(b, '20260811-000002');
  assert.equal(cli(b, 'sync').code, 0);
  const published = refOid(remote, STATE_REF);
  const before = refOid(a, STATE_REF);
  assert.notEqual(before, published);

  const { code, out } = cli(a, 'sync');

  assert.equal(code, 0, out);
  assert.equal(refOid(a, STATE_REF), published);
  assert.ok(listedIds(a).includes('20260811-000002'), 'the fast-forwarded change must be listed');
});

test('20260811-151426 CR1: fast-forwarding runs no push subprocess', () => {
  const { a, b } = syncFixture();
  addChange(b, '20260811-000002');
  assert.equal(cli(b, 'sync').code, 0);
  const { run, argv } = spyRun();

  syncCommand({}, a, silentOutput(), run);

  assert.deepEqual(
    argv.filter(([verb]) => verb === 'push'),
    [],
  );
});

// --- CR2: the local ahead publishes ----------------------------------------

test('20260811-151426 CR2: a local ahead publishes its tip and gains no commit', () => {
  const { a, remote } = syncFixture();
  const tip = addChange(a, '20260811-000003');
  assert.notEqual(refOid(remote, STATE_REF), tip);

  const { code, out } = cli(a, 'sync');

  assert.equal(code, 0, out);
  assert.equal(refOid(remote, STATE_REF), tip, 'the remote must hold the local tip');
  assert.equal(refOid(a, STATE_REF), tip, 'the local journal must gain no commit');
});

test('20260811-151426 CR2: an identical remote is a no-op that moves nothing', () => {
  const { a, remote } = syncFixture();
  const tip = refOid(a, STATE_REF);

  const { code, out } = cli(a, 'sync');

  assert.equal(code, 0, out);
  assert.equal(refOid(a, STATE_REF), tip);
  assert.equal(refOid(remote, STATE_REF), tip);
});

// --- CR5: never blocking ----------------------------------------------------

test('20260811-151426 CR5: a repo with no remote is an informative no-op that leaves the flow intact', () => {
  const { root, revision } = activatedRepo();

  const { code, out } = cli(root, 'sync');

  assert.equal(code, 0, out);
  assert.match(out, /remote/i);
  assert.equal(refOid(root, STATE_REF), revision);
  assert.equal(cli(root, 'list').code, 0, 'every other command keeps working');
});

test('20260811-151426 CR5: an unreachable remote is a warning that touches no ref', () => {
  const { root, revision } = activatedRepo();
  git(root, ['remote', 'add', 'origin', path.join(os.tmpdir(), 'changeledger-absent-remote.git')]);

  const { code, out, err } = cli(root, 'sync');

  assert.equal(code, 0, err);
  assert.match(`${out}${err}`, /warning/i);
  assert.equal(refOid(root, STATE_REF), revision);
  assert.equal(optionalOid(root, TRACKING_REF), null);
  assert.equal(cli(root, 'list').code, 0, 'every other command keeps working');
});

test('20260811-151426 CR5: a repo with the state ref but no activation names `changeledger activate`', () => {
  const { root } = seedLedgerRepo();
  const revision = commitTree(root, buildTree(root, listableStateFiles()), {
    message: 'chore: state',
  });
  updateRef(root, STATE_REF, revision);

  const { code, out } = cli(root, 'sync');

  assert.equal(code, 0, out);
  assert.match(out, /changeledger activate/);
  assert.equal(optionalOid(root, ACTIVATION_REF), null, 'sync must not activate anything itself');
  assert.equal(refOid(root, STATE_REF), revision);
});

// --- CR3: disjoint divergence reconciles itself -----------------------------

test('20260811-151426 CR3: a disjoint divergence lands as one commit with both parents and is published', () => {
  const { a, b, remote } = syncFixture();
  const aTip = addChange(a, '20260811-000004');
  const bTip = addChange(b, '20260811-000005');
  assert.equal(cli(b, 'sync').code, 0, 'the other clone publishes first');
  assert.equal(refOid(remote, STATE_REF), bTip);

  const { code, out, err } = cli(a, 'sync');

  assert.equal(code, 0, `${out}${err}`);
  const merged = refOid(a, STATE_REF);
  assert.deepEqual(
    git(a, ['rev-list', '--parents', '-n', '1', merged]).split(' ').slice(1),
    [aTip, bTip],
    'the reconciliation must preserve both journals as parents, never rebase',
  );
  const { documents } = readSnapshot(a);
  assert.equal(
    documents['changes/20260811-000004-demo.md'],
    ledgerChangeText({ id: '20260811-000004' }),
  );
  assert.equal(
    documents['changes/20260811-000005-demo.md'],
    ledgerChangeText({ id: '20260811-000005' }),
  );
  assert.equal(refOid(remote, STATE_REF), merged, 'the reconciliation must be published');

  assert.equal(cli(b, 'sync').code, 0);
  assert.equal(refOid(b, STATE_REF), merged, 'the other clone fast-forwards on its next sync');
});

// --- CR4: the same document changed differently stops -----------------------

test('20260811-151426 CR4: two graduations of the same spec collide, name both tips, and write nothing', () => {
  const { a, b, remote } = syncFixture();
  const aTip = writeDocument(
    a,
    'specs/demo-spec.md',
    ledgerSpecText({ title: 'Local graduation' }),
  );
  const bTip = writeDocument(
    b,
    'specs/demo-spec.md',
    ledgerSpecText({ title: 'Remote graduation' }),
  );
  assert.equal(cli(b, 'sync').code, 0);

  const { code, err } = cli(a, 'sync');

  assert.notEqual(code, 0, 'a same-document collision must exit non-zero');
  assert.match(err, /spec specs\/demo-spec\.md/, 'the colliding document and its class');
  assert.match(err, new RegExp(aTip), 'the local tip');
  assert.match(err, new RegExp(bTip), 'the remote tip');
  assert.equal(refOid(a, STATE_REF), aTip, 'no local ref may move');
  assert.equal(refOid(remote, STATE_REF), bTip, 'no remote ref may move');
});

test('20260811-151426 CR4: a shared change document collides exactly like a spec, reported as a change', () => {
  const { a, b } = syncFixture();
  const shared = 'changes/20260808-000001-change.md';
  writeDocument(a, shared, `${changeText()}\nLocal edit.\n`);
  writeDocument(b, shared, `${changeText()}\nRemote edit.\n`);
  assert.equal(cli(b, 'sync').code, 0);

  const { code, err } = cli(a, 'sync');

  assert.notEqual(code, 0);
  assert.match(err, new RegExp(`change ${shared.replace('/', '\\/')}`));
});

test('20260811-151426 CR4: config.yml is a document of the tree and collides on the same terms', () => {
  const { a, b } = syncFixture();
  writeDocument(a, 'config.yml', 'project_id: fixture01\nlanguage: es\n');
  writeDocument(b, 'config.yml', 'project_id: fixture01\nlanguage: en\n');
  assert.equal(cli(b, 'sync').code, 0);

  const { code, err } = cli(a, 'sync');

  assert.notEqual(code, 0);
  assert.match(err, /config config\.yml/);
});

test('20260811-151426 CR4: the same document written byte-identically on both sides is no collision', () => {
  const { a, b, remote } = syncFixture();
  const text = ledgerChangeText({ id: '20260811-000006' });
  // Each side also carries its own disjoint work, so the two journals differ by
  // construction: identical content over an identical parent would otherwise be
  // the very same commit object, and there would be no divergence to test.
  addChange(a, '20260811-000007');
  addChange(b, '20260811-000008');
  const aTip = writeDocument(a, 'changes/20260811-000006-demo.md', text);
  const bTip = writeDocument(b, 'changes/20260811-000006-demo.md', text);
  assert.notEqual(aTip, bTip, 'the two journals must really have diverged');
  assert.equal(cli(b, 'sync').code, 0);

  const { code, out, err } = cli(a, 'sync');

  assert.equal(code, 0, `${out}${err}`);
  const merged = refOid(a, STATE_REF);
  assert.deepEqual(git(a, ['rev-list', '--parents', '-n', '1', merged]).split(' ').slice(1), [
    aTip,
    bTip,
  ]);
  assert.equal(readSnapshot(a).documents['changes/20260811-000006-demo.md'], text);
  assert.equal(refOid(remote, STATE_REF), merged);
});

test('20260811-151426 CR4: two ledgers with no common ancestor are refused, not merged', () => {
  const { a, b } = syncFixture();
  // A brand new root commit on B's state ref: a second, independent ledger.
  const foreign = commitTree(b, buildTree(b, listableStateFiles()), { message: 'chore: other' });
  // Forced onto the remote with raw git: `sync` itself never force-pushes, so
  // only an out-of-band write can put an unrelated ledger there.
  git(b, ['push', '-q', '--force', 'origin', `${foreign}:${STATE_REF}`]);
  const before = refOid(a, STATE_REF);

  const { code, err } = cli(a, 'sync');

  assert.notEqual(code, 0);
  assert.match(err, /share no history/);
  assert.equal(refOid(a, STATE_REF), before);
});

// --- CR6: --status is free --------------------------------------------------

// Verbs that would open a connection. `remote` is deliberately absent: `git
// remote` only lists the configured names from local config, while `git remote
// update` does fetch — so the argv is checked for that pair too.
const NETWORK_VERBS = new Set(['fetch', 'push', 'pull', 'clone', 'ls-remote', 'fetch-pack']);

function capturingOutput() {
  const lines = [];
  return { lines, log: (line) => lines.push(line), warn: (line) => lines.push(line) };
}

function networkCalls(argv) {
  return argv.filter(
    ([verb, second]) => NETWORK_VERBS.has(verb) || (verb === 'remote' && second === 'update'),
  );
}

test('20260811-151426 CR6: --status reports the relation and runs no network subprocess', () => {
  const { a, b } = syncFixture();
  addChange(b, '20260811-000020');
  assert.equal(cli(b, 'sync').code, 0);
  assert.equal(cli(a, 'sync').code, 0, 'one online sync leaves a remote-tracking copy behind');
  addChange(a, '20260811-000021');
  const { run, argv } = spyRun();
  const output = capturingOutput();

  syncCommand({ status: true }, a, output, run);

  assert.match(output.lines.join('\n'), /ahead/);
  assert.ok(argv.length > 0, 'the status path must really have run git');
  assert.deepEqual(networkCalls(argv), []);
});

test('20260811-151426 CR6: --status answers from the last fetch and moves no ref', () => {
  const { a, b } = syncFixture();
  assert.equal(cli(a, 'sync').code, 0);
  addChange(b, '20260811-000022');
  assert.equal(cli(b, 'sync').code, 0);
  const tip = refOid(a, STATE_REF);

  const stale = cli(a, 'sync', '--status');
  assert.equal(stale.code, 0, stale.err);
  assert.match(stale.out, /identical/, 'the remote moved, but no fetch happened here');

  git(a, ['fetch', '-q', 'origin', `+${STATE_REF}:${TRACKING_REF}`]);
  assert.match(cli(a, 'sync', '--status').out, /behind/);

  addChange(a, '20260811-000023');
  const trackedBefore = refOid(a, TRACKING_REF);
  const localBefore = refOid(a, STATE_REF);
  assert.notEqual(localBefore, tip, 'the local journal really moved on');

  assert.match(cli(a, 'sync', '--status').out, /diverged/);

  assert.equal(refOid(a, TRACKING_REF), trackedBefore, '--status moves no remote-tracking ref');
  assert.equal(refOid(a, STATE_REF), localBefore, '--status moves no local ref');
});

test('20260811-151426 CR6: --status before any fetch says so instead of guessing', () => {
  const { root } = activatedRepo();
  // An unreachable remote on purpose: an offline report must still answer.
  git(root, ['remote', 'add', 'origin', path.join(os.tmpdir(), 'changeledger-absent-remote.git')]);

  const { code, out, err } = cli(root, 'sync', '--status');

  assert.equal(code, 0, err);
  // 20260812-003312: the no-copy report names both honest outcomes — publish
  // if the remote lacks the ref, fetch if it exists — instead of promising a
  // fetch that a freshly cut repo has nothing to receive from.
  assert.match(out, /no remote-tracking copy/);
  assert.match(out, /publish/i);
  assert.doesNotMatch(out, /to fetch one/);
});

// 20260811-163204 — `--status` answers from the existing remote-tracking
// copies without resolving any remote: a repo with several remotes and no
// `origin` gets its freshness report anyway, while a mutating `sync` on the
// same repo still refuses the ambiguity before touching anything.
test('20260811-163204: --status answers in an ambiguous multi-remote repo', () => {
  const { root, revision } = activatedRepo();
  git(root, ['remote', 'add', 'alpha', path.join(os.tmpdir(), 'changeledger-absent-a.git')]);
  git(root, ['remote', 'add', 'beta', path.join(os.tmpdir(), 'changeledger-absent-b.git')]);
  git(root, ['update-ref', 'refs/remotes/alpha/changeledger/state', revision]);

  const status = cli(root, 'sync', '--status');
  assert.equal(status.code, 0, status.err);
  assert.match(status.out, /refs\/remotes\/alpha\/changeledger\/state/);
  assert.match(status.out, /identical/);

  const mutating = cli(root, 'sync');
  assert.notEqual(mutating.code, 0);
  assert.match(mutating.err, /cannot decide which remote/);
});

test('20260811-151426 CR3: a reconciliation whose merged tree is invalid leaves the local ref where it was', () => {
  const { a, b } = syncFixture();
  const localTip = addChange(a, '20260811-000030');
  // The other side's manifest is fabricated with raw fixture plumbing: the
  // store's own mutator refuses to produce an unsupported format_version, and
  // this scenario needs a remote that carries one anyway.
  const broken = commitTree(
    b,
    buildTree(b, {
      ...listableStateFiles(),
      '.changeledger-state/manifest.yml': 'format_version: 99\nproject_id: fixture01\n',
    }),
    { parents: [refOid(b, STATE_REF)], message: 'chore: unsupported manifest' },
  );
  updateRef(b, STATE_REF, broken);
  assert.equal(cli(b, 'sync').code, 0, 'the other side publishes it');
  // `check`'s own verdict on this fixture is not the subject — that it is
  // UNCHANGED by a failed sync is. (The fixture's state config is minimal, so
  // check legitimately reports errors before sync ever runs.)
  const checkBefore = cli(a, 'check').code;

  const { code, err } = cli(a, 'sync');

  assert.notEqual(code, 0, err);
  assert.equal(refOid(a, STATE_REF), localTip, 'the local ref must not move on an invalid merge');
  assert.equal(cli(a, 'list').code, 0, 'the ledger must still be readable');
  assert.equal(cli(a, 'check').code, checkBefore, 'the ledger must still validate as it did');
  assert.notEqual(cli(a, 'sync').code, 0, 'the failure is idempotent — no half-written state');
  assert.equal(refOid(a, STATE_REF), localTip);
});

// --- 20261002-152923: an unactivated clone is told the remote publishes state --

const PUBLISHES_MESSAGE =
  'refs/remotes/origin/changeledger/state exists: the remote "origin" publishes global state, but this checkout is not activated — run `changeledger activate` to adopt it. sync changed nothing.';
const NOTHING_MESSAGE = `Nothing to sync: this repo is not activated and ${STATE_REF} does not exist here.`;

// A real `git clone` of a remote that carries a published state ref: the clone
// holds the remote-tracking copy and, exactly as after a fresh clone, neither
// the local state ref nor the activation.
function unactivatedClone() {
  const remote = tmpdir('changeledger-sync-remote-');
  initGitFixture(remote, { args: ['--bare', '-b', 'main'] });
  const { root: source, revision } = activatedRepo();
  git(source, ['remote', 'add', 'origin', remote]);
  git(source, ['push', '-q', 'origin', 'main', STATE_REF]);
  const parent = tmpdir('changeledger-sync-clone-');
  const clone = path.join(parent, 'clone');
  git(parent, ['clone', '-q', remote, clone]);
  git(clone, ['config', 'user.name', 'Test User']);
  git(clone, ['config', 'user.email', 'test@example.com']);
  return { remote, source, clone, revision };
}

function worktreeSnapshot(root) {
  return git(root, ['status', '--porcelain', '--untracked-files=all']);
}

test('20261002-152923 CR1: sync in an unactivated clone says the remote publishes state and changes nothing', () => {
  const { clone, revision } = unactivatedClone();
  assert.equal(optionalOid(clone, STATE_REF), null);
  assert.equal(refOid(clone, TRACKING_REF), revision);
  const before = worktreeSnapshot(clone);

  const { code, out, err } = cli(clone, 'sync');

  assert.equal(code, 0, err);
  assert.equal(out.trim(), PUBLISHES_MESSAGE);
  assert.equal(optionalOid(clone, STATE_REF), null, 'sync must not create the local state ref');
  assert.equal(optionalOid(clone, ACTIVATION_REF), null, 'sync must not activate anything');
  assert.equal(worktreeSnapshot(clone), before, 'sync must not touch the worktree');
});

test('20261002-152923 CR2: sync --status in the same clone says the same thing', () => {
  const { clone } = unactivatedClone();

  const { code, out, err } = cli(clone, 'sync', '--status');

  assert.equal(code, 0, err);
  assert.equal(out.trim(), PUBLISHES_MESSAGE);
});

test('20261002-152923 CR3: without a remote-tracking copy the current message stands, with and without a remote', () => {
  const { root } = seedLedgerRepo();
  const withoutRemote = cli(root, 'sync');
  assert.equal(withoutRemote.code, 0, withoutRemote.err);
  assert.equal(withoutRemote.out.trim(), NOTHING_MESSAGE);

  git(root, ['remote', 'add', 'origin', path.join(os.tmpdir(), 'changeledger-absent-remote.git')]);
  const withRemote = cli(root, 'sync');
  assert.equal(withRemote.code, 0, withRemote.err);
  assert.equal(withRemote.out.trim(), NOTHING_MESSAGE);
});

test('20261002-152923: an ambiguous remote set in an unactivated clone keeps the current message instead of failing', () => {
  const { root } = seedLedgerRepo();
  git(root, ['remote', 'add', 'alpha', path.join(os.tmpdir(), 'changeledger-absent-alpha.git')]);
  git(root, ['remote', 'add', 'beta', path.join(os.tmpdir(), 'changeledger-absent-beta.git')]);

  const { code, out, err } = cli(root, 'sync');

  assert.equal(code, 0, err);
  assert.equal(out.trim(), NOTHING_MESSAGE);
});

test('20261002-152923 CR4: the notice needs no network — an unreachable origin and no network subprocess', () => {
  const { clone } = unactivatedClone();
  git(clone, ['remote', 'set-url', 'origin', path.join(os.tmpdir(), 'changeledger-absent.git')]);
  const { run, argv } = spyRun();
  const output = capturingOutput();

  const code = syncCommand({}, clone, output, run);

  assert.equal(code, 0);
  assert.deepEqual(output.lines, [PUBLISHES_MESSAGE]);
  assert.ok(argv.length > 0, 'the notice path must really have run git');
  assert.deepEqual(networkCalls(argv), []);
  const real = cli(clone, 'sync');
  assert.equal(real.code, 0, real.err);
  assert.equal(real.out.trim(), PUBLISHES_MESSAGE);
});

test('20261002-152923 CR5: list in the unactivated clone serves the worktree exactly as without the tracking copy', () => {
  const { clone } = unactivatedClone();
  const withCopy = cli(clone, 'list', '--all', '--json');
  assert.equal(withCopy.code, 0, withCopy.err);

  git(clone, ['update-ref', '-d', TRACKING_REF]);
  const withoutCopy = cli(clone, 'list', '--all', '--json');

  assert.equal(withoutCopy.code, 0, withoutCopy.err);
  assert.equal(withCopy.out, withoutCopy.out);
});

test('20261002-152923 CR6: clone, sync, activate and sync --status walk from the notice to an agreeing journal', () => {
  const { clone, revision } = unactivatedClone();

  const first = cli(clone, 'sync');
  assert.equal(first.code, 0, first.err);
  assert.equal(first.out.trim(), PUBLISHES_MESSAGE);

  const activate = cli(clone, 'activate');
  assert.equal(activate.code, 0, activate.err);
  assert.match(activate.out, /Seeded .* from refs\/remotes\/origin at /);
  assert.equal(refOid(clone, STATE_REF), revision);

  const status = cli(clone, 'sync', '--status');
  assert.equal(status.code, 0, status.err);
  assert.match(status.out, /Relation: identical — the last fetch and the local journal agree/);
});

// --- 20261002-133728 CR3: two clones' records merge without a conflict ------

const FAKE_CCUSAGE = fileURLToPath(new URL('fixtures/ccusage/fake-ccusage.mjs', import.meta.url));
const COLLECTOR = fileURLToPath(new URL('../src/usage-collector.mjs', import.meta.url));

// One clone's snapshot, taken in its own process as on its own machine: a
// process-wide counter could not tell two clones apart in a single test
// process. The local fake answers for ccusage; `who` is `recorded_by`.
function snapshotInOwnProcess(root, event, who) {
  const script = `
    const { snapshotUsage } = await import(${JSON.stringify(pathToFileURL(COLLECTOR).href)});
    const warnings = [];
    snapshotUsage({
      repoRoot: ${JSON.stringify(root)},
      events: [${JSON.stringify(event)}],
      usage: { ownerHandle: () => ${JSON.stringify(who)}, warn: (l) => warnings.push(l) },
    });
    process.stdout.write(JSON.stringify(warnings));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root,
    env: sanitizedEnv({
      CHANGELEDGER_USAGE_COMMAND: JSON.stringify([process.execPath, FAKE_CCUSAGE]),
      FAKE_CCUSAGE_ROOT: encodeProjectPath(root),
    }),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('20261002-133728 CR3: two clones recording the same change in the same second sync without conflict', (t) => {
  const { remote, a, b } = syncFixture();
  for (const dir of [remote, a, path.dirname(b)]) {
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  }
  const event = {
    change: '20260808-000001',
    event: 'status',
    from: 'approved',
    to: 'in-progress',
    at: '2026-10-02T15:32:33Z',
  };
  for (const [root, who] of [
    [a, 'alice'],
    [b, 'bob'],
  ]) {
    git(root, ['config', 'changeledger.usage.collector', 'ccusage']);
    assert.deepEqual(snapshotInOwnProcess(root, event, who), []);
  }

  assert.equal(cli(b, 'sync').code, 0, 'the other clone publishes first');
  const merged = cli(a, 'sync');
  assert.equal(merged.code, 0, `${merged.out}${merged.err}`);

  const records = Object.entries(readSnapshot(a).documents)
    .filter(([name]) => name.startsWith('usage/20260808-000001--20261002T153233Z-'))
    .map(([, text]) => JSON.parse(text).recorded_by)
    .sort();
  assert.deepEqual(records, ['alice', 'bob']);

  assert.equal(cli(b, 'sync').code, 0);
  assert.equal(refOid(b, STATE_REF), refOid(a, STATE_REF));
});

test('20261002-133728: a colliding usage path is reported as a usage record', (t) => {
  const { remote, a, b } = syncFixture();
  for (const dir of [remote, a, path.dirname(b)]) {
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  }
  const name = 'usage/20260808-000001--20261002T153233Z-0a1b2c3d.json';
  writeDocument(a, name, '{"schema": 1, "side": "a"}\n');
  writeDocument(b, name, '{"schema": 1, "side": "b"}\n');
  assert.equal(cli(b, 'sync').code, 0);

  const { code, err } = cli(a, 'sync');

  assert.notEqual(code, 0);
  assert.match(err, /- usage record usage\/20260808-000001--20261002T153233Z-0a1b2c3d\.json: /);
});

// --- 20261002-161641: a collection this CLI does not know travels intact -----

const FUTURE_PATH = '.changeledger-state/future/a.json';
const FUTURE_ID = '20260808-000001';
const unknownWarning = (version) =>
  `warning: the state ref holds collections ChangeLedger ${version} does not know (future); update the installation to use them`;
const PACKAGE_VERSION = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;

// A ledger a later ChangeLedger wrote: the full fixture config, one `approved`
// change, and an entry in a collection this checkout's STATE_COLLECTION_EXTENSIONS
// does not declare.
function futureStateFiles() {
  return {
    ...listableStateFiles(),
    '.changeledger-state/config.yml': ledgerConfigText,
    [`.changeledger-state/changes/${FUTURE_ID}-change.md`]: ledgerChangeText({
      id: FUTURE_ID,
    }).replace('status: draft', 'status: approved'),
    [FUTURE_PATH]: '{"written_by":"a later ChangeLedger"}\n',
  };
}

function futureSyncFixture(t) {
  const fixture = syncFixture({ files: futureStateFiles() });
  for (const dir of [fixture.remote, fixture.a, path.dirname(fixture.b)]) {
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  }
  return fixture;
}

function blobAt(root, revision, full) {
  return git(root, ['rev-parse', `${revision}:${full}`]);
}

test('20261002-161641 CR6: the usual flow works over an unknown collection, and sync keeps it on both refs', (t) => {
  const { remote, a, b, revision } = futureSyncFixture(t);
  const original = blobAt(a, revision, FUTURE_PATH);
  const steps = [
    ['context'],
    ['list', '--status', 'approved'],
    ['status', FUTURE_ID, 'in-progress'],
  ];
  for (const args of steps) {
    const { code, out, err } = cli(b, ...args);
    const label = args.join(' ');
    assert.equal(code, 0, `${label}: ${out}${err}`);
    assert.equal(err.split(unknownWarning(PACKAGE_VERSION)).length - 1, 1, `${label}: ${err}`);
    if (args[0] === 'list') assert.match(out, new RegExp(FUTURE_ID));
  }
  // The other clone moves too, so b's sync has to reconcile, not fast-forward.
  addChange(a, '20261002-000002');
  assert.equal(cli(a, 'sync').code, 0, 'the other clone publishes first');

  const synced = cli(b, 'sync');
  assert.equal(synced.code, 0, `${synced.out}${synced.err}`);
  assert.match(synced.out, /Reconciled disjoint journals/);
  assert.equal(synced.err.split(unknownWarning(PACKAGE_VERSION)).length - 1, 1, synced.err);

  const local = refOid(b, STATE_REF);
  assert.equal(refOid(remote, STATE_REF), local, 'the reconciliation is published');
  assert.equal(blobAt(b, local, FUTURE_PATH), original, 'the local ref keeps the entry');
  assert.equal(blobAt(remote, local, FUTURE_PATH), original, 'the remote ref keeps the entry');
  const listed = JSON.parse(cli(b, 'list', '--all', '--json').out);
  assert.deepEqual(
    listed.map((change) => [change.id, change.status]),
    [
      [FUTURE_ID, 'in-progress'],
      ['20261002-000002', 'draft'],
    ],
  );
});

test('20261002-161641 CR3: a sync whose merge would drop an unknown entry is refused, both refs unmoved', (t) => {
  const { remote, a, b } = futureSyncFixture(t);
  // The remote's side drops the entry with raw plumbing — what a foreign
  // writer, or a later CLI that knows the collection, could publish.
  const { [FUTURE_PATH]: _dropped, ...withoutFuture } = futureStateFiles();
  const dropped = commitTree(b, buildTree(b, withoutFuture), {
    parents: [refOid(b, STATE_REF)],
    message: 'chore: drop the future entry',
  });
  updateRef(b, STATE_REF, dropped);
  git(b, ['push', '-q', 'origin', STATE_REF]);
  const localTip = addChange(a, '20261002-000003');

  const { code, err } = cli(a, 'sync');

  assert.notEqual(code, 0, err);
  assert.match(
    err,
    /merged state drops "\.changeledger-state\/future\/a\.json", an entry of a collection this ChangeLedger does not know/,
  );
  assert.equal(refOid(a, STATE_REF), localTip, 'the local ref must not move');
  assert.equal(refOid(remote, STATE_REF), dropped, 'nothing was published');
});

// --- 20261012-125611: sync does not adopt a remote minimum above the CLI -----

const belowMinimum = (required) =>
  `ChangeLedger CLI ${PACKAGE_VERSION} is below this repository's minimum ${required}; update the global installation.`;

const minConfigText = (min) =>
  `project_id: fixture01\nschema_version: 6\nmin_cli_version: ${min}\n`;

// Two activated clones of one remote whose shared state declares a minimum the
// installed CLI satisfies (0.0.1); `b` then publishes a revision raising it to
// `min`. The publish is raw git: once `b`'s own config declares a minimum above
// the CLI, the `preAction` guard stops `b`'s `changeledger sync`.
function raisedMinimumFixture(t, min) {
  const fixture = syncFixture({
    files: {
      ...listableStateFiles(),
      '.changeledger-state/config.yml': minConfigText('0.0.1'),
    },
  });
  for (const dir of [fixture.remote, fixture.a, path.dirname(fixture.b)]) {
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  }
  writeDocument(fixture.b, 'config.yml', minConfigText(min));
  git(fixture.b, ['push', '-q', 'origin', STATE_REF]);
  return fixture;
}

// Commit objects in `root` whose parents are exactly `parents`, reachable or
// not: a merge commit written and then left unreferenced still counts.
function commitsWithParents(root, parents) {
  return git(root, ['cat-file', '--batch-all-objects', '--batch-check=%(objectname) %(objecttype)'])
    .split('\n')
    .filter((line) => line.endsWith(' commit'))
    .map((line) => line.split(' ')[0])
    .filter((oid) => git(root, ['show', '-s', '--format=%P', oid]) === parents.join(' '));
}

test('20261012-125611 CR1: a fast-forward does not adopt a remote minimum above the CLI', (t) => {
  const { remote, a } = raisedMinimumFixture(t, '99.0.0');
  const localBefore = refOid(a, STATE_REF);
  const remoteBefore = refOid(remote, STATE_REF);

  const { code, out, err } = cli(a, 'sync');

  assert.notEqual(code, 0, `sync exited 0 over a higher remote minimum: ${out}`);
  assert.ok(err.includes(belowMinimum('99.0.0')), err);
  assert.equal(refOid(a, STATE_REF), localBefore, 'the local state ref must keep its oid');
  assert.equal(refOid(remote, STATE_REF), remoteBefore, 'the remote must not change');
});

test('20261012-125611 CR2: a reconciliation does not adopt a remote minimum above the CLI', (t) => {
  const { remote, a } = raisedMinimumFixture(t, '99.0.0');
  const localTip = addChange(a, '20261012-000001');
  const remoteBefore = refOid(remote, STATE_REF);

  const { code, out, err } = cli(a, 'sync');

  assert.notEqual(code, 0, `sync exited 0 over a higher remote minimum: ${out}`);
  assert.ok(err.includes(belowMinimum('99.0.0')), err);
  assert.equal(refOid(a, STATE_REF), localTip, 'the local state ref must keep its oid');
  assert.deepEqual(commitsWithParents(a, [localTip, remoteBefore]), [], 'no merge commit');
  assert.equal(refOid(remote, STATE_REF), remoteBefore, 'nothing was published');
});

test('20261012-125611 CR3: a remote minimum the CLI satisfies fast-forwards as before', (t) => {
  const { remote, a } = raisedMinimumFixture(t, '0.1.0');
  const published = refOid(remote, STATE_REF);
  assert.notEqual(refOid(a, STATE_REF), published, 'the remote really is ahead');

  const { code, out, err } = cli(a, 'sync');

  assert.equal(code, 0, `${out}${err}`);
  assert.equal(refOid(a, STATE_REF), published, 'the local ref advances to the remote revision');
});

// --- 20261012-141809: sync refuses a revision that drops a local path ---------

const STATE = '.changeledger-state';
const BETA_PATH = `${STATE}/changes/20261012-000002-beta.md`;
const SPEC_PATH = `${STATE}/specs/demo-spec.md`;
const RELEASE_PATH = `${STATE}/releases/0.1.0.yml`;
const USAGE_PATH = `${STATE}/usage/20261012-000002--20261012T000000Z-0a1b2c3d.json`;
const UNKNOWN_PATH = `${STATE}/future/a.json`;

// Changes `alpha` (20260808-000001) and `beta`, a spec, a release, a usage
// record and an entry of the unknown collection `future`.
function identityStateFiles() {
  return {
    ...listableStateFiles(),
    [BETA_PATH]: ledgerChangeText({ id: '20261012-000002' }),
    [USAGE_PATH]: '{"schema":1,"recorded_by":"alice"}\n',
    [UNKNOWN_PATH]: '{"written_by":"a later ChangeLedger"}\n',
  };
}

function identityFixture(t) {
  const fixture = syncFixture({ files: identityStateFiles() });
  for (const dir of [fixture.remote, fixture.a, path.dirname(fixture.b)]) {
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  }
  return fixture;
}

// Publishes from `b`, with raw git, a descendant of its state tip whose tree is
// exactly `files`: what a foreign writer could push.
function publishRaw(b, files, message) {
  const revision = commitTree(b, buildTree(b, files), {
    parents: [refOid(b, STATE_REF)],
    message,
  });
  updateRef(b, STATE_REF, revision);
  git(b, ['push', '-q', 'origin', STATE_REF]);
  return revision;
}

function without(files, dropped) {
  const { [dropped]: _dropped, ...rest } = files;
  return rest;
}

const adoptedNothing = (subject, verb, dropped) =>
  `Error: ${subject} ${verb} "${dropped}", present in the local state; sync adopted nothing`;

test('20261012-141809 CR1: a fast-forward does not adopt a revision that drops a change', (t) => {
  const { remote, a, b } = identityFixture(t);
  const dropped = publishRaw(b, without(identityStateFiles(), BETA_PATH), 'chore: drop beta');
  const localBefore = refOid(a, STATE_REF);

  const { code, out, err } = cli(a, 'sync');

  assert.notEqual(code, 0, `sync exited 0 over a dropped change: ${out}`);
  assert.ok(err.includes(adoptedNothing(`state revision ${dropped}`, 'drops', BETA_PATH)), err);
  assert.equal(refOid(a, STATE_REF), localBefore, 'the local state ref must keep its oid');
  assert.ok(listedIds(a).includes('20261012-000002'), 'list --all must still show beta');
  assert.equal(refOid(remote, STATE_REF), dropped, 'the remote must not change');
});

for (const [label, droppedPath] of [
  ['a spec', SPEC_PATH],
  ['a release', RELEASE_PATH],
  ['a usage record', USAGE_PATH],
  ['an unknown collection entry', UNKNOWN_PATH],
]) {
  test(`20261012-141809 CR2: a fast-forward does not adopt a revision that drops ${label}`, (t) => {
    const { a, b } = identityFixture(t);
    const dropped = publishRaw(b, without(identityStateFiles(), droppedPath), 'chore: drop one');
    const localBefore = refOid(a, STATE_REF);

    const { code, out, err } = cli(a, 'sync');

    assert.notEqual(code, 0, `sync exited 0 over a dropped path: ${out}`);
    assert.ok(err.includes(adoptedNothing(`state revision ${dropped}`, 'drops', droppedPath)), err);
    assert.equal(refOid(a, STATE_REF), localBefore, 'the local state ref must keep its oid');
  });
}

test('20261012-141809 CR3: a reconciliation does not publish a tree that drops identities', (t) => {
  const { remote, a, b } = identityFixture(t);
  const localTip = writeDocument(
    a,
    'changes/20260808-000001-change.md',
    `${changeText()}\nEdit.\n`,
  );
  const dropped = publishRaw(
    b,
    without(without(identityStateFiles(), BETA_PATH), USAGE_PATH),
    'chore: drop beta and a usage record',
  );

  const { code, out, err } = cli(a, 'sync');

  assert.notEqual(code, 0, `sync exited 0 over a lossy merge: ${out}`);
  // `changes/` sorts before `usage/`: the first lost path is beta.
  assert.ok(err.includes(adoptedNothing('merged state', 'drops', BETA_PATH)), err);
  assert.deepEqual(commitsWithParents(a, [localTip, dropped]), [], 'no merge commit');
  assert.equal(refOid(a, STATE_REF), localTip, 'the local state ref must keep its oid');
  assert.equal(refOid(remote, STATE_REF), dropped, 'the remote must not change');
});

for (const [label, droppedPath] of [
  ['a spec', SPEC_PATH],
  ['a release', RELEASE_PATH],
  ['a usage record', USAGE_PATH],
]) {
  test(`20261012-141809 CR3: a reconciliation does not publish a tree that drops ${label}`, (t) => {
    const { remote, a, b } = identityFixture(t);
    const localTip = addChange(a, '20261012-000006');
    const dropped = publishRaw(b, without(identityStateFiles(), droppedPath), 'chore: drop one');

    const { code, out, err } = cli(a, 'sync');

    assert.notEqual(code, 0, `sync exited 0 over a lossy merge: ${out}`);
    assert.ok(err.includes(adoptedNothing('merged state', 'drops', droppedPath)), err);
    assert.deepEqual(commitsWithParents(a, [localTip, dropped]), [], 'no merge commit');
    assert.equal(refOid(a, STATE_REF), localTip, 'the local state ref must keep its oid');
    assert.equal(refOid(remote, STATE_REF), dropped, 'the remote must not change');
  });
}

test('20261012-141809 CR4: a remote that adds a change and edits another fast-forwards', (t) => {
  const { remote, a, b } = identityFixture(t);
  addChange(b, '20261012-000003');
  writeDocument(b, 'changes/20260808-000001-change.md', `${changeText()}\nEdit.\n`);
  assert.equal(cli(b, 'sync').code, 0, 'the other clone publishes first');
  const published = refOid(remote, STATE_REF);
  assert.notEqual(refOid(a, STATE_REF), published, 'the remote really is ahead');

  const { code, out, err } = cli(a, 'sync');

  assert.equal(code, 0, `${out}${err}`);
  assert.equal(refOid(a, STATE_REF), published, 'the local ref advances to the remote revision');
});

test('20261012-141809 CR5: a merge that drops an unknown entry keeps its own diagnostic', (t) => {
  const { remote, a, b } = identityFixture(t);
  const dropped = publishRaw(b, without(identityStateFiles(), UNKNOWN_PATH), 'chore: drop');
  const localTip = addChange(a, '20261012-000004');

  const { code, err } = cli(a, 'sync');

  assert.notEqual(code, 0, err);
  assert.ok(
    err.includes(
      `Error: merged state drops "${UNKNOWN_PATH}", an entry of a collection this ChangeLedger does not know (future); update the installation before syncing`,
    ),
    err,
  );
  assert.deepEqual(commitsWithParents(a, [localTip, dropped]), [], 'no merge commit');
  assert.equal(refOid(a, STATE_REF), localTip, 'the local ref must not move');
  assert.equal(refOid(remote, STATE_REF), dropped, 'nothing was published');
});

const rewrittenUsage = () => ({
  ...identityStateFiles(),
  [USAGE_PATH]: '{"schema":1,"recorded_by":"mallory"}\n',
});

test('20261012-141809 CR6: a fast-forward does not adopt a rewritten usage record', (t) => {
  const { remote, a, b } = identityFixture(t);
  const rewritten = publishRaw(b, rewrittenUsage(), 'chore: rewrite a usage record');
  const localBefore = refOid(a, STATE_REF);

  const { code, out, err } = cli(a, 'sync');

  assert.notEqual(code, 0, `sync exited 0 over a rewritten usage record: ${out}`);
  assert.ok(
    err.includes(
      adoptedNothing(`state revision ${rewritten}`, 'rewrites usage record', USAGE_PATH),
    ),
    err,
  );
  assert.equal(refOid(a, STATE_REF), localBefore, 'the local state ref must keep its oid');
  assert.equal(refOid(remote, STATE_REF), rewritten, 'the remote must not change');
});

test('20261012-141809 CR6: a reconciliation does not publish a rewritten usage record', (t) => {
  const { remote, a, b } = identityFixture(t);
  const localTip = addChange(a, '20261012-000005');
  const rewritten = publishRaw(b, rewrittenUsage(), 'chore: rewrite a usage record');

  const { code, out, err } = cli(a, 'sync');

  assert.notEqual(code, 0, `sync exited 0 over a rewritten usage record: ${out}`);
  assert.ok(err.includes(adoptedNothing('merged state', 'rewrites usage record', USAGE_PATH)), err);
  assert.deepEqual(commitsWithParents(a, [localTip, rewritten]), [], 'no merge commit');
  assert.equal(refOid(a, STATE_REF), localTip, 'the local state ref must keep its oid');
  assert.equal(refOid(remote, STATE_REF), rewritten, 'the remote must not change');
});

// --- 20261019-184719 CR2: sync seals the acceptance graduation missed ------
//
// `sealAcceptance` reads the merge at graduation time and nothing retries it,
// so a branch that lands AFTER the graduation leaves `accepted_at` unstamped
// forever. These fixtures reproduce exactly that order, in a repo with no
// remote at all: publishing is a no-op there, merge detection is local.

const SEAL_ID = '20261019-000002';

const SEAL_STATE_CONFIG = `project_id: fixture01
changes_dir: .changeledger/changes
statuses: [draft, approved, in-progress, in-review, done, discarded]
stages: [request, log]
git:
  integration_branch: main
types:
  quick:
    stages: [request, log]
`;

function sealChangeText({ accepted = false, archived = false } = {}) {
  return [
    '---',
    `id: "${SEAL_ID}"`,
    'title: Delivered before its branch landed',
    'type: quick',
    'status: done',
    ...(archived ? ['archived: true'] : []),
    'created: 2026-10-19T00:00:02Z',
    'depends_on: []',
    ...(accepted ? ['accepted_at: 2026-10-19T00:00:00Z'] : []),
    `branch: feature/${SEAL_ID}`,
    '---',
    '',
    '## Request',
    '',
    'Graduated while the branch was still open.',
    '',
    '## Log',
    '',
    '- **2026-10-19T00:01:00Z** `[status]` draft → approved',
    '- **2026-10-19T00:02:00Z** `[status]` approved → in-progress',
    `- **2026-10-19T00:03:00Z** \`[branch]\` set: feature/${SEAL_ID} (auto)`,
    '- **2026-10-19T00:04:00Z** `[status]` in-progress → done',
    '- **2026-10-19T00:05:00Z** `[graduation]` skipped',
    '',
  ].join('\n');
}

// An activated repo with NO remote, holding one `done` change whose branch
// `merged` decides was landed on the integration branch after the graduation.
function sealFixture({ merged = true, text = sealChangeText() } = {}) {
  const { root } = activatedRepo({
    files: defaultStateFiles({
      projectId: 'fixture01',
      extra: {
        '.changeledger-state/config.yml': SEAL_STATE_CONFIG,
        '.changeledger-state/specs/demo-spec.md': ledgerSpecText(),
        [`.changeledger-state/changes/${SEAL_ID}-sealed.md`]: text,
      },
    }),
  });
  git(root, ['checkout', '-q', '-b', `feature/${SEAL_ID}`, 'main']);
  fs.writeFileSync(path.join(root, 'work.txt'), 'work\n');
  git(root, ['add', 'work.txt']);
  git(root, ['commit', '-q', '-m', `fix(x): work [#${SEAL_ID}]`]);
  git(root, ['checkout', '-q', 'main']);
  if (merged) {
    git(root, ['merge', '--no-ff', '-q', '-m', `merge [#${SEAL_ID}]`, `feature/${SEAL_ID}`]);
  }
  return root;
}

function sealedDocument(root) {
  return git(root, ['show', `${STATE_REF}:.changeledger-state/changes/${SEAL_ID}-sealed.md`]);
}

// The merge commit's own instant, in the ISO form `accepted_at` carries.
function mergeInstant(root) {
  const seconds = Number(git(root, ['log', '-1', '--format=%ct', 'main']));
  return new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function mergeShortSha(root) {
  return git(root, ['log', '-1', '--format=%H', 'main']).slice(0, 7);
}

test('20261019-184719 CR2: sync seals a pending acceptance in a repo with no remote', () => {
  const root = sealFixture();
  assert.equal(git(root, ['remote']), '', 'the fixture must configure no remote');
  assert.ok(!sealedDocument(root).includes('accepted_at:'), 'the change starts unstamped');

  const { code, out, err } = cli(root, 'sync');

  assert.equal(code, 0, `${out}${err}`);
  const document = sealedDocument(root);
  assert.ok(
    document.includes(`accepted_at: ${mergeInstant(root)}`),
    `expected accepted_at at the merge instant, got:\n${document}`,
  );
  assert.ok(
    document.includes(`\`[validation]\` accepted (merged ${mergeShortSha(root)})`),
    `expected the acceptance Log entry, got:\n${document}`,
  );
});

test('20261019-184719 CR2: a done change whose branch is unmerged receives nothing', () => {
  const root = sealFixture({ merged: false });
  const before = sealedDocument(root);

  const { code, out, err } = cli(root, 'sync');

  assert.equal(code, 0, `${out}${err}`);
  assert.equal(sealedDocument(root), before, 'an unmerged branch must leave the document alone');
});

test('20261019-184719 CR2: a change already stamped is not sealed twice', () => {
  const root = sealFixture({ text: sealChangeText({ accepted: true }) });
  const before = sealedDocument(root);

  const { code, out, err } = cli(root, 'sync');

  assert.equal(code, 0, `${out}${err}`);
  assert.equal(sealedDocument(root), before, 'sealing must be idempotent');
});

// The decision CR2 leaves open, pinned: archival freezes deliberation, not
// telemetry git derives afterwards. In the very case this exists for the merge
// lands after the archive, so skipping archived changes would leave `check`'s
// pending-acceptance warning (CR3) permanently unclearable.
test('20261019-184719 CR2: an archived change is sealed too, so its CR3 warning can clear', () => {
  const root = sealFixture({ text: sealChangeText({ archived: true }) });

  const { code, out, err } = cli(root, 'sync');

  assert.equal(code, 0, `${out}${err}`);
  const document = sealedDocument(root);
  assert.ok(
    document.includes(`accepted_at: ${mergeInstant(root)}`),
    `expected the archived change to be sealed, got:\n${document}`,
  );
  assert.equal(check_warnsAboutAcceptance(root), false, 'the pending warning must now clear');
});

// `check` after the seal: no acceptance warning survives it.
function check_warnsAboutAcceptance(root) {
  const { out } = cli(root, 'check', SEAL_ID);
  return out.includes('accepted_at is not stamped');
}

// Reading the ledger is new to `sync`, which until now moved refs without
// parsing a single document. A ledger it cannot parse must not become the
// reason a journal stops travelling.
test('20261019-184719 CR2: a ledger that cannot be parsed warns and does not block the sync', () => {
  const { root } = activatedRepo({
    files: defaultStateFiles({
      projectId: 'fixture01',
      extra: { '.changeledger-state/config.yml': SEAL_STATE_CONFIG },
    }),
  });

  const { code, out, err } = cli(root, 'sync');

  assert.equal(code, 0, `${out}${err}`);
  assert.ok(
    err.includes('could not read the ledger to seal pending acceptances'),
    `expected the unreadable-ledger warning, got: ${err}`,
  );
  assert.ok(out.includes('Nothing to sync'), `sync must still report its own outcome: ${out}`);
});

// The seal commits over the state ref, so the tip the comparison publishes is
// the one the seal left behind, never the one read before it.
test('20261019-184719 CR2: the tip sync publishes is the sealed one', () => {
  const root = sealFixture();
  const remote = tmpdir('changeledger-seal-remote-');
  initGitFixture(remote, { args: ['--bare', '-b', 'main'] });
  git(root, ['remote', 'add', 'origin', remote]);
  const beforeSeal = refOid(root, STATE_REF);

  const { code, out, err } = cli(root, 'sync');

  assert.equal(code, 0, `${out}${err}`);
  const sealedTip = refOid(root, STATE_REF);
  assert.notEqual(sealedTip, beforeSeal, 'the seal must have committed something to publish');
  assert.equal(refOid(remote, STATE_REF), sealedTip, 'the remote must hold the sealed tip');
});

// `--status` is the offline freshness report: it resolves no remote and writes
// nothing, so the seal is deliberately not on its path.
test('20261019-184719 CR2: --status reports without sealing anything', () => {
  const root = sealFixture();
  const before = sealedDocument(root);
  const tip = refOid(root, STATE_REF);

  const { code, out, err } = cli(root, 'sync', '--status');

  assert.equal(code, 0, `${out}${err}`);
  assert.equal(sealedDocument(root), before, '--status must leave the document untouched');
  assert.equal(refOid(root, STATE_REF), tip, '--status must move no ref');
});
