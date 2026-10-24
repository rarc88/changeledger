import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parse as parseYaml } from 'yaml';
import { check } from '../src/commands/check.mjs';
import { init } from '../src/commands/init.mjs';
import { registerRepo } from '../src/commands/register.mjs';
import { loadConfig } from '../src/config.mjs';
import { applyMigration, assertSupportedSchema, buildMigration } from '../src/config-migration.mjs';
import { capturedRun } from '../src/git.mjs';
import { templatesDir } from '../src/paths.mjs';
import {
  LedgerConflictError,
  mutateState,
  STATE_REF,
  writeActivation,
} from '../src/state-store.mjs';
import { sanitizedEnv } from './helpers/git-env.mjs';
import { buildTree, commitTree, git, initStateRepo, updateRef } from './helpers/state-repo.mjs';

process.env.CHANGELEDGER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-migration-home-'));

// 20261024-121022 retired the v0 → v6 chain and its 55 tests: a config older
// than schema 6 is migrated by ChangeLedger 0.19, and the only step left is
// 6 → 7. The write-route tests (activation probe, CAS race, nested projects)
// keep guarding `applyMigration`, retargeted to that step.

// The template `init` shipped at schema 6 (before 20261023-181753 retired
// readiness), as a consumer initialised from it still carries it: nine types,
// six stages, per-type impacts, a readiness section and the two retired
// statuses.
const SCHEMA6_TEMPLATE_CONFIG = `\
# ChangeLedger — repo configuration
# Repo specifics: documentation language, change types and active stages per type.

# Schema version — used to detect and migrate outdated configurations.
# Run \`changeledger config migrate --dry-run\` to inspect available migrations.
schema_version: 6

# Minimum ChangeLedger CLI version required to work with this repo (SemVer,
# prereleases included). \`init\` and \`config migrate\` set it to the version that
# wrote this file; an older installed CLI refuses to run until it is updated.
min_cli_version: 0.18.0

# Language for generated documentation CONTENT. Structure (headings, keys, enums)
# is always English. See \`changeledger context spec\`.
language: en

# Definition of Ready policy. When true (default), changes are documented
# test-grade and implemented via TDD; \`changeledger check\` warns on criteria ↔ task
# coverage gaps. Set false for exploratory repos. A type's own \`tdd\` overrides
# this value for its changes. See \`changeledger context spec\`.
tdd: true

# Default SemVer impact for a completed change. A change may override its type
# with \`release_impact: none|patch|minor|major\` in frontmatter.
release:
  impacts:
    feature: minor
    bug: patch
    hotfix: patch
    audit: none
    refactor: none
    chore: none
    quick: patch
    documentation: none
    # The children carry the impact; counting the parent too would double it.
    epic: none

# Definition of Ready path/command hints. Tasks that reference CRs must name at
# least one target and one verification matching these patterns; a warning in
# \`draft\`, an error from \`approved\` onward. Patterns can be path globs or literal
# command snippets. Adapt them to this repo's own layout — for example
# \`target_patterns: ["lib/**"]\` and \`verification_patterns: ["verify:"]\`.
readiness:
  target_patterns: ["src/**"]
  verification_patterns: ["test/**"]

changes_dir: .changeledger/changes
specs_dir: .changeledger/specs

# Git integration: change branches start from and merge into \`integration_branch\`; types with \`integrates_into: release\` use \`release_branch\` instead.
# \`change_branch_format\` may use \`{type}\` and exactly one \`{id}\`; use null or remove it to opt out.
git:
  integration_branch: release
  release_branch:
  change_branch_format: "{type}/{id}"

# Valid lifecycle statuses (order = progress)
statuses: [draft, approved, in-progress, in-review, in-validation, blocked, done, discarded]

# Canonical stages (## headings in the change body)
stages: [request, investigation, proposal, specification, plan, log]

# Active stages per type. The viewer shows only these.
# \`review_required: true\` makes the change pass through \`in-review\` (an
# independent subagent review) before it is delivered to \`done\`. See
# \`changeledger context implement\` and \`changeledger context review\`.
types:
  feature:
    stages: [request, investigation, proposal, specification, plan, log]
    review_required: true
  bug:
    stages: [request, investigation, specification, plan, log]
    review_required: true
  # A fix to released code: it starts from and integrates into
  # \`git.release_branch\`, which must differ from \`git.integration_branch\`.
  hotfix:
    stages: [request, investigation, specification, plan, log]
    review_required: true
    integrates_into: release
  audit:
    stages: [request, investigation, log]
  refactor:
    stages: [request, proposal, specification, plan, log]
    review_required: true
  chore:
    stages: [request, plan]
  # Small, reversible, single-concern work.
  quick:
    stages: [request, log]
  documentation:
    stages: [request, investigation, specification, log]
    review_required: true
    tdd: false
    seed_stage: investigation
  # The grouping parent of a multi-change effort.
  epic:
    stages: [request, proposal, log]
    tdd: false

# Project identity (stable; the global registry maps it to a path)
project_id: "abc123"
project_name: myrepo
`;

