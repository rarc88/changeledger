// `changeledger import --from <ref>` — the incremental, idempotent absorption of
// one worktree-layout ref into an activated repo's state ref (20260809-113241
// CR1-CR12). Every assertion goes through the real bin so the exit code under
// test is the process's own, and every fixture is a real temporary git repo cut
// over by the real `cutover` command — the starting point the import assumes.

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CAS_CONFLICT_MESSAGE, readSnapshot, STATE_REF } from '../src/state-store.mjs';
import {
  defaultLedgerFiles,
  git,
  ledgerConfigText,
  ledgerReleaseText,
  ledgerSpecText,
  seedLedgerRepo,
  writeLedgerFiles,
} from './helpers/state-repo.mjs';

const BIN = fileURLToPath(new URL('../bin/changeledger.mjs', import.meta.url));

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
  return cliWithEnv(root, {}, ...args);
}

// Same as `cli`, but with extra environment overlaid on top of `CLI_ENV` — the
// CAS-race fixture below needs a `PATH` that puts its git shim first.
function cliWithEnv(root, envOverrides, ...args) {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd: root,
    env: { ...CLI_ENV, ...envOverrides },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  return { code: result.status ?? 1, out: result.stdout ?? '', err: result.stderr ?? '' };
}

// A real `git` shim on PATH that forces the CAS loss `test/config-migration.test.mjs`
// forces via an injected `run` — the import path has no such hook since the CLI
// runs as a real subprocess, so the race has to land inside the actual git
// binary the subprocess resolves via PATH. On the FIRST `commit-tree` (the step
// `mutateState` takes right before its CAS `update-ref`), the shim uses the
// real git to land a genuine concurrent commit and advance `ref` out from
// under the expected revision, then forwards the original invocation — and
// every other one — to the real git untouched.
function createCasRaceShim(root, ref) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-git-shim-'));
  const realGit = execFileSync('command', ['-v', 'git'], { shell: true, encoding: 'utf8' }).trim();
  const marker = path.join(dir, 'raced');
  const shimPath = path.join(dir, 'git');
  fs.writeFileSync(
    shimPath,
    `#!/usr/bin/env bash
set -euo pipefail
if [ "\${1:-}" = "commit-tree" ] && [ ! -f "${marker}" ]; then
  touch "${marker}"
  tip=$("${realGit}" -C "${root}" rev-parse "${ref}")
  tree=$("${realGit}" -C "${root}" rev-parse "\${tip}^{tree}")
  winner=$("${realGit}" -C "${root}" commit-tree "\${tree}" -p "\${tip}" -m "race: concurrent winner")
  "${realGit}" -C "${root}" update-ref "${ref}" "\${winner}" "\${tip}"
fi
exec "${realGit}" "$@"
`,
    { mode: 0o755 },
  );
  return dir;
}

const SOURCE = 'feature-x';
const DEMO_ID = '20260808-000001';
const DEMO_FILE = `.changeledger/changes/${DEMO_ID}-demo.md`;
const DEMO_DOC = `changes/${DEMO_ID}-demo.md`;
const NEW_ID = '20260101-000001';
const NEW_FILE = `.changeledger/changes/${NEW_ID}-new.md`;
const NEW_DOC = `changes/${NEW_ID}-new.md`;
const SPEC_FILE = '.changeledger/specs/demo-spec.md';
const SPEC_DOC = 'specs/demo-spec.md';
const RELEASE_FILE = '.changeledger/releases/0.1.0.yml';
const RELEASE_DOC = 'releases/0.1.0.yml';

// The two Log entries every ordering scenario is built from, plus a third that
// shares the first's prefix and then departs from it. `checkLifecycleSequence`
// reconstructs the status from these, so each variant carries the status its own
// Log ends on — a mismatched pair would fail validation before classification.
const E1 = '- **2026-08-08T01:00:00Z** `[status]` draft → approved';
const E2 = '- **2026-08-08T02:00:00Z** `[status]` approved → in-progress';
const E2_OTHER = '- **2026-08-08T03:30:00Z** `[status]` approved → in-progress';

