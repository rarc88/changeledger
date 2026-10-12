// Fixture for test/run-tests.test.mjs: a passing test that creates a directory
// in the system temp. Inert unless RUN_TESTS_FIXTURE is set, because
// `node --test` loads every module under test/ and the fixture must add no
// test to the real suite. When active, RUN_TESTS_FIXTURE_REPORT names the file
// that receives { dir, pid }.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

if (process.env.RUN_TESTS_FIXTURE) {
  test('run-tests-fixture pass-case', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-tests-fixture-'));
    fs.writeFileSync(
      process.env.RUN_TESTS_FIXTURE_REPORT,
      JSON.stringify({ dir, pid: process.pid }),
    );
  });
}