// The same file after 6 → 7, written by hand: the retired keys leave with the
// comments that introduce them, `min_cli_version` declares the running CLI and
// every other byte stays.
const SCHEMA7_FROM_TEMPLATE = `\
# ChangeLedger — repo configuration
# Repo specifics: documentation language, change types and active stages per type.

# Schema version — used to detect and migrate outdated configurations.
# Run \`changeledger config migrate --dry-run\` to inspect available migrations.
schema_version: 7

# Minimum ChangeLedger CLI version required to work with this repo (SemVer,
# prereleases included). \`init\` and \`config migrate\` set it to the version that
# wrote this file; an older installed CLI refuses to run until it is updated.
min_cli_version: 0.20.0

# Language for generated documentation CONTENT. Structure (headings, keys, enums)
# is always English. See \`changeledger context spec\`.
language: en

# Definition of Ready policy. When true (default), changes are documented
# test-grade and implemented via TDD; \`changeledger check\` warns on criteria ↔ task
# coverage gaps. Set false for exploratory repos. A type's own \`tdd\` overrides
# this value for its changes. See \`changeledger context spec\`.
tdd: true

# Default SemVer impact for a completed change. A change may override its type
# with \`release_impact: none|patch|minor|major\` in frontmatter.
release:
  default_impact: patch

changes_dir: .changeledger/changes
specs_dir: .changeledger/specs

# Git integration: change branches start from and merge into \`integration_branch\`; types with \`integrates_into: release\` use \`release_branch\` instead.
# \`change_branch_format\` may use \`{type}\` and exactly one \`{id}\`; use null or remove it to opt out.
git:
  integration_branch: release
  release_branch:
  change_branch_format: "{type}/{id}"

# Valid lifecycle statuses (order = progress)
statuses: [draft, approved, in-progress, in-review, done, discarded]

# Project identity (stable; the global registry maps it to a path)
project_id: "abc123"
project_name: myrepo
`;

const CR12_CHANGES = [
  'updated schema_version: 6 → 7',
  'removed types',
  'removed stages',
  'replaced release.impacts with release.default_impact: patch',
  'removed readiness',
  'removed retired statuses: in-validation, blocked',
];

// This repo's own authoritative config at schema 6: no blank line after
// `min_cli_version`, `types` between `stages` and the project identity, and
// `git` last with a comment of its own.
const SCHEMA6_REPO_CONFIG = `\
# ChangeLedger — repo configuration

# Schema version — used to detect and migrate outdated configurations.
schema_version: 6

# Minimum ChangeLedger CLI version required to work with this repo.
min_cli_version: 0.17.0
# Language for generated documentation CONTENT.
language: es

# Test-first policy.
tdd: true

# Default SemVer impact for a completed change.
release:
  impacts:
    feature: minor
    quick: patch
    # The children carry the impact; counting the parent too would double it.
    epic: none

changes_dir: .changeledger/changes
specs_dir: .changeledger/specs

# Valid lifecycle statuses (order = progress)
statuses: [draft, approved, in-progress, in-review, done, discarded]

# Canonical stages (## headings in the change body)
stages: [request, investigation, proposal, specification, plan, log]

# Active stages per type. The viewer shows only these.
types:
  feature:
    stages: [request, investigation, proposal, specification, plan, log]
    review_required: true
  quick:
    stages: [request, log]
  # The grouping parent of a multi-change effort.
  epic:
    stages: [request, proposal, log]
    tdd: false

# Project identity (stable; the global registry maps it to a path)
project_id: "304c473ce5"
project_name: changeledger

# Git integration: change branches start from and merge into this branch
git:
  integration_branch: dev
  change_branch_format: "{type}/{id}"
`;

