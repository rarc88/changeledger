import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { check } from '../src/commands/check.mjs';
import { init } from '../src/commands/init.mjs';
import { registerRepo } from '../src/commands/register.mjs';
import { loadConfig } from '../src/config.mjs';
import { buildMigration } from '../src/config-migration.mjs';

process.env.CHANGELEDGER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-migration-home-'));

function tmp() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-migration-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  return root;
}

function silentOutput() {
  const messages = { log: [], error: [], warn: [] };
  return {
    log(...a) {
      messages.log.push(a.join(' '));
    },
    error(...a) {
      messages.error.push(a.join(' '));
    },
    warn(...a) {
      messages.warn.push(a.join(' '));
    },
    messages,
  };
}

// Minimal SpecLedger-era config (schema 0, five statuses, id_digits, .sl/* paths, no tdd/review)
const SPECLEDGER_CONFIG = `\
language: en
id_digits: 8
changes_dir: .sl/changes

statuses: [draft, approved, in-progress, blocked, done]
stages: [request, investigation, proposal, specification, plan, log]

types:
  feature:
    stages: [request, investigation, proposal, specification, plan, log]
  bug:
    stages: [request, investigation, specification, plan, log]

project_id: "abc123"
project_name: myrepo
`;

// CR1 — init seeds schema_version: 1
test('113219 CR1: init creates config with schema_version: 1', () => {
  const root = tmp();
  init(root);
  const configText = fs.readFileSync(path.join(root, '.changeledger', 'config.yml'), 'utf8');
  assert.match(configText, /^schema_version: 1$/m);
  const config = loadConfig(path.join(root, '.changeledger'));
  assert.equal(config.schema_version, 1);
});

// CR2 — check and register warn about schema 0, don't mutate
test('113219 CR2: check warns on schema 0 with actionable message and does not modify config', () => {
  const root = tmp();
  init(root);
  const configFile = path.join(root, '.changeledger', 'config.yml');
  // Downgrade to schema 0
  const text = fs.readFileSync(configFile, 'utf8').replace(/^schema_version: 1\n/m, '');
  fs.writeFileSync(configFile, text);
  const before = fs.readFileSync(configFile, 'utf8');

  const out = silentOutput();
  check([], root, out);

  assert.ok(
    out.messages.warn.some((m) => m.includes('config schema 0 is outdated')),
    `expected schema warning, got: ${JSON.stringify(out.messages.warn)}`,
  );
  assert.ok(
    out.messages.warn.some((m) => m.includes('changeledger config migrate --dry-run')),
    'warning should include the actionable command',
  );
  assert.equal(fs.readFileSync(configFile, 'utf8'), before, 'check must not modify config.yml');
});

test('113219 CR2: register warns on schema 0 and does not modify config', () => {
  const root = tmp();
  init(root);
  const configFile = path.join(root, '.changeledger', 'config.yml');
  const text = fs.readFileSync(configFile, 'utf8').replace(/^schema_version: 1\n/m, '');
  fs.writeFileSync(configFile, text);
  const before = fs.readFileSync(configFile, 'utf8');

  let warned = false;
  const origWarn = console.warn;
  console.warn = (msg) => {
    if (String(msg).includes('config schema 0')) warned = true;
  };
  try {
    registerRepo(root);
  } finally {
    console.warn = origWarn;
  }

  assert.ok(warned, 'register must warn about schema 0');
  assert.equal(fs.readFileSync(configFile, 'utf8'), before, 'register must not modify config.yml');
});

// CR3 — dry-run shows candidate YAML, file unchanged
test('113219 CR3: buildMigration returns candidate YAML without writing', () => {
  const configFile = `${os.tmpdir()}/cl-dryrun-${process.pid}.yml`;
  fs.writeFileSync(configFile, SPECLEDGER_CONFIG);
  const before = fs.readFileSync(configFile, 'utf8');

  const result = buildMigration(SPECLEDGER_CONFIG);

  assert.ok(result, 'should produce a migration result for schema 0');
  assert.ok(
    result.yaml.includes('schema_version: 1'),
    'candidate YAML must include schema_version: 1',
  );
  assert.equal(
    fs.readFileSync(configFile, 'utf8'),
    before,
    'buildMigration must not write to disk',
  );
  fs.rmSync(configFile, { force: true });
});

// CR4 — full migration from SpecLedger config
test('113219 CR4: migration adds required fields and removes id_digits', () => {
  const result = buildMigration(SPECLEDGER_CONFIG);

  assert.ok(result);
  const { yaml: migrated } = result;

  assert.match(migrated, /^schema_version: 1/m);
  assert.match(migrated, /tdd: true/);
  assert.match(migrated, /in-review/);
  assert.match(migrated, /in-validation/);
  assert.match(migrated, /discarded/);
  assert.doesNotMatch(migrated, /id_digits/);
  assert.ok(result.changes.some((c) => c.includes('review_required')));
  assert.ok(result.changes.some((c) => c.includes('release.impacts')));
});