const STATUS_AFTER = (logs) =>
  logs.length === 0 ? 'draft' : logs.length === 1 ? 'approved' : 'in-progress';

function changeText({
  id = DEMO_ID,
  body = 'Demo multibyte: café, mañana, 東京.',
  logs = [],
} = {}) {
  return `---\nid: "${id}"\ntitle: Añadir soporté ☂\ntype: quick\nstatus: ${STATUS_AFTER(logs)}\ncreated: 2026-08-08T00:00:00Z\ndepends_on: []\n---\n\n## Request\n\n${body}\n\n## Log\n${logs.map((l) => `${l}\n`).join('')}`;
}

// An activated repo (cut over on `main`) plus a branch that still carries the
// worktree-layout ledger — the real "branch in flight at the moment of the
// migration" the import exists for. The branch is committed BEFORE the cutover,
// exactly as it would have been in a real adoption.
function activatedRepo({
  mainFiles = defaultLedgerFiles(),
  sourceFiles = {},
  removeFromSource = [],
  allowEmptySource = false,
} = {}) {
  const { root } = seedLedgerRepo({ files: mainFiles });
  git(root, ['checkout', '-q', '-b', SOURCE]);
  writeLedgerFiles(root, sourceFiles);
  for (const rel of removeFromSource) git(root, ['rm', '-q', '-f', '--', rel]);
  git(root, ['add', '-A']);
  const commitArgs = ['commit', '-q'];
  if (allowEmptySource) commitArgs.push('--allow-empty');
  commitArgs.push('-m', 'feat: work on the branch');
  git(root, commitArgs);
  git(root, ['checkout', '-q', 'main']);
  const cut = cli(root, 'cutover');
  assert.equal(cut.code, 0, cut.err);
  return root;
}

function stateRevision(root) {
  return git(root, ['rev-parse', STATE_REF]);
}

function snapshotConfigBlob(root) {
  // Read untrimmed and straight from the object database: the fixture helper's
  // `git()` trims, which would make a trailing-newline change invisible.
  return execFileSync('git', ['cat-file', 'blob', `${STATE_REF}:.changeledger-state/config.yml`], {
    cwd: root,
    env: CLI_ENV,
    encoding: 'utf8',
  });
}

// Rewrites the source branch and returns to `main` — the "late document" half of
// what this command exists for.
function amendSource(root, files, message = 'feat: more work on the branch') {
  git(root, ['checkout', '-q', SOURCE]);
  writeLedgerFiles(root, files);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', message]);
  git(root, ['checkout', '-q', 'main']);
}

// --- CR1: a document absent from the snapshot is added -----------------------

test('20260809-113241 CR1: a change the snapshot does not have is added byte for byte', () => {
  const source = changeText({ id: NEW_ID });
  const root = activatedRepo({ sourceFiles: { [NEW_FILE]: source } });
  const before = stateRevision(root);

  const { code, out, err } = cli(root, 'import', '--from', SOURCE);

  assert.equal(code, 0, err || out);
  const snapshot = readSnapshot(root);
  assert.equal(snapshot.documents[NEW_DOC], source);
  assert.notEqual(snapshot.revision, before);
  // The documents that were already published are untouched by the add.
  assert.equal(snapshot.documents[DEMO_DOC], defaultLedgerFiles()[DEMO_FILE]);
  assert.deepEqual(Object.keys(snapshot.documents).sort(), [
    NEW_DOC,
    DEMO_DOC,
    RELEASE_DOC,
    SPEC_DOC,
  ]);
});

// --- CR2: re-running the same ref absorbs nothing (MIG-05) -------------------