const SCHEMA7_FROM_REPO = `\
# ChangeLedger — repo configuration

# Schema version — used to detect and migrate outdated configurations.
schema_version: 7

# Minimum ChangeLedger CLI version required to work with this repo.
min_cli_version: 0.20.0
# Language for generated documentation CONTENT.
language: es

# Test-first policy.
tdd: true

# Default SemVer impact for a completed change.
release:
  default_impact: patch

changes_dir: .changeledger/changes
specs_dir: .changeledger/specs

# Valid lifecycle statuses (order = progress)
statuses: [draft, approved, in-progress, in-review, done, discarded]

# Project identity (stable; the global registry maps it to a path)
project_id: "304c473ce5"
project_name: changeledger

# Git integration: change branches start from and merge into this branch
git:
  integration_branch: dev
  change_branch_format: "{type}/{id}"
`;

// A schema-6 config carrying none of the keys the step retires.
const SCHEMA6_CONFIG = `\
schema_version: 6
min_cli_version: 0.18.0
language: en
tdd: true
changes_dir: .changeledger/changes
specs_dir: .changeledger/specs
statuses: [draft, approved, in-progress, in-review, done, discarded]
project_id: "abc123"
project_name: myrepo
`;

function tmp() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-migration-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  return root;
}

function tmpConfig(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-migration-file-'));
  const configFile = path.join(dir, 'config.yml');
  fs.writeFileSync(configFile, text);
  return { dir, configFile };
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

function activeMigrationFixture({
  stateConfig = SCHEMA6_CONFIG,
  marker = 'schema_version: 6\n',
} = {}) {
  const root = initStateRepo();
  const configFile = path.join(root, '.changeledger', 'config.yml');
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, marker);
  const tree = buildTree(root, {
    '.changeledger-state/manifest.yml': 'format_version: 1\nproject_id: abc123\n',
    '.changeledger-state/config.yml': stateConfig,
    '.changeledger-state/specs/keep.md': '# Keep\n',
  });
  const revision = commitTree(root, tree, { message: 'chore: state fixture' });
  updateRef(root, STATE_REF, revision);
  writeActivation(root, { stateRef: STATE_REF });
  return { root, configFile, marker, revision };
}

// A second ChangeLedger project nested inside an activated repo, owning a
// different `project_id` and no `.git` of its own: the activation probe run
// from here resolves the host repo's activation even though the host's state
// ref is not this project's ledger.
function nestedProject(root, { config = SCHEMA6_CONFIG, projectId = 'nested99' } = {}) {
  const text = config.replace('project_id: "abc123"', `project_id: "${projectId}"`);
  const repoRoot = path.join(root, 'nested');
  const configFile = path.join(repoRoot, '.changeledger', 'config.yml');
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, text);
  return { repoRoot, configFile, text };
}

function stateRefAt(root) {
  return execFileSync('git', ['rev-parse', STATE_REF], {
    cwd: root,
    env: sanitizedEnv(),
    encoding: 'utf8',
  }).trim();
}

function stateConfigAt(root, revision = STATE_REF) {
  return execFileSync('git', ['cat-file', 'blob', `${revision}:.changeledger-state/config.yml`], {
    cwd: root,
    env: sanitizedEnv(),
    encoding: 'utf8',
  });
}

test('161652 CR1: shared write guard rejects only future schemas', () => {
  assert.equal(assertSupportedSchema({}), 0);
  assert.equal(assertSupportedSchema({ schema_version: 5 }), 5);
  assert.equal(assertSupportedSchema({ schema_version: 6 }), 6);
  assert.equal(assertSupportedSchema({ schema_version: 7 }), 7);
  assert.throws(
    () => assertSupportedSchema({ schema_version: 8 }),
    /^Error: config schema 8 is newer than supported schema 7; update ChangeLedger before writing$/,
  );
});

test('113219 CR1: init creates config with the current schema_version', () => {
  const root = tmp();
  init(root, '0.17.0');
  const configText = fs.readFileSync(path.join(root, '.changeledger', 'config.yml'), 'utf8');
  assert.match(configText, /^schema_version: 7$/m);
  assert.match(configText, /^min_cli_version: 0\.17\.0$/m);
  const config = loadConfig(path.join(root, '.changeledger'));
  assert.equal(config.schema_version, 7);
  assert.equal(config.min_cli_version, '0.17.0');
  assert.equal(config.git.integration_branch, null);
  assert.equal(config.git.change_branch_format, '{type}/{id}');
});