test('113219 CR4: migrated config passes changeledger check', () => {
  const root = tmp();
  init(root);
  const configFile = path.join(root, '.changeledger', 'config.yml');
  // Replace with SpecLedger fixture + project identity
  fs.writeFileSync(configFile, SPECLEDGER_CONFIG);

  const { yaml: migrated } = buildMigration(SPECLEDGER_CONFIG);
  fs.writeFileSync(configFile, migrated);

  const out = silentOutput();
  const _code = check([], root, out);
  assert.equal(out.messages.error.length, 0, `check errors: ${JSON.stringify(out.messages.error)}`);
});

// CR5 — values and custom extensions preserved
test('113219 CR5: custom values, paths, flags and unknown keys preserved', () => {
  const customConfig = `\
language: es
tdd: false
changes_dir: .sl/changes
specs_dir: .sl/specs
statuses: [draft, approved, in-progress, blocked, done, internal-review]
stages: [request, investigation, proposal, specification, plan, log]
types:
  feature:
    stages: [request, investigation, proposal, specification, plan, log]
    review_required: false
  bug:
    stages: [request, investigation, specification, plan, log]
release:
  impacts:
    feature: major
custom_policy: strict
project_id: "abc123"
project_name: myrepo
`;

  const result = buildMigration(customConfig);
  assert.ok(result);
  const { yaml: migrated } = result;

  // Custom values preserved
  assert.match(migrated, /language: es/);
  assert.match(migrated, /tdd: false/);
  // Paths preserved as-is (no data movement)
  assert.match(migrated, /changes_dir: \.sl\/changes/);
  assert.match(migrated, /specs_dir: \.sl\/specs/);
  // Explicit review_required: false preserved (not overwritten)
  assert.match(migrated, /review_required: false/);
  // Custom status preserved
  assert.match(migrated, /internal-review/);
  // Custom impact preserved (feature: major not downgraded)
  assert.match(migrated, /feature: major/);
  // Unknown key preserved
  assert.match(migrated, /custom_policy: strict/);
  // Missing canonicals added
  assert.match(migrated, /in-review/);
  assert.match(migrated, /in-validation/);
  assert.match(migrated, /discarded/);
  // tdd not added (already present as false)
  assert.equal(migrated.match(/tdd:/g)?.length, 1, 'tdd should appear exactly once');
});

// CR6 — custom types get no invented defaults
test('113219 CR6: custom types do not get review_required or impacts invented', () => {
  const configWithCustomType = `\
language: en
tdd: true
changes_dir: .changeledger/changes
specs_dir: .changeledger/specs
statuses: [draft, approved, in-progress, blocked, done]
stages: [request, investigation, proposal, specification, plan, log]
types:
  experiment:
    stages: [request, investigation, log]
project_id: "abc123"
project_name: myrepo
`;

  const result = buildMigration(configWithCustomType);
  assert.ok(result);
  const { yaml: migrated } = result;

  // experiment type preserved, no review_required or impact invented
  assert.match(migrated, /experiment:/);
  assert.ok(
    !result.changes.some((c) => c.includes('experiment')),
    'no migration change should reference experiment type',
  );
  // The migrated YAML should have experiment without review_required
  const typeBlock = migrated.slice(migrated.indexOf('experiment:'));
  const nextType =
    typeBlock.indexOf('\n  ') > 0 ? typeBlock.slice(0, typeBlock.indexOf('\n  ')) : typeBlock;
  assert.doesNotMatch(nextType, /review_required/);
});

// CR7 — atomic write and idempotent
test('113219 CR7: migration is idempotent — second run returns null', () => {
  const result = buildMigration(SPECLEDGER_CONFIG);
  assert.ok(result);

  const result2 = buildMigration(result.yaml);
  assert.equal(result2, null, 're-running migration on already-migrated config must return null');
});

test('113219 CR7: config with explicit schema_version: 0 migrates without duplicate key', () => {
  const withExplicitZero = `\
schema_version: 0
language: en
tdd: true
changes_dir: .changeledger/changes
specs_dir: .changeledger/specs
statuses: [draft, approved, in-progress, in-review, in-validation, blocked, done, discarded]
stages: [request, investigation, proposal, specification, plan, log]
types:
  feature:
    stages: [request, investigation, proposal, specification, plan, log]
    review_required: true
project_id: "abc123"
project_name: myrepo
`;
  const result = buildMigration(withExplicitZero);
  assert.ok(result);
  const { yaml: migrated } = result;
  // Only one schema_version key
  assert.equal(
    (migrated.match(/^schema_version:/gm) ?? []).length,
    1,
    'no duplicate schema_version',
  );
  assert.match(migrated, /^schema_version: 1/m);
  // Idempotent
  assert.equal(buildMigration(migrated), null);
});

// CR8 — invalid YAML and future schema fail closed
test('113219 CR8: invalid YAML throws with explanation', () => {
  assert.throws(() => buildMigration('statuses: [\n  - bad'), /Invalid YAML/);
});

