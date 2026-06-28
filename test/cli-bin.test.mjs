import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { validation } from '../src/commands/agent.mjs';

const bin = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'bin',
  'changeledger.mjs',
);

test('ChangeLedger migration exposes only the unscoped changeledger binary (CR1, CR2)', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(path.dirname(bin), '..', 'package.json'), 'utf8'),
  );
  assert.equal(packageJson.name, 'changeledger');
  assert.deepEqual(packageJson.bin, { changeledger: 'bin/changeledger.mjs' });
  assert.equal(Object.hasOwn(packageJson.bin, 'sl'), false);
});

// Run the CLI; returns { code, out, err }.
function run(...args) {
  try {
    const out = execFileSync('node', [bin, ...args], { encoding: 'utf8' });
    return { code: 0, out, err: '' };
  } catch (e) {
    return { code: e.status ?? 1, out: e.stdout ?? '', err: e.stderr ?? '' };
  }
}

function runDirect(...args) {
  try {
    const out = execFileSync(bin, args, { encoding: 'utf8' });
    return { code: 0, out, err: '' };
  } catch (e) {
    return { code: e.status ?? 1, out: e.stdout ?? '', err: e.stderr ?? '' };
  }
}

// Run the CLI inside a repo, with an isolated registry home.
function runIn(cwd, env, ...args) {
  try {
    const out = execFileSync('node', [bin, ...args], { encoding: 'utf8', cwd, env });
    return { code: 0, out, err: '' };
  } catch (e) {
    return { code: e.status ?? 1, out: e.stdout ?? '', err: e.stderr ?? '' };
  }
}

test('CR1: changeledger graduate --help shows --skip and --pending, exit 0', () => {
  const { code, out } = run('graduate', '--help');
  assert.equal(code, 0);
  assert.match(out, /--skip/);
  assert.match(out, /--pending/);
});

test('CR2: changeledger task -h shows done|block, exit 0', () => {
  const { code, out } = run('task', '-h');
  assert.equal(code, 0);
  assert.match(out, /done\|block/);
});

test('CR3: changeledger graduate with no args fails with its usage', () => {
  const { code, err } = run('graduate');
  assert.notEqual(code, 0);
  assert.match(err, /graduate/);
});

test('CR4: changeledger --help lists all commands', () => {
  const { code, out } = run('--help');
  assert.equal(code, 0);
  assert.match(out, /changeledger init/);
  assert.match(out, /changeledger context/);
  assert.match(out, /changeledger graduate/);
  assert.match(out, /changeledger review/);
  assert.match(out, /changeledger release/);
});

test('205033 CR1/CR3/CR4: context is wired through the CLI', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = { ...process.env, CHANGELEDGER_HOME: home };
  assert.equal(runIn(root, env, 'init').code, 0);

  const core = runIn(root, env, 'context');
  assert.equal(core.code, 0);
  assert.match(core.out, /Mode: core/);

  const review = runIn(root, env, 'context', 'review');
  assert.equal(review.code, 0);
  assert.match(review.out, /Mode: review/);

  const unknown = runIn(root, env, 'context', 'bogus');
  assert.equal(unknown.code, 1);
  assert.match(
    unknown.err,
    /Unknown context "bogus" — valid modes: implement, review, spec, release \(or pass a change id\)/,
  );
});