// --- 20261024-121022 CR11: the template declares schema 7 without the matrix --

test('20261024-121022 CR11: the template declares schema 7, tdd, the default impact and the integration branch', () => {
  const template = parseYaml(fs.readFileSync(path.join(templatesDir, 'config.yml'), 'utf8'));
  assert.equal(template.schema_version, 7);
  assert.equal(template.tdd, true);
  assert.deepEqual(template.release, { default_impact: 'patch' });
  assert.ok(Object.hasOwn(template.git, 'integration_branch'));
  assert.deepEqual(template.statuses, [
    'draft',
    'approved',
    'in-progress',
    'in-review',
    'done',
    'discarded',
  ]);
  for (const retired of ['types', 'stages', 'readiness']) {
    assert.equal(Object.hasOwn(template, retired), false, `template still declares ${retired}`);
  }
});

test('20261024-121022 CR11: init writes the template with min_cli_version filled and check is green', () => {
  const root = tmp();
  init(root, '0.20.0');
  const written = fs.readFileSync(path.join(root, '.changeledger', 'config.yml'), 'utf8');
  const template = fs.readFileSync(path.join(templatesDir, 'config.yml'), 'utf8');
  const head = template.replace(/^min_cli_version:$/m, 'min_cli_version: 0.20.0');
  assert.ok(written.startsWith(head), 'init must write the template with min_cli_version filled');
  assert.match(
    written.slice(head.length),
    /^\n# Project identity[^\n]*\nproject_id: "[0-9a-f]{10}"\nproject_name: \S+\n$/,
  );

  const out = silentOutput();
  const code = check([], root, out);
  assert.deepEqual(out.messages.error, [], 'a freshly initialised repo must report no errors');
  assert.equal(code, 0);
});

// --- 20261024-121022 CR12: config migrate knows only 6 → 7 -------------------

test('20261024-121022 CR12: the dry run prints the 6 → 7 plan and writes nothing', () => {
  const { dir, configFile } = tmpConfig(SCHEMA6_TEMPLATE_CONFIG);
  const summary = applyMigration(configFile, {
    dryRun: true,
    repoRoot: dir,
    runningVersion: '0.20.0',
  });
  assert.equal(
    summary,
    [
      'Config migration 6 → 7 (dry run)',
      ...CR12_CHANGES.map((change) => `  - ${change}`),
      '',
      '--- candidate YAML ---',
      SCHEMA7_FROM_TEMPLATE,
    ].join('\n'),
  );
  assert.equal(fs.readFileSync(configFile, 'utf8'), SCHEMA6_TEMPLATE_CONFIG);
});

test('20261024-121022 CR12: migrating removes the retired keys and keeps every other byte', () => {
  const { dir, configFile } = tmpConfig(SCHEMA6_TEMPLATE_CONFIG);
  const summary = applyMigration(configFile, { repoRoot: dir, runningVersion: '0.20.0' });
  assert.equal(
    summary,
    ['Config migration 6 → 7', ...CR12_CHANGES.map((change) => `  - ${change}`)].join('\n'),
  );
  const migrated = fs.readFileSync(configFile, 'utf8');
  assert.equal(migrated, SCHEMA7_FROM_TEMPLATE);

  const config = parseYaml(migrated);
  for (const retired of ['types', 'stages', 'readiness']) {
    assert.equal(Object.hasOwn(config, retired), false, retired);
  }
  assert.deepEqual(config.release, { default_impact: 'patch' });
  assert.equal(config.min_cli_version, '0.20.0');
  assert.deepEqual(config.statuses, [
    'draft',
    'approved',
    'in-progress',
    'in-review',
    'done',
    'discarded',
  ]);
});

test('20261024-121022 CR12: this repo shape migrates byte-faithfully outside the retired keys', () => {
  const result = buildMigration(SCHEMA6_REPO_CONFIG, '0.20.0');
  assert.equal(result.yaml, SCHEMA7_FROM_REPO);
  assert.deepEqual(result.changes, [
    'updated schema_version: 6 → 7',
    'removed types',
    'removed stages',
    'replaced release.impacts with release.default_impact: patch',
  ]);
});