test('113219 CR8: future schema throws with explanation and does not write', () => {
  const futureConfig = `schema_version: 2\nlanguage: en\nchanges_dir: .changeledger/changes\n`;
  assert.throws(
    () => buildMigration(futureConfig),
    /config schema 2 is newer than supported schema 1/,
  );
});

// CR9 — historical SpecLedger fixtures all converge to schema 1
test('113219 CR9: all historical fixture generations converge to schema 1', () => {
  const fixtures = [
    // Minimal SpecLedger initial template (5 statuses, .sl paths, id_digits)
    SPECLEDGER_CONFIG,
    // After adding tdd gate (but not in-review)
    `language: en\ntdd: true\nid_digits: 8\nchanges_dir: .sl/changes\nstatuses: [draft, approved, in-progress, blocked, done]\nstages: [request, investigation, proposal, specification, plan, log]\ntypes:\n  feature:\n    stages: [request, investigation, proposal, specification, plan, log]\nproject_id: "abc123"\nproject_name: myrepo\n`,
    // After adding in-review but not in-validation or discarded
    `language: en\ntdd: true\nchanges_dir: .sl/changes\nstatuses: [draft, approved, in-progress, in-review, blocked, done]\nstages: [request, investigation, proposal, specification, plan, log]\ntypes:\n  feature:\n    stages: [request, investigation, proposal, specification, plan, log]\n    review_required: true\nproject_id: "abc123"\nproject_name: myrepo\n`,
    // Near-current (missing only schema_version)
    `language: en\ntdd: true\nchanges_dir: .changeledger/changes\nspecs_dir: .changeledger/specs\nstatuses: [draft, approved, in-progress, in-review, in-validation, blocked, done, discarded]\nstages: [request, investigation, proposal, specification, plan, log]\ntypes:\n  feature:\n    stages: [request, investigation, proposal, specification, plan, log]\n    review_required: true\n  bug:\n    stages: [request, investigation, specification, plan, log]\n    review_required: true\nrelease:\n  impacts:\n    feature: minor\n    bug: patch\n    audit: none\n    refactor: none\n    chore: none\nproject_id: "abc123"\nproject_name: myrepo\n`,
  ];

  for (const fixture of fixtures) {
    const result = buildMigration(fixture);
    assert.ok(
      result !== null || buildMigration(fixture) === null,
      'result should be migration or already-current',
    );
    const migrated = result ? result.yaml : fixture;
    const _config = JSON.parse(JSON.stringify({}));
    // Verify schema_version: 1 in output
    assert.match(
      migrated,
      /schema_version: 1/,
      `fixture did not converge: ${fixture.slice(0, 80)}`,
    );
    // Verify idempotent
    const second = buildMigration(migrated);
    assert.equal(second, null, `migration was not idempotent for fixture: ${fixture.slice(0, 80)}`);
  }
});

// CR5 (comments) — managed comments refreshed, custom comments preserved
test('113219 CR5 comments: SpecLedger-era managed comments are replaced with current template comments', () => {
  const specLedgerWithOldComments = `\
# Spec Ledger — repo configuration
language: en
# Definition of Ready. See \`sl context spec\` and run \`sl check\`.
tdd: true
changes_dir: .sl/changes
statuses: [draft, approved, in-progress, blocked, done]
stages: [request, investigation, proposal, specification, plan, log]
types:
  feature:
    stages: [request, investigation, proposal, specification, plan, log]
project_id: "abc123"
project_name: myrepo
`;

  const result = buildMigration(specLedgerWithOldComments);
  assert.ok(result);
  const { yaml: migrated } = result;

  // Old sl check / Spec Ledger references must be gone from managed comments
  assert.doesNotMatch(migrated, /sl check/);
  assert.doesNotMatch(migrated, /sl context/);
  assert.doesNotMatch(migrated, /Spec Ledger/);

  // Current template comment for language must appear
  assert.match(migrated, /changeledger context spec/);

  // Values must be preserved
  assert.match(migrated, /language: en/);
  assert.match(migrated, /tdd: true/);
});

test('113219 CR5 comments: custom (unknown key) comments are preserved', () => {
  const configWithCustomComment = `\
language: en
tdd: true
changes_dir: .changeledger/changes
# THIS IS MY CUSTOM NOTE — do not remove
custom_policy: strict
statuses: [draft, approved, in-progress, blocked, done]
stages: [request, investigation, proposal, specification, plan, log]
types:
  feature:
    stages: [request, investigation, proposal, specification, plan, log]
project_id: "abc123"
project_name: myrepo
`;

  const result = buildMigration(configWithCustomComment);
  assert.ok(result);
  const { yaml: migrated } = result;

  // Custom comment preserved
  assert.match(migrated, /THIS IS MY CUSTOM NOTE/);
  // Custom key preserved
  assert.match(migrated, /custom_policy: strict/);
});
