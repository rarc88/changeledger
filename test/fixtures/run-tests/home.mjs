// Fixture for test/run-tests.test.mjs: reports the CHANGELEDGER_HOME the
// wrapper hands its child, and the registry file a real register() lands in.
// Inert unless RUN_TESTS_FIXTURE is set, because `node --test` loads every
// module under test/ and the fixture must add no test to the real suite. When
// active, RUN_TESTS_FIXTURE_REPORT names the file that receives
// { home, homedir, registry, entries }.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { register, registryPath } from '../../../src/registry.mjs';

if (process.env.RUN_TESTS_FIXTURE) {
  test('run-tests-fixture home-case', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'run-tests-fixture-home-'));
    register({ id: 'cr4', name: 'cr4', path: repo });
    const registry = registryPath();
    fs.writeFileSync(
      process.env.RUN_TESTS_FIXTURE_REPORT,
      JSON.stringify({
        home: process.env.CHANGELEDGER_HOME ?? null,
        homedir: os.homedir(),
        registry,
        entries: Object.keys(JSON.parse(fs.readFileSync(registry, 'utf8'))),
      }),
    );
  });
}