test('20261024-121022 CR12: each change line appears only for a key that was present', () => {
  assert.deepEqual(buildMigration(SCHEMA6_CONFIG, '0.20.0').changes, [
    'updated schema_version: 6 → 7',
  ]);
  const onlyBlocked = SCHEMA6_CONFIG.replace('in-review, done', 'in-review, blocked, done').replace(
    'tdd: true\n',
    'tdd: true\nreadiness:\n  target_patterns: ["src/**"]\n',
  );
  assert.deepEqual(buildMigration(onlyBlocked, '0.20.0').changes, [
    'updated schema_version: 6 → 7',
    'removed readiness',
    'removed retired statuses: blocked',
  ]);
});

test('20261024-121022 CR12: a schema-7 config needs no migration and is not rewritten', () => {
  assert.equal(buildMigration(SCHEMA7_FROM_TEMPLATE, '0.20.0'), null);
  const { dir, configFile } = tmpConfig(SCHEMA7_FROM_TEMPLATE);
  const before = fs.statSync(configFile).mtimeMs;
  assert.equal(
    applyMigration(configFile, { repoRoot: dir, runningVersion: '0.20.0' }),
    'Config is already at schema 7. No changes needed.',
  );
  assert.equal(fs.statSync(configFile).mtimeMs, before);
  assert.equal(fs.readFileSync(configFile, 'utf8'), SCHEMA7_FROM_TEMPLATE);
});

test('20261024-121022 CR12: a schema older than 6 is refused naming the version that migrates it', () => {
  for (const [text, schema] of [
    [SCHEMA6_CONFIG.replace('schema_version: 6', 'schema_version: 5'), 5],
    [SCHEMA6_CONFIG.replace('schema_version: 6\n', ''), 0],
  ]) {
    const { dir, configFile } = tmpConfig(text);
    assert.throws(
      () => applyMigration(configFile, { repoRoot: dir, runningVersion: '0.20.0' }),
      new RegExp(
        `^Error: config schema ${schema} is older than 6: migrate it with ChangeLedger 0\\.19 before upgrading$`,
      ),
    );
    assert.equal(fs.readFileSync(configFile, 'utf8'), text);
  }
});

// A schema `config migrate` refuses must not be pointed at it: `check` and
// `register` name the release that migrates it, in the refusal's own words.
test('20261024-121022 CR13: check and register name ChangeLedger 0.19 for a schema older than 6', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-schema5-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  init(root);
  const configFile = path.join(root, '.changeledger', 'config.yml');
  fs.writeFileSync(
    configFile,
    fs.readFileSync(configFile, 'utf8').replace(/^schema_version: \d+$/m, 'schema_version: 5'),
  );
  const expected =
    'config schema 5 is older than 6: migrate it with ChangeLedger 0.19 before upgrading';

  const lines = [];
  check(['--json'], root, { log: (l) => lines.push(l) });
  const schemaWarnings = JSON.parse(lines.join('\n'))
    .warnings.filter((w) => w.file === '.changeledger/config.yml')
    .map((w) => w.message);
  assert.deepEqual(schemaWarnings, [expected]);

  const warned = [];
  registerRepo(root, { log: () => {}, warn: (l) => warned.push(l) });
  assert.deepEqual(
    warned.filter((l) => l.includes('schema')),
    [`warn  .changeledger/config.yml: ${expected}`],
  );
});

test('20261024-121022 CR12: in an activated repo the migration is one config: migrate commit on the state ref', () => {
  const fixture = activeMigrationFixture({ stateConfig: SCHEMA6_TEMPLATE_CONFIG });
  const summary = applyMigration(fixture.configFile, {
    repoRoot: fixture.root,
    runningVersion: '0.20.0',
  });
  assert.match(summary, /^Config migration 6 → 7$/m);
  const tip = stateRefAt(fixture.root);
  assert.equal(git(fixture.root, ['rev-parse', `${tip}^`]), fixture.revision);
  assert.equal(git(fixture.root, ['log', '-1', '--format=%s', tip]), 'config: migrate');
  assert.equal(stateConfigAt(fixture.root, tip), SCHEMA7_FROM_TEMPLATE);
  assert.equal(fs.readFileSync(fixture.configFile, 'utf8'), fixture.marker);
});

