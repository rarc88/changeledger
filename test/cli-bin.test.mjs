import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { validation } from '../src/commands/agent.mjs';

const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'sl.mjs');

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

test('CR1: sl graduate --help shows --skip and --pending, exit 0', () => {
  const { code, out } = run('graduate', '--help');
  assert.equal(code, 0);
  assert.match(out, /--skip/);
  assert.match(out, /--pending/);
});

test('CR2: sl task -h shows done|block, exit 0', () => {
  const { code, out } = run('task', '-h');
  assert.equal(code, 0);
  assert.match(out, /done\|block/);
});

test('CR3: sl graduate with no args fails with its usage', () => {
  const { code, err } = run('graduate');
  assert.notEqual(code, 0);
  assert.match(err, /graduate/);
});

test('CR4: sl --help lists all commands', () => {
  const { code, out } = run('--help');
  assert.equal(code, 0);
  assert.match(out, /sl init/);
  assert.match(out, /sl graduate/);
  assert.match(out, /sl review/);
});

test('151226: bin remains directly executable', () => {
  const { code, out } = runDirect('--help');
  assert.equal(code, 0);
  assert.match(out, /sl init/);
});

test('151226: unknown options fail instead of being ignored', () => {
  const { code, err } = run('list', '--bogus');
  assert.notEqual(code, 0);
  assert.match(err, /unknown option '--bogus'/);
});

test('sl review --help shows pass and fail routing, exit 0', () => {
  const { code, out } = run('review', '--help');
  assert.equal(code, 0);
  assert.match(out, /pass/);
  assert.match(out, /--retry/);
  assert.match(out, /--block/);
});

// End-to-end: the bin parses `review <id> fail --block "<reason>"` (mode + reason
// extraction) and routes the change to blocked.
test('review wiring: fail --block parses the reason and blocks the change', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = { ...process.env, SPEC_LEDGER_HOME: home };

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

// End-to-end: `sl graduate <id> <slug> --into` links an existing spec (flag in
// any position) without touching its body, exit 0.
test('CR6: graduate --into wires through and links an existing spec', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = { ...process.env, SPEC_LEDGER_HOME: home };

  assert.equal(runIn(root, env, 'init').code, 0);
  assert.equal(runIn(root, env, 'new', 'chore', 'x', 'X').code, 0);
  const id = JSON.parse(runIn(root, env, 'list', '--json').out)[0].id;
  // chore: no review gate, but human validation is still required.
  for (const s of ['approved', 'in-progress', 'in-validation']) {
    assert.equal(runIn(root, env, 'status', id, s).code, 0);
  }
  validation(id, 'pass', {}, root);

  const specFile = path.join(root, '.sl', 'specs', 'architecture.md');
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
