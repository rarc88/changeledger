import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

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
});
