import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkRepo } from '../src/check.mjs';
import {
  assertRepoCliVersion,
  CliVersionError,
  cliVersionError,
  compareCliVersions,
  isValidCliVersion,
  minCliVersionDeclarationError,
} from '../src/version-guard.mjs';

const schema6 = (min) => ({ schema_version: 6, min_cli_version: min });
const below = (installed, required) =>
  `ChangeLedger CLI ${installed} is below this repository's minimum ${required}; update the global installation.`;

test('184354 CR4: SemVer precedence decides compatibility for the specified pairs', () => {
  assert.equal(cliVersionError(schema6('0.17.0'), '0.17.0'), null);
  assert.equal(cliVersionError(schema6('0.17.0'), '0.17.1'), null);
  assert.equal(cliVersionError(schema6('0.17.0'), '0.17.0-dev'), below('0.17.0-dev', '0.17.0'));
  assert.equal(cliVersionError(schema6('0.17.0'), '0.16.9'), below('0.16.9', '0.17.0'));
});

test('184354 CR4: precedence follows semver.org §11, not text order', () => {
  // semver.org's own ascending example, plus numeric-vs-text traps.
  const ascending = [
    '0.9.0',
    '0.10.0',
    '1.0.0-alpha',
    '1.0.0-alpha.1',
    '1.0.0-alpha.beta',
    '1.0.0-beta',
    '1.0.0-beta.2',
    '1.0.0-beta.11',
    '1.0.0-rc.1',
    '1.0.0',
    '1.0.1',
    '1.1.0',
    '2.0.0',
  ];
  for (let i = 0; i < ascending.length; i++) {
    for (let j = 0; j < ascending.length; j++) {
      assert.equal(
        compareCliVersions(ascending[i], ascending[j]),
        Math.sign(i - j),
        `${ascending[i]} vs ${ascending[j]}`,
      );
    }
  }
  assert.equal(compareCliVersions('1.0.0+build.1', '1.0.0'), 0, 'build metadata has no precedence');
  assert.throws(() => compareCliVersions('latest', '1.0.0'), /latest/);
});

test('184354 CR3: a lower installed version gets the literal actionable diagnostic', () => {
  assert.equal(
    cliVersionError(schema6('0.18.0'), '0.17.0'),
    "ChangeLedger CLI 0.17.0 is below this repository's minimum 0.18.0; update the global installation.",
  );
});

test('184354 CR8: a newer global CLI works until the repo raises its minimum', () => {
  assert.equal(cliVersionError(schema6('0.17.0'), '0.17.1'), null);
  assert.equal(cliVersionError(schema6('0.18.0'), '0.17.1'), below('0.17.1', '0.18.0'));
});

test('184354 schema gate: below schema 6 the declaration is ignored', () => {
  for (const config of [
    { schema_version: 5, min_cli_version: '99.0.0' },
    { schema_version: 5, min_cli_version: 'latest' },
    { schema_version: 5 },
    {},
    null,
  ]) {
    assert.equal(cliVersionError(config, '0.17.0'), null, JSON.stringify(config));
    assert.equal(minCliVersionDeclarationError(config), null, JSON.stringify(config));
  }
  assert.equal(
    cliVersionError({ schema_version: 7, min_cli_version: '99.0.0' }, '0.17.0'),
    below('0.17.0', '99.0.0'),
  );
});

test('184354 CR5: an absent or invalid declaration fails closed with the check wording', () => {
  for (const config of [
    { schema_version: 6 },
    schema6('latest'),
    schema6('^0.17.0'),
    schema6(17),
  ]) {
    const message = cliVersionError(config, '0.17.0');
    assert.match(message, /min_cli_version/);
    if ('min_cli_version' in config)
      assert.ok(message.includes(JSON.stringify(config.min_cli_version)));
    else assert.match(message, /missing/);
    assert.equal(message, minCliVersionDeclarationError(config));
    const { errors } = checkRepo({ config, changes: [] });
    assert.ok(
      errors.some((e) => e.message === message),
      'check and the guard emit one message',
    );
  }
});

test('184354 CR5: isValidCliVersion accepts concrete SemVer only', () => {
  for (const good of ['0.17.0', '0.17.0-dev', '1.0.0-rc.1+build.5']) {
    assert.equal(isValidCliVersion(good), true, good);
  }
  for (const bad of ['latest', '0.17', '^0.17.0', '01.0.0', 17, undefined]) {
    assert.equal(isValidCliVersion(bad), false, String(bad));
  }
});

test('184354 CR3: assertRepoCliVersion reads an inactive repo worktree config', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'version-guard-'));
  const changeledgerDir = path.join(root, '.changeledger');
  fs.mkdirSync(changeledgerDir);
  fs.writeFileSync(
    path.join(changeledgerDir, 'config.yml'),
    'schema_version: 6\nmin_cli_version: 0.18.0\n',
  );

  assert.throws(
    () => assertRepoCliVersion(root, changeledgerDir, '0.17.0'),
    (error) => error instanceof CliVersionError && error.message === below('0.17.0', '0.18.0'),
  );
  assert.doesNotThrow(() => assertRepoCliVersion(root, changeledgerDir, '0.18.0'));
});
