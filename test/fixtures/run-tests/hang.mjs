// Fixture for test/run-tests.test.mjs: a test that creates a directory in the
// system temp, reports it and then never finishes, so the test can interrupt
// the run. Inert unless RUN_TESTS_FIXTURE is set (see pass.mjs).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

if (process.env.RUN_TESTS_FIXTURE) {
  test('run-tests-fixture hang-case', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-tests-fixture-'));
    fs.writeFileSync(
      process.env.RUN_TESTS_FIXTURE_REPORT,
      JSON.stringify({ dir, pid: process.pid }),
    );
    setInterval(() => {}, 1000);
    await new Promise(() => {});
  });
}
