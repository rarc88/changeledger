// `changeledger activate` — the clone-side half of the stage-2 adoption UX
// (20260809-113240 CR6, CR9). Every assertion goes through the real bin so the
// exit code under test is the process's own, not a return value a wiring bug
// could still hide.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ACTIVATION_REF, readActivation, STATE_REF, writeActivation } from '../src/state-store.mjs';
import {
  buildTree,
  commitTree,
  defaultStateFiles,
  git,
  ledgerSpecText,
  seedLedgerRepo,
  updateRef,
  writeLedgerFiles,
  writeLooseRef,
} from './helpers/state-repo.mjs';

const BIN = fileURLToPath(new URL('../bin/changeledger.mjs', import.meta.url));

// This suite may itself run inside this repo's own pre-commit hook, which
// exports GIT_DIR/GIT_WORK_TREE for the outer repo; left inherited, the CLI
// under test would operate on that repo instead of the fixture.
const CLI_ENV = { ...process.env };
for (const key of [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_CEILING_DIRECTORIES',
]) {
  delete CLI_ENV[key];
}

function cli(root, ...args) {
  try {
    const out = execFileSync(process.execPath, [BIN, ...args], {
      cwd: root,
      env: CLI_ENV,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out, err: '' };
  } catch (e) {
    return { code: e.status ?? 1, out: e.stdout ?? '', err: e.stderr ?? '' };
  }
}

// A clone-shaped fixture: the ledger repo plus a published state ref, with no
// activation yet — exactly what a fresh clone of an already cut-over repo has.
function clonedRepoWithState({ files = defaultStateFiles({ projectId: 'fixture01' }) } = {}) {
  const { root } = seedLedgerRepo();
  const tree = buildTree(root, files);
  const revision = commitTree(root, tree, { message: 'chore: state' });
  updateRef(root, STATE_REF, revision);
  return { root, revision };
}

function refOid(root, ref) {
  return git(root, ['rev-parse', ref]);
}

test('20260809-113240 CR6: activate creates the activation ref on a clone that has the state ref', () => {
  const { root } = clonedRepoWithState();

  const { code, out } = cli(root, 'activate');

  assert.equal(code, 0, out);
  assert.match(out, /Activated/);
  assert.doesNotThrow(() => refOid(root, ACTIVATION_REF));
});

test('20260809-113240 CR6: re-running activate over the same state is a no-op that does not move the ref', () => {
  const { root } = clonedRepoWithState();
  assert.equal(cli(root, 'activate').code, 0);
  const activation = refOid(root, ACTIVATION_REF);

  const { code, out } = cli(root, 'activate');

  assert.equal(code, 0, out);
  assert.match(out, /already activated/i);
  assert.equal(refOid(root, ACTIVATION_REF), activation);
});

test('20260809-113240 CR6: a divergent existing activation is rejected and left intact', () => {
  const { root } = clonedRepoWithState();
  writeActivation(root, { stateRef: 'refs/heads/other/state' });
  const activation = refOid(root, ACTIVATION_REF);

  const { code, err } = cli(root, 'activate');

  assert.notEqual(code, 0);
  assert.match(err, /refs\/heads\/other\/state/);
  assert.equal(refOid(root, ACTIVATION_REF), activation);
});

test('20260809-113240 CR9: a state ref resolving to an annotated tag is rejected, never peeled', () => {
  const { root, revision } = clonedRepoWithState();
  git(root, ['tag', '-a', '-m', 'tag', 'v1', revision]);
  // `update-ref` itself refuses a non-commit under refs/heads/, so the loose ref
  // is written directly to fabricate the scenario MIG-04 came from.
  writeLooseRef(root, STATE_REF, git(root, ['rev-parse', 'refs/tags/v1']));

  const { code, err } = cli(root, 'activate');

  assert.notEqual(code, 0);
  assert.match(err, /resolves to a tag, not a commit/);
  assert.throws(() => refOid(root, ACTIVATION_REF));
});

test('20260809-113240 CR6: activate without a state ref names what is missing', () => {
  const { root } = seedLedgerRepo();

  const { code, err } = cli(root, 'activate');

  assert.notEqual(code, 0);
  assert.match(err, new RegExp(STATE_REF.replace(/\//g, '\\/')));
  assert.throws(() => refOid(root, ACTIVATION_REF));
});

test('20260809-113240 CR6: activate outside a ChangeLedger repo fails without writing', () => {
  const { root } = clonedRepoWithState();
  const outside = path.dirname(root);

  const { code, err } = cli(outside, 'activate');

  assert.notEqual(code, 0);
  assert.match(
    err,
    /Not a ChangeLedger repo \(no \.changeledger\/ found\)\. Run `changeledger init` first\./,
  );
});

// --- 20260810-120457 CR1/CR5: activate anchors, and repairs a missing anchor --

test('20260810-120457 CR1: activate records the ledger directory it activates', () => {
  const { root } = clonedRepoWithState();

  assert.equal(cli(root, 'activate').code, 0);

  assert.equal(readActivation(root).ledger_dir, '.changeledger');
});

test('20260810-120457 CR5: activate repairs an activation written without the anchor', () => {
  // `defaultStateFiles`'s spec is plumbing-shaped (no frontmatter), which
  // `list` refuses on its own terms; swap in the ledger fixture's valid one so
  // the command's exit code reports the anchor and nothing else.
  const { root } = clonedRepoWithState({
    files: defaultStateFiles({
      projectId: 'fixture01',
      extra: { '.changeledger-state/specs/demo-spec.md': ledgerSpecText() },
    }),
  });
  const legacyTree = buildTree(root, {
    'authority.yml': `format_version: 1\nstate_ref: ${STATE_REF}\n`,
  });
  updateRef(root, ACTIVATION_REF, commitTree(root, legacyTree, { message: 'chore: activation' }));
  assert.throws(() => readActivation(root), /ledger_dir/);
  assert.notEqual(cli(root, 'list').code, 0);

  const { code, out } = cli(root, 'activate');

  assert.equal(code, 0, out);
  assert.match(out, /repair/i);
  assert.equal(readActivation(root).ledger_dir, '.changeledger');
  assert.equal(cli(root, 'list').code, 0);
});

// 20260811-163203 — a fresh clone has the state ref only as a remote-tracking
// copy; `activate` seeds the local ref from it (CAS create, tree validated
// first) instead of demanding a manual `git update-ref`.
test('20260811-163203: activate seeds the local state ref from the remote-tracking copy', () => {
  const { root, revision } = clonedRepoWithState();
  git(root, ['update-ref', '-d', STATE_REF]);
  git(root, ['remote', 'add', 'origin', root]);
  git(root, ['update-ref', 'refs/remotes/origin/changeledger/state', revision]);

  const result = cli(root, 'activate');
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /[Ss]eeded/);
  assert.equal(git(root, ['rev-parse', STATE_REF]), revision);
  assert.notEqual(readActivation(root), null);
});

test('20260811-163203: a clone with neither ref keeps the actionable error', () => {
  const { root } = clonedRepoWithState();
  git(root, ['update-ref', '-d', STATE_REF]);
  git(root, ['remote', 'add', 'origin', root]);

  const result = cli(root, 'activate');
  assert.notEqual(result.code, 0);
  assert.match(result.err, /no state to activate/);
  assert.match(result.err, /does not exist/);
});

test('20260811-163203: an invalid remote-tracking tree refuses the seed and creates nothing', () => {
  const { root } = clonedRepoWithState();
  git(root, ['update-ref', '-d', STATE_REF]);
  const files = defaultStateFiles({ projectId: 'fixture01' });
  const manifestPath = Object.keys(files).find((k) => k.endsWith('manifest.yml'));
  const bad = buildTree(root, {
    ...files,
    [manifestPath]: 'format_version: 99\nproject_id: "fixture01"\n',
  });
  const badCommit = commitTree(root, bad, { message: 'chore: bad state' });
  git(root, ['remote', 'add', 'origin', root]);
  git(root, ['update-ref', 'refs/remotes/origin/changeledger/state', badCommit]);

  const result = cli(root, 'activate');
  assert.notEqual(result.code, 0);
  assert.match(result.err, /format_version/);
  assert.throws(() => git(root, ['rev-parse', '--verify', STATE_REF]));
  assert.throws(() => git(root, ['rev-parse', '--verify', ACTIVATION_REF]));
});

// --- 20260925-130844: activate compares the minimum of the revision it adopts --
//
// The installed version is the distributed package's own (the bin reads the
// same `package.json`), so the literal diagnostic is built from it rather than
// from a hardcoded number that goes stale at the next release.
const { version: pkgVersion } = createRequire(import.meta.url)('../package.json');
const belowMinimum = (required) =>
  `ChangeLedger CLI ${pkgVersion} is below this repository's minimum ${required}; update the global installation.`;

// The state tree of a schema-6 ledger declaring `min`. `ledgerSpecText` swaps in
// the valid spec that the fixture's plumbing-shaped one is not, so CR4's `list` can succeed.
function stateFilesWithMin(min) {
  return defaultStateFiles({
    projectId: 'fixture01',
    extra: {
      '.changeledger-state/config.yml': `project_id: fixture01\nschema_version: 6\nmin_cli_version: ${min}\n`,
      '.changeledger-state/specs/demo-spec.md': ledgerSpecText(),
    },
  });
}

const allRefs = (root) => git(root, ['for-each-ref']);

// A fresh clone of a cut-over repo: no local state ref, no activation, the state
// only as `refs/remotes/origin/changeledger/state`, and a worktree marker whose
// own minimum the installed CLI satisfies (the guard in `preAction` reads it).
function freshClone(min) {
  const { root, revision } = clonedRepoWithState({ files: stateFilesWithMin(min) });
  git(root, ['update-ref', '-d', STATE_REF]);
  git(root, ['remote', 'add', 'origin', root]);
  git(root, ['update-ref', 'refs/remotes/origin/changeledger/state', revision]);
  writeLedgerFiles(root, {
    '.changeledger/config.yml': `schema_version: 6\nmin_cli_version: ${pkgVersion}\n`,
  });
  return { root, revision };
}

test('20260925-130844 CR1: a fresh clone does not adopt a state ref whose minimum is above the CLI', () => {
  const { root } = freshClone('99.0.0');
  const before = allRefs(root);

  const { code, out, err } = cli(root, 'activate');

  assert.notEqual(code, 0, `activate exited 0 over a higher minimum: ${out}`);
  assert.ok(err.includes(belowMinimum('99.0.0')), err);
  assert.equal(allRefs(root), before, 'activate left refs behind');
});

test('20260925-130844 CR2: a local state ref above the CLI is not activated', () => {
  const { root, revision } = clonedRepoWithState({ files: stateFilesWithMin('99.0.0') });
  const before = allRefs(root);

  const { code, out, err } = cli(root, 'activate');

  assert.notEqual(code, 0, `activate exited 0 over a higher minimum: ${out}`);
  assert.ok(err.includes(belowMinimum('99.0.0')), err);
  assert.throws(() => refOid(root, ACTIVATION_REF));
  assert.equal(refOid(root, STATE_REF), revision);
  assert.equal(allRefs(root), before);
});

test('20260925-130844 CR3: repairing an activation without the anchor respects the minimum', () => {
  const { root } = clonedRepoWithState({ files: stateFilesWithMin('99.0.0') });
  const legacyTree = buildTree(root, {
    'authority.yml': `format_version: 1\nstate_ref: ${STATE_REF}\n`,
  });
  const legacy = commitTree(root, legacyTree, { message: 'chore: activation' });
  updateRef(root, ACTIVATION_REF, legacy);
  assert.throws(() => readActivation(root), /ledger_dir/);

  const { code, out, err } = cli(root, 'activate');

  assert.notEqual(code, 0, `activate exited 0 over a higher minimum: ${out}`);
  assert.ok(err.includes(belowMinimum('99.0.0')), err);
  assert.equal(refOid(root, ACTIVATION_REF), legacy);
});

test('20260925-130844 CR4: a fresh clone whose state ref admits the CLI activates and then lists', () => {
  const { root, revision } = freshClone('0.1.0');

  const result = cli(root, 'activate');

  assert.equal(result.code, 0, result.err);
  assert.ok(
    result.out.includes(`Seeded ${STATE_REF} from refs/remotes/origin at ${revision}`),
    result.out,
  );
  assert.ok(
    result.out.includes(`Activated ${ACTIVATION_REF} → ${STATE_REF} at ${revision}`),
    result.out,
  );
  const listed = cli(root, 'list');
  assert.equal(listed.code, 0, listed.err);
});
