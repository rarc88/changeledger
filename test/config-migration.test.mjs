import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { check } from '../src/commands/check.mjs';
import { init } from '../src/commands/init.mjs';
import { registerRepo } from '../src/commands/register.mjs';
import { loadConfig } from '../src/config.mjs';
import { applyMigration, buildMigration } from '../src/config-migration.mjs';

process.env.CHANGELEDGER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-migration-home-'));

const SCHEMA_2_CONFIG = `\
schema_version: 2
language: en
tdd: true
changes_dir: .changeledger/changes
specs_dir: .changeledger/specs
statuses: [draft, approved, in-progress, in-review, in-validation, blocked, done, discarded]
stages: [request, investigation, proposal, specification, plan, log]
types:
  feature:
    stages: [request, investigation, proposal, specification, plan, log]
  quick:
    stages: [request, log]
release:
  impacts:
    feature: minor
    quick: patch
project_id: "abc123"
project_name: myrepo
`;

test('225637 CR1: schema 2 gains a documented blank integration branch at schema 3', () => {
  const result = buildMigration(SCHEMA_2_CONFIG);
  assert.ok(result);
  assert.equal(result.fromVersion, 2);
  assert.match(result.yaml, /^schema_version: 4$/m);
  assert.match(
    result.yaml,
    /project_name: myrepo\n\n# Git integration: change branches start from and merge into this branch\ngit:\n {2}integration_branch:\s*$/m,
  );
  assert.deepEqual(result.changes, [
    'updated schema_version: 2 → 4',
    'added git section',
    'added readiness section',
  ]);
});

test('225637 CR2: schema 2 preserves an existing git section and custom comments', () => {
  const source = `${SCHEMA_2_CONFIG}\n# custom git policy\ngit:\n  integration_branch: develop\n  custom: keep\n`;
  const result = buildMigration(source);
  assert.ok(result);
  assert.match(
    result.yaml,
    /# custom git policy\ngit:\n {2}integration_branch: develop\n {2}custom: keep/,
  );
  assert.equal(result.changes.includes('added git section'), false);
  assert.equal(buildMigration(result.yaml), null);
});

// 20260730-183807 CR1 — a null-valued scalar earlier in the document (a blank
// `git.integration_branch:`) must not shift the indentation of an unrelated,
// untouched comment elsewhere in the migrated output.
const SCHEMA_3_WITH_FOREIGN_COMMENT = `\
schema_version: 3
language: en
tdd: true
changes_dir: .changeledger/changes
specs_dir: .changeledger/specs
git:
  integration_branch:

# Valid lifecycle statuses (order = progress)
statuses: [draft, approved, in-progress, in-review, in-validation, blocked, done, discarded]
stages: [request, investigation, proposal, specification, plan, log]
types:
  feature:
    stages: [request, investigation, proposal, specification, plan, log]
    review_required: true
project_id: "abc123"
project_name: myrepo
`;

test('183807 CR1: an empty integration_branch does not re-indent an unrelated comment', () => {
  const result = buildMigration(SCHEMA_3_WITH_FOREIGN_COMMENT);
  assert.ok(result);
  const line = result.yaml.split('\n').find((l) => l.includes('Valid lifecycle'));
  assert.equal(line, '# Valid lifecycle statuses (order = progress)');
});

test('183807 CR1: a non-empty integration_branch keeps the same comment untouched', () => {
  const withBranch = SCHEMA_3_WITH_FOREIGN_COMMENT.replace(
    'integration_branch:\n',
    'integration_branch: main\n',
  );
  const result = buildMigration(withBranch);
  assert.ok(result);
  const line = result.yaml.split('\n').find((l) => l.includes('Valid lifecycle'));
  assert.equal(line, '# Valid lifecycle statuses (order = progress)');
});

