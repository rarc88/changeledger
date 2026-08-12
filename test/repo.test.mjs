import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { commit } from '../src/commands/commit.mjs';
import { findChangeledgerDir, resolveRepoPath } from '../src/config.mjs';
import { loadRepo, loadRepoAsync, loadRepoWithConfig } from '../src/repo.mjs';
import { STATE_REF, writeActivation } from '../src/state-store.mjs';
import { initGitFixture, sanitizedEnv } from './helpers/git-env.mjs';
import {
  buildTree,
  commitTree,
  initStateRepo,
  git as stateGit,
  updateRef,
  writeLooseRef,
} from './helpers/state-repo.mjs';

function fixture(changesDir = '.changeledger/changes') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-'));
  const changes = path.join(root, '.changeledger', 'changes');
  fs.mkdirSync(changes, { recursive: true });
  fs.writeFileSync(
    path.join(root, '.changeledger', 'config.yml'),
    `language: en\nchanges_dir: ${changesDir}\ntypes:\n  feature:\n    stages: [request, plan]\n`,
  );
  fs.writeFileSync(
    path.join(changes, '0001-x.md'),
    '---\nid: "0001"\ntitle: X\ntype: feature\nstatus: draft\ncreated: 2026-06-13T00:00:00Z\ndepends_on: []\n---\n\n## Request\n\nHi.\n',
  );
  return root;
}

test('loadRepo finds .changeledger, reads config and changes', () => {
  const root = fixture();
  const repo = loadRepo(root);
  assert.equal(repo.config.language, 'en');
  assert.equal(repo.changes.length, 1);
  assert.equal(repo.changes[0].frontmatter.id, '0001');
});

test('loadRepo walks up from a subdirectory', () => {
  const root = fixture();
  const sub = path.join(root, 'src', 'deep');
  fs.mkdirSync(sub, { recursive: true });
  const repo = loadRepo(sub);
  assert.equal(repo.changes.length, 1);
});

test('loadRepo throws outside a ChangeLedger repo', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-empty-'));
  assert.throws(() => loadRepo(empty), /Run `changeledger init`/);
});

test('103625: project discovery ignores a global home and finds only configured repos', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-tree-'));
  const globalState = path.join(home, '.changeledger');
  fs.mkdirSync(globalState);
  fs.writeFileSync(path.join(globalState, '.registry.json'), '{}\n');

  const tempRoot = path.join(home, 'AppData', 'Local', 'Temp');
  const outside = path.join(tempRoot, 'outside');
  fs.mkdirSync(outside, { recursive: true });

  assert.equal(findChangeledgerDir(outside), null);
  assert.throws(() => loadRepo(outside), /no \.changeledger\/ found/);

  const repoRoot = path.join(tempRoot, 'repo');
  const projectState = path.join(repoRoot, '.changeledger');
  const nested = path.join(repoRoot, 'src', 'nested');
  fs.mkdirSync(projectState, { recursive: true });
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(
    path.join(projectState, 'config.yml'),
    'changes_dir: .changeledger/changes\ntypes:\n  feature:\n    stages: [request]\n',
  );

  assert.equal(findChangeledgerDir(nested), projectState);
  assert.equal(loadRepo(nested).repoRoot, repoRoot);
});

test('ChangeLedger migration does not discover the retired project directory (CR3, CR9)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-retired-'));
  fs.mkdirSync(path.join(root, '.sl'), { recursive: true });
  fs.writeFileSync(path.join(root, '.sl', 'config.yml'), 'language: en\n');
  assert.throws(() => loadRepo(root), /no \.changeledger\/ found/);
});

test('CR1: a traversal changes_dir is rejected and reads nothing outside', () => {
  const root = fixture('../outside');
  assert.throws(() => loadRepo(root), /changes_dir.*escapes the repo root/);
});

test('CR2: an absolute changes_dir is rejected before any IO', () => {
  const root = fixture(path.join(os.tmpdir(), 'changeledger-abs-target'));
  assert.throws(() => loadRepo(root), /changes_dir.*must be relative/);
});