test('20260809-113241 CR2: re-importing the same ref is a no-op that does not move the ref', () => {
  const root = activatedRepo({ sourceFiles: { [NEW_FILE]: changeText({ id: NEW_ID }) } });
  assert.equal(cli(root, 'import', '--from', SOURCE).code, 0);
  const after = stateRevision(root);

  const { code, out, err } = cli(root, 'import', '--from', SOURCE);

  assert.equal(code, 0, err || out);
  assert.match(out, /nothing to import/i);
  assert.equal(stateRevision(root), after);
  // Determinism: a third run reaches the same result, not a growing history.
  assert.equal(cli(root, 'import', '--from', SOURCE).code, 0);
  assert.equal(stateRevision(root), after);
});

// --- CR3: the snapshot already absorbed this version and moved on ------------

test('20260809-113241 CR3: a snapshot Log that strictly extends the imported one is kept', () => {
  const held = changeText({ logs: [E1, E2] });
  const root = activatedRepo({
    mainFiles: defaultLedgerFiles({ changeText: held }),
    sourceFiles: { [DEMO_FILE]: changeText({ logs: [E1] }) },
  });
  const before = stateRevision(root);

  const { code, out, err } = cli(root, 'import', '--from', SOURCE);

  assert.equal(code, 0, err || out);
  assert.equal(readSnapshot(root).documents[DEMO_DOC], held);
  assert.equal(stateRevision(root), before);
});

// --- CR4: the source is strictly newer ---------------------------------------

test('20260809-113241 CR4: an imported Log that strictly extends the snapshot wins', () => {
  const incoming = changeText({ logs: [E1, E2] });
  const root = activatedRepo({
    mainFiles: defaultLedgerFiles({ changeText: changeText({ logs: [E1] }) }),
    sourceFiles: { [DEMO_FILE]: incoming },
  });

  const { code, out, err } = cli(root, 'import', '--from', SOURCE);

  assert.equal(code, 0, err || out);
  assert.equal(readSnapshot(root).documents[DEMO_DOC], incoming);
});

// --- CR5: the same Log with a different body is a conflict -------------------

test('20260809-113241 CR5: identical Logs with divergent bodies are a conflict, nothing written', () => {
  const held = changeText({ logs: [E1], body: 'La versión publicada.' });
  const root = activatedRepo({
    mainFiles: defaultLedgerFiles({ changeText: held }),
    sourceFiles: { [DEMO_FILE]: changeText({ logs: [E1], body: 'La versión de la rama.' }) },
  });
  const before = stateRevision(root);

  const { code, err } = cli(root, 'import', '--from', SOURCE);

  assert.notEqual(code, 0);
  assert.match(err, new RegExp(DEMO_ID));
  assert.match(err, /no Log advance/i);
  assert.equal(stateRevision(root), before);
  assert.equal(readSnapshot(root).documents[DEMO_DOC], held);
});

// --- CR6: Logs that share a prefix and then part are a conflict --------------

test('20260809-113241 CR6: Logs diverging after a shared prefix are a conflict, nothing written', () => {
  const held = changeText({ logs: [E1, E2] });
  const root = activatedRepo({
    mainFiles: defaultLedgerFiles({ changeText: held }),
    sourceFiles: { [DEMO_FILE]: changeText({ logs: [E1, E2_OTHER] }) },
  });
  const before = stateRevision(root);

  const { code, err } = cli(root, 'import', '--from', SOURCE);

  assert.notEqual(code, 0);
  assert.match(err, new RegExp(DEMO_ID));
  assert.match(err, /diverge after 1 shared/i);
  assert.equal(stateRevision(root), before);
  assert.equal(readSnapshot(root).documents[DEMO_DOC], held);
});

// --- CR7: all or nothing ------------------------------------------------------

test('20260809-113241 CR7: one conflict withholds the importable document too', () => {
  const root = activatedRepo({
    mainFiles: defaultLedgerFiles({
      changeText: changeText({ logs: [E1], body: 'La versión publicada.' }),
    }),
    sourceFiles: {
      [DEMO_FILE]: changeText({ logs: [E1], body: 'La versión de la rama.' }),
      [NEW_FILE]: changeText({ id: NEW_ID }),
    },
  });
  const before = stateRevision(root);

  const { code, err } = cli(root, 'import', '--from', SOURCE);

  assert.notEqual(code, 0);
  assert.match(err, /nothing was written/);
  assert.equal(stateRevision(root), before);
  // The clean document is withheld: a partial apply would make the outcome
  // depend on the order of invocations.
  assert.equal(NEW_DOC in readSnapshot(root).documents, false);
});

