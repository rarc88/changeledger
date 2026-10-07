// Fixture for test/run-tests.test.mjs: a failing test that creates a directory
// in the system temp. Inert unless RUN_TESTS_FIXTURE is set (see pass.mjs).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

if (process.env.RUN_TESTS_FIXTURE) {
  test('run-tests-fixture fail-case', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-tests-fixture-'));
    fs.writeFileSync(
      process.env.RUN_TESTS_FIXTURE_REPORT,
      JSON.stringify({ dir, pid: process.pid }),
    );
    assert.fail('intentional fixture failure');
  });
}