test('CR3: a configured dir symlinked outside the repo is rejected', () => {
  const root = fixture('.changeledger/changes');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-ext-'));
  const link = path.join(root, 'escape');
  fs.symlinkSync(outside, link);
  assert.throws(() => resolveRepoPath(root, 'escape', 'specs_dir'), /specs_dir.*symlink/);
});

test('CR4: default and normalized internal paths keep working', () => {
  assert.equal(loadRepo(fixture()).changes.length, 1);
  assert.equal(loadRepo(fixture('./.changeledger/changes')).changes.length, 1);
});

// 20260615-175731 — an intermediate ancestor is a symlink and the final target
// does not exist yet. The shape check passes and existsSync(resolved) is false,
// so the realpath guard must inspect the nearest existing ancestor.
test('175731 CR1: an external intermediate symlink with a non-existent target is rejected', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-'));
  fs.mkdirSync(path.join(root, '.changeledger'), { recursive: true });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-ext-'));
  fs.symlinkSync(outside, path.join(root, '.changeledger', 'escape'));
  assert.throws(
    () => resolveRepoPath(root, '.changeledger/escape/newdir', 'changes_dir'),
    /changes_dir.*symlink/,
  );
  assert.ok(!fs.existsSync(path.join(outside, 'newdir')), 'must not create in the external target');
});

test('175731 CR2: an internal intermediate symlink is accepted for a non-existent target', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-'));
  const real = path.join(root, '.changeledger', 'real');
  fs.mkdirSync(real, { recursive: true });
  fs.symlinkSync(real, path.join(root, '.changeledger', 'link'));
  const resolved = resolveRepoPath(root, '.changeledger/link/newdir', 'changes_dir');
  assert.equal(resolved, path.join(root, '.changeledger', 'link', 'newdir'));
});

// 20260730-183807 CR4 — loadRepo must never let a raw fs or parse error reach
// the caller unattributed when a consumer repo's changes_dir contains a
// directory that merely looks like a document, or a symlink to a file with no
// frontmatter block.

test('183807 CR4: a directory named like a change document gets a named error, never raw EISDIR', () => {
  const root = fixture();
  const changes = path.join(root, '.changeledger', 'changes');
  const offender = path.join(changes, '0002-looks-like-a-doc.md');
  fs.mkdirSync(offender);

  assert.throws(
    () => loadRepo(root),
    (e) =>
      e.message === `${offender}: expected a change document but found a directory` &&
      e.code !== 'EISDIR',
  );
});

test('183807 CR4: a symlink to a file without frontmatter gets a named error with its path', () => {
  const root = fixture();
  const changes = path.join(root, '.changeledger', 'changes');
  const target = path.join(root, 'no-frontmatter-target.md');
  fs.writeFileSync(target, 'no frontmatter here, just prose\n');
  const offender = path.join(changes, '0002-symlink.md');
  fs.symlinkSync(target, offender);

  assert.throws(
    () => loadRepo(root),
    (e) => e.message === `${offender}: Change is missing its frontmatter block`,
  );
});

// 20260730-183807 CR5 — a `changes_dir` that collapses to the repo root must
// be diagnosed as the collapse itself, not left to die on the first ordinary
// markdown file (e.g. AGENTS.md) with the raw frontmatter error. The message
// stays consistent with the commit guard's own diagnosis of the same collapse
// (162616 CR9), since loadRepo is the first thing `commit` calls.

test('183807 CR5: a collapsed changes_dir aborts naming the collapse, not the frontmatter error', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-collapsed-'));
  fs.mkdirSync(path.join(root, '.changeledger'), { recursive: true });
  fs.writeFileSync(path.join(root, '.changeledger', 'config.yml'), 'changes_dir: "."\n');
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');

  assert.throws(
    () => loadRepo(root),
    /changes_dir "\." resolves to the repo root; the commit guard cannot judge staged paths/,
  );
});

const GIT_ENV = sanitizedEnv();
function git(root, args) {
  return execFileSync('git', args, { cwd: root, env: GIT_ENV, encoding: 'utf8' });
}

