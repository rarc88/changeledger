// `changeledger activate` — the clone-side half of the stage-2 adoption UX
// (20260809-113240 CR6, CR9). Every assertion goes through the real bin so the
// exit code under test is the process's own, not a return value a wiring bug
// could still hide.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