// --- 20261024-121022 CR15: the chain is gone from the source -----------------

test('20261024-121022 CR15: config-migration and fix define no step of the retired chain or modes', () => {
  const migration = fs.readFileSync(
    new URL('../src/config-migration.mjs', import.meta.url),
    'utf8',
  );
  for (const name of [
    /\bmigrateToV\d/,
    /\bBUILTIN_TYPES\b/,
    /\bBUILTIN_IMPACTS\b/,
    /\bactivateReviewableStages\b/,
    /\btemplateSection\b/,
  ]) {
    assert.doesNotMatch(migration, name);
  }
  const fixSource = fs.readFileSync(new URL('../src/fix.mjs', import.meta.url), 'utf8');
  const fixCommand = fs.readFileSync(new URL('../src/commands/fix.mjs', import.meta.url), 'utf8');
  for (const name of [
    /\bmigratePlanTags\b/,
    /\bmigrateStructuredSections\b/,
    /\bconvertLegacyTask\b/,
    /\bFIX_MIGRATION_MODES\b/,
    /--plan-tags|--structured-sections|--graduation-links/,
  ]) {
    assert.doesNotMatch(fixSource, name);
    assert.doesNotMatch(fixCommand, name);
  }
});

// --- applyMigration write route, retargeted to 6 → 7 -------------------------

// 20260810-004609 — production always passes repoRoot explicitly, so a
// missing one must fail fast instead of probing the wrong directory.
test('20260810-004609: applyMigration without repoRoot fails fast', () => {
  const { configFile } = tmpConfig(SCHEMA6_CONFIG);
  assert.throws(() => applyMigration(configFile), /applyMigration requires an explicit repoRoot/);
});

test('234920 CR4: active apply loses a deterministic real CAS race and preserves the winner', () => {
  const { root, configFile, marker, revision } = activeMigrationFixture();
  const winnerConfig = buildMigration(SCHEMA6_CONFIG, '0.20.0').yaml.replace(
    'project_name: myrepo',
    'project_name: winner',
  );
  let raced = false;
  const racingRun = (args, cwd, options) => {
    if (!raced && args[0] === 'update-ref' && args[1] === STATE_REF) {
      raced = true;
      mutateState(
        root,
        { expectedRevision: revision, message: 'concurrent winner' },
        (stage) => stage.write('config.yml', winnerConfig),
        capturedRun,
      );
    }
    return capturedRun(args, cwd, options);
  };

  assert.throws(
    () => applyMigration(configFile, { repoRoot: root, run: racingRun, runningVersion: '0.20.0' }),
    LedgerConflictError,
  );
  assert.equal(raced, true);
  assert.equal(stateConfigAt(root), winnerConfig);
  assert.equal(fs.readFileSync(configFile, 'utf8'), marker);
});

test('234920 CR3: active no-op and invalid or future configs never fall back to the marker', () => {
  const current = buildMigration(SCHEMA6_CONFIG, '0.20.0').yaml;
  const noOp = activeMigrationFixture({ stateConfig: current, marker: 'statuses: [\n' });
  assert.equal(
    applyMigration(noOp.configFile, { repoRoot: noOp.root, runningVersion: '0.20.0' }),
    'Config is already at schema 7. No changes needed.',
  );
  assert.equal(stateRefAt(noOp.root), noOp.revision);
  assert.equal(fs.readFileSync(noOp.configFile, 'utf8'), 'statuses: [\n');

  for (const [name, stateConfig, expected] of [
    ['invalid', 'statuses: [\n', /Invalid YAML/],
    [
      'future',
      'schema_version: 8\nproject_id: abc123\n',
      /config schema 8 is newer than supported schema 7/,
    ],
  ]) {
    const fixture = activeMigrationFixture({ stateConfig, marker: current });
    assert.throws(
      () =>
        applyMigration(fixture.configFile, {
          dryRun: true,
          repoRoot: fixture.root,
          runningVersion: '0.20.0',
        }),
      expected,
      name,
    );
    assert.equal(stateRefAt(fixture.root), fixture.revision, name);
    assert.equal(fs.readFileSync(fixture.configFile, 'utf8'), current, name);
  }
});