test('235628 CR1/CR5/CR7: release CLI initializes, plans JSON and records', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = { ...process.env, CHANGELEDGER_HOME: home };

  assert.equal(runIn(root, env, 'init').code, 0);
  assert.equal(runIn(root, env, 'release', 'init', '0.1.0').code, 0);
  assert.equal(runIn(root, env, 'new', 'feature', 'x', 'X').code, 0);
  const item = JSON.parse(runIn(root, env, 'list', '--json').out)[0];
  const file = fs
    .readdirSync(path.join(root, '.changeledger', 'changes'))
    .map((name) => path.join(root, '.changeledger', 'changes', name))
    .find((candidate) => fs.readFileSync(candidate, 'utf8').includes(`id: "${item.id}"`));
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('status: draft', 'status: done'));

  const planned = runIn(root, env, 'release', 'plan', '--json');
  assert.equal(planned.code, 0);
  const plan = JSON.parse(planned.out);
  assert.equal(plan.nextVersion, '0.2.0');
  assert.deepEqual(
    plan.changes.map((change) => change.id),
    [item.id],
  );
  assert.equal(runIn(root, env, 'release', 'record', '0.2.0').code, 0);
  assert.equal(fs.existsSync(path.join(root, '.changeledger', 'releases', '0.2.0.yml')), true);
});

test('151226: bin remains directly executable', { skip: process.platform === 'win32' }, () => {
  const { code, out } = runDirect('--help');
  assert.equal(code, 0);
  assert.match(out, /changeledger init/);
});

test('151226: unknown options fail instead of being ignored', () => {
  const { code, err } = run('list', '--bogus');
  assert.notEqual(code, 0);
  assert.match(err, /unknown option '--bogus'/);
});

test('changeledger review --help shows pass and fail routing, exit 0', () => {
  const { code, out } = run('review', '--help');
  assert.equal(code, 0);
  assert.match(out, /pass/);
  assert.match(out, /--retry/);
  assert.match(out, /--block/);
});

// End-to-end: the bin parses `review <id> fail --block "<reason>"` (mode + reason
// extraction) and routes the change to blocked.
test('review wiring: fail --block parses the reason and blocks the change', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = { ...process.env, CHANGELEDGER_HOME: home };

  assert.equal(runIn(root, env, 'init').code, 0);
  assert.equal(runIn(root, env, 'new', 'feature', 'x', 'X').code, 0);
  const id = JSON.parse(runIn(root, env, 'list', '--json').out)[0].id;

  for (const s of ['approved', 'in-progress', 'in-review']) {
    assert.equal(runIn(root, env, 'status', id, s).code, 0);
  }
  assert.equal(runIn(root, env, 'review', id, 'fail', '--block', 'spec is ambiguous').code, 0);

  const shown = JSON.parse(runIn(root, env, 'show', id, '--json').out);
  assert.equal(shown.frontmatter.status, 'blocked');
  assert.match(
    shown.stages.find((s) => s.key === 'log').body,
    /review → blocked: spec is ambiguous/,
  );
});

// End-to-end: `changeledger graduate <id> <slug> --into` links an existing spec (flag in
// any position) without touching its body, exit 0.
test('CR6: graduate --into wires through and links an existing spec', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = { ...process.env, CHANGELEDGER_HOME: home };

  assert.equal(runIn(root, env, 'init').code, 0);
  assert.equal(runIn(root, env, 'new', 'chore', 'x', 'X').code, 0);
  const id = JSON.parse(runIn(root, env, 'list', '--json').out)[0].id;
  // chore: no review gate, but human validation is still required.
  for (const s of ['approved', 'in-progress', 'in-validation']) {
    assert.equal(runIn(root, env, 'status', id, s).code, 0);
  }
  validation(id, 'pass', {}, root);

  const specFile = path.join(root, '.changeledger', 'specs', 'architecture.md');
  fs.mkdirSync(path.dirname(specFile), { recursive: true });
  fs.writeFileSync(
    specFile,
    '---\ntitle: Arch\nupdated: 2020-01-01T00:00:00Z\ntags: [architecture]\n---\n\n# Arch\n\nBody kept.\n',
  );

  const res = runIn(root, env, 'graduate', id, 'architecture', '--into');
  assert.equal(res.code, 0);
  const after = fs.readFileSync(specFile, 'utf8');
  assert.match(after, /Body kept\./);
  assert.doesNotMatch(after, /2020-01-01T00:00:00Z/);
});