// --- CR8: specs and releases are byte-identical or conflict ------------------

test('20260809-113241 CR8: a divergent spec conflicts, and the aligned re-import absorbs the rest', () => {
  const EXTRA_FILE = '.changeledger/specs/extra-spec.md';
  const EXTRA_DOC = 'specs/extra-spec.md';
  const extra = ledgerSpecText({ title: 'Otro contrato' });
  const root = activatedRepo({
    sourceFiles: {
      '.changeledger/specs/demo-spec.md': `${ledgerSpecText()}\nLínea extra.\n`,
      [EXTRA_FILE]: extra,
    },
  });
  const before = stateRevision(root);

  const conflicted = cli(root, 'import', '--from', SOURCE);

  assert.notEqual(conflicted.code, 0);
  assert.match(conflicted.err, /demo-spec/);
  assert.match(conflicted.err, /no Log/i);
  assert.equal(stateRevision(root), before);
  assert.equal(EXTRA_DOC in readSnapshot(root).documents, false);

  // Aligned at the source, the same ref now imports cleanly: the new spec is
  // added and the byte-identical release stays a no-op.
  amendSource(root, { '.changeledger/specs/demo-spec.md': ledgerSpecText() }, 'docs: align spec');
  const { code, out, err } = cli(root, 'import', '--from', SOURCE);

  assert.equal(code, 0, err || out);
  const snapshot = readSnapshot(root);
  assert.equal(snapshot.documents[EXTRA_DOC], extra);
  assert.equal(snapshot.documents[SPEC_DOC], ledgerSpecText());
  assert.equal(snapshot.documents[RELEASE_DOC], ledgerReleaseText());
  assert.match(out, /Imported 1 document/);
});

// --- CR9: the source's config.yml is ignored ---------------------------------

test('20260809-113241 CR9: a divergent source config is neither imported nor reported', () => {
  const root = activatedRepo({
    sourceFiles: {
      '.changeledger/config.yml': ledgerConfigText.replace(
        'project_name: fixture',
        'project_name: fixture-de-la-rama',
      ),
    },
  });
  const before = stateRevision(root);

  const { code, out, err } = cli(root, 'import', '--from', SOURCE);

  assert.equal(code, 0, err || out);
  assert.equal(snapshotConfigBlob(root), ledgerConfigText);
  assert.equal(stateRevision(root), before);
  assert.doesNotMatch(`${out}${err}`, /config/i);
});

// --- CR12: the import requires an activated repo -----------------------------

test('20260809-113241 CR12: import on a repo that was never activated is refused', () => {
  const { root } = seedLedgerRepo();
  git(root, ['checkout', '-q', '-b', SOURCE]);
  git(root, ['checkout', '-q', 'main']);

  const { code, err } = cli(root, 'import', '--from', SOURCE);

  assert.notEqual(code, 0);
  assert.match(err, /activat/i);
  assert.equal(
    (() => {
      try {
        git(root, ['rev-parse', '--verify', STATE_REF]);
        return true;
      } catch {
        return false;
      }
    })(),
    false,
  );
});

// --- CR10: a ref that is not a commit object is refused (MIG-04) -------------

test('20260809-113241 CR10: an annotated tag is refused, never peeled to its commit', () => {
  const root = activatedRepo({ sourceFiles: { [NEW_FILE]: changeText({ id: NEW_ID }) } });
  git(root, ['tag', '-a', 'v-import', SOURCE, '-m', 'annotated']);
  const before = stateRevision(root);

  const { code, err } = cli(root, 'import', '--from', 'v-import');

  assert.notEqual(code, 0);
  assert.match(err, /not a commit/);
  assert.equal(stateRevision(root), before);
});