test('234920 CR5: inactive Git repos only probe activation across every config and mode', () => {
  const migrated = buildMigration(SCHEMA6_CONFIG, '0.20.0').yaml;
  const cases = [
    { name: 'old', text: SCHEMA6_CONFIG, summary: /Config migration 6 → 7/ },
    {
      name: 'current',
      text: migrated,
      summary: 'Config is already at schema 7. No changes needed.',
    },
    { name: 'invalid', text: 'statuses: [\n', error: /Invalid YAML/ },
    {
      name: 'future',
      text: 'schema_version: 8\nproject_id: abc123\n',
      error: /config schema 8 is newer than supported schema 7/,
    },
  ];
  const activationProbe = [['rev-parse', '--verify', '--quiet', 'refs/changeledger/activation']];

  for (const dryRun of [true, false]) {
    for (const fixture of cases) {
      const root = initStateRepo();
      const configFile = path.join(root, '.changeledger', 'config.yml');
      fs.mkdirSync(path.dirname(configFile), { recursive: true });
      fs.writeFileSync(configFile, fixture.text);
      const calls = [];
      const run = (args, cwd, options) => {
        calls.push([...args]);
        return capturedRun(args, cwd, options);
      };
      const label = `${fixture.name}/${dryRun ? 'dry-run' : 'apply'}`;

      if (fixture.error) {
        assert.throws(
          () =>
            applyMigration(configFile, { dryRun, repoRoot: root, run, runningVersion: '0.20.0' }),
          fixture.error,
          label,
        );
      } else {
        const summary = applyMigration(configFile, {
          dryRun,
          repoRoot: root,
          run,
          runningVersion: '0.20.0',
        });
        if (fixture.summary instanceof RegExp) assert.match(summary, fixture.summary, label);
        else assert.equal(summary, fixture.summary, label);
      }

      const expectedText = fixture.name === 'old' && !dryRun ? migrated : fixture.text;
      assert.equal(fs.readFileSync(configFile, 'utf8'), expectedText, label);
      assert.deepEqual(calls, activationProbe, label);
    }
  }
});

// Activation is inherited by every directory under an activated repo, so a
// nested project with its own ledger and no `.git` probes as "activated". The
// host's state ref is another project's authority: migrating it there writes
// the wrong ledger and leaves the nested config at its old schema.
test('234920 CR5: a nested project migrates its own config and never the host state ref', () => {
  const host = activeMigrationFixture();
  const nested = nestedProject(host.root);

  const summary = applyMigration(nested.configFile, {
    repoRoot: nested.repoRoot,
    runningVersion: '0.20.0',
  });

  assert.match(summary, /^Config migration 6 → 7$/m);
  assert.equal(
    fs.readFileSync(nested.configFile, 'utf8'),
    buildMigration(nested.text, '0.20.0').yaml,
  );
  assert.equal(stateRefAt(host.root), host.revision);
  assert.equal(stateConfigAt(host.root), SCHEMA6_CONFIG);
  assert.equal(fs.readFileSync(host.configFile, 'utf8'), host.marker);
});

test('234920 CR5: a nested project migrates even when the host authority is current', () => {
  const host = activeMigrationFixture({
    stateConfig: buildMigration(SCHEMA6_CONFIG, '0.20.0').yaml,
  });
  const nested = nestedProject(host.root);

  const summary = applyMigration(nested.configFile, {
    repoRoot: nested.repoRoot,
    runningVersion: '0.20.0',
  });

  assert.match(summary, /^Config migration 6 → 7$/m);
  assert.equal(
    fs.readFileSync(nested.configFile, 'utf8'),
    buildMigration(nested.text, '0.20.0').yaml,
  );
  assert.equal(stateRefAt(host.root), host.revision);
});

// The identity guard must not weaken the ref route: on the activated repo's
// own ledger the marker is discovery only, whether it diverges while claiming
// the same project or cannot be parsed at all.
test('234920 CR2: the activated repo keeps the ref route on a divergent or malformed marker', () => {
  const expected = buildMigration(SCHEMA6_CONFIG, '0.20.0').yaml;
  for (const [name, marker] of [
    ['divergent', 'schema_version: 6\nproject_id: "abc123"\nproject_name: divergent\n'],
    ['malformed', 'statuses: [\n'],
  ]) {
    const fixture = activeMigrationFixture({ marker });

    const summary = applyMigration(fixture.configFile, {
      repoRoot: fixture.root,
      runningVersion: '0.20.0',
    });

    assert.match(summary, /^Config migration 6 → 7$/m, name);
    const tip = stateRefAt(fixture.root);
    assert.equal(git(fixture.root, ['rev-parse', `${tip}^`]), fixture.revision, name);
    assert.equal(git(fixture.root, ['log', '-1', '--format=%s', tip]), 'config: migrate', name);
    assert.equal(stateConfigAt(fixture.root, tip), expected, name);
    assert.equal(fs.readFileSync(fixture.configFile, 'utf8'), marker, name);
  }
});