test('183807 CR5: the realistic `commit` route reaches the collapse message, not the frontmatter one', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-collapsed-commit-'));
  initGitFixture(root);
  git(root, ['config', 'commit.gpgsign', 'false']);
  fs.mkdirSync(path.join(root, '.changeledger'), { recursive: true });
  fs.writeFileSync(path.join(root, '.changeledger', 'config.yml'), 'changes_dir: "."\n');
  // An ordinary consumer markdown file — before CR5 this is exactly what
  // `loadRepo` tried to parse as a change document and died on, raw.
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  fs.writeFileSync(path.join(root, 'leftover.tmp'), 'not declared anywhere');
  git(root, ['add', '-A']);

  assert.throws(
    () => commit({ message: 'fix(x): y', ids: ['20260711-000001'] }, root, undefined, () => {}),
    (e) =>
      e.message ===
        'changes_dir "." resolves to the repo root; the commit guard cannot judge staged paths — configure changes_dir to a subdirectory' &&
      !e.message.includes('frontmatter'),
  );
});

// 20260808-151641 — read routing to the global-state snapshot. `loadRepo`
// must produce byte-identical results with zero git subprocesses when a repo
// is not activated, and must serve the state ref's snapshot (never the
// worktree) when it is.

function changeDoc(id, title) {
  return `---\nid: "${id}"\ntitle: ${title}\ntype: feature\nstatus: draft\ncreated: 2026-08-08T00:00:00Z\ndepends_on: []\n---\n\n## Request\n\nHi.\n`;
}

