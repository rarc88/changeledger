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
import { fileURLToPath } from 'node:url';
import { sync as syncCommand } from '../src/commands/sync.mjs';
import { capturedRun } from '../src/git.mjs';
import { ACTIVATION_REF, mutateState, readSnapshot, STATE_REF } from '../src/state-store.mjs';
import { initGitFixture, sanitizedEnv } from './helpers/git-env.mjs';
import {
  buildTree,
  changeText,
  commitTree,
  defaultStateFiles,
  git,
  ledgerChangeText,
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
function syncFixture() {
  const remote = tmpdir('changeledger-sync-remote-');
  initGitFixture(remote, { args: ['--bare', '-b', 'main'] });
  const { root: a, revision } = activatedRepo();
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