// --- CR11: an invalid source document aborts before anything is written ------

test('20260809-113241 CR11: a source change with no ## Log aborts naming the document', () => {
  const broken = changeText({ id: NEW_ID }).replace('\n## Log\n', '\n');
  const root = activatedRepo({ sourceFiles: { [NEW_FILE]: broken } });
  const before = stateRevision(root);

  const { code, err } = cli(root, 'import', '--from', SOURCE);

  assert.notEqual(code, 0);
  assert.match(err, /20260101-000001-new\.md/);
  assert.match(err, /log/i);
  assert.equal(stateRevision(root), before);
  assert.equal(NEW_DOC in readSnapshot(root).documents, false);
});

// --- a source ref with no ChangeLedger documents at all ----------------------
//
// "Nothing to import" and "nothing was found to import" are different facts and
// must not share a sentence. Reporting an unreadable ref as "0 document(s)
// already absorbed" claims an absorption that never happened — an operator who
// believes it deletes a branch whose ledger was never read. The exit code stays
// 0 in both cases (CR2's approved wording fixes that); only the text separates
// them.
test('20260809-113241 CR2: a ref with no ChangeLedger documents says so, never "already absorbed"', () => {
  const root = activatedRepo({ allowEmptySource: true });
  git(root, ['checkout', '-q', '--orphan', 'no-ledger']);
  git(root, ['rm', '-r', '-q', '-f', '.']);
  writeLedgerFiles(root, { 'README.md': '# unrelated branch\n' });
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'chore: a branch with no ledger']);
  git(root, ['checkout', '-q', 'main']);
  const before = stateRevision(root);

  const { code, out, err } = cli(root, 'import', '--from', 'no-ledger');

  assert.equal(code, 0, err || out);
  assert.match(out, /no ChangeLedger documents/i);
  assert.doesNotMatch(out, /already absorbed/);
  assert.equal(stateRevision(root), before);
});

// --- a source layout that hides its changes from the snapshot authority -----

test('20260809-140157: zero visible documents warns when the source declares another changes_dir', () => {
  const movedDir = 'branch-ledger/changes';
  const root = activatedRepo({
    sourceFiles: {
      '.changeledger/config.yml': ledgerConfigText.replace(
        'changes_dir: .changeledger/changes',
        `changes_dir: ${movedDir}`,
      ),
      [`${movedDir}/${NEW_ID}-new.md`]: changeText({ id: NEW_ID }),
    },
    removeFromSource: [DEMO_FILE, SPEC_FILE, RELEASE_FILE],
  });
  const before = stateRevision(root);

  const { code, out, err } = cli(root, 'import', '--from', SOURCE);

  assert.equal(code, 0, err || out);
  assert.match(out, /no ChangeLedger documents/i);
  assert.match(err, /source declares `changes_dir: branch-ledger\/changes`/i);
  assert.match(err, /this repo reads `.changeledger\/changes`/i);
  assert.match(err, /documents.*not imported/i);
  assert.equal(stateRevision(root), before);
  assert.equal(NEW_DOC in readSnapshot(root).documents, false);
});

test('20260809-140157: zero visible documents with matching changes_dir emits no warning', () => {
  const root = activatedRepo({
    removeFromSource: [DEMO_FILE, SPEC_FILE, RELEASE_FILE],
  });

  const { code, out, err } = cli(root, 'import', '--from', SOURCE);

  assert.equal(code, 0, err || out);
  assert.match(out, /no ChangeLedger documents/i);
  assert.equal(err, '');
});

test('20260809-140157: a source-only specs_dir does not trigger the changes_dir warning', () => {
  const movedSpecsDir = 'branch-ledger/specs';
  const root = activatedRepo({
    sourceFiles: {
      '.changeledger/config.yml': ledgerConfigText.replace(
        'specs_dir: .changeledger/specs',
        `specs_dir: ${movedSpecsDir}`,
      ),
      [`${movedSpecsDir}/demo-spec.md`]: ledgerSpecText(),
    },
    removeFromSource: [DEMO_FILE, SPEC_FILE, RELEASE_FILE],
  });

  const { code, out, err } = cli(root, 'import', '--from', SOURCE);

  assert.equal(code, 0, err || out);
  assert.match(out, /no ChangeLedger documents/i);
  assert.equal(err, '');
});