// 20260730-183807 CR3 — the migration must retire the old template's
// commented-out `# readiness:` block (pre-da84722c) when it still matches the
// template's own text verbatim, and leave it alone when the user edited it.
const SCHEMA_3_WITH_STALE_READINESS_COMMENT = `\
schema_version: 3
language: en
tdd: true
release:
  impacts:
    feature: minor
    bug: patch
    audit: none
    refactor: none
    chore: none
    quick: patch

# Optional Definition of Ready path/command hints. When present, tasks that
# reference CRs should name at least one target and one verification matching
# these patterns. Patterns can be path globs or literal command snippets.
# readiness:
#   target_patterns: ["src/**"]
#   verification_patterns: ["test/**", "**/*.test.*", "**/*.spec.*", "pnpm test"]

changes_dir: .changeledger/changes
specs_dir: .changeledger/specs
git:
  integration_branch:
statuses: [draft, approved, in-progress, in-review, in-validation, blocked, done, discarded]
stages: [request, investigation, proposal, specification, plan, log]
types:
  feature:
    stages: [request, investigation, proposal, specification, plan, log]
    review_required: true
project_id: "abc123"
project_name: myrepo
`;

test('183807 CR3: migration removes a verbatim stale commented readiness block from the old template', () => {
  const result = buildMigration(SCHEMA_3_WITH_STALE_READINESS_COMMENT);
  assert.ok(result);
  assert.doesNotMatch(result.yaml, /# readiness:/);
  assert.doesNotMatch(result.yaml, /# Optional Definition of Ready/);
  // The live block published by addReadinessSection is the only one left.
  assert.match(result.yaml, /^readiness:$/m);
  assert.ok(result.changes.includes('removed stale commented-out readiness block'));
});

test('183807 CR3: a user-edited commented readiness block is preserved intact', () => {
  const edited = SCHEMA_3_WITH_STALE_READINESS_COMMENT.replace(
    '#   verification_patterns: ["test/**", "**/*.test.*", "**/*.spec.*", "pnpm test"]',
    '#   verification_patterns: ["test/**", "pnpm run test"]',
  );
  const result = buildMigration(edited);
  assert.ok(result);
  assert.match(result.yaml, /# {3}verification_patterns: \["test\/\*\*", "pnpm run test"\]/);
  assert.ok(!result.changes.includes('removed stale commented-out readiness block'));
});

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

// CR1 — init seeds the current schema version
test('113219 CR1: init creates config with the current schema_version', () => {
  const root = tmp();
  init(root);
  const configText = fs.readFileSync(path.join(root, '.changeledger', 'config.yml'), 'utf8');
  assert.match(configText, /^schema_version: 4$/m);
  const config = loadConfig(path.join(root, '.changeledger'));
  assert.equal(config.schema_version, 4);
  assert.match(
    configText,
    /specs_dir: \.changeledger\/specs\n\n# Git integration: change branches start from and merge into this branch\ngit:\n {2}integration_branch:\s*$/m,
  );
  assert.equal(config.git.integration_branch, null);
});

// CR2 — check and register warn about schema 0, don't mutate
test('113219 CR2: check warns on schema 0 with actionable message and does not modify config', () => {
  const root = tmp();
  init(root);
  const configFile = path.join(root, '.changeledger', 'config.yml');
  // Downgrade to schema 0
  const text = fs.readFileSync(configFile, 'utf8').replace(/^schema_version: \d+\n/m, '');
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
  const text = fs.readFileSync(configFile, 'utf8').replace(/^schema_version: \d+\n/m, '');
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
    result.yaml.includes('schema_version: 4'),
    'candidate YAML must include schema_version: 4',
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

  assert.match(migrated, /^schema_version: 4/m);
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
  assert.match(migrated, /^schema_version: 4/m);
  // Idempotent
  assert.equal(buildMigration(migrated), null);
});

// CR8 — invalid YAML and future schema fail closed
test('113219 CR8: invalid YAML throws with explanation', () => {
  assert.throws(() => buildMigration('statuses: [\n  - bad'), /Invalid YAML/);
});

test('113219 CR8: future schema throws with explanation and does not write', () => {
  const futureConfig = `schema_version: 5\nlanguage: en\nchanges_dir: .changeledger/changes\n`;
  assert.throws(
    () => buildMigration(futureConfig),
    /config schema 5 is newer than supported schema 4/,
  );
});

// CR9 — historical SpecLedger fixtures all converge to the current schema
test('113219 CR9: all historical fixture generations converge to the current schema', () => {
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
    // Verify the current schema version in output
    assert.match(
      migrated,
      /schema_version: 4/,
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

test('113219 CR4 comments: newly added managed keys receive current template documentation', () => {
  const historical = `\
language: es
changes_dir: .sl/changes
statuses: [draft, approved, in-progress, blocked, done]
stages: [request, investigation, proposal, specification, plan, log]
types:
  feature:
    stages: [request, investigation, proposal, specification, plan, log]
project_id: "abc123"
project_name: legacy
`;

  const { yaml: migrated } = buildMigration(historical);
  assert.match(
    migrated,
    /# Definition of Ready policy[\s\S]*?tdd: true/,
    'new tdd key should carry its managed comment',
  );
  assert.match(
    migrated,
    /# Default SemVer impact[\s\S]*?release:/,
    'new release key should carry its managed comment',
  );
  assert.match(migrated, /changeledger context spec/);
  assert.doesNotMatch(migrated, /Spec Ledger|\bsl check\b|AGENTS\.md §/);
});

// 20260711-162556 — migration 1 → 2 propagates the quick type to schema 1 repos

// Schema 1 config as produced by the previous template (no quick type)
const SCHEMA1_CONFIG = `\
schema_version: 1
language: en
tdd: true
release:
  impacts:
    feature: minor
    bug: patch
    audit: none
    refactor: none
    chore: none
changes_dir: .changeledger/changes
specs_dir: .changeledger/specs
statuses: [draft, approved, in-progress, in-review, in-validation, blocked, done, discarded]
stages: [request, investigation, proposal, specification, plan, log]
types:
  feature:
    stages: [request, investigation, proposal, specification, plan, log]
    review_required: true
  bug:
    stages: [request, investigation, specification, plan, log]
    review_required: true
project_id: "abc123"
project_name: myrepo
`;

// CR1 — migration 1 → 2 adds quick
test('162556 CR1: schema 1 without quick gains quick type and impact on migration', () => {
  const result = buildMigration(SCHEMA1_CONFIG);
  assert.ok(result, 'schema 1 must produce a migration to the current schema');
  const { yaml: migrated, changes } = result;

  assert.match(migrated, /^schema_version: 4$/m);
  // quick type with stages [request, log]
  assert.match(migrated, /quick:\s*\n\s+stages: \[ ?request, log ?\]/);
  // no review_required inside the quick block
  const quickBlock = migrated.slice(migrated.indexOf('quick:'));
  const quickTypeBlock = quickBlock.slice(0, quickBlock.search(/\n\S/) + 1 || undefined);
  assert.doesNotMatch(quickTypeBlock, /review_required/);
  // release impact
  assert.match(migrated, /quick: patch/);
  // summary lists both additions
  assert.ok(
    changes.some((c) => c.includes('types.quick')),
    `changes must list the quick type addition, got: ${JSON.stringify(changes)}`,
  );
  assert.ok(
    changes.some((c) => c.includes('release.impacts.quick: patch')),
    `changes must list the quick impact addition, got: ${JSON.stringify(changes)}`,
  );
});

test('162556 CR1: applyMigration summary reports 1 → current for schema 1 configs', () => {
  const configFile = `${os.tmpdir()}/cl-162556-summary-${process.pid}.yml`;
  fs.writeFileSync(configFile, SCHEMA1_CONFIG);
  const summary = applyMigration(configFile, { dryRun: true });
  assert.match(summary, /Config migration 1 → 4/);
  assert.equal(fs.readFileSync(configFile, 'utf8'), SCHEMA1_CONFIG, 'dry run must not write');
  fs.rmSync(configFile, { force: true });
});

// CR2 — custom quick type, its impact and its comment survive migration. Since
// schema 4 this custom flavour also declares `review_required: true`, so the
// 3 → 4 migration repairs the one thing that made it invalid — the missing
// `specification` stage — and touches nothing else.
test('162556 CR2: existing custom quick type and impacts stay intact through migration', () => {
  const customized = `\
schema_version: 1
language: en
tdd: true
release:
  impacts:
    feature: minor
    quick: minor
changes_dir: .changeledger/changes
specs_dir: .changeledger/specs
statuses: [draft, approved, in-progress, in-review, in-validation, blocked, done, discarded]
stages: [request, investigation, proposal, specification, plan, log]
types:
  feature:
    stages: [request, investigation, proposal, specification, plan, log]
    review_required: true
  # my own quick flavour
  quick:
    stages: [request, plan, log]
    review_required: true
project_id: "abc123"
project_name: myrepo
`;
  const result = buildMigration(customized);
  assert.ok(result);
  const { yaml: migrated, changes } = result;

  const expected = `${customized
    .replace('schema_version: 1', 'schema_version: 4')
    .replace(
      '    stages: [request, plan, log]',
      '    stages: [request, specification, plan, log]',
    )}\n# Git integration: change branches start from and merge into this branch\ngit:\n  integration_branch:\n`;
  assert.equal(
    withoutReadiness(migrated),
    expected,
    'only schema version, git section, readiness and the review coupling',
  );
  assert.deepEqual(changes, [
    'updated schema_version: 1 → 4',
    'added git section',
    'added readiness section',
    'added stage specification to types.quick.stages',
  ]);
});

// The migration appends the published readiness section last; stripping it
// isolates what a migration must leave byte for byte alone.
function withoutReadiness(yaml) {
  return yaml.replace(/\n\n# Definition of Ready[\s\S]*$/, '\n');
}

// CR3 — idempotency and version boundary
test('162556 CR3: current config needs no migration and file is untouched', () => {
  const result = buildMigration(SCHEMA1_CONFIG);
  assert.ok(result);
  assert.equal(buildMigration(result.yaml), null, 'migration output must be terminal');

  const configFile = `${os.tmpdir()}/cl-162556-idem-${process.pid}.yml`;
  fs.writeFileSync(configFile, result.yaml);
  const before = fs.statSync(configFile).mtimeMs;
  const summary = applyMigration(configFile);
  assert.match(summary, /already at schema 4/);
  assert.equal(fs.statSync(configFile).mtimeMs, before, 'no rewrite when already current');
  fs.rmSync(configFile, { force: true });
});

test('162556 CR3: schema newer than current fails closed', () => {
  assert.throws(
    () => buildMigration('schema_version: 5\nlanguage: en\n'),
    /config schema 5 is newer than supported schema 4/,
  );
});

// CR1/CR9 continuity — schema 0 configs also converge with quick included
test('162556 CR1: schema 0 migration lands at current and includes quick', () => {
  const result = buildMigration(SPECLEDGER_CONFIG);
  assert.ok(result);
  assert.match(result.yaml, /^schema_version: 4$/m);
  assert.match(result.yaml, /quick:\s*\n\s+stages: \[ ?request, log ?\]/);
  assert.match(result.yaml, /quick: patch/);
  assert.equal(buildMigration(result.yaml), null);
});

// 20260726-141119 — migration 3 → 4 activates the verifiable stages on every
// type that already demands independent review

const SCHEMA3_REVIEW_WITHOUT_SPEC = `\
schema_version: 3
language: en
tdd: true
changes_dir: .changeledger/changes
specs_dir: .changeledger/specs
git:
  integration_branch:
statuses: [draft, approved, in-progress, in-review, in-validation, blocked, done, discarded]
stages: [request, investigation, proposal, specification, plan, log]
types:
  feature:
    stages: [request, investigation, proposal, specification, plan, log]
    review_required: true
  audit:
    stages: [request, investigation, log]
  refactor:
    stages: [request, proposal, plan, log]
    review_required: true
  chore:
    stages: [request, plan]
  quick:
    stages: [request, log]
release:
  impacts:
    feature: minor
    audit: none
    refactor: none
    chore: none
    quick: patch
project_id: "abc123"
project_name: myrepo
`;

test('141119 CR6: migration 3 → 4 inserts the stages a review_required type lacks', () => {
  const configFile = path.join(tmp(), 'config.yml');
  fs.writeFileSync(configFile, SCHEMA3_REVIEW_WITHOUT_SPEC);

  const summary = applyMigration(configFile);
  assert.match(summary, /Config migration 3 → 4/);
  assert.ok(summary.includes('added stage specification to types.refactor.stages'), summary);

  const migrated = fs.readFileSync(configFile, 'utf8');
  assert.match(migrated, /^schema_version: 4$/m);
  assert.match(migrated, /^ {4}stages: \[request, proposal, specification, plan, log\]$/m);
  // Types that do not demand review keep their stage lists byte for byte.
  assert.match(migrated, /^ {4}stages: \[request, investigation, log\]$/m);
  assert.match(migrated, /^ {4}stages: \[request, plan\]$/m);
  assert.match(migrated, /^ {4}stages: \[request, log\]$/m);
  assert.equal(buildMigration(migrated), null, 'migration must be terminal');
});

test('141119 CR6: the migrated config no longer trips the review/stage coupling', () => {
  const root = tmp();
  init(root);
  const configFile = path.join(root, '.changeledger', 'config.yml');
  fs.writeFileSync(configFile, SCHEMA3_REVIEW_WITHOUT_SPEC);

  const before = silentOutput();
  check([], root, before);
  assert.ok(
    before.messages.error.some((m) => m.includes('requires active stages')),
    `expected the coupling error before migrating, got: ${JSON.stringify(before.messages.error)}`,
  );

  applyMigration(configFile);

  const after = silentOutput();
  check([], root, after);
  assert.ok(
    !after.messages.error.some((m) => m.includes('requires active stages')),
    `migrating must clear the coupling error, got: ${JSON.stringify(after.messages.error)}`,
  );
  assert.ok(
    !after.messages.warn.some((m) => m.includes('is outdated')),
    `migrating must clear the stale-schema warning, got: ${JSON.stringify(after.messages.warn)}`,
  );
});

test('141119 CR6: a light type demanding review gains both stages in canonical order', () => {
  const source = SCHEMA3_REVIEW_WITHOUT_SPEC.replace(
    '  quick:\n    stages: [request, log]\n',
    '  quick:\n    stages: [request, log]\n    review_required: true\n',
  );
  const result = buildMigration(source);
  assert.ok(result);
  assert.match(result.yaml, /^ {4}stages: \[request, specification, plan, log\]$/m);
  assert.deepEqual(
    result.changes.filter((c) => c.includes('types.quick.stages')),
    ['added stage specification to types.quick.stages', 'added stage plan to types.quick.stages'],
  );
});

// 20260726-141122 — migration 3 → 4 also publishes the Definition of Ready
// hints, which until now only ever existed as a comment in the template.

const SCHEMA3_WITH_COMMENTS = `\
schema_version: 3
language: en
# our own policy note — must survive
tdd: true
changes_dir: .changeledger/changes
specs_dir: .changeledger/specs
git:
  integration_branch: dev
statuses: [draft, approved, in-progress, in-review, in-validation, blocked, done, discarded]
stages: [request, investigation, proposal, specification, plan, log]
types:
  feature:
    stages: [request, investigation, proposal, specification, plan, log]
    review_required: true
release:
  impacts:
    feature: minor
project_id: "abc123"
project_name: myrepo
`;

test('141122 CR4: migration adds the readiness defaults to a config that lacks them', () => {
  const configFile = path.join(tmp(), 'config.yml');
  fs.writeFileSync(configFile, SCHEMA3_WITH_COMMENTS);

  const summary = applyMigration(configFile);
  assert.ok(
    summary.split('\n').some((line) => line.includes('readiness')),
    `the summary must report the readiness addition, got:\n${summary}`,
  );

  const migrated = fs.readFileSync(configFile, 'utf8');
  assert.match(migrated, /^schema_version: 4$/m);
  assert.ok(
    migrated.includes(
      'readiness:\n  target_patterns: ["src/**"]\n  verification_patterns: ["test/**"]\n',
    ),
    `migrated config must publish the readiness defaults, got:\n${migrated}`,
  );
  // The user's own comments, values and key order survive untouched.
  assert.match(migrated, /# our own policy note — must survive\ntdd: true/);
  assert.match(migrated, /integration_branch: dev/);
  assert.equal(
    withoutReadiness(migrated),
    SCHEMA3_WITH_COMMENTS.replace('schema_version: 3', 'schema_version: 4'),
    'nothing but the schema version and the appended readiness section may change',
  );
  assert.equal(buildMigration(migrated), null, 'migration must be terminal');
});

test('141122 CR5: a readiness the user already declared survives the migration', () => {
  const source = SCHEMA3_WITH_COMMENTS.replace(
    'changes_dir:',
    '# tuned for this Ruby repo\nreadiness:\n  target_patterns: ["lib/**"]\n  verification_patterns: ["verify:"]\n\nchanges_dir:',
  );
  const result = buildMigration(source);
  assert.ok(result);
  assert.equal(
    result.yaml,
    source.replace('schema_version: 3', 'schema_version: 4'),
    'a declared readiness must survive byte for byte, with nothing appended',
  );
  assert.deepEqual(result.changes, ['updated schema_version: 3 → 4']);
  assert.equal(buildMigration(result.yaml), null, 'migration must be terminal');
});

// 20260726-141119 CR6 (review defect) — a stage absent from the config's own
// canonical `stages` list must never be inserted into a type, even when that
// type demands review. Inserting it there produces a config `check` itself
// calls invalid ("references unknown stage"), while migrate declares success.
const SCHEMA3_REVIEW_STAGE_NOT_CANONICAL = `\
schema_version: 3
language: en
tdd: true
changes_dir: .changeledger/changes
specs_dir: .changeledger/specs
git:
  integration_branch:
statuses: [draft, approved, in-progress, in-review, in-validation, blocked, done, discarded]
stages: [request, proposal, plan, log]
types:
  refactor:
    stages: [request, proposal, plan, log]
    review_required: true
release:
  impacts:
    refactor: none
project_id: "abc123"
project_name: myrepo
`;

test('141119 CR6: a stage missing from the canonical list is never inserted into a type', () => {
  const result = buildMigration(SCHEMA3_REVIEW_STAGE_NOT_CANONICAL);
  assert.ok(result);
  assert.deepEqual(result.changes, ['updated schema_version: 3 → 4', 'added readiness section']);

  const migrated = result.yaml;
  assert.match(migrated, /^ {4}stages: \[request, proposal, plan, log\]$/m);
});

// CR4 — check detects schema 1 as outdated and points at the migration
test('162556 CR4: check warns on schema 1 with the migrate command and does not modify config', () => {
  const root = tmp();
  init(root);
  const configFile = path.join(root, '.changeledger', 'config.yml');
  const schema1 = fs
    .readFileSync(configFile, 'utf8')
    .replace(/^schema_version: \d+$/m, 'schema_version: 1')
    .replace(/^ {4}quick: patch\n/m, '')
    .replace(/^ {2}quick:\n {4}stages: \[.*\]\n/m, '');
  fs.writeFileSync(configFile, schema1);
  const before = fs.readFileSync(configFile, 'utf8');

  const out = silentOutput();
  check([], root, out);

  assert.ok(
    out.messages.warn.some((m) => m.includes('config schema 1 is outdated')),
    `expected schema 1 warning, got: ${JSON.stringify(out.messages.warn)}`,
  );
  assert.ok(
    out.messages.warn.some((m) => m.includes('changeledger config migrate --dry-run')),
    'warning should include the actionable command',
  );
  assert.equal(fs.readFileSync(configFile, 'utf8'), before, 'check must not modify config.yml');
});
