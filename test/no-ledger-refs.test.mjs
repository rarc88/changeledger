import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { initGitFixture, sanitizedEnv } from './helpers/git-env.mjs';

const SCRIPT = fileURLToPath(new URL('../hooks/no-ledger-refs.sh', import.meta.url));
// The fixtures are assembled, never written out: this file is itself subject to
// the rule it tests, so a literal change id or criterion here would be rejected.
const ID = ['20261024', '202718'].join('-');
const cr = (n) => `CR${n}`;

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, env: sanitizedEnv(), encoding: 'utf8' });

// A scratch repo with one base commit; `files` seeds that commit.
function scratchRepo(files = { 'README.md': 'base\n' }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'no-ledger-refs-'));
  initGitFixture(root);
  write(root, files);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'base');
  return root;
}

function write(root, files) {
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), content);
  }
}

const stage = (root, files) => {
  write(root, files);
  git(root, 'add', '-A');
};

const run = (root, arg) => {
  const result = spawnSync('sh', [SCRIPT, arg], {
    cwd: root,
    env: sanitizedEnv(),
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

test('a staged CRn outside .changeledger/ is rejected with file, line and match', () => {
  const root = scratchRepo();
  stage(root, { 'src/x.mjs': `// see ${cr(3)}\n` });
  const result = run(root, '--cached');
  assert.equal(result.stdout, `src/x.mjs:1: ledger reference outside .changeledger/: ${cr(3)}\n`);
  assert.equal(result.status, 1);
});

test('a staged change id outside .changeledger/ is rejected with the id as match', () => {
  const root = scratchRepo();
  stage(root, { 'src/y.mjs': `export const a = 1;\nconst note = '${ID}';\n` });
  const result = run(root, '--cached');
  assert.equal(result.stdout, `src/y.mjs:2: ledger reference outside .changeledger/: ${ID}\n`);
  assert.equal(result.status, 1);
});

test('the ledger, its state and the contract grammar examples are exempt', () => {
  const root = scratchRepo();
  stage(root, {
    '.changeledger/changes/z.md': `see ${ID} ${cr(1)}\n`,
    '.changeledger-state/changes/z.md': `see ${ID} ${cr(1)}\n`,
    'templates/contract/spec.md': `see ${ID} ${cr(1)}\n`,
  });
  const result = run(root, '--cached');
  assert.deepEqual([result.status, result.stdout, result.stderr], [0, '', '']);
});

test('only added lines count, not references already in the file', () => {
  const root = scratchRepo({ 'src/old.mjs': `// ${cr(1)} predates the rule\n` });
  stage(root, { 'src/old.mjs': `// ${cr(1)} predates the rule\nconst clean = 1;\n` });
  const result = run(root, '--cached');
  assert.deepEqual([result.status, result.stdout], [0, '']);
});

test('a range inspects the commits it spans with the same rules', () => {
  const root = scratchRepo();
  const base = git(root, 'rev-parse', 'HEAD').trim();
  stage(root, { 'src/a.mjs': '// ok\n', '.changeledger/changes/z.md': `${ID}\n` });
  git(root, 'commit', '-q', '-m', 'clean');
  assert.deepEqual(
    [run(root, `${base}...HEAD`).status, run(root, `${base}...HEAD`).stdout],
    [0, ''],
  );
  stage(root, { 'src/b.mjs': `const a = 1;\n// ${cr(12)} here\n` });
  git(root, 'commit', '-q', '-m', 'dirty');
  const result = run(root, `${base}...HEAD`);
  assert.equal(result.stdout, `src/b.mjs:2: ledger reference outside .changeledger/: ${cr(12)}\n`);
  assert.equal(result.status, 1);
});

test('nothing staged or an empty range inspects nothing and passes', () => {
  const root = scratchRepo();
  assert.deepEqual([run(root, '--cached').status, run(root, '--cached').stdout], [0, '']);
  assert.deepEqual([run(root, 'HEAD...HEAD').status, run(root, 'HEAD...HEAD').stdout], [0, '']);
});

test('CR followed by letters or a letter after the digits is not a criterion', () => {
  const root = scratchRepo();
  stage(root, {
    'src/crud.mjs':
      '// CRUD operations\n// CR3x is a name\n// MYCR3 and CR_3\n// 1234567-123456 is no id\n',
  });
  const result = run(root, '--cached');
  assert.deepEqual([result.status, result.stdout], [0, '']);
});

test('line numbers follow the new file for a hunk in the middle and every offence is reported', () => {
  const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
  const root = scratchRepo({ 'src/m.mjs': `${lines.join('\n')}\n` });
  const edited = [
    ...lines.slice(0, 4),
    `// ${cr(7)}`,
    'extra',
    ...lines.slice(4, 8),
    `// ${ID}`,
    ...lines.slice(8),
  ];
  stage(root, { 'src/m.mjs': `${edited.join('\n')}\n` });
  const result = run(root, '--cached');
  assert.equal(
    result.stdout,
    [
      `src/m.mjs:5: ledger reference outside .changeledger/: ${cr(7)}`,
      `src/m.mjs:11: ledger reference outside .changeledger/: ${ID}`,
      '',
    ].join('\n'),
  );
  assert.equal(result.status, 1);
});

test('an added line in a renamed file is inspected like any other', () => {
  const root = scratchRepo({ 'README.md': 'base\n', 'src/ren.mjs': 'export const a = 1;\n' });
  git(root, 'mv', 'src/ren.mjs', 'src/renamed.mjs');
  fs.appendFileSync(path.join(root, 'src/renamed.mjs'), `// ${cr(3)} in rename\n`);
  git(root, 'add', '-A');
  const result = run(root, '--cached');
  assert.equal(
    result.stdout,
    `src/renamed.mjs:2: ledger reference outside .changeledger/: ${cr(3)}\n`,
  );
  assert.equal(result.status, 1);
});

test('the exemptions hold when the user configures diff.noprefix', () => {
  const root = scratchRepo();
  git(root, 'config', 'diff.noprefix', 'true');
  stage(root, { '.changeledger/changes/np.md': `${ID}\n`, 'src/z.mjs': `// ${cr(4)}\n` });
  const result = run(root, '--cached');
  assert.equal(result.stdout, `src/z.mjs:1: ledger reference outside .changeledger/: ${cr(4)}\n`);
  assert.equal(result.status, 1);
});