test('20260809-140157: import help scopes validation to the snapshot-authoritative layout', () => {
  const { code, out, err } = cli(process.cwd(), 'import', '--help');

  assert.equal(code, 0, err || out);
  assert.doesNotMatch(out, /validates the whole source/i);
  assert.match(out, /validates every document visible\s+under that layout/i);
});

// --- identity survives a rename ----------------------------------------------
//
// A change is its id, not its filename. When the source both renames a change
// and extends its Log, the update must land at the path the snapshot already
// publishes: writing it at the source's new name would leave the same change
// published twice, under two names, with no way for either to win next time.
test('20260809-113241 CR4: a renamed change updates in place, never as a second document', () => {
  const RENAMED = `.changeledger/changes/${DEMO_ID}-renombrado.md`;
  const incoming = changeText({ logs: [E1, E2] });
  const root = activatedRepo({
    mainFiles: defaultLedgerFiles({ changeText: changeText({ logs: [E1] }) }),
    sourceFiles: { [RENAMED]: incoming },
    removeFromSource: [DEMO_FILE],
  });

  const { code, out, err } = cli(root, 'import', '--from', SOURCE);

  assert.equal(code, 0, err || out);
  const snapshot = readSnapshot(root);
  assert.equal(snapshot.documents[DEMO_DOC], incoming);
  assert.equal(`changes/${DEMO_ID}-renombrado.md` in snapshot.documents, false);
  assert.deepEqual(Object.keys(snapshot.documents).sort(), [DEMO_DOC, RELEASE_DOC, SPEC_DOC]);
});

// --- 20260810-004608: the report follows the confirmed CAS, never precedes it -

test('20260810-004608 CR1: a lost CAS race prints no applied-document lines', () => {
  const root = activatedRepo({ sourceFiles: { [NEW_FILE]: changeText({ id: NEW_ID }) } });
  const before = stateRevision(root);
  const shimDir = createCasRaceShim(root, STATE_REF);

  let result;
  try {
    result = cliWithEnv(
      root,
      { PATH: `${shimDir}${path.delimiter}${CLI_ENV.PATH}` },
      'import',
      '--from',
      SOURCE,
    );
  } finally {
    fs.rmSync(shimDir, { recursive: true, force: true });
  }
  const { code, out, err } = result;

  assert.notEqual(code, 0);
  assert.match(err, new RegExp(CAS_CONFLICT_MESSAGE));
  // The race genuinely landed (the ref moved under the command), and yet
  // nothing that reads as an applied add/update reached stdout.
  assert.notEqual(stateRevision(root), before);
  assert.doesNotMatch(out, /^ {2}[+~] /m);
});

test('20260810-004608 CR2: a winning import reports the same lines and order as before', () => {
  const root = activatedRepo({
    mainFiles: defaultLedgerFiles({ changeText: changeText({ logs: [E1] }) }),
    sourceFiles: {
      [DEMO_FILE]: changeText({ logs: [E1, E2] }),
      [NEW_FILE]: changeText({ id: NEW_ID }),
    },
  });
  const sourceRevision = git(root, ['rev-parse', SOURCE]);

  const { code, out, err } = cli(root, 'import', '--from', SOURCE);

  assert.equal(code, 0, err || out);
  const tip = stateRevision(root);
  const lines = out.replace(/\n$/, '').split('\n');
  assert.deepEqual(lines, [
    `  + ${NEW_DOC} (change ${NEW_ID})`,
    `  ~ ${DEMO_DOC} (change ${DEMO_ID})`,
    `Imported 2 document(s) from ${SOURCE} (${sourceRevision}) — ${STATE_REF} at ${tip}`,
  ]);
});