// Location outranks identity on the write path exactly as it does on the read
// path: a `.changeledger` directly under the git top-level is the repo's own
// ledger, so a stale `project_id` in the marker cannot divert the migration
// away from the state ref and into the worktree file.
test('194234 CR4: a top-level marker with a mismatched project_id migrates the ref', () => {
  const marker = 'schema_version: 6\nproject_id: "stale-id"\nproject_name: stale-name\n';
  const fixture = activeMigrationFixture({ marker });

  const summary = applyMigration(fixture.configFile, {
    repoRoot: fixture.root,
    runningVersion: '0.20.0',
  });

  assert.match(summary, /^Config migration 6 → 7$/m);
  const tip = stateRefAt(fixture.root);
  assert.equal(git(fixture.root, ['rev-parse', `${tip}^`]), fixture.revision);
  assert.equal(git(fixture.root, ['log', '-1', '--format=%s', tip]), 'config: migrate');
  assert.equal(stateConfigAt(fixture.root, tip), buildMigration(SCHEMA6_CONFIG, '0.20.0').yaml);
  assert.equal(fs.readFileSync(fixture.configFile, 'utf8'), marker);
});

// --- 20260810-120457 CR3/CR6: migrate routes by the anchor -------------------
//
// `config migrate` writes, so it asks the ownership question the read seam
// asks, through the same anchor. The two shapes identity and location could
// never judge: an owned ledger below the git top-level whose marker is stale,
// and a nested foreign ledger that claims the host's own `project_id`.

function activatedBelowTopLevel({ marker = 'schema_version: 6\nproject_id: "stale-id"\n' } = {}) {
  const root = initStateRepo();
  const repoRoot = path.join(root, 'packages', 'app');
  const configFile = path.join(repoRoot, '.changeledger', 'config.yml');
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, marker);
  const tree = buildTree(root, {
    '.changeledger-state/manifest.yml': 'format_version: 1\nproject_id: abc123\n',
    '.changeledger-state/config.yml': SCHEMA6_CONFIG,
    '.changeledger-state/specs/keep.md': '# Keep\n',
  });
  const revision = commitTree(root, tree, { message: 'chore: state fixture' });
  updateRef(root, STATE_REF, revision);
  writeActivation(repoRoot, { stateRef: STATE_REF });
  return { root, repoRoot, configFile, marker, revision };
}

test('20260810-120457 CR3: a stale marker below the top-level still migrates the ref', () => {
  const fixture = activatedBelowTopLevel();

  const summary = applyMigration(fixture.configFile, {
    repoRoot: fixture.repoRoot,
    runningVersion: '0.20.0',
  });

  assert.match(summary, /^Config migration 6 → 7$/m);
  const tip = stateRefAt(fixture.root);
  assert.equal(git(fixture.root, ['rev-parse', `${tip}^`]), fixture.revision);
  assert.equal(stateConfigAt(fixture.root, tip), buildMigration(SCHEMA6_CONFIG, '0.20.0').yaml);
  assert.equal(fs.readFileSync(fixture.configFile, 'utf8'), fixture.marker);
});

test('20260810-120457 CR6: a nested project claiming the host project_id migrates its own config', () => {
  const host = activeMigrationFixture();
  const nested = nestedProject(host.root, { projectId: 'abc123' });

  const summary = applyMigration(nested.configFile, {
    repoRoot: nested.repoRoot,
    runningVersion: '0.20.0',
  });

  assert.match(summary, /^Config migration 6 → 7$/m);
  assert.equal(
    fs.readFileSync(nested.configFile, 'utf8'),
    buildMigration(nested.text, '0.20.0').yaml,
  );
  assert.equal(stateRefAt(host.root), host.revision);
  assert.equal(stateConfigAt(host.root), SCHEMA6_CONFIG);
});
