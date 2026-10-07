// scripts/run-tests.mjs runs `node --test` with a temp root of its own and
// removes it afterwards (20261007-135154). The wrapper is exercised on the tiny
// fixtures in test/fixtures/run-tests/, never on the real suite, with TMPDIR
// pointing at a sandbox directory so "nothing left behind" is an assertion on
// that sandbox.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wrapper = path.join(repo, 'scripts', 'run-tests.mjs');
const fixture = (name) => path.join(repo, 'test', 'fixtures', 'run-tests', `${name}.mjs`);

// A work dir holding the sandbox used as the wrapper's system temp and the
// report file the fixtures write; removed when the test ends.
function setup(t) {
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-run-tests-')));
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const sandbox = path.join(work, 'sandbox');
  fs.mkdirSync(sandbox);
  const report = path.join(work, 'report.json');
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  Object.assign(env, {
    TMPDIR: sandbox,
    TEMP: sandbox,
    TMP: sandbox,
    RUN_TESTS_FIXTURE: '1',
    RUN_TESTS_FIXTURE_REPORT: report,
  });
  return { sandbox, report, env };
}

const readReport = (report) => JSON.parse(fs.readFileSync(report, 'utf8'));

async function waitFor(predicate, what, ms = 20_000) {
  const deadline = Date.now() + ms;
  for (;;) {
    try {
      const value = predicate();
      if (value) return value;
    } catch {
      // not ready yet (for example a report file still being written)
    }
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test('CR1: a passing run exits 0 and leaves nothing in the system temp', (t) => {
  const { sandbox, report, env } = setup(t);
  const run = spawnSync(process.execPath, [wrapper, fixture('pass')], {
    env,
    cwd: repo,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const { dir } = readReport(report);
  assert.ok(
    dir.startsWith(`${sandbox}${path.sep}`),
    `the suite created ${dir} outside the sandbox ${sandbox}`,
  );
  assert.deepEqual(fs.readdirSync(sandbox), []);
});

test('CR1: arguments reach node --test', (t) => {
  const { sandbox, env } = setup(t);
  // The pattern selects only the passing case, so exit 0 proves the failing
  // file was run with the filter and the filter was forwarded.
  const run = spawnSync(
    process.execPath,
    [wrapper, '--test-name-pattern=pass-case', fixture('pass'), fixture('fail')],
    { env, cwd: repo, encoding: 'utf8' },
  );
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.deepEqual(fs.readdirSync(sandbox), []);
});

test('CR2: a failing run keeps the exit code of node --test and cleans up', (t) => {
  const { sandbox, report, env } = setup(t);
  const run = spawnSync(process.execPath, [wrapper, fixture('fail')], {
    env,
    cwd: repo,
    encoding: 'utf8',
  });
  const direct = setup(t);
  const plain = spawnSync(process.execPath, ['--test', fixture('fail')], {
    env: direct.env,
    cwd: repo,
    encoding: 'utf8',
  });
  assert.notEqual(plain.status, 0, 'node --test must fail on the fixture');
  assert.equal(run.status, plain.status, run.stdout + run.stderr);
  // The fixture ran under the wrapper and made its directory inside the sandbox.
  assert.ok(readReport(report).dir.startsWith(`${sandbox}${path.sep}`));
  assert.deepEqual(fs.readdirSync(sandbox), []);
});

for (const [signal, code] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
]) {
  test(`CR3: ${signal} ends the run with ${code} and cleans up`, async (t) => {
    const { sandbox, report, env } = setup(t);
    const child = spawn(process.execPath, [wrapper, fixture('hang')], {
      env,
      cwd: repo,
      stdio: 'ignore',
    });
    const closed = new Promise((resolve) =>
      child.on('close', (status, sig) => resolve({ status, sig })),
    );
    t.after(() => child.kill('SIGKILL'));
    const { pid } = await waitFor(() => readReport(report), 'the hanging test');
    // A wrapper that does not stop would leave the hanging test running.
    t.after(() => {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already gone
      }
    });
    child.kill(signal);
    const outcome = await Promise.race([
      closed,
      new Promise((resolve) => setTimeout(resolve, 15_000, 'timeout')),
    ]);
    assert.deepEqual(outcome, { status: code, sig: null });
    assert.deepEqual(fs.readdirSync(sandbox), []);
    await waitFor(() => !alive(pid), 'the test process to end');
  });
}