// A real git repo discoverable as a ChangeLedger repo (worktree `.changeledger/`
// with its own change, `only-worktree`) whose activation points at a state ref
// carrying a different document, `only-ref` — the exact CR2 shape (doc only in
// ref vs only in worktree). `seedStateRef: false` leaves the state ref entirely
// unwritten (CR3's "absent" case). `subdir` (CR8) nests `.changeledger/` below
// the git top-level — the state ref and activation still live at the real git
// root (refs are repo-wide, not tied to cwd depth); `root` is what `loadRepo`
// is called with (the ChangeLedger discovery point), `gitRoot` is the actual
// top-level.
function activatedFixture({
  stateConfig = 'project_id: demo\nlanguage: en\n',
  seedStateRef = true,
  subdir = '',
} = {}) {
  const gitRoot = initStateRepo();
  const root = subdir ? path.join(gitRoot, subdir) : gitRoot;
  fs.mkdirSync(path.join(root, '.changeledger', 'changes'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.changeledger', 'config.yml'),
    'language: es\nchanges_dir: .changeledger/changes\ntypes:\n  feature:\n    stages: [request]\n',
  );
  fs.writeFileSync(
    path.join(root, '.changeledger', 'changes', 'only-worktree.md'),
    changeDoc('only-worktree', 'Only worktree'),
  );

  let revision;
  if (seedStateRef) {
    const tree = buildTree(gitRoot, {
      '.changeledger-state/manifest.yml': 'format_version: 1\nproject_id: demo\n',
      '.changeledger-state/config.yml': stateConfig,
      '.changeledger-state/changes/only-ref.md': changeDoc('only-ref', 'Only ref'),
    });
    revision = commitTree(gitRoot, tree, { message: 'chore: state' });
    updateRef(gitRoot, STATE_REF, revision);
  }

  // Taken for the ledger at `root`, which is what the activation records: the
  // ref is repo-wide, but it names the one ledger it activates.
  writeActivation(root, { stateRef: STATE_REF });
  return { root, gitRoot, revision };
}

// Activation present, but the state ref names a blob instead of a commit —
// CR3's "unreadable" variant (the other variant, "absent", is
// `activatedFixture({ seedStateRef: false })`).
function nonCommitStateRefFixture() {
  const root = initStateRepo();
  fs.mkdirSync(path.join(root, '.changeledger', 'changes'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.changeledger', 'config.yml'),
    'language: es\nchanges_dir: .changeledger/changes\ntypes:\n  feature:\n    stages: [request]\n',
  );
  const blob = stateGit(root, ['hash-object', '-w', '--stdin'], { input: 'not a commit' });
  writeLooseRef(root, STATE_REF, blob);
  writeActivation(root, { stateRef: STATE_REF });
  return { root };
}

test('20260808-151641 CR1: no activation stays byte-identical with zero git subprocesses', () => {
  const root = fixture();
  const throwingRun = () => {
    throw new Error('unexpected git subprocess invocation');
  };
  const repo = loadRepo(root, { run: throwingRun });
  assert.equal(repo.config.language, 'en');
  assert.equal(repo.changes.length, 1);
  assert.equal(repo.changes[0].frontmatter.id, '0001');
  assert.equal(repo.state, null);
});

test('20260808-151641 CR2: an activated repo serves the state-ref snapshot, not the worktree', () => {
  const { root, revision } = activatedFixture();
  const repo = loadRepo(root);
  assert.equal(repo.state.revision, revision);
  assert.deepEqual(
    repo.changes.map((c) => c.frontmatter.id),
    ['only-ref'],
  );
  assert.equal(
    repo.changes.find((c) => c.frontmatter.id === 'only-worktree'),
    undefined,
  );
});

test('20260808-151641 CR3: activation with an absent state ref fails explicit, no fallback', () => {
  const { root } = activatedFixture({ seedStateRef: false });
  assert.throws(() => loadRepo(root), /state is not initialized/);
});

test('20260808-151641 CR3: activation with a non-commit state ref fails explicit, no fallback', () => {
  const { root } = nonCommitStateRefFixture();
  assert.throws(() => loadRepo(root), /not a commit/);
});

test('20260808-151641 CR4: active config comes from the snapshot, not the worktree', () => {
  const { root } = activatedFixture({ stateConfig: 'project_id: demo\nlanguage: en\n' });
  const repo = loadRepo(root);
  assert.equal(repo.config.language, 'en');
});

test('20260809-113242 CR10: active repo loaders never parse a malformed stale marker', async () => {
  const { root, revision } = activatedFixture();
  fs.writeFileSync(path.join(root, '.changeledger', 'config.yml'), 'statuses: [\n');

  const syncRepo = loadRepo(root);
  const asyncRepo = await loadRepoAsync(root);

  assert.equal(syncRepo.state.revision, revision);
  assert.equal(asyncRepo.state.revision, revision);
  assert.deepEqual(
    syncRepo.changes.map((change) => change.frontmatter.id),
    ['only-ref'],
  );
  assert.deepEqual(
    asyncRepo.changes.map((change) => change.frontmatter.id),
    ['only-ref'],
  );
});

// 20260809-194235 — one state read per activated load. 20260809-113242 gave
// `loadRepo` a config bootstrap that enumerates the state tree, but the
// activated branch then ignored it and enumerated everything again through
// `readSnapshot`: measured with the shim below, an activated `loadRepo` cost
// 18 git processes where the whole load needs 9.

// Counts real `git` executions by prepending a shim directory to PATH. This is
// the only instrument that sees every subprocess, including one a future
// caller spawns without going through the injectable `run` seam — which an
// injected counter would silently miss, and the double read this pins was
// invisible for exactly that reason. `sanitizedEnv` strips the GIT_* location
// vars but forwards PATH, so `capturedRun`'s call to the `git` binary reaches
// the shim; the shim logs argv and `exec`s the absolute real git, so it never
// recurses into itself.
async function countGitSpawns(load) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-git-shim-'));
  const log = path.join(dir, 'spawns.log');
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  fs.writeFileSync(log, '');
  fs.writeFileSync(
    path.join(dir, 'git'),
    `#!/bin/sh\nprintf '%s ' "$@" >> ${JSON.stringify(log)}\nprintf '\\n' >> ${JSON.stringify(log)}\nexec ${realGit} "$@"\n`,
    { mode: 0o755 },
  );

  const previousPath = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${previousPath}`;
  try {
    await load();
  } finally {
    process.env.PATH = previousPath;
  }
  return fs
    .readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => line.trim());
}

// The four stages of one full state read. CR1 is about how many times this
// SEQUENCE runs, so each stage is counted on its own: a later change that adds
// one more integrity probe to the load is legitimate drift and should not fail
// here, while any re-entry into the enumeration — the defect — takes every one
// of these counts to 2 at once.
const STATE_READ_STAGES = [
  ['activation probe', /^rev-parse --verify --quiet refs\/changeledger\/activation$/],
  ['ls-tree', /^ls-tree -r -z --full-tree /],
  ['cat-file --batch-check', /^cat-file --batch-check$/],
  ['cat-file --batch', /^cat-file --batch$/],
];

function assertSingleStateRead(spawns, label) {
  for (const [stage, pattern] of STATE_READ_STAGES) {
    const times = spawns.filter((line) => pattern.test(line)).length;
    assert.equal(
      times,
      1,
      `${label}: ${stage} ran ${times}×, expected exactly 1\n${spawns.join('\n')}`,
    );
  }
}

// 20260810-181803 — the tri-state contract of `options.snapshot` (absent =
// resolve it yourself; null = inactive; object = serve it) decides by strict
// identity, never truthiness: a falsy non-null value is a caller bug and must
// fail loudly instead of silently loading the repo as inactive.
test('20260810-181803: a falsy non-null options.snapshot fails loudly instead of loading inactive', () => {
  const { root } = activatedFixture();
  const changeledgerDir = path.join(root, '.changeledger');
  for (const bogus of [0, '', false]) {
    assert.throws(
      () => loadRepoWithConfig(root, changeledgerDir, { language: 'es' }, { snapshot: bogus }),
      /options\.snapshot must be a snapshot object or null/,
      `snapshot=${JSON.stringify(bogus)} must be refused`,
    );
  }
});

test('20260809-194235 CR1: an activated loadRepo reads the state tree exactly once', async () => {
  const { root, revision } = activatedFixture();
  let repo;
  const spawns = await countGitSpawns(() => {
    repo = loadRepo(root);
  });

  assertSingleStateRead(spawns, 'loadRepo');
  // A budget, not a goal: this load cost 18 processes while the bootstrap's
  // read was thrown away. Raising the number is a deliberate decision here,
  // never a silent regression in a caller.
  assert.equal(
    spawns.length,
    9,
    `loadRepo spawned ${spawns.length} git processes:\n${spawns.join('\n')}`,
  );
  assert.equal(repo.state.revision, revision);
});

test('20260809-194235 CR1: an activated loadRepoAsync reads the state tree exactly once', async () => {
  const { root, revision } = activatedFixture();
  let repo;
  const spawns = await countGitSpawns(async () => {
    repo = await loadRepoAsync(root);
  });

  assertSingleStateRead(spawns, 'loadRepoAsync');
  assert.equal(
    spawns.length,
    9,
    `loadRepoAsync spawned ${spawns.length} git processes:\n${spawns.join('\n')}`,
  );
  assert.equal(repo.state.revision, revision);
});

test('20260809-194235 CR1: the single read holds for a ledger below the git top-level', async () => {
  const { root, revision } = activatedFixture({ subdir: 'apps/proj' });
  let repo;
  const spawns = await countGitSpawns(() => {
    repo = loadRepo(root);
  });

  assertSingleStateRead(spawns, 'loadRepo (subdir)');
  assert.equal(repo.state.revision, revision);
});

// CR2's second half, pinned against real processes rather than the injected
// `run` seam: outside any git repository the load must execute no `git` at
// all — not even a probe whose non-zero exit would be swallowed.
test('20260809-194235 CR2: a load outside any git repo executes no git process', async () => {
  const root = fixture();
  let repo;
  const spawns = await countGitSpawns(() => {
    repo = loadRepo(root);
  });

  assert.deepEqual(spawns, []);
  assert.equal(repo.state, null);
  assert.equal(repo.changes.length, 1);
});

// Correction round (post-review) — CR8: a `.changeledger/` below the git
// top-level must not hide a live activation. `fs.existsSync(repoRoot/.git)`
// only checks the exact directory `loadRepo` was given, which is `root`
// (the subdir) here, not `gitRoot` where `.git` actually lives — the defect
// the reviewer confirmed.
test('20260808-151641 CR8: an activated repo below the git top-level still serves the snapshot', () => {
  const { root, revision } = activatedFixture({ subdir: 'apps/proj' });
  const repo = loadRepo(root);
  assert.equal(repo.state.revision, revision);
  assert.deepEqual(
    repo.changes.map((c) => c.frontmatter.id),
    ['only-ref'],
  );
  assert.equal(
    repo.changes.find((c) => c.frontmatter.id === 'only-worktree'),
    undefined,
  );
});
