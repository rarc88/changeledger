import assert from 'node:assert/strict';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { parseChange } from '../src/change.mjs';
import { writeLedgerFiles } from '../src/change-store.mjs';
import { checkRepo } from '../src/check.mjs';
import {
  approve,
  archive,
  archiveGraduated,
  branch,
  discard,
  isPendingGraduation,
  list,
  log,
  owner,
  review,
  show,
  status,
  task,
} from '../src/commands/agent.mjs';
import { edit } from '../src/commands/edit.mjs';
import { fix } from '../src/commands/fix.mjs';
import { scaffoldSpec, skipGraduation } from '../src/commands/graduate.mjs';
import { init as initializeRepo } from '../src/commands/init.mjs';
import { newChange, newChangeFrom, scaffoldChange } from '../src/commands/new.mjs';
import { resolveRemote } from '../src/commands/sync.mjs';
import { VERSION } from '../src/framing.mjs';
import { capturedRun, defaultRun } from '../src/git.mjs';
import { loadRepo } from '../src/repo.mjs';
import {
  LedgerConflictError,
  mutateState,
  STATE_REF,
  STATE_ROOT,
  writeActivation,
} from '../src/state-store.mjs';
import { encodeProjectPath } from '../src/usage-collector.mjs';
import {
  appendLogEvent,
  setBranch,
  setReviewed,
  setStatus,
  setTask,
  stampVersion,
} from '../src/writer.mjs';
import {
  claudeRunner,
  gitCommonUsageDir,
  ledgerUsageRecords,
  usageNamePattern,
  usageRecordText,
} from './helpers/ccusage.mjs';
import { initGitFixture, sanitizedEnv } from './helpers/git-env.mjs';
import { buildTree, commitTree, updateRef } from './helpers/state-repo.mjs';
import {
  eventsAdded,
  logEvents,
  PREVIOUS_VERSION,
  versionEvents,
} from './helpers/version-stamp.mjs';
import { installCli } from './helpers/versioned-cli.mjs';

const execFileAsync = promisify(execFile);

// Isolate the global registry so init() doesn't touch the real home.
process.env.CHANGELEDGER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));

// Lifecycle fixtures that do not exercise branch naming opt out explicitly.
// The 161655 cases below opt back in with the exact format they assert.
function init(root) {
  initializeRepo(root);
  const file = path.join(root, '.changeledger', 'config.yml');
  fs.writeFileSync(
    file,
    fs
      .readFileSync(file, 'utf8')
      .replace(/^ {2}change_branch_format:.*$/m, '  change_branch_format: null'),
  );
}

function repoWithChange({ configExtra = '' } = {}) {
  // Native realpath at the seat, as in `initStateRepo` (20260812-022248 CR2):
  // on macOS os.tmpdir() lives under /var, a symlink to /private/var, and on
  // Windows runners it can carry an 8.3 short name. On POSIX a CLI spawned in
  // the root reads it from getcwd and git answers in physical form, so on macOS
  // CI a session announced with the raw temp path went unmatched
  // (20261012-213243).
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-agent-')),
  );
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  init(root);
  if (configExtra) fs.appendFileSync(path.join(root, '.changeledger', 'config.yml'), configExtra);
  // Born ownerless on purpose: these tests pin the `in-progress` auto-assignment,
  // whose precondition is an empty `owner`. Since 20260726-124836 `new` resolves
  // the local git identity by default, so the resolver is injected here to keep
  // the precondition explicit instead of depending on the host's git identity.
  const file = newChange(
    { type: 'feature', slug: 'x', title: 'X', now: '2026-06-13T12:00:00Z' },
    root,
    { ownerHandle: () => '' },
  );
  // Give it a task to operate on. `(support)` because that is what this task
  // honestly is — scaffolding for the lifecycle tests below, which declare no
  // criteria — and since 20260729-185200 an unmarked task with no CR blocks
  // approval, which these tests cross on their way to later statuses. Since
  // 20260810-213633 an approve also refuses any active stage left blank
  // (Request/Investigation/Proposal/Specification), so each gets one minimal
  // line here too — a single seat for the whole file's approve()/status(…,
  // 'approved') fixtures rather than patching every call site.
  const text = fs
    .readFileSync(file, 'utf8')
    .replace('## Request\n', '## Request\n\nR\n')
    .replace('## Investigation\n', '## Investigation\n\nI\n')
    .replace('## Proposal\n', '## Proposal\n\nP\n')
    .replace('## Specification\n', '## Specification\n\nS\n')
    .replace('## Plan\n', '## Plan\n\n- [ ] do it\n  - **Support:**\n');
  fs.writeFileSync(file, text);
  const id = parseChange(text).frontmatter.id;
  return { root, file, id };
}

// Activated variant of `repoWithChange()`: the same document, but living
// only in the state ref's snapshot — the worktree copy used to build its
// text is removed before activation, so any mutator that fell back to a
// worktree read would fail outright rather than silently succeed against
// stale content.
function activatedRepoWithChange({ configExtra = '' } = {}) {
  const { root, file, id } = repoWithChange({ configExtra });
  const name = path.basename(file);
  const text = fs.readFileSync(file, 'utf8');
  const configText = fs.readFileSync(path.join(root, '.changeledger', 'config.yml'), 'utf8');
  fs.rmSync(file);

  initGitFixture(root);
  const tree = buildTree(root, {
    '.changeledger-state/manifest.yml': 'format_version: 1\nproject_id: demo\n',
    '.changeledger-state/config.yml': configText,
    [`.changeledger-state/changes/${name}`]: text,
  });
  const revision = commitTree(root, tree, { message: 'chore: state' });
  updateRef(root, STATE_REF, revision);
  writeActivation(root, { stateRef: STATE_REF });

  return { root, id, name, revision };
}

function stateRefTip(root) {
  return execFileSync('git', ['rev-parse', STATE_REF], {
    encoding: 'utf8',
    cwd: root,
    env: sanitizedEnv(),
  }).trim();
}

function stateDocText(root, revision, relPath) {
  return execFileSync('git', ['cat-file', 'blob', `${revision}:${STATE_ROOT}/${relPath}`], {
    encoding: 'utf8',
    cwd: root,
    env: sanitizedEnv(),
  });
}

function lastCommitMessage(root) {
  return execFileSync('git', ['log', '-1', '--format=%s', STATE_REF], {
    encoding: 'utf8',
    cwd: root,
    env: sanitizedEnv(),
  }).trim();
}

function configureChangeBranches(root, { integration = 'dev', format = 'work/{id}' } = {}) {
  const file = path.join(root, '.changeledger', 'config.yml');
  const configured = fs
    .readFileSync(file, 'utf8')
    .replace(/^ {2}integration_branch:$/m, `  integration_branch: ${integration}`)
    .replace(/^ {2}change_branch_format:.*$/m, `  change_branch_format: ${format}`);
  fs.writeFileSync(file, configured);
}

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    env: sanitizedEnv(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function gitBackedApprovedChange({ branch, unrelated = false }) {
  const fixture = repoWithChange();
  configureChangeBranches(fixture.root);
  initGitFixture(fixture.root, { args: ['-b', 'dev'] });
  git(fixture.root, ['config', 'commit.gpgsign', 'false']);
  git(fixture.root, ['add', '.']);
  git(fixture.root, ['commit', '-q', '-m', 'chore: baseline']);
  status(fixture.id, 'approved', fixture.root);

  if (unrelated) {
    git(fixture.root, ['checkout', '-q', '--orphan', branch]);
    git(fixture.root, ['add', '.']);
    git(fixture.root, ['commit', '-q', '-m', 'chore: unrelated history']);
  } else {
    git(fixture.root, ['checkout', '-q', '-b', branch]);
  }
  return fixture;
}

test('161655 CR5: approved work starts only on the exact configured branch', () => {
  const fixture = gitBackedApprovedChange({ branch: 'wrong/branch' });
  const before = fs.readFileSync(fixture.file, 'utf8');

  assert.throws(
    () => status(fixture.id, 'in-progress', fixture.root, { ownerHandle: () => '' }),
    new RegExp(`must start on branch "work/${fixture.id}" \\(current: wrong/branch\\)`),
  );
  assert.equal(fs.readFileSync(fixture.file, 'utf8'), before);
});

test('161655 CR5: the expected branch must descend from the integration branch', () => {
  const fixture = gitBackedApprovedChange({
    branch: 'work/20260613-120000',
    unrelated: true,
  });
  const before = fs.readFileSync(fixture.file, 'utf8');

  assert.throws(
    () => status(fixture.id, 'in-progress', fixture.root, { ownerHandle: () => '' }),
    /branch "work\/20260613-120000" must descend from integration branch "dev"/,
  );
  assert.equal(fs.readFileSync(fixture.file, 'utf8'), before);
});

test('161655 CR5: exact branch descending from integration starts implementation', () => {
  const fixture = gitBackedApprovedChange({ branch: 'work/20260613-120000' });

  status(fixture.id, 'in-progress', fixture.root, { ownerHandle: () => '' });

  assert.equal(
    parseChange(fs.readFileSync(fixture.file, 'utf8')).frontmatter.status,
    'in-progress',
  );
});

test('161655 CR7: integration branch alone keeps lifecycle branch checks disabled', () => {
  const fixture = repoWithChange();
  const configFile = path.join(fixture.root, '.changeledger', 'config.yml');
  fs.writeFileSync(
    configFile,
    fs
      .readFileSync(configFile, 'utf8')
      .replace(/^ {2}integration_branch:$/m, '  integration_branch: dev'),
  );
  status(fixture.id, 'approved', fixture.root);

  assert.doesNotThrow(() =>
    status(fixture.id, 'in-progress', fixture.root, { ownerHandle: () => '' }),
  );
});

// --- 20261002-181346: a type's `integrates_into` picks the branch it starts from ---

// `main` carries a release commit `dev` lacks, so a branch cut from `dev` does
// not descend from `main`: the guard below is judged on which base it resolves.
// `releaseBranch: null` leaves `git.release_branch` undeclared (CR4).
// `shape` places the release commit: 'release-ahead' (default) on `main` only,
// 'dev-ahead' on `dev` only (20261002-204623), 'same' on neither, so both
// branches share one commit. `integrationBranch: null` leaves
// `git.integration_branch` undeclared.
function releaseTypeRepo({
  releaseBranch = 'main',
  shape = 'release-ahead',
  integrationBranch = 'dev',
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-agent-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  initializeRepo(root);
  const configFile = path.join(root, '.changeledger', 'config.yml');
  const config = parseYaml(fs.readFileSync(configFile, 'utf8'));
  config.git = { change_branch_format: '{type}/{id}' };
  if (integrationBranch) config.git.integration_branch = integrationBranch;
  // `new` refuses a release type without a branch: declare it while creating.
  config.git.release_branch = releaseBranch ?? 'main';
  config.types.fix = {
    stages: ['request', 'investigation', 'specification', 'plan', 'log'],
    integrates_into: 'release',
  };
  fs.writeFileSync(configFile, stringifyYaml(config));

  const changes = {};
  for (const [type, slug, now] of [
    ['fix', 'release-fix', '2026-10-02T18:00:00Z'],
    ['feature', 'dev-feature', '2026-10-02T18:00:01Z'],
  ]) {
    const file = newChange({ type, slug, title: slug, now }, root, { ownerHandle: () => '' });
    const text = fs
      .readFileSync(file, 'utf8')
      .replace('## Request\n', '## Request\n\nR\n')
      .replace('## Investigation\n', '## Investigation\n\nI\n')
      .replace('## Proposal\n', '## Proposal\n\nP\n')
      .replace('## Specification\n', '## Specification\n\nS\n')
      .replace('## Plan\n', '## Plan\n\n- [ ] do it\n  - **Support:**\n');
    fs.writeFileSync(file, text);
    changes[type] = { file, id: parseChange(text).frontmatter.id };
  }

  initGitFixture(root, { args: ['-b', 'main'] });
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: baseline']);
  git(root, ['branch', 'dev']);
  if (shape !== 'same') {
    if (shape === 'dev-ahead') git(root, ['checkout', '-q', 'dev']);
    fs.writeFileSync(path.join(root, 'RELEASE'), '1\n');
    git(root, ['add', 'RELEASE']);
    git(root, ['commit', '-q', '-m', 'chore: release']);
    if (shape === 'dev-ahead') git(root, ['checkout', '-q', 'main']);
  }
  for (const { id } of Object.values(changes)) status(id, 'approved', root);
  if (!releaseBranch) {
    delete config.git.release_branch;
    fs.writeFileSync(configFile, stringifyYaml(config));
  }
  return { root, changes };
}

function startOn(root, { id, type }, base) {
  git(root, ['checkout', '-q', '-b', `${type}/${id}`, base]);
  status(id, 'in-progress', root, { ownerHandle: () => '' });
}

test('181346 CR3: a release type must start from git.release_branch, not the integration branch', () => {
  const { root, changes } = releaseTypeRepo();
  const { file, id } = changes.fix;
  const before = fs.readFileSync(file, 'utf8');

  assert.throws(
    () => startOn(root, { id, type: 'fix' }, 'dev'),
    (error) => error.message === `branch "fix/${id}" must descend from integration branch "main"`,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before);

  git(root, ['checkout', '-q', 'main']);
  git(root, ['branch', '-D', `fix/${id}`]);
  startOn(root, { id, type: 'fix' }, 'main');
  assert.equal(parseChange(fs.readFileSync(file, 'utf8')).frontmatter.status, 'in-progress');
});

test('181346 CR4: a release type without git.release_branch does not start', () => {
  const { root, changes } = releaseTypeRepo({ releaseBranch: null });
  const { file, id } = changes.fix;
  const before = fs.readFileSync(file, 'utf8');

  assert.throws(
    () => startOn(root, { id, type: 'fix' }, 'main'),
    (error) =>
      error.message === 'type "fix" integrates into git.release_branch, which is not declared',
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('181346 CR5: a type without integrates_into still starts from the integration branch', () => {
  const { root, changes } = releaseTypeRepo();
  const { file, id } = changes.feature;

  startOn(root, { id, type: 'feature' }, 'dev');

  assert.equal(parseChange(fs.readFileSync(file, 'utf8')).frontmatter.status, 'in-progress');
});

// --- 20261002-204623: a release branch must not carry unpublished integration work ---

function startsInProgress(file) {
  return parseChange(fs.readFileSync(file, 'utf8')).frontmatter.status === 'in-progress';
}

test('204623 CR1: a release branch cut from the integration branch ahead of the release branch does not start', () => {
  const { root, changes } = releaseTypeRepo({ shape: 'dev-ahead' });
  const { file, id } = changes.fix;
  const before = fs.readFileSync(file, 'utf8');

  assert.throws(
    () => startOn(root, { id, type: 'fix' }, 'dev'),
    (error) =>
      error.message === `branch "fix/${id}" contains commits of "dev" that are not in "main"`,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('204623 CR1: a release branch holding a commit of its own on top of dev work does not start', () => {
  const { root, changes } = releaseTypeRepo({ shape: 'dev-ahead' });
  const { file, id } = changes.fix;
  git(root, ['checkout', '-q', '-b', `fix/${id}`, 'dev']);
  fs.writeFileSync(path.join(root, 'HOTFIX'), '1\n');
  git(root, ['add', 'HOTFIX']);
  git(root, ['commit', '-q', '-m', 'fix: own work']);

  assert.throws(
    () => status(id, 'in-progress', root, { ownerHandle: () => '' }),
    (error) =>
      error.message === `branch "fix/${id}" contains commits of "dev" that are not in "main"`,
  );
  assert.equal(startsInProgress(file), false);
});

test('204623 CR2: a release branch cut from the release branch starts although dev is ahead', () => {
  const { root, changes } = releaseTypeRepo({ shape: 'dev-ahead' });
  const { file, id } = changes.fix;

  startOn(root, { id, type: 'fix' }, 'main');

  assert.equal(startsInProgress(file), true);
});

test('204623 CR2: work committed on the release branch after the cut still starts', () => {
  const { root, changes } = releaseTypeRepo({ shape: 'dev-ahead' });
  const { file, id } = changes.fix;
  git(root, ['checkout', '-q', '-b', `fix/${id}`, 'main']);
  fs.writeFileSync(path.join(root, 'HOTFIX'), '1\n');
  git(root, ['add', 'HOTFIX']);
  git(root, ['commit', '-q', '-m', 'fix: own work']);

  status(id, 'in-progress', root, { ownerHandle: () => '' });

  assert.equal(startsInProgress(file), true);
});

test('204623 CR3: a release branch cut from dev starts when dev and the release branch coincide', () => {
  const { root, changes } = releaseTypeRepo({ shape: 'same' });
  const { file, id } = changes.fix;

  startOn(root, { id, type: 'fix' }, 'dev');

  assert.equal(startsInProgress(file), true);
});

test('204623 CR4: an integration type keeps starting from dev when dev is ahead', () => {
  const { root, changes } = releaseTypeRepo({ shape: 'dev-ahead' });
  const { file, id } = changes.feature;

  startOn(root, { id, type: 'feature' }, 'dev');

  assert.equal(startsInProgress(file), true);
});

test('204623 CR4: an integration type with commits of its own still starts', () => {
  const { root, changes } = releaseTypeRepo({ shape: 'dev-ahead' });
  const { file, id } = changes.feature;
  git(root, ['checkout', '-q', '-b', `feature/${id}`, 'dev']);
  fs.writeFileSync(path.join(root, 'FEATURE'), '1\n');
  git(root, ['add', 'FEATURE']);
  git(root, ['commit', '-q', '-m', 'feat: own work']);

  status(id, 'in-progress', root, { ownerHandle: () => '' });

  assert.equal(startsInProgress(file), true);
});

// Criss-cross: `dev` merged `feat/y` and then `main`, so `HEAD` (cut from `main`,
// then merged `feat/y`) and `dev` have two merge bases, X (in `main`) and Y (not
// in `main`). Commit dates are pinned so plain `git merge-base` picks X.
test('204623 CR1: a criss-cross with an unpublished merge base does not start', () => {
  const { root, changes } = releaseTypeRepo({ shape: 'same' });
  const { file, id } = changes.fix;
  const at = (date, args) =>
    execFileSync('git', args, {
      cwd: root,
      env: sanitizedEnv({ GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const commitFile = (name, date) => {
    fs.writeFileSync(path.join(root, name), '1\n');
    at(date, ['add', name]);
    at(date, ['commit', '-q', '-m', `chore: ${name}`]);
  };
  at('2026-01-01T00:00:00Z', ['checkout', '-q', '-b', 'feat/y']);
  commitFile('Y', '2026-01-02T00:00:00Z');
  at('2026-01-05T00:00:00Z', ['checkout', '-q', 'main']);
  commitFile('X', '2026-01-05T00:00:00Z');
  at('2026-01-06T00:00:00Z', ['checkout', '-q', 'dev']);
  at('2026-01-06T00:00:00Z', ['merge', '-q', '--no-ff', '-m', 'merge y', 'feat/y']);
  at('2026-01-07T00:00:00Z', ['merge', '-q', '--no-ff', '-m', 'merge main', 'main']);
  at('2026-01-08T00:00:00Z', ['checkout', '-q', '-b', `fix/${id}`, 'main']);
  at('2026-01-08T00:00:00Z', ['merge', '-q', '--no-ff', '-m', 'merge y', 'feat/y']);
  const before = fs.readFileSync(file, 'utf8');
  const tip = (ref) => git(root, ['rev-parse', ref]).trim();
  const bases = git(root, ['merge-base', '--all', 'HEAD', 'dev']).trim().split('\n');
  assert.deepEqual(bases.sort(), [tip('main'), tip('feat/y')].sort());

  assert.throws(
    () => status(id, 'in-progress', root, { ownerHandle: () => '' }),
    (error) =>
      error.message === `branch "fix/${id}" contains commits of "dev" that are not in "main"`,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('204623: a missing release branch ref still fails the ancestry check', () => {
  const { root, changes } = releaseTypeRepo({ shape: 'dev-ahead' });
  const { id } = changes.fix;
  git(root, ['checkout', '-q', '-b', `fix/${id}`, 'main']);
  git(root, ['branch', '-m', 'main', 'gone']);

  assert.throws(
    () => status(id, 'in-progress', root, { ownerHandle: () => '' }),
    (error) => error.message === `branch "fix/${id}" must descend from integration branch "main"`,
  );
});

test('204623 CR5: without git.integration_branch there is nothing to compare against', () => {
  for (const base of ['main', 'dev']) {
    const { root, changes } = releaseTypeRepo({ shape: 'dev-ahead', integrationBranch: null });
    const { file, id } = changes.fix;

    startOn(root, { id, type: 'fix' }, base);

    assert.equal(startsInProgress(file), true, `from ${base}`);
  }
});

test('204623: an integration branch absent locally fails closed and says so', () => {
  const { root, changes } = releaseTypeRepo({ shape: 'dev-ahead' });
  const { file, id } = changes.fix;
  git(root, ['branch', '-D', 'dev']);
  const before = fs.readFileSync(file, 'utf8');

  assert.throws(
    () => startOn(root, { id, type: 'fix' }, 'main'),
    (error) =>
      error.message ===
      `branch "fix/${id}" cannot start: integration branch "dev" does not exist locally — create it (e.g. from its remote-tracking copy) before starting`,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('204623: an integration branch with unrelated history fails closed and says so', () => {
  const { root, changes } = releaseTypeRepo({ shape: 'dev-ahead' });
  const { file, id } = changes.fix;
  const emptyTree = git(root, ['hash-object', '-t', 'tree', '/dev/null']).trim();
  const orphan = git(root, ['commit-tree', emptyTree, '-m', 'chore: orphan']).trim();
  git(root, ['branch', '-f', 'dev', orphan]);
  git(root, ['checkout', '-q', '-b', `fix/${id}`, 'main']);
  const before = fs.readFileSync(file, 'utf8');

  assert.throws(
    () => status(id, 'in-progress', root, { ownerHandle: () => '' }),
    (error) =>
      error.message ===
      `branch "fix/${id}" cannot start: it shares no history with integration branch "dev"`,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

// --- 20261012-175147: the start guard compares branches, not same-named refs,
// and a release type also compares with the integration branch's remote-tracking copy ---

// `releaseTypeRepo({ shape: 'same' })` plus a bare `origin` that received `main`
// and `dev`, both at one commit.
function remoteTypeRepo() {
  const fixture = releaseTypeRepo({ shape: 'same' });
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-origin-'));
  git(bare, ['init', '-q', '--bare', '-b', 'main']);
  git(fixture.root, ['remote', 'add', 'origin', bare]);
  git(fixture.root, ['push', '-q', 'origin', 'main', 'dev']);
  return { ...fixture, bare };
}

// Commits a new file on `branch`, then checks `main` out again.
function commitOn(root, branch, name, message = `chore: ${name}`) {
  git(root, ['checkout', '-q', branch]);
  fs.writeFileSync(path.join(root, name), '1\n');
  git(root, ['add', name]);
  git(root, ['commit', '-q', '-m', message]);
  git(root, ['checkout', '-q', 'main']);
}

// Pushes a `feat: dev work` commit on `dev` to `bare` from a separate clone,
// leaving the fixture repo's own branches where they were.
function pushDevWorkFromClone(bare) {
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-clone-'));
  git(clone, ['clone', '-q', bare, '.']);
  git(clone, ['checkout', '-q', 'dev']);
  fs.writeFileSync(path.join(clone, 'DEVWORK'), '1\n');
  git(clone, ['add', 'DEVWORK']);
  git(clone, ['commit', '-q', '-m', 'feat: dev work']);
  git(clone, ['push', '-q', 'origin', 'dev']);
}

// Cuts `<type>/<id>` from `base` and asserts the start throws exactly `message`
// and leaves the document byte for byte as it was.
function assertStartRefused(root, { file, id }, type, base, message) {
  git(root, ['checkout', '-q', '-b', `${type}/${id}`, base]);
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(
    () => status(id, 'in-progress', root, { ownerHandle: () => '' }),
    (error) => error.message === message,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before);
}

// Back on `main` with the refused change branch deleted, so the same repo can
// try another base.
function dropChangeBranch(root, { id }, type) {
  git(root, ['checkout', '-q', 'main']);
  git(root, ['branch', '-q', '-D', `${type}/${id}`]);
}

const cliBin = fileURLToPath(new URL('../bin/changeledger.mjs', import.meta.url));

function startWithCli(root, id) {
  const result = spawnSync(process.execPath, [cliBin, 'status', id, 'in-progress'], {
    cwd: root,
    encoding: 'utf8',
    env: sanitizedEnv({ CHANGELEDGER_NO_GH: '1' }),
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

// A `gitRun` that delegates to `defaultRun` and records each argv, and the
// subcommand of an argv once leading global options are skipped.
function recordingGitRun() {
  const calls = [];
  const gitRun = (args, cwd) => {
    calls.push([...args]);
    return defaultRun(args, cwd);
  };
  return { calls, gitRun };
}
function subcommandOf(args) {
  let at = 0;
  while (at < args.length && args[at].startsWith('-')) {
    at += args[at] === '-c' || args[at] === '-C' ? 2 : 1;
  }
  return args.slice(at);
}

test('175147 CR1: a release branch cut from main starts while dev and origin/dev are ahead', () => {
  const { root, changes, bare } = remoteTypeRepo();
  const { file, id } = changes.fix;
  commitOn(root, 'dev', 'DEVWORK', 'feat: dev work');
  git(root, ['push', '-q', 'origin', 'dev']);
  git(root, ['fetch', '-q', 'origin']);
  assert.equal(
    git(bare, ['rev-parse', 'refs/heads/dev']),
    git(root, ['rev-parse', 'refs/heads/dev']),
  );
  git(root, ['checkout', '-q', '-b', `fix/${id}`, 'main']);

  const { code, out } = startWithCli(root, id);

  assert.equal(code, 0);
  assert.equal(out.trim(), `#${id} → in-progress`);
  const text = fs.readFileSync(file, 'utf8');
  const { frontmatter } = parseChange(text);
  assert.equal(frontmatter.status, 'in-progress');
  assert.equal(frontmatter.branch, `fix/${id}`);
  assert.match(text, /`\[status\]` approved → in-progress/);
  assert.ok(text.includes(`\`[branch]\` set: fix/${id} (auto)`));
});

test('175147 CR2: a remote-tracking copy of dev ahead of main blocks a branch cut from it', () => {
  const { root, changes, bare } = remoteTypeRepo();
  const { file, id } = changes.fix;
  pushDevWorkFromClone(bare);
  git(root, ['fetch', '-q', 'origin']);
  assert.equal(
    git(root, ['rev-parse', 'refs/heads/dev']),
    git(root, ['rev-parse', 'refs/heads/main']),
  );
  git(root, ['checkout', '-q', '-b', `fix/${id}`, 'origin/dev']);
  const before = fs.readFileSync(file, 'utf8');

  const { code, err } = startWithCli(root, id);

  assert.notEqual(code, 0);
  assert.equal(
    err.trim(),
    `Error: branch "fix/${id}" contains commits of "origin/dev" that are not in "main"`,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('175147 CR3: the local integration branch is compared before its remote-tracking copy', () => {
  const { root, changes } = remoteTypeRepo();
  commitOn(root, 'dev', 'DEVWORK');
  git(root, ['push', '-q', 'origin', 'dev']);
  git(root, ['fetch', '-q', 'origin']);
  const { id } = changes.fix;

  assertStartRefused(
    root,
    changes.fix,
    'fix',
    'dev',
    `branch "fix/${id}" contains commits of "dev" that are not in "main"`,
  );
});

test('175147 CR4: a remote without a copy of the integration branch does not block', () => {
  const { root, changes } = remoteTypeRepo();
  const { file, id } = changes.fix;
  git(root, ['push', '-q', 'origin', '--delete', 'dev']);
  git(root, ['fetch', '-q', '--prune', 'origin']);
  assert.throws(() => git(root, ['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/dev']));
  commitOn(root, 'dev', 'DEVWORK');

  assertStartRefused(
    root,
    changes.fix,
    'fix',
    'dev',
    `branch "fix/${id}" contains commits of "dev" that are not in "main"`,
  );
  dropChangeBranch(root, changes.fix, 'fix');
  startOn(root, { id, type: 'fix' }, 'main');

  assert.equal(startsInProgress(file), true);
});

test('175147 CR5: without a local integration branch its remote-tracking copy is compared', () => {
  const { root, changes } = remoteTypeRepo();
  const { file, id } = changes.fix;
  commitOn(root, 'dev', 'DEVWORK');
  git(root, ['push', '-q', 'origin', 'dev']);
  git(root, ['fetch', '-q', 'origin']);
  git(root, ['branch', '-q', '-D', 'dev']);

  assertStartRefused(
    root,
    changes.fix,
    'fix',
    'origin/dev',
    `branch "fix/${id}" contains commits of "origin/dev" that are not in "main"`,
  );
  dropChangeBranch(root, changes.fix, 'fix');
  startOn(root, { id, type: 'fix' }, 'main');

  assert.equal(startsInProgress(file), true);
});

test('175147 CR6: with neither a local nor a remote-tracking integration branch it fails closed', () => {
  const { root, changes } = remoteTypeRepo();
  const { id } = changes.fix;
  git(root, ['push', '-q', 'origin', '--delete', 'dev']);
  git(root, ['fetch', '-q', '--prune', 'origin']);
  git(root, ['branch', '-q', '-D', 'dev']);

  assertStartRefused(
    root,
    changes.fix,
    'fix',
    'main',
    `branch "fix/${id}" cannot start: integration branch "dev" does not exist locally — create it (e.g. from its remote-tracking copy) before starting`,
  );
});

// With a branch absent, git resolves its full ref through same-named refs
// further down the gitrevisions(7) lookup order. Each case drops both copies of
// `dev`, plants one such ref at `main` and checks that git really reads it in
// place of the missing copy before the guard runs.
function plantedWithoutIntegrationBranch(plant, missing) {
  const fixture = remoteTypeRepo();
  const { root } = fixture;
  git(root, ['push', '-q', 'origin', '--delete', 'dev']);
  git(root, ['fetch', '-q', '--prune', 'origin']);
  git(root, ['branch', '-q', '-D', 'dev']);
  git(root, plant);
  assert.equal(git(root, ['rev-parse', missing]), git(root, ['rev-parse', 'refs/heads/main']));
  return fixture;
}

for (const [label, plant, missing] of [
  ['git tag refs/heads/dev', ['tag', 'refs/heads/dev', 'main'], 'refs/heads/dev'],
  ['git branch refs/heads/dev', ['branch', 'refs/heads/dev', 'main'], 'refs/heads/dev'],
  [
    'refs/tags/refs/remotes/origin/dev',
    ['update-ref', 'refs/tags/refs/remotes/origin/dev', 'main'],
    'refs/remotes/origin/dev',
  ],
]) {
  test(`175147 CR6: a ref made by ${label} does not stand in for an absent integration branch`, () => {
    const { root, changes } = plantedWithoutIntegrationBranch(plant, missing);
    const { id } = changes.fix;

    assertStartRefused(
      root,
      changes.fix,
      'fix',
      'main',
      `branch "fix/${id}" cannot start: integration branch "dev" does not exist locally — create it (e.g. from its remote-tracking copy) before starting`,
    );
  });
}

// Remotes `fork` and `upstream`, neither named `origin`.
function ambiguousRemotes(root, bare) {
  git(root, ['remote', 'rename', 'origin', 'upstream']);
  git(root, ['remote', 'add', 'fork', bare]);
}

test('175147 CR8: several remotes without origin fail closed and name what is missing', () => {
  const { root, changes, bare } = remoteTypeRepo();
  const { id } = changes.fix;
  ambiguousRemotes(root, bare);

  assertStartRefused(
    root,
    changes.fix,
    'fix',
    'main',
    `branch "fix/${id}" cannot start: cannot decide which remote holds integration branch "dev": this repo configures fork, upstream and none is "origin"`,
  );
  assert.throws(
    () => resolveRemote(root, defaultRun),
    (error) =>
      error.message ===
      'cannot decide which remote holds the state ref: this repo configures fork, upstream and none is "origin"',
  );
});

test('175147 CR9: an integration type does not resolve a remote', () => {
  const { root, changes, bare } = remoteTypeRepo();
  const { file, id } = changes.feature;
  ambiguousRemotes(root, bare);

  startOn(root, { id, type: 'feature' }, 'dev');

  assert.equal(startsInProgress(file), true);
});

test('175147 CR10: the guard reads local refs and never reaches the network', () => {
  const { root, changes } = remoteTypeRepo();
  const { file, id } = changes.fix;
  git(root, ['remote', 'set-url', 'origin', '/nonexistent/remote.git']);
  const tree = git(root, ['rev-parse', 'main^{tree}']).trim();
  const ahead = git(root, ['commit-tree', tree, '-p', 'main', '-m', 'feat: dev work']).trim();
  git(root, ['update-ref', 'refs/remotes/origin/dev', ahead]);
  assert.equal(git(root, ['branch', '--contains', ahead]).trim(), '');

  assertStartRefused(
    root,
    changes.fix,
    'fix',
    ahead,
    `branch "fix/${id}" contains commits of "origin/dev" that are not in "main"`,
  );
  dropChangeBranch(root, changes.fix, 'fix');
  git(root, ['checkout', '-q', '-b', `fix/${id}`, 'main']);
  const { calls, gitRun } = recordingGitRun();
  status(id, 'in-progress', root, { ownerHandle: () => '', gitRun });

  assert.equal(startsInProgress(file), true);
  const subcommands = calls.map(subcommandOf);
  const network = subcommands.filter(
    ([name, sub]) =>
      ['fetch', 'ls-remote', 'pull'].includes(name) || (name === 'remote' && sub === 'update'),
  );
  assert.deepEqual(network, []);
  assert.deepEqual(
    calls.filter((args) => subcommandOf(args)[0] === 'remote'),
    [['remote']],
  );
});

test('175147 CR11: a remote-tracking copy with unrelated history fails closed and says so', () => {
  const { root, changes } = remoteTypeRepo();
  const { id } = changes.fix;
  const emptyTree = git(root, ['hash-object', '-t', 'tree', '/dev/null']).trim();
  const orphan = git(root, ['commit-tree', emptyTree, '-m', 'chore: orphan']).trim();
  git(root, ['update-ref', 'refs/remotes/origin/dev', orphan]);

  assertStartRefused(
    root,
    changes.fix,
    'fix',
    'main',
    `branch "fix/${id}" cannot start: it shares no history with integration branch "origin/dev"`,
  );
});

test('175147 CR12: a tag named like the integration branch does not stand in for it', () => {
  const { root, changes } = remoteTypeRepo();
  const { id } = changes.fix;
  commitOn(root, 'dev', 'DEVWORK');
  git(root, ['tag', 'dev', 'main']);

  assertStartRefused(
    root,
    changes.fix,
    'fix',
    'refs/heads/dev',
    `branch "fix/${id}" contains commits of "dev" that are not in "main"`,
  );
});

test('175147 CR13: a tag named like the release branch does not stand in for it', () => {
  const { root, changes } = remoteTypeRepo();
  const { id } = changes.fix;
  commitOn(root, 'dev', 'DEVWORK');
  git(root, ['tag', 'main', 'refs/heads/dev']);

  assertStartRefused(
    root,
    changes.fix,
    'fix',
    'refs/heads/dev',
    `branch "fix/${id}" contains commits of "dev" that are not in "main"`,
  );
});

test('175147 CR14: the ancestry check of a release type resolves the release branch', () => {
  const { root, changes } = remoteTypeRepo();
  const { id } = changes.fix;
  commitOn(root, 'main', 'RELEASE', 'chore: release');
  git(root, ['tag', 'main', 'refs/heads/dev']);

  assertStartRefused(
    root,
    changes.fix,
    'fix',
    'refs/heads/dev',
    `branch "fix/${id}" must descend from integration branch "main"`,
  );
});

test('175147 CR14: a tag named refs/heads/main does not stand in for an absent release branch', () => {
  const { root, changes } = remoteTypeRepo();
  const { id } = changes.fix;
  commitOn(root, 'dev', 'DEVWORK');
  git(root, ['branch', '-m', 'main', 'gone']);
  git(root, ['tag', 'refs/heads/main', 'refs/heads/dev']);
  assert.equal(
    git(root, ['rev-parse', 'refs/heads/main']),
    git(root, ['rev-parse', 'refs/heads/dev']),
  );

  assertStartRefused(
    root,
    changes.fix,
    'fix',
    'refs/heads/dev',
    `branch "fix/${id}" must descend from integration branch "main"`,
  );
});

test('175147 CR14: without a remote, a tag named refs/heads/main does not stand in for a missing release branch', () => {
  const { root, changes } = releaseTypeRepo({ shape: 'dev-ahead' });
  const { file, id } = changes.fix;
  git(root, ['checkout', '-q', '-b', `fix/${id}`, 'main']);
  git(root, ['branch', '-m', 'main', 'gone']);
  git(root, ['tag', 'refs/heads/main', 'HEAD']);
  assert.equal(git(root, ['remote']), '');
  const before = fs.readFileSync(file, 'utf8');

  assert.throws(
    () => status(id, 'in-progress', root, { ownerHandle: () => '' }),
    (error) => error.message === `branch "fix/${id}" must descend from integration branch "main"`,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('175147 CR15: the ancestry check of an integration type resolves the integration branch', () => {
  const { root, changes } = remoteTypeRepo();
  const { id } = changes.feature;
  commitOn(root, 'dev', 'DEVWORK');
  git(root, ['tag', 'dev', 'refs/heads/main']);

  assertStartRefused(
    root,
    changes.feature,
    'feature',
    'refs/heads/main',
    `branch "feature/${id}" must descend from integration branch "dev"`,
  );
});

test('175147 CR15: a tag named refs/heads/dev does not stand in for an absent integration branch', () => {
  const { root, changes } = plantedWithoutIntegrationBranch(
    ['tag', 'refs/heads/dev', 'main'],
    'refs/heads/dev',
  );
  const { id } = changes.feature;

  assertStartRefused(
    root,
    changes.feature,
    'feature',
    'main',
    `branch "feature/${id}" must descend from integration branch "dev"`,
  );
});

test('175147 CR16: a ref outside refs/tags named like the branch does not stand in for it', () => {
  const { root, changes } = remoteTypeRepo();
  const { id } = changes.fix;
  commitOn(root, 'dev', 'DEVWORK');
  git(root, ['update-ref', 'refs/dev', 'refs/heads/main']);

  assertStartRefused(
    root,
    changes.fix,
    'fix',
    'refs/heads/dev',
    `branch "fix/${id}" contains commits of "dev" that are not in "main"`,
  );
});

test('175147 CR17: a tag named like the remote-tracking copy does not stand in for it', () => {
  const { root, changes, bare } = remoteTypeRepo();
  const { id } = changes.fix;
  pushDevWorkFromClone(bare);
  git(root, ['fetch', '-q', 'origin']);
  git(root, ['tag', 'origin/dev', 'main']);

  assertStartRefused(
    root,
    changes.fix,
    'fix',
    'refs/remotes/origin/dev',
    `branch "fix/${id}" contains commits of "origin/dev" that are not in "main"`,
  );
});

test('175147 CR18: without change_branch_format the guard stays off', () => {
  const { root, changes, bare } = remoteTypeRepo();
  const { file, id } = changes.fix;
  const configFile = path.join(root, '.changeledger', 'config.yml');
  const config = parseYaml(fs.readFileSync(configFile, 'utf8'));
  config.git.change_branch_format = null;
  fs.writeFileSync(configFile, stringifyYaml(config));
  ambiguousRemotes(root, bare);
  commitOn(root, 'dev', 'DEVWORK');
  git(root, ['checkout', '-q', '-b', `fix/${id}`, 'refs/heads/dev']);
  const { calls, gitRun } = recordingGitRun();

  status(id, 'in-progress', root, { ownerHandle: () => '', gitRun });

  assert.equal(startsInProgress(file), true);
  assert.deepEqual(calls, []);
});

function futureSchemaRepo() {
  const fixture = repoWithChange();
  const configFile = path.join(fixture.root, '.changeledger', 'config.yml');
  fs.writeFileSync(
    configFile,
    fs.readFileSync(configFile, 'utf8').replace(/^schema_version: \d+$/m, 'schema_version: 7'),
  );
  return fixture;
}

test('161652 CR2: lifecycle mutations reject a future schema before writing', () => {
  const mutators = [
    ['status', ({ id, root }) => status(id, 'approved', root)],
    ['approve', ({ id, root }) => approve(id, root)],
    ['review', ({ id, root }) => review(id, 'pass', {}, root)],
    ['owner', ({ id, root }) => owner(id, 'ana', root)],
    ['discard', ({ id, root }) => discard(id, 'reason', root)],
    ['archive', ({ id, root }) => archive(id, root)],
    ['archive --graduated', ({ root }) => archiveGraduated({}, root)],
    ['log', ({ id, root }) => log(id, 'note', root)],
    ['task', ({ id, root }) => task(id, 'done', 1, '', root)],
  ];

  for (const [name, mutate] of mutators) {
    const fixture = futureSchemaRepo();
    const before = fs.readFileSync(fixture.file, 'utf8');
    assert.throws(
      () => mutate(fixture),
      /^Error: config schema 7 is newer than supported schema 6; update ChangeLedger before writing$/,
      name,
    );
    assert.equal(fs.readFileSync(fixture.file, 'utf8'), before, name);
    assert.deepEqual(
      fs
        .readdirSync(path.join(fixture.root, '.changeledger', 'changes'))
        .filter((entry) => entry.endsWith('.lock')),
      [],
      name,
    );
  }
});

test('status moves the lifecycle and logs the transition', () => {
  const { root, file, id } = repoWithChange();
  status(id, 'approved', root);
  const c = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(c.frontmatter.status, 'approved');
  assert.match(c.stages.find((s) => s.key === 'log').body, /draft → approved/);
});

test('125139 CR1/CR7: conversational approval is attributed without changing viewer semantics', () => {
  const conversational = repoWithChange();
  approve(conversational.id, conversational.root);
  const conversationalLog = parseChange(fs.readFileSync(conversational.file, 'utf8')).stages.find(
    (stage) => stage.key === 'log',
  ).body;
  assert.match(conversationalLog, /draft → approved \(human via conversation\)/);

  const viewer = repoWithChange();
  status(viewer.id, 'approved', viewer.root, { actor: 'human' });
  const viewerLog = parseChange(fs.readFileSync(viewer.file, 'utf8')).stages.find(
    (stage) => stage.key === 'log',
  ).body;
  assert.match(viewerLog, /`\[status\]` draft → approved/);
  assert.doesNotMatch(viewerLog, /via conversation/);
});

// 20260729-185200 — the draft's exit gate. `emptyRepo` keeps the defective and
// the ready candidate side by side: both are hand-written drafts, because the
// scaffold `new` produces is empty and therefore already ready.
function emptyRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-gate-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  init(root);
  return root;
}

function writeDraft(root, id, body) {
  const file = path.join(root, '.changeledger', 'changes', `${id}-gate.md`);
  fs.writeFileSync(file, body);
  return file;
}

// The readiness defect classes the Investigation reproduced: a criterion with no
// Given/When/Then, a task citing a criterion that does not exist, and CR-bearing
// tasks that name neither target nor verification.
function defectiveDraft(id) {
  return `---
id: "${id}"
title: Defective
type: feature
status: draft
created: 2026-06-13T12:00:00Z
depends_on: []
---

## Request

R

## Investigation

I

## Proposal

P

## Specification

### CR1 — Test-grade
- **Given** a
- **When** b
- **Then** c

### CR2 — Not test-grade
- **Given** a

## Plan

- [ ] vague work
  - **Criteria:** CR1
- [ ] more vague work
  - **Criteria:** CR2
- [ ] Update \`src/x.mjs\`
  - **Target:** \`src/x.mjs\`
  - **Verify:** \`node --test test/x.test.mjs\`
  - **Criteria:** CR99

## Log

- **2026-06-13T12:00:00Z** \`[note]\` Draft.
`;
}

function readyDraft(id) {
  return `---
id: "${id}"
title: Ready
type: feature
status: draft
created: 2026-06-13T12:00:00Z
depends_on: []
---

## Request

R

## Investigation

I

## Proposal

P

## Specification

### CR1 — Test-grade
- **Given** a
- **When** b
- **Then** c

## Plan

- [ ] Update \`src/x.mjs\`
  - **Target:** \`src/x.mjs\`
  - **Verify:** \`node --test test/x.test.mjs\`
  - **Criteria:** CR1

## Log

- **2026-06-13T12:00:00Z** \`[note]\` Draft.
`;
}

test('185200 CR1: approve rejects a draft whose defects would be errors once approved', () => {
  const root = emptyRepo();
  const id = '20260613-120000';
  const file = writeDraft(root, id, defectiveDraft(id));
  const before = fs.readFileSync(file, 'utf8');

  assert.throws(
    () => approve(id, root),
    (error) => {
      assert.match(error.message, /failed scoped validation/);
      assert.match(error.message, /CR2 is not test-grade: missing Given\/When\/Then/);
      assert.match(error.message, /Plan task references unknown criterion "CR99"/);
      assert.match(error.message, /Plan task for CR1 must name target and verification/);
      assert.match(error.message, /Plan task for CR2 must name target and verification/);
      return true;
    },
  );

  assert.equal(fs.readFileSync(file, 'utf8'), before, 'a rejected approve must not write');
  assert.equal(parseChange(before).frontmatter.status, 'draft');
});

test('185200 CR2: a ready draft approves exactly as before', () => {
  const root = emptyRepo();
  const id = '20260613-120001';
  const file = writeDraft(root, id, readyDraft(id));

  approve(id, root);

  const after = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(after.frontmatter.status, 'approved');
  assert.match(
    after.stages.find((stage) => stage.key === 'log').body,
    /`\[status\]` draft → approved \(human via conversation\)/,
  );
});

// 20260810-213633 — the empty-stage gate on the draft→approved transition
// itself (real incident: 20260810-181801 approved with every narrative stage
// blank). `checkCoverage`'s referential checks pass vacuously on an empty
// Specification/Plan — no criteria declared, so nothing is uncovered — so this
// is a distinct assertion from the 185200 CR1 gate above, not a duplicate.
function emptySpecAndPlanDraft(id) {
  return `---
id: "${id}"
title: Empty spec and plan
type: feature
status: draft
created: 2026-06-13T12:00:00Z
depends_on: []
---

## Request

R

## Investigation

I

## Proposal

P

## Specification

## Plan

## Log

- **2026-06-13T12:00:00Z** \`[note]\` Draft.
`;
}

function emptyRequestQuickDraft(id) {
  return `---
id: "${id}"
title: Empty request
type: quick
status: draft
created: 2026-06-13T12:00:00Z
depends_on: []
---

## Request

## Log

- **2026-06-13T12:00:00Z** \`[note]\` Draft.
`;
}

test('213633 CR1: approve refuses a feature draft with empty Specification and Plan, naming both', () => {
  const root = emptyRepo();
  const id = '20260810-213700';
  const file = writeDraft(root, id, emptySpecAndPlanDraft(id));
  const before = fs.readFileSync(file, 'utf8');

  assert.throws(() => approve(id, root), {
    message: 'cannot approve: "## Specification", "## Plan" are empty',
  });

  assert.equal(fs.readFileSync(file, 'utf8'), before, 'a rejected approve must not write');
  assert.equal(parseChange(before).frontmatter.status, 'draft');
});

test('213633 CR2: approve refuses a quick draft with an empty Request', () => {
  const root = emptyRepo();
  const id = '20260810-213701';
  const file = writeDraft(root, id, emptyRequestQuickDraft(id));
  const before = fs.readFileSync(file, 'utf8');

  assert.throws(() => approve(id, root), {
    message: 'cannot approve: "## Request" is empty',
  });

  assert.equal(fs.readFileSync(file, 'utf8'), before, 'a rejected approve must not write');
  assert.equal(parseChange(before).frontmatter.status, 'draft');
});

test('status rejects an invalid value without writing', () => {
  const { root, file, id } = repoWithChange();
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => status(id, 'weird', root), /Invalid status/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('status rejects an illegal lifecycle jump without writing', () => {
  const { root, file, id } = repoWithChange();
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => status(id, 'done', root), /invalid lifecycle transition: draft → done/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('task done marks the task with a timestamp', () => {
  const { root, file, id } = repoWithChange();
  task(id, 'done', 1, '', root);
  const t = parseChange(fs.readFileSync(file, 'utf8')).tasks[0];
  assert.equal(t.state, 'done');
  assert.match(t.resolvedAt, /^\d{4}-\d{2}-\d{2}T/);
});

// --- 20261023-094931: the `task` seat runs `apply`'s candidate rule ---------
//
// `task` and `apply {"op": "task"}` share `taskMutation`; before this change
// `apply` alone judged the document it produces. These pin the rule on the
// standalone seat: an error the write introduces refuses it in both layouts,
// and one the repo already carried does not (worktree layout, CR4).

const GATE_DONE_ID = '20260601-100000';
const GATE_DONE_NAME = `${GATE_DONE_ID}-graduable.md`;
const gateDoneChange = `---
id: "${GATE_DONE_ID}"
title: Verdad graduable
type: feature
status: done
created: 2026-06-01T10:00:00Z
depends_on: []
---

## Request

Petición cerrada.

## Investigation

Investigación cerrada.

## Proposal

Propuesta cerrada.

## Specification

### CR1 — una verdad graduable
- **Given** un repo
- **When** algo ocurre
- **Then** pasa algo

## Plan

- [x] Hacer la verdad
  - **Criteria:** CR1
  - **Resolved:** \`2026-06-01T10:00:00Z\`

## Log

- **2026-06-01T10:00:00Z** \`[note]\` created
`;

const gateInProgress = (id) => ({
  [`${id}-en-curso.md`]: `---\nid: "${id}"\ntitle: En curso\ntype: chore\nstatus: in-progress\ncreated: 2026-06-13T12:00:00Z\ndepends_on: []\n---\n\n## Request\n\nAlgo.\n\n## Plan\n\n- [ ] Hacer la cosa\n\n## Log\n\n- **2026-06-13T12:00:00Z** \`[status]\` draft → approved\n- **2026-06-13T12:01:00Z** \`[status]\` approved → in-progress\n`,
});

const GATE_BROKEN_NAME = '20260613-200000-roto.md';
const gateBroken = {
  [GATE_BROKEN_NAME]:
    '---\nid: "20260613-200000"\ntitle: Roto\ntype: quick\nstatus: draft\ncreated: 2026-06-13T20:00:00Z\ndepends_on: []\nparent: "20200101-000000"\n---\n\n## Request\n\nAlgo.\n\n## Log\n',
};

// `docs` maps a change filename to its text: written to the worktree, or
// committed only to the state ref when `activated`.
function taskGateRepo(docs, { activated = false } = {}) {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-task-gate-')),
  );
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  init(root);
  if (!activated) {
    for (const [name, text] of Object.entries(docs)) {
      fs.writeFileSync(path.join(root, '.changeledger', 'changes', name), text);
    }
    return root;
  }
  const configText = fs.readFileSync(path.join(root, '.changeledger', 'config.yml'), 'utf8');
  initGitFixture(root);
  const tree = buildTree(root, {
    '.changeledger-state/manifest.yml': 'format_version: 1\nproject_id: demo\n',
    '.changeledger-state/config.yml': configText,
    ...Object.fromEntries(
      Object.entries(docs).map(([name, text]) => [`.changeledger-state/changes/${name}`, text]),
    ),
  });
  updateRef(root, STATE_REF, commitTree(root, tree, { message: 'chore: state' }));
  writeActivation(root, { stateRef: STATE_REF });
  return root;
}

const repoErrors = (root) => checkRepo(loadRepo(root)).errors.map((e) => `${e.file}: ${e.message}`);

const taskRefusal = (id, n, action, lines) =>
  `task ${id} ${n} ${action} refused, nothing was written — the resulting candidate carries ${lines.length} validation error(s):\n${lines.map((line) => `  ${line}`).join('\n')}`;

const NOT_DONE_LINE = `${GATE_DONE_NAME}: status is "done" but 1 task(s) are not done`;

test('20261023-094931 CR1: task block on a done change is refused and the state tip does not move', () => {
  const root = taskGateRepo({ [GATE_DONE_NAME]: gateDoneChange }, { activated: true });
  assert.deepEqual(repoErrors(root), [], 'the fixture must start clean');
  const tip = stateRefTip(root);

  assert.throws(
    () => task(GATE_DONE_ID, 'block', 1, 'r', root),
    (e) => {
      assert.equal(e.message, taskRefusal(GATE_DONE_ID, 1, 'block', [NOT_DONE_LINE]));
      return true;
    },
  );
  assert.equal(stateRefTip(root), tip);
  assert.equal(stateDocText(root, tip, `changes/${GATE_DONE_NAME}`), gateDoneChange);
});

test('20261023-094931 CR2: task block on a done change is refused in the worktree layout', () => {
  const root = taskGateRepo({ [GATE_DONE_NAME]: gateDoneChange });
  assert.deepEqual(repoErrors(root), [], 'the fixture must start clean');
  const file = path.join(root, '.changeledger', 'changes', GATE_DONE_NAME);

  assert.throws(
    () => task(GATE_DONE_ID, 'block', 1, 'r', root),
    (e) => {
      assert.equal(e.message, taskRefusal(GATE_DONE_ID, 1, 'block', [NOT_DONE_LINE]));
      return true;
    },
  );
  assert.equal(fs.readFileSync(file, 'utf8'), gateDoneChange);
});

test('20261023-094931 CR3: task done and task block on an in-progress change still land', () => {
  const root = taskGateRepo({
    ...gateInProgress('20260613-120000'),
    ...gateInProgress('20260613-121000'),
  });
  assert.deepEqual(repoErrors(root), [], 'the fixture must start clean');
  const read = (id) =>
    parseChange(
      fs.readFileSync(path.join(root, '.changeledger', 'changes', `${id}-en-curso.md`), 'utf8'),
    ).tasks[0];

  task('20260613-120000', 'done', 1, '', root);
  const done = read('20260613-120000');
  assert.equal(done.state, 'done');
  assert.match(done.resolvedAt, /^\d{4}-\d{2}-\d{2}T/);

  task('20260613-121000', 'block', 1, 'r', root);
  const blocked = read('20260613-121000');
  assert.equal(blocked.state, 'blocked');
  assert.equal(blocked.reason, 'r');
});

test('20261023-094931 CR4: an unrelated pre-existing error neither blocks task nor joins its refusal', () => {
  const root = taskGateRepo({
    ...gateInProgress('20260613-120000'),
    ...gateBroken,
    [GATE_DONE_NAME]: gateDoneChange,
  });
  const brokenLine = `${GATE_BROKEN_NAME}: parent references missing change "20200101-000000"`;
  assert.deepEqual(repoErrors(root), [brokenLine], 'the break must be the one error before');

  assert.doesNotThrow(() => task('20260613-120000', 'done', 1, '', root));

  const file = path.join(root, '.changeledger', 'changes', GATE_DONE_NAME);
  assert.throws(
    () => task(GATE_DONE_ID, 'block', 1, 'r', root),
    (e) => {
      assert.equal(e.message, taskRefusal(GATE_DONE_ID, 1, 'block', [NOT_DONE_LINE]));
      return true;
    },
  );
  assert.equal(fs.readFileSync(file, 'utf8'), gateDoneChange);
});

// The gate loads the whole worktree ledger, which `task` did not before; an
// unparseable sibling must keep costing nothing, as in 150231 CR6.
test('20261023-094931: the task gate ignores an unrelated unparseable change in the worktree', () => {
  const root = taskGateRepo(gateInProgress('20260613-120000'));
  fs.writeFileSync(path.join(root, '.changeledger', 'changes', 'broken.md'), 'not frontmatter\n');

  assert.doesNotThrow(() => task('20260613-120000', 'done', 1, '', root));
});

test('125007 CR6: log appends an opaque typed note', () => {
  const { root, file, id } = repoWithChange();
  const message = 'status: draft → done — [graduation] spec: fake.md';
  log(id, message, root);
  assert.match(
    fs.readFileSync(file, 'utf8'),
    /`\[note\]` status: draft → done — \[graduation\] spec: fake\.md\n?$/,
  );
});

test('new --owner writes the owner into the frontmatter', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-owner-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  init(root);
  const file = newChange(
    { type: 'feature', slug: 'x', title: 'X', owner: 'ana', now: '2026-06-13T12:00:00Z' },
    root,
  );
  assert.equal(parseChange(fs.readFileSync(file, 'utf8')).frontmatter.owner, 'ana');
});

test('owner sets and clears the responsible', () => {
  const { root, file, id } = repoWithChange();
  owner(id, 'ana', root);
  assert.equal(parseChange(fs.readFileSync(file, 'utf8')).frontmatter.owner, 'ana');
  owner(id, '-', root);
  assert.equal('owner' in parseChange(fs.readFileSync(file, 'utf8')).frontmatter, false);
});

test('status to in-progress auto-assigns owner handle when empty', () => {
  const { root, file, id } = repoWithChange();
  status(id, 'approved', root);
  status(id, 'in-progress', root, { ownerHandle: () => 'raruiz' });
  const c = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(c.frontmatter.owner, 'raruiz');
  assert.match(c.stages.find((s) => s.key === 'log').body, /`\[owner\]` set: raruiz \(auto\)/);
});

test('status to in-progress does not overwrite an explicit owner', () => {
  const { root, file, id } = repoWithChange();
  owner(id, 'leo', root);
  status(id, 'approved', root);
  status(id, 'in-progress', root, { ownerHandle: () => 'raruiz' });
  assert.equal(parseChange(fs.readFileSync(file, 'utf8')).frontmatter.owner, 'leo');
});

test('status to in-progress tolerates a missing owner handle', () => {
  const { root, file, id } = repoWithChange();
  status(id, 'approved', root);
  status(id, 'in-progress', root, { ownerHandle: () => '' });
  assert.equal('owner' in parseChange(fs.readFileSync(file, 'utf8')).frontmatter, false);
});

test('20260805-052741 CR1: status to in-progress auto-assigns the current branch when empty', () => {
  const { root, file, id } = repoWithChange();
  status(id, 'approved', root, { ownerHandle: () => '' });
  status(id, 'in-progress', root, { ownerHandle: () => '', checkoutBranch: () => 'feature/x' });
  const c = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(c.frontmatter.branch, 'feature/x');
  assert.match(c.stages.find((s) => s.key === 'log').body, /`\[branch\]` set: feature\/x \(auto\)/);
});

test('20260805-052741 CR2: status to in-progress does not overwrite an explicit branch', () => {
  const { root, file, id } = repoWithChange();
  fs.writeFileSync(file, setBranch(fs.readFileSync(file, 'utf8'), 'manual-branch'));
  status(id, 'approved', root, { ownerHandle: () => '' });
  status(id, 'in-progress', root, { ownerHandle: () => '', checkoutBranch: () => 'otra-rama' });
  assert.equal(parseChange(fs.readFileSync(file, 'utf8')).frontmatter.branch, 'manual-branch');
});

test('20260805-052741 CR3: status to in-progress tolerates a missing branch', () => {
  const { root, file, id } = repoWithChange();
  status(id, 'approved', root, { ownerHandle: () => '' });
  status(id, 'in-progress', root, { ownerHandle: () => '', checkoutBranch: () => '' });
  assert.equal('branch' in parseChange(fs.readFileSync(file, 'utf8')).frontmatter, false);
});

test('20260808-141944 CR1: a branch mismatch on transition produces a non-blocking warning', () => {
  const { root, file, id } = repoWithChange();
  fs.writeFileSync(file, setBranch(fs.readFileSync(file, 'utf8'), 'feature/x'));
  status(id, 'approved', root, { ownerHandle: () => '' });
  status(id, 'in-progress', root, { ownerHandle: () => '', checkoutBranch: () => 'feature/x' });
  const result = status(id, 'in-review', root, { checkoutBranch: () => 'feature/y' });
  assert.equal(parseChange(fs.readFileSync(file, 'utf8')).frontmatter.status, 'in-review');
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /feature\/x/);
  assert.match(result.warnings[0], /feature\/y/);
  assert.match(result.warnings[0], /changeledger branch/);
});

test('20260808-141944 CR2: no mismatch means no warning', () => {
  const { root, file, id } = repoWithChange();
  fs.writeFileSync(file, setBranch(fs.readFileSync(file, 'utf8'), 'feature/x'));
  status(id, 'approved', root, { ownerHandle: () => '' });
  status(id, 'in-progress', root, { ownerHandle: () => '', checkoutBranch: () => 'feature/x' });
  const result = status(id, 'in-review', root, { checkoutBranch: () => 'feature/x' });
  assert.deepEqual(result.warnings, []);
});

test('20260808-141944 CR3: an unresolvable checkout produces no warning and does not throw', () => {
  const { root, file, id } = repoWithChange();
  fs.writeFileSync(file, setBranch(fs.readFileSync(file, 'utf8'), 'feature/x'));
  status(id, 'approved', root, { ownerHandle: () => '' });
  status(id, 'in-progress', root, { ownerHandle: () => '', checkoutBranch: () => 'feature/x' });
  const result = status(id, 'in-review', root, { checkoutBranch: () => '' });
  assert.deepEqual(result.warnings, []);
});

test('20260808-141944 CR4: no branch field means no comparison', () => {
  const { root, file, id } = repoWithChange();
  status(id, 'approved', root, { ownerHandle: () => '' });
  const result = status(id, 'in-progress', root, {
    ownerHandle: () => '',
    checkoutBranch: () => 'feature/y',
  });
  assert.equal(parseChange(fs.readFileSync(file, 'utf8')).frontmatter.branch, 'feature/y');
  assert.deepEqual(result.warnings, []);
});

test('20260808-141944 CR5: the warning does not mutate the document', () => {
  const { root, file, id } = repoWithChange();
  fs.writeFileSync(file, setBranch(fs.readFileSync(file, 'utf8'), 'feature/x'));
  status(id, 'approved', root, { ownerHandle: () => '' });
  status(id, 'in-progress', root, { ownerHandle: () => '', checkoutBranch: () => 'feature/x' });
  status(id, 'in-review', root, { checkoutBranch: () => 'feature/y' });
  const c = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(c.frontmatter.branch, 'feature/x');
  const logBody = c.stages.find((s) => s.key === 'log').body;
  const statusEvents = logBody.split('\n').filter((l) => l.includes('[status]'));
  const branchEvents = logBody.split('\n').filter((l) => l.includes('[branch]'));
  assert.equal(statusEvents.length, 3);
  assert.equal(branchEvents.length, 0);
});

test('144812 CR1: an assigned owner skips resolution entirely', () => {
  const { root, file, id } = repoWithChange();
  owner(id, 'ana', root);
  status(id, 'approved', root);
  let calls = 0;
  status(id, 'in-progress', root, {
    ownerHandle: () => {
      calls += 1;
      return 'raruiz';
    },
  });
  assert.equal(calls, 0);
  const c = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(c.frontmatter.owner, 'ana');
  assert.doesNotMatch(c.stages.find((s) => s.key === 'log').body, /\(auto\)/);
});

test('144812 CR2: an absent owner is resolved exactly once', () => {
  const { root, file, id } = repoWithChange();
  status(id, 'approved', root);
  let calls = 0;
  status(id, 'in-progress', root, {
    ownerHandle: () => {
      calls += 1;
      return 'resolved-user';
    },
  });
  assert.equal(calls, 1);
  const c = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(c.frontmatter.owner, 'resolved-user');
  assert.match(
    c.stages.find((s) => s.key === 'log').body,
    /`\[owner\]` set: resolved-user \(auto\)/,
  );
});

test('archive sets the archived flag', () => {
  const { root, file, id } = repoWithChange();
  archive(id, root);
  assert.equal(parseChange(fs.readFileSync(file, 'utf8')).frontmatter.archived, true);
});

function repoWithArchiveCandidates() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-archive-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  init(root);
  const changesDir = path.join(root, '.changeledger', 'changes');
  const write = ({
    id,
    status = 'done',
    type = 'feature',
    owner,
    reviewed = true,
    archived = false,
    log = '',
  }) => {
    const fm = [
      '---',
      `id: "${id}"`,
      'title: Candidate',
      `type: ${type}`,
      `status: ${status}`,
      'created: 2026-06-13T12:00:00Z',
      ...(reviewed ? ['reviewed: true'] : []),
      ...(archived ? ['archived: true'] : []),
      ...(owner ? [`owner: ${owner}`] : []),
      'depends_on: []',
      '---',
    ].join('\n');
    const text = `${fm}\n\n## Request\n\nR\n\n## Investigation\n\nI\n\n## Proposal\n\nP\n\n## Specification\n\n### CR1 — C\n- **Given** x\n- **When** y\n- **Then** z\n\n## Plan\n\n- [x] do it (CR1) — 2026-06-13T12:00:00Z\n\n## Log\n${log}\n`;
    const file = path.join(changesDir, `${id}-candidate.md`);
    fs.writeFileSync(file, text);
    return file;
  };
  return { root, write };
}

test('212322 CR2: archiveGraduated archives graduated and skipped done changes', () => {
  const { root, write } = repoWithArchiveCandidates();
  const graduated = write({
    id: '20260613-120001',
    log: '- **2026-06-13T12:00:00Z** `[graduation]` spec: `arch.md`',
  });
  const skipped = write({
    id: '20260613-120002',
    log: '- **2026-06-13T12:00:00Z** `[graduation]` skipped: no durable truth',
  });
  const archived = archiveGraduated({}, root);
  assert.deepEqual(
    archived.map((c) => c.id),
    ['20260613-120001', '20260613-120002'],
  );
  for (const file of [graduated, skipped]) {
    const c = parseChange(fs.readFileSync(file, 'utf8'));
    assert.equal(c.frontmatter.archived, true);
    assert.match(c.stages.find((s) => s.key === 'log').body, /`\[archive\]` archived/);
  }
});

test('212322 CR3/CR4: archiveGraduated skips active, unreviewed and already archived changes', () => {
  const { root, write } = repoWithArchiveCandidates();
  const active = write({
    id: '20260613-120001',
    status: 'in-progress',
    log: '- **2026-06-13T12:00:00Z** `[graduation]` spec: `arch.md`',
  });
  const unreviewed = write({
    id: '20260613-120002',
    reviewed: false,
    log: '- **2026-06-13T12:00:00Z** `[graduation]` spec: `arch.md`',
  });
  const alreadyArchived = write({
    id: '20260613-120003',
    archived: true,
    log: '- **2026-06-13T12:00:00Z** `[graduation]` spec: `arch.md`\n- **2026-06-13T12:01:00Z** `[archive]` archived',
  });
  const before = new Map(
    [active, unreviewed, alreadyArchived].map((file) => [file, fs.readFileSync(file, 'utf8')]),
  );
  assert.deepEqual(archiveGraduated({}, root), []);
  for (const [file, text] of before) assert.equal(fs.readFileSync(file, 'utf8'), text);
});

test('105457 CR1/CR4/CR5: archiveGraduated filters exact owners and matches list preview', () => {
  const { root, write } = repoWithArchiveCandidates();
  write({
    id: '20260613-120001',
    owner: 'Roberto Ruiz',
    log: '- **2026-06-13T12:00:00Z** `[graduation]` spec: `one.md`',
  });
  write({
    id: '20260613-120002',
    owner: 'Ana',
    log: '- **2026-06-13T12:00:00Z** `[graduation]` spec: `two.md`',
  });
  write({ id: '20260613-120003', owner: 'Roberto Ruiz', reviewed: false });

  const preview = list({ pending: 'archive', owner: 'Roberto Ruiz' }, root).map((c) => c.id);
  const archived = archiveGraduated({ owner: 'Roberto Ruiz' }, root).map((c) => c.id);
  assert.deepEqual(archived, preview);
  assert.deepEqual(archived, ['20260613-120001']);
  assert.deepEqual(
    archiveGraduated({}, root).map((c) => c.id),
    ['20260613-120002'],
  );
});

test('105457 CR2/CR4: archiveGraduated filters unowned candidates and matches list preview', () => {
  const { root, write } = repoWithArchiveCandidates();
  write({
    id: '20260613-120001',
    log: '- **2026-06-13T12:00:00Z** `[graduation]` skipped: no durable truth',
  });
  write({
    id: '20260613-120002',
    owner: 'Ana',
    log: '- **2026-06-13T12:00:00Z** `[graduation]` skipped: no durable truth',
  });

  const preview = list({ pending: 'archive', unowned: true }, root).map((c) => c.id);
  const archived = archiveGraduated({ unowned: true }, root).map((c) => c.id);
  assert.deepEqual(archived, preview);
  assert.deepEqual(archived, ['20260613-120001']);
});

test('list filters by status and show returns the change', () => {
  const { root, id } = repoWithChange();
  assert.equal(list({ status: 'approved' }, root).length, 0);
  assert.equal(list({ status: 'draft' }, root).length, 1);
  assert.equal(show(id, root).frontmatter.title, 'X');
});

test('131649 CR1/CR2: list owns graduation and archive pending queries', () => {
  const { root, write } = repoWithArchiveCandidates();
  write({ id: '20260613-120001', reviewed: false });
  write({ id: '20260613-120002' });
  write({
    id: '20260613-120003',
    log: '- **2026-06-13T12:00:00Z** `[graduation]` spec: `api.md`',
  });
  write({
    id: '20260613-120004',
    log: '- **2026-06-13T12:00:00Z** `[graduation]` skipped: no durable truth',
  });
  write({ id: '20260613-120005', status: 'in-review', reviewed: false });
  write({
    id: '20260613-120006',
    archived: true,
    log: '- **2026-06-13T12:00:00Z** `[graduation]` spec: `old.md`',
  });

  assert.deepEqual(
    list({ pending: 'graduation' }, root).map((change) => change.id),
    ['20260613-120001'],
  );
  assert.deepEqual(
    list({ pending: 'archive' }, root).map((change) => change.id),
    ['20260613-120003', '20260613-120004'],
  );
});

test('141643 CR3: pending graduation is exactly done with reviewed other than true', () => {
  const change = (status, reviewed, stages = []) => ({
    frontmatter: { status, ...(reviewed === undefined ? {} : { reviewed }) },
    stages,
  });
  const graduationMarker = [
    {
      key: 'log',
      body: '- **2026-06-13T12:00:00Z** `[graduation]` spec: `legacy.md`',
    },
  ];

  assert.equal(isPendingGraduation(change('done', undefined)), true);
  assert.equal(isPendingGraduation(change('done', false)), true);
  assert.equal(isPendingGraduation(change('done', 'true')), true);
  assert.equal(isPendingGraduation(change('done', undefined, graduationMarker)), true);
  assert.equal(isPendingGraduation(change('done', true)), false);
  assert.equal(isPendingGraduation(change('in-review', undefined)), false);
});

test('131649 CR3-CR5: list combines owner, unowned, status and type filters', () => {
  const { root, write } = repoWithArchiveCandidates();
  write({ id: '20260613-120001', owner: 'Roberto Ruiz', status: 'in-review' });
  write({ id: '20260613-120002', owner: 'raruiz-hiberuscom', status: 'in-review' });
  write({ id: '20260613-120003', status: 'in-review' });
  write({ id: '20260613-120004', owner: 'Roberto Ruiz', type: 'bug' });

  assert.deepEqual(
    list({ owner: 'Roberto Ruiz', status: 'in-review', type: 'feature' }, root).map(
      (change) => change.id,
    ),
    ['20260613-120001'],
  );
  assert.deepEqual(
    list({ unowned: true }, root).map((change) => change.id),
    ['20260613-120003'],
  );
});

test('131649 CR6/CR7: list hides archives by default and exposes unambiguous visibility', () => {
  const { root, write } = repoWithArchiveCandidates();
  write({ id: '20260613-120001' });
  write({ id: '20260613-120002', archived: true });

  assert.deepEqual(
    list({}, root).map((change) => change.id),
    ['20260613-120001'],
  );
  assert.deepEqual(
    list({ archived: true }, root).map((change) => change.id),
    ['20260613-120002'],
  );
  const all = list({ all: true }, root);
  assert.deepEqual(
    all.map((change) => change.id),
    ['20260613-120001', '20260613-120002'],
  );
  assert.deepEqual(
    all.map((change) => change.archived),
    [false, true],
  );
});

// Review gate (change 20260615-150510). repoWithChange() is a `feature`, which
// the seeded config marks review_required.

function repoWithChore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-agent-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  init(root);
  const file = newChange(
    { type: 'chore', slug: 'c', title: 'C', now: '2026-06-13T12:00:00Z' },
    root,
    { ownerHandle: () => '' },
  );
  // 20260810-213633: approve refuses a chore whose active stages (request,
  // plan) are blank, so this shared fixture back-fills both minimally.
  const text = fs
    .readFileSync(file, 'utf8')
    .replace('## Request\n', '## Request\n\nR\n')
    .replace('## Plan\n', '## Plan\n\n- [ ] do it\n  - **Support:**\n');
  fs.writeFileSync(file, text);
  const id = parseChange(text).frontmatter.id;
  return { root, file, id };
}

// repoWithChange() deliberately produces an owner-less change (see its own
// comment), so the pre-existing in-progress auto-assign guard (!fm.owner)
// fires here for every caller. None of reach()'s callers assert anything
// about owner, so inject a deterministic empty identity to keep the suite
// hermetic instead of reaching the host's real gh/git identity.
const reach = (id, root, target) => {
  for (const s of ['approved', 'in-progress', 'in-review']) {
    status(id, s, root, { ownerHandle: () => '' });
    if (s === target) return;
  }
};

test('171002 CR1: status blocks review-required in-progress → done', () => {
  const { root, file, id } = repoWithChange();
  reach(id, root, 'in-progress');
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(
    () => status(id, 'done', root),
    /feature changes must be reviewed before delivery — move to in-review first/,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

// 20260726-141120 — entry into review is closed for a type without
// `review_required`. `init` seeds `audit` without it.

function repoWithAudit() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-agent-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  init(root);
  const file = newChange(
    { type: 'audit', slug: 'a', title: 'A', now: '2026-06-13T12:00:00Z' },
    root,
    { ownerHandle: () => '' },
  );
  // 20260810-213633: approve refuses an audit whose active stages (request,
  // investigation) are blank, so this shared fixture back-fills both minimally.
  const text = fs
    .readFileSync(file, 'utf8')
    .replace('## Request\n', '## Request\n\nR\n')
    .replace('## Investigation\n', '## Investigation\n\nI\n');
  fs.writeFileSync(file, text);
  const id = parseChange(text).frontmatter.id;
  status(id, 'approved', root);
  status(id, 'in-progress', root, { ownerHandle: () => '' });
  return { root, file, id };
}

test('141120 CR2: rejecting review entry leaves the document and Log untouched', () => {
  const { root, file, id } = repoWithAudit();
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(
    () => status(id, 'in-review', root),
    /^Error: audit changes do not require review — move to done instead$/,
  );
  const after = fs.readFileSync(file, 'utf8');
  assert.equal(after, before);
  const c = parseChange(after);
  assert.equal(c.frontmatter.status, 'in-progress');
  assert.doesNotMatch(c.stages.find((s) => s.key === 'log').body, /in-review/);
});

test('141120 CR1: the CLI reports the rejection and exits 1', async () => {
  const { root, id } = repoWithAudit();
  const bin = path.resolve('bin/changeledger.mjs');
  const failure = await execFileAsync(process.execPath, [bin, 'status', id, 'in-review'], {
    cwd: root,
  }).then(
    () => null,
    (e) => e,
  );
  assert.ok(failure, 'the CLI must fail');
  assert.equal(failure.code, 1);
  assert.match(
    failure.stderr,
    /^Error: audit changes do not require review — move to done instead$/m,
  );
});

// 20260722-124656 — the local gate decides whether a reviewable candidate exists,
// so the transition that claims review started is the last place the readiness of
// that candidate can still be refused instead of delegated to the reviewer.
function repoWithUnreadyChange() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-agent-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  init(root);
  const file = newChange(
    { type: 'feature', slug: 'unready', title: 'Unready', now: '2026-06-13T12:00:00Z' },
    root,
    { ownerHandle: () => '' },
  );
  // Walk to in-progress while the document is still ready: since 20260729-185200
  // the draft → approved gate refuses a defective candidate, and the subject here
  // is the in-review gate, not approval.
  const ready = fs
    .readFileSync(file, 'utf8')
    .replace('## Request\n', '## Request\n\nR\n')
    .replace('## Investigation\n', '## Investigation\n\nI\n')
    .replace('## Proposal\n', '## Proposal\n\nP\n')
    .replace(
      '## Specification\n',
      '## Specification\n\n### CR1 — Something\n- **Given** a thing\n- **When** it runs\n- **Then** it holds\n',
    )
    .replace(
      '## Plan\n',
      '## Plan\n\n- [ ] do it in `src/x.mjs`\n  - **Target:** `src/x.mjs`\n  - **Verify:** `test/x.test.mjs`\n  - **Criteria:** CR1\n',
    );
  fs.writeFileSync(file, ready);
  const id = parseChange(ready).frontmatter.id;
  status(id, 'approved', root);
  status(id, 'in-progress', root, { ownerHandle: () => '' });
  // Two readiness defects at once, introduced where this fixture needs them: CR1
  // has no When/Then, and the Plan task that claims it names neither a target
  // (`src/**`) nor a verification (`test/**`).
  fs.writeFileSync(
    file,
    fs
      .readFileSync(file, 'utf8')
      .replace(
        '### CR1 — Something\n- **Given** a thing\n- **When** it runs\n- **Then** it holds\n',
        '### CR1 — Something\n- **Given** a thing\n',
      )
      .replace(
        '- [ ] do it in `src/x.mjs`\n  - **Target:** `src/x.mjs`\n  - **Verify:** `test/x.test.mjs`\n  - **Criteria:** CR1',
        '- [ ] do the thing\n  - **Criteria:** CR1',
      ),
  );
  return { root, file, id };
}

test('124656 CR3: the in-review transition refuses an unready candidate', () => {
  const { root, file, id } = repoWithUnreadyChange();
  const before = fs.readFileSync(file, 'utf8');
  let thrown;
  try {
    status(id, 'in-review', root);
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, 'the transition must refuse an unready candidate');
  // Every readiness defect is named, not just the first one found.
  assert.match(thrown.message, /CR1 is not test-grade: missing Given\/When\/Then/);
  assert.match(thrown.message, /Plan task for CR1 must name target and verification/);
  // The refusal is byte-preserving: no status flip, and no Log entry at all.
  const after = fs.readFileSync(file, 'utf8');
  assert.equal(after, before);
  const c = parseChange(after);
  assert.equal(c.frontmatter.status, 'in-progress');
  const logBody = c.stages.find((s) => s.key === 'log').body;
  // CR2: neither a transition into in-review nor any review-typed event.
  assert.doesNotMatch(logBody, /in-review/);
  assert.doesNotMatch(logBody, /\[review\]/);
});

test('124656 CR3: a ready candidate still reaches in-review', () => {
  const { root, file, id } = repoWithUnreadyChange();
  const repaired = fs
    .readFileSync(file, 'utf8')
    .replace(
      '### CR1 — Something\n- **Given** a thing\n',
      '### CR1 — Something\n- **Given** a thing\n- **When** it runs\n- **Then** it holds\n',
    )
    .replace(
      '- [ ] do the thing\n  - **Criteria:** CR1',
      '- [ ] do it in `src/x.mjs`\n  - **Target:** `src/x.mjs`\n  - **Verify:** `test/x.test.mjs`\n  - **Criteria:** CR1',
    );
  fs.writeFileSync(file, repaired);
  status(id, 'in-review', root);
  const c = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(c.frontmatter.status, 'in-review');
  assert.match(c.stages.find((s) => s.key === 'log').body, /in-progress → in-review/);
});

test('CR5: status rejects approved → in-review without writing', () => {
  const { root, file, id } = repoWithChange();
  status(id, 'approved', root);
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(
    () => status(id, 'in-review', root),
    /invalid lifecycle transition: approved → in-review/,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('CR12: status rejects draft → done without writing', () => {
  const { root, file, id } = repoWithChange();
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => status(id, 'done', root), /invalid lifecycle transition: draft → done/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('171002 CR1: review pass delivers and marks the delegation', () => {
  const { root, file, id } = repoWithChange();
  task(id, 'done', 1, '', root);
  reach(id, root, 'in-review');
  review(id, 'pass', {}, root);
  const c = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(c.frontmatter.status, 'done');
  assert.match(
    c.stages.find((s) => s.key === 'log').body,
    /review → done \(delegated subagent, clean context\)/,
  );
});

test('122950 support: status and review preserve non-canonical valid YAML style', () => {
  const { root, file, id } = repoWithChange();
  task(id, 'done', 1, '', root);
  const styled = fs
    .readFileSync(file, 'utf8')
    .replace('title: X', "title: 'X'")
    .replace('depends_on: []', 'depends_on: [] # keep compact');
  fs.writeFileSync(file, styled);

  reach(id, root, 'in-review');
  assert.match(fs.readFileSync(file, 'utf8'), /title: 'X'.*depends_on: \[\] # keep compact/s);
  review(id, 'pass', {}, root);
  assert.match(fs.readFileSync(file, 'utf8'), /title: 'X'.*depends_on: \[\] # keep compact/s);
});

test('150231 CR2/CR3: delivery rejects incomplete or inconsistent changes without writing', () => {
  for (const defect of ['task', 'log']) {
    const { root, file, id } = repoWithChange();
    if (defect === 'log') task(id, 'done', 1, '', root);
    reach(id, root, 'in-review');
    if (defect === 'log') {
      fs.writeFileSync(
        file,
        fs
          .readFileSync(file, 'utf8')
          .replace(
            '## Log\n',
            '## Log\n\n- **2026-06-13T12:30:00Z** `[status]` draft → approved\n',
          ),
      );
    }
    const before = fs.readFileSync(file, 'utf8');
    assert.throws(
      () => review(id, 'pass', {}, root),
      defect === 'task' ? /1 task\(s\) are not done/ : /Log line .*reconstructed status/,
    );
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  }
});

test('150231 CR6: delivery ignores an unrelated unparseable change', () => {
  const { root, file, id } = repoWithChange();
  task(id, 'done', 1, '', root);
  reach(id, root, 'in-review');
  fs.writeFileSync(path.join(root, '.changeledger', 'changes', 'broken.md'), 'not frontmatter\n');

  assert.doesNotThrow(() => review(id, 'pass', {}, root));
  assert.equal(parseChange(fs.readFileSync(file, 'utf8')).frontmatter.status, 'done');
});

function deliveredChange() {
  const result = repoWithChange();
  task(result.id, 'done', 1, '', result.root);
  reach(result.id, result.root, 'in-review');
  review(result.id, 'pass', {}, result.root);
  return result;
}

// 150232 CR1/CR2/CR5 and 105205 CR2 pinned `reopen`, which is retired with
// `in-validation`: the return is the generic transition now. Requiring a
// reason is the viewer's rule, pinned in test/view.test.mjs; what the command
// owes is to carry that reason AND the actor into the Log, since this edge is
// the only record a human rejection leaves and `rejectionCount` counts only
// the human ones (20261018-131621 CR24).
test('20261018-131621 CR24: the return from done records its actor and reason', () => {
  for (const [actor, expected] of [
    ['human', 'human'],
    ['agent', 'agent'],
  ]) {
    const { root, file, id } = deliveredChange();
    status(id, 'in-progress', root, { actor, reason: 'complete original acceptance' });
    const parsed = parseChange(fs.readFileSync(file, 'utf8'));
    assert.equal(parsed.frontmatter.status, 'in-progress');
    assert.match(
      parsed.stages.find((s) => s.key === 'log').body,
      new RegExp(
        `\`\\[status\\]\` done → in-progress \\(${expected}\\): complete original acceptance$`,
        'm',
      ),
      actor,
    );
  }
});

// Supersedes 150232 CR3, whose four durable boundaries are down to one: a
// graduated or archived change is reversible (`--into` never overwrites a spec
// body, `archived: false` undoes an archive), so only a published release
// still freezes what the change contains.
test('20261018-131621 CR9: only release membership closes the return from done', () => {
  for (const boundary of ['reviewed', 'graduated', 'archived']) {
    const { root, file, id } = deliveredChange();
    let text = fs.readFileSync(file, 'utf8');
    if (boundary === 'reviewed')
      text = text.replace('depends_on: []', 'depends_on: []\nreviewed: true');
    if (boundary === 'graduated') text += '\n- **2026-06-13T13:00:00Z** `[graduation]` skipped\n';
    if (boundary === 'archived')
      text = text.replace('depends_on: []', 'depends_on: []\narchived: true');
    fs.writeFileSync(file, text);

    status(id, 'in-progress', root, { reason: 'late' });
    assert.equal(parseChange(fs.readFileSync(file, 'utf8')).frontmatter.status, 'in-progress');
  }

  const { root, file, id } = deliveredChange();
  const dir = path.join(root, '.changeledger', 'releases');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, '0.19.0.yml'),
    `version: 0.19.0\ncreated: 2026-06-13T13:00:00Z\nchanges: ["${id}"]\n`,
  );
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(
    () => status(id, 'in-progress', root, { reason: 'late' }),
    (e) => e.message === `change ${id} shipped in release 0.19.0: new work needs a new change`,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

// 150232 CR3 pinned a race between `release record` and `reopen`, which took
// the release-history lock. `reopen` is retired and the generic transition
// does not take that lock: in an activated repo the CAS on the state revision
// closes the window, and in a worktree layout the race stays open and
// unguarded (20261018-131621 CR16).

test('20261018-131621 CR4: a type without review delivers through generic status', () => {
  const { root, file, id } = repoWithChore();
  status(id, 'approved', root);
  status(id, 'in-progress', root, { ownerHandle: () => '' });
  task(id, 'done', 1, '', root);
  status(id, 'done', root);
  const c = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(c.frontmatter.status, 'done');
  assert.match(c.stages.find((s) => s.key === 'log').body, /`\[status\]` in-progress → done/);
});

test('20261018-131621 CR20: status done refuses a change with an open Plan task', () => {
  const { root, file, id } = repoWithChore();
  status(id, 'approved', root);
  status(id, 'in-progress', root, { ownerHandle: () => '' });
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => status(id, 'done', root), /status is "done" but 1 task\(s\) are not done/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('20261018-131621 CR20: review pass refuses a change with an open Plan task', () => {
  const { root, file, id } = repoWithChange();
  reach(id, root, 'in-review');
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(
    () => review(id, 'pass', {}, root),
    /status is "done" but 1 task\(s\) are not done/,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

// Retiring `in-validation` left `in-review → done` as a legal edge of the
// graph with no seat narrowing it, so the generic transition delivered
// review_required work with no verdict at all and `check` saw nothing wrong.
// The verdict is the reviewer's to give; this seat only names where it lives.
test('20261018-131621 CR27: status done refuses to deliver a change in review', () => {
  const { root, file, id } = repoWithChange();
  task(id, 'done', 1, '', root);
  reach(id, root, 'in-review');
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(
    () => status(id, 'done', root),
    (e) => e.message.includes(`changeledger review ${id} pass`),
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('CR7: review fail returns to in-progress with the reason', () => {
  const { root, file, id } = repoWithChange();
  reach(id, root, 'in-review');
  review(id, 'fail', { reason: 'CR3 not met' }, root);
  const c = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(c.frontmatter.status, 'in-progress');
  assert.match(c.stages.find((s) => s.key === 'log').body, /review → in-progress: CR3 not met/);
});

test('CR9: review requires status in-review', () => {
  const { root, file, id } = repoWithChange();
  status(id, 'approved', root);
  status(id, 'in-progress', root, { ownerHandle: () => '' });
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(
    () => review(id, 'pass', {}, root),
    /review requires status in-review \(current: in-progress\)/,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

// 20260729-162616 CR2: review() validates both its outcomes through
// assertTransition, the same lifecycle authority status() and discard() already
// use — instead of writing setStatus directly once its own bespoke
// `current !== 'in-review'` guard passes. Under today's graph both in-review
// edges are legal (`in-review: ['done', 'in-progress']` mirrors review()'s two
// verdicts exactly), so assertTransition can never actually throw through
// review() right now. This pins the illegal-current rejection (the only
// reachable one) on the fail path too, not just `pass`, so a future edit that
// narrows the graph or the review-required gate is enforced here the same way
// it already is for the other verbs.
test('162616 CR2: review fail rejects an illegal current status without writing', () => {
  const { root, file, id } = repoWithChange();
  status(id, 'approved', root);
  status(id, 'in-progress', root, { ownerHandle: () => '' });
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(
    () => review(id, 'fail', { reason: 'x' }, root),
    /review requires status in-review \(current: in-progress\)/,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('CR10: review fail requires a reason', () => {
  const { root, file, id } = repoWithChange();
  reach(id, root, 'in-review');
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(
    () => review(id, 'fail', {}, root),
    /fail requires a reason — changeledger review <id> fail "<reason>"/,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

// 20260615-175734 — ids share a timestamp prefix, so a partial/ambiguous id must
// never resolve to "the first file whose name starts with it". Resolution is by
// exact frontmatter.id equality, and it must not write to the wrong change.
function repoWithTwoSamePrefix() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-agent-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  init(root);
  const fileA = newChange(
    { type: 'feature', slug: 'a', title: 'A', now: '2026-06-13T12:00:00Z' },
    root,
    { ownerHandle: () => '' },
  );
  const fileB = newChange(
    { type: 'feature', slug: 'b', title: 'B', now: '2026-06-13T12:00:01Z' },
    root,
    { ownerHandle: () => '' },
  );
  // 20260810-213633: fileB reaches approved in CR1 below, so its active stages
  // need minimal content; fileA is filled the same way to keep both siblings
  // uniform (it never itself moves past draft in these tests).
  const fillStages = (text) =>
    text
      .replace('## Request\n', '## Request\n\nR\n')
      .replace('## Investigation\n', '## Investigation\n\nI\n')
      .replace('## Proposal\n', '## Proposal\n\nP\n')
      .replace('## Specification\n', '## Specification\n\nS\n')
      .replace('## Plan\n', '## Plan\n\n- [ ] do it\n  - **Support:**\n');
  fs.writeFileSync(fileA, fillStages(fs.readFileSync(fileA, 'utf8')));
  fs.writeFileSync(fileB, fillStages(fs.readFileSync(fileB, 'utf8')));
  const idA = parseChange(fs.readFileSync(fileA, 'utf8')).frontmatter.id;
  const idB = parseChange(fs.readFileSync(fileB, 'utf8')).frontmatter.id;
  return { root, fileA, fileB, idA, idB };
}

test('175734 CR1: a full exact id resolves the right sibling and leaves the other untouched', () => {
  const { root, fileA, fileB, idB } = repoWithTwoSamePrefix();
  const beforeA = fs.readFileSync(fileA, 'utf8');
  status(idB, 'approved', root);
  assert.equal(parseChange(fs.readFileSync(fileB, 'utf8')).frontmatter.status, 'approved');
  assert.equal(fs.readFileSync(fileA, 'utf8'), beforeA, 'sibling must be byte-for-byte unchanged');
});

test('175734 CR2: a partial id shared by siblings is rejected without writing', () => {
  const { root, fileA, fileB } = repoWithTwoSamePrefix();
  const beforeA = fs.readFileSync(fileA, 'utf8');
  const beforeB = fs.readFileSync(fileB, 'utf8');
  assert.throws(() => status('20260613', 'approved', root), /No change with id "20260613"/);
  assert.equal(fs.readFileSync(fileA, 'utf8'), beforeA);
  assert.equal(fs.readFileSync(fileB, 'utf8'), beforeB);
});

test('175734 CR3: a filename whose frontmatter id differs is not an exact match', () => {
  const { root, fileA, idA } = repoWithTwoSamePrefix();
  // Corrupt the frontmatter id so the filename prefix no longer reflects it.
  fs.writeFileSync(
    fileA,
    fs.readFileSync(fileA, 'utf8').replace(`id: "${idA}"`, 'id: "20260613-999999"'),
  );
  // The filename still begins with idA, but no change has that exact frontmatter id.
  assert.throws(() => status(idA, 'approved', root), new RegExp(`No change with id "${idA}"`));
  // The real (corrupted) id resolves regardless of the filename. The witness is
  // `owner`, not `approve`: the corruption this fixture needs is itself a check
  // error ("filename does not match id"), and since 20260729-185200 the
  // draft → approved gate refuses any document with errors. Resolution, not
  // readiness, is what this criterion owns.
  owner('20260613-999999', 'ana', root);
  assert.equal(parseChange(fs.readFileSync(fileA, 'utf8')).frontmatter.owner, 'ana');
});

// 20260615-210508 — discard requires a reason and writes a terminal status.
test('210508 CR1: discard without a reason throws and writes nothing', () => {
  const { root, file, id } = repoWithChange();
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(
    () => discard(id, '', root),
    /discard requires a reason — changeledger discard <id> "<reason>"/,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('210508 CR2: discard sets the terminal status and logs the reason', () => {
  const { root, file, id } = repoWithChange();
  discard(id, 'superseded by 20260613-120001', root);
  const c = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(c.frontmatter.status, 'discarded');
  assert.match(
    c.stages.find((s) => s.key === 'log').body,
    /draft → discarded: superseded by 20260613-120001/,
  );
});

test('210508 CR3/CR4: cannot discard a done change, and discarded is terminal', () => {
  const { root, file, id } = repoWithChange();
  task(id, 'done', 1, '', root);
  status(id, 'approved', root);
  status(id, 'in-progress', root, { ownerHandle: () => '' });
  // Drive the feature through review to test terminal done.
  status(id, 'in-review', root);
  review(id, 'pass', {}, root);
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(
    () => discard(id, 'too late', root),
    /invalid lifecycle transition: done → discarded/,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('210508 CR1: status refuses discarded and points to the discard verb', () => {
  const { root, file, id } = repoWithChange();
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => status(id, 'discarded', root), /use `changeledger discard <id> "<reason>"`/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

function repoWithTwoTasks() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-agent-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  init(root);
  const file = newChange(
    { type: 'feature', slug: 'race', title: 'Race', now: '2026-06-13T12:00:00Z' },
    root,
    { ownerHandle: () => '' },
  );
  const text = fs
    .readFileSync(file, 'utf8')
    .replace('## Plan\n', '## Plan\n\n- [ ] first\n- [ ] second\n');
  fs.writeFileSync(file, text);
  return { root, file, id: parseChange(text).frontmatter.id };
}

test('212314 CR1: concurrent task mutations on the same change preserve both writes', async () => {
  const { root, file, id } = repoWithTwoTasks();
  const readyOne = path.join(root, 'ready-one');
  const readyTwo = path.join(root, 'ready-two');
  const go = path.join(root, 'go');
  const code = `
    import fs from 'node:fs';
    import { setTimeout as delay } from 'node:timers/promises';
    import { task } from ${JSON.stringify(pathToFileURL(path.resolve('src/commands/agent.mjs')).href)};
    fs.writeFileSync(process.argv[4], 'ready');
    while (!fs.existsSync(process.argv[5])) await delay(5);
    task(process.argv[1], 'done', Number(process.argv[2]), '', process.argv[3]);
  `;
  const child = (taskNumber, readyPath) =>
    execFileAsync(process.execPath, [
      '--input-type=module',
      '-e',
      code,
      id,
      String(taskNumber),
      root,
      readyPath,
      go,
    ]);

  const one = child(1, readyOne);
  const two = child(2, readyTwo);
  const deadline = Date.now() + 3000;
  while ((!fs.existsSync(readyOne) || !fs.existsSync(readyTwo)) && Date.now() < deadline) {
    await delay(5);
  }
  assert.ok(fs.existsSync(readyOne), 'first child reached the barrier');
  assert.ok(fs.existsSync(readyTwo), 'second child reached the barrier');
  fs.writeFileSync(go, 'go');
  await Promise.all([one, two]);

  assert.deepEqual(
    parseChange(fs.readFileSync(file, 'utf8')).tasks.map((t) => t.state),
    ['done', 'done'],
  );
});

test('212314 CR2: a lock on one change does not block mutating another change', () => {
  const first = repoWithTwoTasks();
  const secondFile = newChange(
    { type: 'feature', slug: 'other', title: 'Other', now: '2026-06-13T12:00:01Z' },
    first.root,
    { ownerHandle: () => '' },
  );
  const secondText = fs
    .readFileSync(secondFile, 'utf8')
    .replace('## Plan\n', '## Plan\n\n- [ ] only\n');
  fs.writeFileSync(secondFile, secondText);
  const secondId = parseChange(secondText).frontmatter.id;

  const heldLock = path.join(path.dirname(first.file), `.${path.basename(first.file)}.lock`);
  fs.writeFileSync(heldLock, 'held');
  try {
    task(secondId, 'done', 1, '', first.root);
    assert.equal(parseChange(fs.readFileSync(secondFile, 'utf8')).tasks[0].state, 'done');
    assert.equal(parseChange(fs.readFileSync(first.file, 'utf8')).tasks[0].state, 'todo');
  } finally {
    fs.rmSync(heldLock, { force: true });
  }
});

// 20260808-151643 — active-mode routing: a mutation on an activated repo
// writes a CAS commit on the state ref instead of the worktree, and every
// mutator in the battery still recognizes a document that only exists there.

test('CR1: task/owner/branch/log mutate the state ref, never the worktree, one commit each', () => {
  const { root, id, name } = activatedRepoWithChange();
  const relPath = `changes/${name}`;

  task(id, 'done', 1, '', root);
  assert.equal(parseChange(stateDocText(root, stateRefTip(root), relPath)).tasks[0].state, 'done');
  assert.equal(lastCommitMessage(root), `task: ${id} 1 done`);

  owner(id, 'octocat', root);
  assert.equal(
    parseChange(stateDocText(root, stateRefTip(root), relPath)).frontmatter.owner,
    'octocat',
  );
  assert.equal(lastCommitMessage(root), `owner: ${id} octocat`);

  branch(id, 'work/x', root);
  assert.equal(
    parseChange(stateDocText(root, stateRefTip(root), relPath)).frontmatter.branch,
    'work/x',
  );
  assert.equal(lastCommitMessage(root), `branch: ${id} work/x`);

  log(id, 'a note', root);
  assert.match(stateDocText(root, stateRefTip(root), relPath), /a note/);
  assert.equal(lastCommitMessage(root), `log: ${id}`);

  // Never a worktree write: the whole state tree root never existed on disk.
  assert.equal(fs.existsSync(path.join(root, STATE_ROOT)), false);
});

test('20260809-113242 CR10: active status ignores a malformed stale marker', () => {
  const { root, id, name } = activatedRepoWithChange();
  const before = stateRefTip(root);
  fs.writeFileSync(path.join(root, '.changeledger', 'config.yml'), 'statuses: [\n');

  const { warnings } = status(id, 'approved', root, { actor: 'human', channel: 'conversation' });

  assert.deepEqual(warnings, []);
  const tip = stateRefTip(root);
  assert.notEqual(tip, before);
  const fm = parseChange(stateDocText(root, tip, `changes/${name}`)).frontmatter;
  assert.equal(fm.status, 'approved');
  assert.equal(lastCommitMessage(root), `status: ${id} → approved`);
  assert.equal(fs.existsSync(path.join(root, STATE_ROOT)), false);
});

// 20260808-151643 CR9 (post-validation fold-in) — the converted mutators
// return the written path in both modes: inactive unchanged (the worktree
// file, byte-identical to before this change), active the state-tree path
// (`changes/<file>`), never `undefined`. `status` is CR9's named example;
// one representative assertion per mode is the criterion's own scope.
test('CR9: status returns the worktree path when inactive and the state-tree path when active', () => {
  const inactive = repoWithChange();
  const inactiveResult = status(inactive.id, 'approved', inactive.root, {
    actor: 'human',
    channel: 'conversation',
  });
  assert.equal(inactiveResult.file, inactive.file);

  const active = activatedRepoWithChange();
  const activeResult = status(active.id, 'approved', active.root, {
    actor: 'human',
    channel: 'conversation',
  });
  assert.equal(activeResult.file, `changes/${active.name}`);
});

test('CR1: full lifecycle through review/return/discard stays on the ref', () => {
  const { root, id, name } = activatedRepoWithChange();
  const relPath = `changes/${name}`;
  task(id, 'done', 1, '', root);
  status(id, 'approved', root, { actor: 'human', channel: 'conversation' });
  status(id, 'in-progress', root, { ownerHandle: () => '' });
  status(id, 'in-review', root);

  review(id, 'pass', {}, root);
  assert.equal(
    parseChange(stateDocText(root, stateRefTip(root), relPath)).frontmatter.status,
    'done',
  );

  status(id, 'in-progress', root, { reason: 'needs a fix' });
  assert.equal(
    parseChange(stateDocText(root, stateRefTip(root), relPath)).frontmatter.status,
    'in-progress',
  );
  assert.equal(lastCommitMessage(root), `status: ${id} → in-progress`);

  status(id, 'in-review', root);
  review(id, 'fail', { reason: 'oops' }, root);
  assert.equal(
    parseChange(stateDocText(root, stateRefTip(root), relPath)).frontmatter.status,
    'in-progress',
  );

  discard(id, 'not needed', root);
  const fm = parseChange(stateDocText(root, stateRefTip(root), relPath)).frontmatter;
  assert.equal(fm.status, 'discarded');
  assert.equal(lastCommitMessage(root), `discard: ${id}`);
  assert.equal(fs.existsSync(path.join(root, STATE_ROOT)), false);
});

test('CR1: archive and archiveGraduated commit through the ref', () => {
  const { root, id, name } = activatedRepoWithChange();
  const relPath = `changes/${name}`;
  task(id, 'done', 1, '', root);
  status(id, 'approved', root, { actor: 'human', channel: 'conversation' });
  status(id, 'in-progress', root, { ownerHandle: () => '' });
  status(id, 'in-review', root);
  review(id, 'pass', {}, root);

  archive(id, root);
  assert.equal(
    parseChange(stateDocText(root, stateRefTip(root), relPath)).frontmatter.archived,
    true,
  );
});

function archiveCandidateText(id, log) {
  const fm = [
    '---',
    `id: "${id}"`,
    'title: Candidate',
    'type: feature',
    'status: done',
    'created: 2026-06-13T12:00:00Z',
    'reviewed: true',
    'depends_on: []',
    '---',
  ].join('\n');
  return `${fm}\n\n## Request\n\nR\n\n## Investigation\n\nI\n\n## Proposal\n\nP\n\n## Specification\n\n### CR1 — C\n- **Given** x\n- **When** y\n- **Then** z\n\n## Plan\n\n- [x] do it (CR1) — 2026-06-13T12:00:00Z\n\n## Log\n${log}\n`;
}

test('CR1: archiveGraduated commits every archived change in one commit, active mode', () => {
  const { root } = activatedRepoWithChange();
  const graduatedText = archiveCandidateText(
    '20260613-120001',
    '- **2026-06-13T12:00:00Z** `[graduation]` spec: `arch.md`',
  );
  const skippedText = archiveCandidateText(
    '20260613-120002',
    '- **2026-06-13T12:00:00Z** `[graduation]` skipped: no durable truth',
  );
  writeLedgerFiles(
    { repoRoot: root, state: { revision: stateRefTip(root) } },
    [
      { relPath: 'changes/20260613-120001-candidate.md', text: graduatedText },
      { relPath: 'changes/20260613-120002-candidate.md', text: skippedText },
    ],
    { message: 'chore: seed candidates' },
  );

  const before = stateRefTip(root);
  const result = archiveGraduated({}, root);

  assert.deepEqual(result.map((c) => c.id).sort(), ['20260613-120001', '20260613-120002']);
  // CR9 fold-in: archiveGraduated's own return also names the written path
  // in active mode, never the `null` `repo.changes` carries there.
  assert.deepEqual(result.map((c) => c.file).sort(), [
    'changes/20260613-120001-candidate.md',
    'changes/20260613-120002-candidate.md',
  ]);
  const tip = stateRefTip(root);
  assert.equal(git(root, ['rev-list', '--count', `${before}..${tip}`]).trim(), '1');
  for (const relPath of [
    'changes/20260613-120001-candidate.md',
    'changes/20260613-120002-candidate.md',
  ]) {
    const fm = parseChange(stateDocText(root, tip, relPath)).frontmatter;
    assert.equal(fm.archived, true);
  }
});

test('CR7: an active mutation preserves every other document identity in the child snapshot', () => {
  const { root, id, revision } = activatedRepoWithChange();
  const before = execFileSync('git', ['ls-tree', '-r', '--name-only', revision], {
    encoding: 'utf8',
    cwd: root,
    env: sanitizedEnv(),
  })
    .trim()
    .split('\n')
    .filter(Boolean);

  log(id, 'a note', root);

  const after = execFileSync('git', ['ls-tree', '-r', '--name-only', stateRefTip(root)], {
    encoding: 'utf8',
    cwd: root,
    env: sanitizedEnv(),
  })
    .trim()
    .split('\n')
    .filter(Boolean);

  for (const p of before) assert.ok(after.includes(p), `${p} disappeared from the child snapshot`);
});

test('CR2: a concurrent write between load and write surfaces LedgerConflictError, no partial write', () => {
  const { root, id, name } = activatedRepoWithChange();
  const relPath = `changes/${name}`;
  task(id, 'done', 1, '', root);
  status(id, 'approved', root, { actor: 'human', channel: 'conversation' });

  // `status(..., 'in-progress')` calls `ownerHandle` (owner is unset here)
  // strictly after `locate()` already captured `repo.state.revision`, and
  // strictly before this call's own write — the exact window CR2 describes.
  // The racer performs a real, unrelated write through the same seam
  // (`log`) to advance the ref out from under the in-flight call, entirely
  // deterministically (no timing, no subprocess race).
  const racer = () => {
    log(id, 'concurrent note', root);
    return '';
  };

  assert.throws(
    () => status(id, 'in-progress', root, { ownerHandle: racer }),
    (err) => err instanceof LedgerConflictError && /state ref moved/.test(err.message),
  );

  const tip = stateRefTip(root);
  const fm = parseChange(stateDocText(root, tip, relPath)).frontmatter;
  // The ref sits exactly where the racer left it: the racer's write is
  // there, the failed call's write is not.
  assert.match(stateDocText(root, tip, relPath), /concurrent note/);
  assert.equal(fm.status, 'approved');
  assert.equal(fs.existsSync(path.join(root, STATE_ROOT)), false);
});

// 20261001-155216 — the `[version]` stamp, driven through the real commands in
// both layouts. A fixture change is walked to the wanted status by writing its
// Log with a PREVIOUS_VERSION CLI (the writer's version seam); the helper
// asserts that the installed version differs from PREVIOUS_VERSION.

const LAYOUTS = ['legacy', 'state ref'];
const STEPS = ['approved', 'in-progress', 'in-review', 'in-validation', 'done'];
const FIXTURE_AT = '2026-06-13T12:30:00Z';

function textAtStatus(text, target, version) {
  if (target === 'draft') return stampVersion(text, FIXTURE_AT, version);
  let from = 'draft';
  for (const to of STEPS) {
    text = appendLogEvent(
      setStatus(text, to),
      { at: FIXTURE_AT, type: 'status', from, to },
      version,
    );
    from = to;
    if (to === target) break;
  }
  // Work is finished by the time a change is reviewed, as in a real run.
  return STEPS.indexOf(target) >= STEPS.indexOf('in-review')
    ? setTask(text, 1, 'done', { iso: FIXTURE_AT })
    : text;
}

// A change at `status` whose Log was written by `version`, in `layout`.
function stampedFixture(layout, status, { version = PREVIOUS_VERSION, edit: editText } = {}) {
  const { root, file, id } = repoWithChange();
  let text = textAtStatus(fs.readFileSync(file, 'utf8'), status, version);
  if (editText) text = editText(text);
  const name = path.basename(file);
  if (layout === 'legacy') {
    fs.writeFileSync(file, text);
    return { root, id, name, read: () => fs.readFileSync(file, 'utf8') };
  }
  const configText = fs.readFileSync(path.join(root, '.changeledger', 'config.yml'), 'utf8');
  fs.rmSync(file);
  initGitFixture(root);
  const tree = buildTree(root, {
    '.changeledger-state/manifest.yml': 'format_version: 1\nproject_id: demo\n',
    '.changeledger-state/config.yml': configText,
    [`.changeledger-state/changes/${name}`]: text,
  });
  updateRef(root, STATE_REF, commitTree(root, tree, { message: 'chore: state' }));
  writeActivation(root, { stateRef: STATE_REF });
  return {
    root,
    id,
    name,
    read: () => stateDocText(root, stateRefTip(root), `changes/${name}`),
  };
}

const bySameInstant = (events) => events.every((event) => event.at === events[0].at);

for (const layout of LAYOUTS) {
  test(`20261001-155216 CR2 (${layout}): a change already stamped with the running version gains only the events of its commands`, () => {
    const { root, id, read } = stampedFixture(layout, 'approved', { version: VERSION });
    const before = read();
    status(id, 'in-progress', root, { ownerHandle: () => 'ana' });
    log(id, 'nota', root);
    const added = eventsAdded(before, read());
    assert.deepEqual(
      added.map((event) => event.type),
      ['status', 'owner', 'note'],
    );
    assert.deepEqual(versionEvents(added), []);
  });

  test(`20261001-155216 CR3 (${layout}): an update in mid-change is recorded once, at the instant of the event that follows`, () => {
    const { root, id, read } = stampedFixture(layout, 'approved');
    const before = read();
    status(id, 'in-progress', root, { ownerHandle: () => 'ana' });
    log(id, 'nota', root);
    const added = eventsAdded(before, read());
    assert.deepEqual(added[0], {
      at: added[1].at,
      type: 'version',
      previous: PREVIOUS_VERSION,
      version: VERSION,
    });
    assert.equal(added[1].type, 'status');
    assert.equal(`${added[1].from} → ${added[1].to}`, 'approved → in-progress');
    assert.deepEqual(
      added.map((event) => event.type),
      ['version', 'status', 'owner', 'note'],
      'the later events are not preceded by another version line',
    );
  });

  test(`20261001-155216 CR4 (${layout}): a Log without any version line receives the running version with no origin`, () => {
    const { root, id, read } = stampedFixture(layout, 'approved', {
      edit: (text) =>
        text
          .split('\n')
          .filter((line) => !line.includes('`[version]`'))
          .join('\n'),
    });
    const before = read();
    assert.deepEqual(versionEvents(logEvents(before)), []);
    log(id, 'nota', root);
    const added = eventsAdded(before, read());
    assert.deepEqual(added, [
      { at: added[1].at, type: 'version', version: VERSION },
      { at: added[1].at, type: 'note', message: 'nota' },
    ]);
  });

  test(`20261001-155216 CR5 (${layout}): a last stamp above the running version is recorded as a change too`, () => {
    const { root, id, read } = stampedFixture(layout, 'approved', { version: '99.0.0' });
    const before = read();
    log(id, 'nota', root);
    const added = eventsAdded(before, read());
    assert.deepEqual(added[0], {
      at: added[1].at,
      type: 'version',
      previous: '99.0.0',
      version: VERSION,
    });
    assert.equal(added[1].type, 'note');
  });
}

// CR6: each command `log --help` lists for a type other than `version`, plus a
// status event sent through `changeStatus` (view.test.mjs) and `apply`
// (apply.test.mjs). Each case starts from a change at the status the command
// accepts and checks the first event after the fixture is the stamp.
const PRODUCERS = [
  { name: 'approve', at: 'draft', run: ({ id, root }) => approve(id, root), types: ['status'] },
  {
    name: 'status',
    at: 'approved',
    run: ({ id, root }) => status(id, 'in-progress', root, { ownerHandle: () => 'ana' }),
    types: ['status', 'owner'],
  },
  {
    name: 'discard',
    at: 'draft',
    run: ({ id, root }) => discard(id, 'why', root),
    types: ['status'],
  },
  {
    name: 'review',
    at: 'in-review',
    run: ({ id, root }) => review(id, 'pass', {}, root),
    types: ['review'],
  },
  {
    name: 'owner',
    at: 'in-progress',
    run: ({ id, root }) => owner(id, 'ana', root),
    types: ['owner'],
  },
  {
    name: 'branch',
    at: 'in-progress',
    run: ({ id, root }) => branch(id, 'work/x', root),
    types: ['branch'],
  },
  { name: 'archive', at: 'done', run: ({ id, root }) => archive(id, root), types: ['archive'] },
  {
    name: 'archive --graduated',
    at: 'done',
    prepare: (text) =>
      setReviewed(
        appendLogEvent(
          text,
          { at: FIXTURE_AT, type: 'graduation', outcome: 'skipped' },
          PREVIOUS_VERSION,
        ),
        true,
      ),
    run: ({ root }) => archiveGraduated({}, root),
    types: ['archive'],
  },
  { name: 'log', at: 'in-progress', run: ({ id, root }) => log(id, 'nota', root), types: ['note'] },
];

for (const layout of LAYOUTS) {
  for (const producer of PRODUCERS) {
    test(`20261001-155216 CR6 (${layout}): ${producer.name} stamps the version before its event`, () => {
      const fixture = stampedFixture(layout, producer.at, { edit: producer.prepare });
      const before = fixture.read();
      producer.run(fixture);
      const added = eventsAdded(before, fixture.read());
      assert.deepEqual(
        added[0],
        { at: added[1].at, type: 'version', previous: PREVIOUS_VERSION, version: VERSION },
        `${producer.name}: the first new entry is the stamp`,
      );
      assert.equal(versionEvents(added).length, 1);
      assert.deepEqual(
        added.slice(1).map((event) => event.type),
        producer.types,
      );
      assert.ok(bySameInstant([added[0], added[1]]));
    });
  }
}

// CR7: paths that write no event of their own never stamp, and `edit` keeps its
// byte-identical no-op.
for (const layout of LAYOUTS) {
  test(`20261001-155216 CR7 (${layout}): task and edit add no version line, and an identical edit stays a no-op`, () => {
    const { root, id, read } = stampedFixture(layout, 'in-progress');
    const source = path.join(root, 'incoming.md');
    const stamps = () => versionEvents(logEvents(read())).length;
    const initial = stamps();

    const beforeTask = read();
    task(id, 'done', 1, '', root);
    assert.notEqual(read(), beforeTask, 'task changed the document');
    assert.deepEqual(eventsAdded(beforeTask, read()), []);

    const beforeEdit = read();
    fs.writeFileSync(source, beforeEdit.replace('\nR\n', '\nR, rewritten\n'));
    assert.equal(edit(id, { from: source }, root).changed, true);
    assert.match(read(), /R, rewritten/);
    assert.deepEqual(eventsAdded(beforeEdit, read()), []);

    const beforeNoop = read();
    const tip = layout === 'state ref' ? stateRefTip(root) : undefined;
    fs.writeFileSync(source, beforeNoop);
    assert.equal(edit(id, { from: source }, root).changed, false);
    assert.equal(read(), beforeNoop);
    if (tip) assert.equal(stateRefTip(root), tip);

    assert.equal(stamps(), initial, 'task and edit added no stamp');
  });

  test(`20261001-155216 CR7 (${layout}): fix repairs a Plan marker without stamping`, () => {
    const { root, id, read } = stampedFixture(layout, 'in-progress', {
      edit: (text) => text.replace('- [ ] do it', '- [X] do it'),
    });
    const before = read();
    assert.ok(before.includes('- [X] do it'));
    const output = { log() {}, error() {}, warn() {} };
    assert.equal(fix([id], root, output), 0);
    const after = read();
    assert.ok(after.includes('- [x] do it'), 'fix normalized the checkbox marker');
    assert.deepEqual(eventsAdded(before, after), []);
  });
}

// --- two installed versions against one repo (20261001-155216 CR10, CR1, CR5) ---
// Each version is a copy of this checkout's CLI with its package.json relabelled
// 0.18.0 or 0.18.1: both run this checkout's code, not published releases.

function cliRepo(cli, home) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-versions-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  assert.equal(cli(['init'], { cwd: root, home }).code, 0);
  const configFile = path.join(root, '.changeledger', 'config.yml');
  fs.writeFileSync(
    configFile,
    fs
      .readFileSync(configFile, 'utf8')
      .replace(/^ {2}change_branch_format:.*$/m, '  change_branch_format: null'),
  );
  return root;
}

const cliHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
const onlyChangeFile = (root) => {
  const dir = path.join(root, '.changeledger', 'changes');
  const [name] = fs.readdirSync(dir).filter((entry) => entry.endsWith('.md'));
  return path.join(dir, name);
};
const fillFeature = (text) =>
  text
    .replace('## Request\n', '## Request\n\nR\n')
    .replace('## Investigation\n', '## Investigation\n\nI\n')
    .replace('## Proposal\n', '## Proposal\n\nP\n')
    .replace('## Specification\n', '## Specification\n\nS\n')
    .replace('## Plan\n', '## Plan\n\n- [ ] do it\n  - **Support:**\n');

test('20261001-155216 CR10: a change created and approved by 0.18.0 and finished by 0.18.1 records both versions once', () => {
  const home = cliHome();
  const v180 = installCli('0.18.0');
  const v181 = installCli('0.18.1');
  const root = cliRepo(v180, home);

  assert.equal(
    v180(['new', 'feature', 'demo', 'Demo', '--owner', 'ana'], { cwd: root, home }).code,
    0,
  );
  const file = onlyChangeFile(root);
  fs.writeFileSync(file, fillFeature(fs.readFileSync(file, 'utf8')));
  const id = parseChange(fs.readFileSync(file, 'utf8')).frontmatter.id;
  assert.equal(v180(['approve', id], { cwd: root, home }).code, 0);

  // Activate the repo with that document, as the other fixtures do.
  const name = path.basename(file);
  const text = fs.readFileSync(file, 'utf8');
  const configText = fs.readFileSync(path.join(root, '.changeledger', 'config.yml'), 'utf8');
  fs.rmSync(file);
  initGitFixture(root);
  const tree = buildTree(root, {
    '.changeledger-state/manifest.yml': 'format_version: 1\nproject_id: demo\n',
    '.changeledger-state/config.yml': configText,
    [`.changeledger-state/changes/${name}`]: text,
  });
  updateRef(root, STATE_REF, commitTree(root, tree, { message: 'chore: state' }));
  writeActivation(root, { stateRef: STATE_REF });

  // The installation is updated; the same change carries on.
  for (const args of [
    ['status', id, 'in-progress'],
    ['log', id, 'avance'],
    ['task', id, 'done', '1'],
    ['status', id, 'in-review'],
    ['review', id, 'pass'],
  ]) {
    const result = v181(args, { cwd: root, home });
    assert.equal(result.code, 0, `${args.join(' ')}: ${result.err}`);
  }

  const events = logEvents(stateDocText(root, stateRefTip(root), `changes/${name}`));
  const versions = versionEvents(events);
  assert.deepEqual(
    versions.map(({ previous, version }) => ({ previous, version })),
    [
      { previous: undefined, version: '0.18.0' },
      { previous: '0.18.0', version: '0.18.1' },
    ],
  );
  const step = (event) => `${event.type} ${event.from ?? ''}→${event.to ?? ''}`;
  const position = (predicate) => events.findIndex(predicate);
  const approved = position((e) => e.type === 'status' && e.to === 'approved');
  const started = position((e) => e.type === 'status' && e.to === 'in-progress');
  assert.equal(events.indexOf(versions[0]) < approved, true, step(events[approved]));
  assert.equal(
    events.indexOf(versions[1]),
    started - 1,
    'the update is stamped right before approved → in-progress',
  );
  assert.equal(
    events.slice(started).filter((event) => event.type === 'version').length,
    0,
    'every later event belongs to 0.18.1',
  );
  assert.equal(events.at(-1).type, 'review');
  assert.equal(v181(['check'], { cwd: root, home }).code, 0);
});

test('20261001-155216 CR1: a change created by 0.18.0 starts with exactly its own version', () => {
  const home = cliHome();
  const v18 = installCli('0.18.0');
  const root = cliRepo(v18, home);
  assert.equal(v18(['new', 'feature', 'demo', 'Demo'], { cwd: root, home }).code, 0);
  const text = fs.readFileSync(onlyChangeFile(root), 'utf8');
  const { created } = parseChange(text).frontmatter;
  assert.equal(
    parseChange(text)
      .stages.find((stage) => stage.key === 'log')
      .body.trim(),
    `- **${created}** \`[version]\` 0.18.0`,
  );
});

test('20261001-155216 CR5: a lower installed version, still allowed by min_cli_version, is recorded as a change', () => {
  const home = cliHome();
  const v18 = installCli('0.18.0');
  const v181 = installCli('0.18.1');
  const root = cliRepo(v18, home);
  assert.match(
    fs.readFileSync(path.join(root, '.changeledger', 'config.yml'), 'utf8'),
    /min_cli_version: 0\.18\.0/,
  );
  assert.equal(
    v181(['new', 'feature', 'demo', 'Demo', '--owner', 'ana'], { cwd: root, home }).code,
    0,
  );
  const file = onlyChangeFile(root);
  const id = parseChange(fs.readFileSync(file, 'utf8')).frontmatter.id;

  assert.equal(v18(['log', id, 'nota'], { cwd: root, home }).code, 0);

  const events = logEvents(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(
    events.map(({ type, previous, version, message }) => ({ type, previous, version, message })),
    [
      { type: 'version', previous: undefined, version: '0.18.1', message: undefined },
      { type: 'version', previous: '0.18.1', version: '0.18.0', message: undefined },
      { type: 'note', previous: undefined, version: undefined, message: 'nota' },
    ],
  );
});

// --- usage snapshots (20261001-155612, 20261002-133728) ---
//
// Lifecycle wiring of the usage collector. The in-process cases inject the
// runner and the identity resolver; the group and CLI cases point
// CHANGELEDGER_USAGE_COMMAND at the local fake, so a producer wired by mistake
// would still be observed (and never reach the network). Since
// 20261002-133728 the records live in the ledger: the state ref's `usage/`
// collection when activated, `.changeledger/usage/` otherwise.

const CONFIG_YML_USAGE = '\nusage:\n  collector: ccusage\n';
const FAKE_CCUSAGE = path.resolve('test/fixtures/ccusage/fake-ccusage.mjs');
const FAKE_COMMAND = JSON.stringify([process.execPath, FAKE_CCUSAGE]);
const usageBin = path.resolve('bin/changeledger.mjs');
// Collector options for in-process calls: `recorded_by` resolved without gh.
const usageOptions = (extra = {}) => ({
  warn: () => {},
  ownerHandle: () => 'Test User',
  ...extra,
});

const usageRecords = (cwd, id) => ledgerUsageRecords(cwd, id);

function seedCommit(root) {
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'chore: seed', '--allow-empty']);
}

// Inactive repos of this suite are git repositories, like any repo whose
// collector is switched on in git config. Activation is repo-local git config
// here (`collector: null` leaves it unset); the global and system scopes are
// isolated by helpers/git-env.mjs. With `t`, the repo is removed at the end.
function usageRepo({ activated = false, collector = 'ccusage', configExtra = '', t } = {}) {
  const enable = (root) => {
    if (collector !== null) git(root, ['config', 'changeledger.usage.collector', collector]);
  };
  const cleanup = (root) => t?.after(() => fs.rmSync(root, { recursive: true, force: true }));
  if (activated) {
    const result = activatedRepoWithChange({ configExtra });
    cleanup(result.root);
    enable(result.root);
    seedCommit(result.root);
    return {
      ...result,
      read: () => stateDocText(result.root, stateRefTip(result.root), `changes/${result.name}`),
    };
  }
  const result = repoWithChange({ configExtra });
  cleanup(result.root);
  initGitFixture(result.root);
  enable(result.root);
  seedCommit(result.root);
  return { ...result, read: () => fs.readFileSync(result.file, 'utf8') };
}

// No record anywhere: neither in the ledger (any state ref commit, or the
// worktree collection) nor in the git directory the first collector used.
function assertNoUsage(root) {
  assert.equal(fs.existsSync(gitCommonUsageDir(root)), false);
  assert.equal(fs.existsSync(path.join(root, '.changeledger', 'usage')), false);
  let commits = [];
  try {
    commits = git(root, ['rev-list', STATE_REF]).trim().split('\n').filter(Boolean);
  } catch {
    // no state ref: an inactive repo
  }
  for (const commit of commits) {
    assert.doesNotMatch(git(root, ['ls-tree', '-r', '--name-only', commit]), /usage/);
  }
}

function logLines(text) {
  return parseChange(text)
    .stages.find((s) => s.key === 'log')
    .body.split('\n');
}

const instantOf = (text, transition) =>
  logLines(text)
    .find((l) => l.includes(`\`[status]\` ${transition}`))
    .match(/\*\*(\S+)\*\*/)[1];

function withFakeCcusage(env, fn) {
  const saved = {};
  const vars = { CHANGELEDGER_USAGE_COMMAND: FAKE_COMMAND, ...env };
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function runUsageBin(args, cwd, env = {}) {
  const result = spawnSync(process.execPath, [usageBin, ...args], {
    cwd,
    encoding: 'utf8',
    env: sanitizedEnv({ CHANGELEDGER_NO_GH: '1', ...env }),
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

const commitSubject = (root, commit) => git(root, ['log', '-1', '--format=%s', commit]).trim();

test('20261001-155612 CR1: without the git config value a transition runs no collector', (t) => {
  const { root, id } = usageRepo({ collector: null, t });
  task(id, 'done', 1, '', root);
  approve(id, root);
  const runner = claudeRunner('-unused');
  const result = status(id, 'in-progress', root, { ownerHandle: () => '', usage: { runner } });
  assert.equal(runner.calls.length, 0);
  assert.deepEqual(result.warnings, []);
  assertNoUsage(root);

  // Same through the CLI, with a fake ccusage that would log any call.
  const logFile = path.join(root, '..', `${path.basename(root)}-ccusage.log`);
  t.after(() => fs.rmSync(logFile, { force: true }));
  const other = usageRepo({ collector: null, t });
  task(other.id, 'done', 1, '', other.root);
  approve(other.id, other.root);
  const out = runUsageBin(['status', other.id, 'in-progress'], other.root, {
    CHANGELEDGER_USAGE_COMMAND: FAKE_COMMAND,
    FAKE_CCUSAGE_LOG: logFile,
  });
  assert.equal(out.code, 0, out.err);
  assert.equal(out.out, `#${other.id} → in-progress\n`);
  assert.equal(out.err, '');
  assert.equal(fs.existsSync(logFile), false);
  assertNoUsage(other.root);
});

test('20261001-155612 CR2: a usage key in config.yml does not activate capture', (t) => {
  for (const activated of [false, true]) {
    const { root, id } = usageRepo({
      activated,
      collector: null,
      configExtra: CONFIG_YML_USAGE,
      t,
    });
    task(id, 'done', 1, '', root);
    const runner = claudeRunner(encodeProjectPath(root));
    const warnings = [];
    approve(id, root, { usage: usageOptions({ runner, warn: (l) => warnings.push(l) }) });
    assert.equal(runner.calls.length, 0);
    assert.deepEqual(warnings, []);
    assertNoUsage(root);
  }
});

for (const activated of [false, true]) {
  const layout = activated ? 'activated' : 'inactive';

  test(`20261001-155612 CR3 (${layout}): status leaves one complete record at the [status] instant`, (t) => {
    const { root, id, read } = usageRepo({ activated, t });
    task(id, 'done', 1, '', root);
    // Given an `approved` change: approving it leaves its own record, which is
    // not the one under test (filtered out below by its `to`).
    approve(id, root, { usage: usageOptions({ runner: claudeRunner('-unused') }) });
    const warnings = [];
    const runner = claudeRunner(encodeProjectPath(root));
    status(id, 'in-progress', root, {
      ownerHandle: () => '',
      usage: usageOptions({ runner, warn: (l) => warnings.push(l) }),
    });

    const at = instantOf(read(), 'approved → in-progress');
    const found = usageRecords(root, id).filter((r) => r.to === 'in-progress');
    assert.equal(found.length, 1);
    const [record] = found;
    assert.match(record.name, usageNamePattern(id, at));
    assert.equal(record.at, at);
    assert.equal(record.schema, 1);
    assert.equal(record.change, id);
    assert.equal(record.event, 'status');
    assert.equal(record.from, 'approved');
    assert.deepEqual(record.collector, { name: 'ccusage', version: '20.0.26', pricing: 'online' });
    assert.deepEqual(record.excluded, []);
    assert.equal(record.error, null);
    assert.equal(record.sessions.length, 1);
    assert.equal(record.sessions[0].source, 'claude');
    assert.deepEqual(
      record.sessions[0].models.map((m) => m.model),
      ['claude-opus-5-5', 'claude-sonnet-5-5'],
    );
    assert.deepEqual(warnings, []);
  });

  test(`20261001-155612 (${layout}): the snapshot runs only after the transition is written`, (t) => {
    const { root, id, read } = usageRepo({ activated, t });
    task(id, 'done', 1, '', root);
    const seen = [];
    const inner = claudeRunner(encodeProjectPath(root));
    const runner = (args, options) => {
      seen.push(read().includes('`[status]` draft → approved'));
      return inner(args, options);
    };
    approve(id, root, { usage: usageOptions({ runner }) });
    assert.ok(seen.length > 0);
    assert.ok(seen.every(Boolean), 'ccusage ran before the ledger held the transition');
  });

  test(`20261001-155612 CR4 (${layout}): every transition and creation snapshots; the rest do not`, (t) => {
    const { root, id } = usageRepo({ activated, t });
    withFakeCcusage({ FAKE_CCUSAGE_ROOT: encodeProjectPath(root) }, () => {
      const quiet = { usage: usageOptions() };
      // The sequence of records, each step contributing the one record it left
      // (names carry a random suffix, so the order is observed step by step).
      const sequence = [];
      const expectOne = (label, fn) => {
        const before = new Set(usageRecords(root, id).map((r) => r.name));
        fn();
        const added = usageRecords(root, id).filter((r) => !before.has(r.name));
        assert.equal(added.length, 1, `${label} must leave exactly one record`);
        sequence.push(`${added[0].event}:${added[0].from}→${added[0].to}`);
      };
      const expectNone = (label, fn, subject = id) => {
        const before = usageRecords(root, subject).length;
        fn();
        assert.equal(usageRecords(root, subject).length, before, `${label} must leave no record`);
      };
      const own = { ownerHandle: () => '', ...quiet };

      expectNone('task', () => task(id, 'done', 1, '', root));
      expectOne('approve', () => approve(id, root, quiet));
      expectOne('status', () => status(id, 'in-progress', root, own));
      expectNone('log', () => log(id, 'a note', root));
      expectNone('owner', () => owner(id, 'someone', root));
      expectNone('branch', () => branch(id, 'feature/x', root));
      expectOne('status in-review', () => status(id, 'in-review', root, own));
      expectOne('review fail', () => review(id, 'fail', { reason: 'r' }, root, quiet));
      expectOne('status in-review', () => status(id, 'in-review', root, own));
      expectOne('review pass', () => review(id, 'pass', {}, root, quiet));
      expectOne('status done → in-progress', () =>
        status(id, 'in-progress', root, { ...own, reason: 'again' }),
      );
      expectOne('status in-review', () => status(id, 'in-review', root, own));
      expectOne('review pass', () => review(id, 'pass', {}, root, quiet));
      expectNone('graduate', () => skipGraduation(id, 'nothing durable', root));
      expectNone('archive', () => archive(id, root));

      // A second change carries creation, edit, fix and discard.
      const draft = scaffoldChange(
        { type: 'quick', slug: 'second', title: 'Second', now: '2026-06-14T12:00:00Z' },
        root,
        { ownerHandle: () => '' },
      );
      const draftFile = path.join(root, '..', `${path.basename(root)}-second.md`);
      t.after(() => fs.rmSync(draftFile, { force: true }));
      fs.writeFileSync(draftFile, draft.text);
      newChangeFrom(
        { type: 'quick', slug: 'second', title: 'Second', from: draftFile },
        root,
        quiet,
      );
      const created = usageRecords(root, draft.id);
      assert.equal(created.length, 1);
      assert.equal(created[0].event, 'created');
      assert.equal(created[0].from, null);
      assert.equal(created[0].to, 'draft');
      assert.equal(created[0].at, '2026-06-14T12:00:00Z');

      fs.writeFileSync(draftFile, draft.text.replace('## Request\n', '## Request\n\nEdited.\n'));
      expectNone('edit', () => edit(draft.id, { from: draftFile }, root), draft.id);
      expectNone('fix', () => fix([], root, { log() {}, warn() {}, error() {} }), draft.id);
      const before = usageRecords(root, draft.id).length;
      discard(draft.id, 'not needed', root, quiet);
      assert.equal(usageRecords(root, draft.id).length, before + 1);

      assert.deepEqual(sequence, [
        'status:draft→approved',
        'status:approved→in-progress',
        'status:in-progress→in-review',
        'review:in-review→in-progress',
        'status:in-progress→in-review',
        'review:in-review→done',
        'status:done→in-progress',
        'status:in-progress→in-review',
        'review:in-review→done',
      ]);
    });
  });

  test(`20261001-155612 CR4 (${layout}): \`new\` without --from snapshots its creation`, (t) => {
    if (activated) return; // an activated repo refuses a bare scaffold by design
    const { root } = usageRepo({ activated, t });
    const warnings = [];
    const file = newChange(
      { type: 'quick', slug: 'fresh', title: 'Fresh', now: '2026-06-15T09:30:00Z' },
      root,
      {
        ownerHandle: () => '',
        usage: usageOptions({
          runner: claudeRunner(encodeProjectPath(root)),
          warn: (l) => warnings.push(l),
        }),
      },
    );
    const createdId = parseChange(fs.readFileSync(file, 'utf8')).frontmatter.id;
    const found = usageRecords(root, createdId);
    assert.deepEqual(
      found.map((r) => [r.event, r.from, r.to, r.at]),
      [['created', null, 'draft', '2026-06-15T09:30:00Z']],
    );
    assert.match(found[0].name, usageNamePattern(createdId, '2026-06-15T09:30:00Z'));
    assert.deepEqual(warnings, []);
  });

  test(`20261001-155612 (${layout}): a conflicted write takes no snapshot`, (t) => {
    if (!activated) return; // the CAS conflict only exists on the state ref
    const { root, id } = usageRepo({ activated, t });
    task(id, 'done', 1, '', root);
    approve(id, root, { usage: usageOptions({ runner: claudeRunner('-x') }) });
    const before = usageRecords(root, id).length;
    const runner = claudeRunner(encodeProjectPath(root));
    const racer = () => {
      log(id, 'concurrent note', root);
      return '';
    };
    assert.throws(
      () =>
        status(id, 'in-progress', root, { ownerHandle: racer, usage: usageOptions({ runner }) }),
      (err) => err instanceof LedgerConflictError,
    );
    assert.equal(runner.calls.length, 0);
    assert.equal(usageRecords(root, id).length, before);
  });
}

const CLI_FAILURES = {
  'npx absent': { CHANGELEDGER_USAGE_COMMAND: JSON.stringify(['changeledger-no-such-npx-xyz']) },
  'over 10 s': { FAKE_CCUSAGE_MODE: 'sleep' },
  'non-zero exit': { FAKE_CCUSAGE_MODE: 'fail' },
  'invalid JSON': { FAKE_CCUSAGE_MODE: 'invalid' },
};

for (const [name, env] of Object.entries(CLI_FAILURES)) {
  test(`20261001-155612 CR8: ${name} never blocks \`changeledger status\``, (t) => {
    const { root, id, read } = usageRepo({ t });
    task(id, 'done', 1, '', root);
    const prep = runUsageBin(['approve', id], root, { CHANGELEDGER_USAGE_COMMAND: FAKE_COMMAND });
    assert.equal(prep.code, 0, prep.err);
    const out = runUsageBin(['status', id, 'in-progress'], root, {
      CHANGELEDGER_USAGE_COMMAND: FAKE_COMMAND,
      ...env,
    });
    assert.equal(out.code, 0, out.err);
    assert.equal(out.out, `#${id} → in-progress\n`);
    assert.ok(logLines(read()).some((l) => l.includes('`[status]` approved → in-progress')));
    const [record] = usageRecords(root, id).filter((r) => r.to === 'in-progress');
    assert.deepEqual(record.sessions, []);
    assert.equal(typeof record.error, 'string');
    assert.match(out.err, /^usage: snapshot failed: /m);
  });
}

// 20261001-155612 CR9 kept its records in the git common dir; 20261002-133728
// moved them into the ledger. A linked worktree now writes where its ledger
// lives: the shared state ref when activated, its own worktree otherwise.
test('20261002-133728: a linked worktree records into the ledger it works on', (t) => {
  for (const activated of [false, true]) {
    const { root, id } = usageRepo({ activated, t });
    const worktree = `${root}-wt`;
    t.after(() => fs.rmSync(worktree, { recursive: true, force: true }));
    git(root, ['worktree', 'add', '-q', worktree]);
    const usage = usageOptions({ runner: claudeRunner(encodeProjectPath(root)) });
    task(id, 'done', 1, '', root);
    if (!activated) task(id, 'done', 1, '', worktree);
    approve(id, root, { usage });
    if (activated) status(id, 'in-progress', worktree, { ownerHandle: () => '', usage });
    else approve(id, worktree, { usage });

    assert.equal(fs.existsSync(gitCommonUsageDir(root)), false);
    if (activated) {
      assert.equal(usageRecords(root, id).length, 2);
      assert.equal(usageRecords(worktree, id).length, 2);
    } else {
      assert.equal(usageRecords(root, id).length, 1);
      assert.equal(usageRecords(worktree, id).length, 1);
    }
    const checked = runUsageBin(['check'], root);
    assert.equal(checked.code, 0, checked.err + checked.out);
  }
});

// --- 20261002-133728: records are published into the ledger ---------------

test('20261002-133728 CR1: with the state ref, the snapshot is its own commit that only adds its record', (t) => {
  const { root, id, read } = usageRepo({ activated: true, t });
  task(id, 'done', 1, '', root);
  approve(id, root, { usage: usageOptions({ runner: claudeRunner('-x') }) });
  const before = stateRefTip(root);

  const out = runUsageBin(['status', id, 'in-progress'], root, {
    CHANGELEDGER_USAGE_COMMAND: FAKE_COMMAND,
    FAKE_CCUSAGE_ROOT: encodeProjectPath(root),
  });
  assert.equal(out.code, 0, out.err);
  assert.equal(out.err, '');

  const commits = git(root, ['rev-list', '--reverse', '--first-parent', `${before}..${STATE_REF}`])
    .trim()
    .split('\n');
  assert.equal(commits.length, 2, 'the transition commit, then the usage commit');
  const [transition, published] = commits;
  assert.equal(commitSubject(root, transition), `status: ${id} → in-progress`);
  assert.equal(commitSubject(root, published), `usage: ${id} status`);
  assert.equal(git(root, ['rev-parse', `${published}^`]).trim(), transition);

  const delta = git(root, ['diff-tree', '-r', '--name-status', transition, published])
    .trim()
    .split('\n');
  assert.equal(delta.length, 1, `the usage commit only adds its record:\n${delta.join('\n')}`);
  const [, added] = delta[0].match(/^A\t\.changeledger-state\/usage\/(.+)$/) ?? [];
  const at = instantOf(read(), 'approved → in-progress');
  assert.match(added, usageNamePattern(id, at));

  const record = JSON.parse(git(root, ['show', `${published}:.changeledger-state/usage/${added}`]));
  const { owner: resolvedOwner } = parseChange(read()).frontmatter;
  assert.equal(resolvedOwner, 'Test User', 'the CLI resolved the owner on in-progress');
  assert.equal(record.recorded_by, resolvedOwner);
  assert.equal(record.schema, 1);
  assert.equal(record.change, id);
  assert.equal(record.at, at);
  assert.equal(record.event, 'status');
  assert.equal(record.from, 'approved');
  assert.equal(record.to, 'in-progress');
  assert.deepEqual(record.collector, { name: 'ccusage', version: '20.0.26', pricing: 'online' });
  assert.equal(record.sessions.length, 1);
  assert.equal(record.error, null);
  assert.equal(fs.existsSync(gitCommonUsageDir(root)), false);
  assert.equal(fs.existsSync(path.join(root, '.changeledger', 'usage')), false);
});

test('20261002-133728 CR2: in the worktree layout the record lands in .changeledger/usage', (t) => {
  const { root, id, read } = usageRepo({ t });
  task(id, 'done', 1, '', root);
  approve(id, root, { usage: usageOptions({ runner: claudeRunner('-x') }) });

  const out = runUsageBin(['status', id, 'in-progress'], root, {
    CHANGELEDGER_USAGE_COMMAND: FAKE_COMMAND,
    FAKE_CCUSAGE_ROOT: encodeProjectPath(root),
  });
  assert.equal(out.code, 0, out.err);
  const at = instantOf(read(), 'approved → in-progress');
  const [record] = usageRecords(root, id).filter((r) => r.to === 'in-progress');
  assert.match(record.name, usageNamePattern(id, at));
  assert.equal(record.sessions.length, 1);
  assert.equal(out.err, '');
  assert.equal(record.recorded_by, parseChange(read()).frontmatter.owner);
  assert.equal(fs.existsSync(gitCommonUsageDir(root)), false);

  // ...and travels with the commit of its change.
  const committed = runUsageBin(['commit', '-m', 'feat(x): y', '--id', id], root);
  assert.equal(committed.code, 0, committed.err);
  const paths = git(root, ['show', '--name-only', '--format=', 'HEAD']);
  assert.ok(
    paths.split('\n').includes(`.changeledger/usage/${record.name}`),
    `the commit must carry the record:\n${paths}`,
  );
});

// A directory that is a symlink to a real one, made by the test itself so the
// shape does not depend on os.tmpdir(): `<base>/link` -> `<base>/real`, with
// `base` already in native realpath form.
function symlinkedDir(t) {
  const base = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-symlink-')),
  );
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const real = path.join(base, 'real');
  const link = path.join(base, 'link');
  fs.mkdirSync(real);
  fs.symlinkSync(real, link, 'dir');
  return { real, link };
}

test('20261012-213243 CR1: repoWithChange is born in native realpath when the temp dir is a symlink', {
  skip: process.platform === 'win32' && 'os.tmpdir() ignores TMPDIR on win32',
}, (t) => {
  const { real, link } = symlinkedDir(t);
  const saved = process.env.TMPDIR;
  process.env.TMPDIR = link;
  let root;
  try {
    assert.equal(os.tmpdir(), link, 'the fixture temp dir is the symlink');
    ({ root } = repoWithChange());
  } finally {
    if (saved === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = saved;
  }
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(root, fs.realpathSync.native(root));
  assert.ok(root.startsWith(`${real}${path.sep}`), `${root} should live under ${real}`);
});

test('20261012-213243 CR4: a repo reached through a symlink records usage for the session getcwd announces', {
  skip: process.platform === 'win32' && 'symlinks may need privileges on win32',
}, (t) => {
  const { real, link } = symlinkedDir(t);
  const logical = path.join(link, 'demo');
  const physical = path.join(real, 'demo');
  fs.mkdirSync(physical);
  assert.notEqual(logical, fs.realpathSync.native(logical), 'demo is reached through the symlink');
  assert.equal(fs.realpathSync.native(logical), physical);
  fs.writeFileSync(path.join(physical, 'AGENTS.md'), '# rules\n');
  initializeRepo(logical);
  initGitFixture(logical);
  git(logical, ['config', 'changeledger.usage.collector', 'ccusage']);
  seedCommit(logical);
  const env = {
    CHANGELEDGER_USAGE_COMMAND: FAKE_COMMAND,
    FAKE_CCUSAGE_ROOT: encodeProjectPath(physical),
  };

  const created = runUsageBin(
    ['new', 'quick', 'second-step', 'Segundo paso', '--owner', 't'],
    logical,
    env,
  );
  assert.equal(created.code, 0, created.err);
  const [, id] = created.out.match(/changes\/(\d{8}-\d{6})-second-step\.md/) ?? [];
  assert.ok(id, `the new change id in:\n${created.out}`);
  const file = path.join(logical, '.changeledger', 'changes', `${id}-second-step.md`);
  fs.writeFileSync(
    file,
    fs.readFileSync(file, 'utf8').replace('## Request\n', '## Request\n\nSegundo paso.\n'),
  );

  const approved = runUsageBin(['approve', id], logical, env);
  git(logical, ['checkout', '-q', '-b', `quick/${id}`]);
  const started = runUsageBin(['status', id, 'in-progress'], logical, env);
  for (const out of [created, approved, started]) {
    assert.equal(out.code, 0, out.err);
    assert.doesNotMatch(out.err, /^usage:/m);
  }
  assert.match(approved.out, new RegExp(`#${id} → approved \\(human via conversation\\)`));
  assert.match(started.out, new RegExp(`#${id} → in-progress`));
  assert.equal(approved.err, '');
  assert.equal(started.err, '');

  const records = usageRecords(logical, id);
  // Compared as a set: records written within one second share their instant,
  // so the file-name order need not be the order of the transitions.
  assert.deepEqual(records.map((r) => `${r.event} ${r.from} -> ${r.to}`).sort(), [
    'created null -> draft',
    'status approved -> in-progress',
    'status draft -> approved',
  ]);
  for (const record of records) {
    assert.equal(record.sessions.length, 1);
    assert.equal(record.error, null);
  }
});

// Another writer moves the state ref right before the collector's CAS
// `update-ref`, `races` times at most: the injected `stateRun` is the
// collector's own git seam for the state store, so the transition itself
// is untouched by it.
function racingStateRun(races) {
  const attempts = { count: 0 };
  const run = (args, cwd, options) => {
    if (args[0] === 'update-ref' && args[1] === STATE_REF) {
      attempts.count += 1;
      if (attempts.count <= races) {
        const tip = capturedRun(['rev-parse', STATE_REF], cwd).trim();
        mutateState(
          cwd,
          { expectedRevision: tip, message: `usage: other writer ${attempts.count}` },
          (stage) =>
            stage.write(
              `usage/20260101-000000--20260101T000000Z-0000000${attempts.count}.json`,
              usageRecordText('20260101-000000', '2026-01-01T00:00:00Z'),
            ),
        );
      }
    }
    return capturedRun(args, cwd, options);
  };
  return { run, attempts };
}

test('20261002-133728 CR7: a ref that keeps moving never blocks the transition', (t) => {
  const { root, id, read } = usageRepo({ activated: true, t });
  task(id, 'done', 1, '', root);
  approve(id, root, { usage: usageOptions({ runner: claudeRunner('-x') }) });
  const { run, attempts } = racingStateRun(Number.POSITIVE_INFINITY);
  const warnings = [];

  status(id, 'in-progress', root, {
    ownerHandle: () => '',
    usage: usageOptions({
      runner: claudeRunner(encodeProjectPath(root)),
      warn: (l) => warnings.push(l),
      stateRun: run,
    }),
  });

  assert.equal(attempts.count, 2, 'one attempt and exactly one retry');
  assert.ok(logLines(read()).some((l) => l.includes('`[status]` approved → in-progress')));
  const lines = warnings.filter((l) => l.startsWith('usage: record not published: '));
  assert.equal(lines.length, 1, warnings.join('\n'));
  assert.deepEqual(
    usageRecords(root, id).filter((r) => r.to === 'in-progress'),
    [],
  );
  assert.equal(fs.existsSync(gitCommonUsageDir(root)), false);
  assert.equal(fs.existsSync(path.join(root, '.changeledger', 'usage')), false);
});

test('20261002-133728 CR7: one move of the ref is absorbed by the single retry', (t) => {
  const { root, id } = usageRepo({ activated: true, t });
  task(id, 'done', 1, '', root);
  approve(id, root, { usage: usageOptions({ runner: claudeRunner('-x') }) });
  const { run, attempts } = racingStateRun(1);
  const warnings = [];

  status(id, 'in-progress', root, {
    ownerHandle: () => '',
    usage: usageOptions({
      runner: claudeRunner(encodeProjectPath(root)),
      warn: (l) => warnings.push(l),
      stateRun: run,
    }),
  });

  assert.equal(attempts.count, 2);
  assert.deepEqual(warnings, []);
  assert.equal(usageRecords(root, id).filter((r) => r.to === 'in-progress').length, 1);
  assert.equal(commitSubject(root, STATE_REF), `usage: ${id} status`);
});

test('20261002-133728 CR8: without the collector a transition adds no commit, folder or output', (t) => {
  for (const activated of [false, true]) {
    const { root, id } = usageRepo({ activated, collector: null, t });
    task(id, 'done', 1, '', root);
    approve(id, root);
    const before = activated ? stateRefTip(root) : null;
    const out = runUsageBin(['status', id, 'in-progress'], root, {
      CHANGELEDGER_USAGE_COMMAND: FAKE_COMMAND,
    });
    assert.equal(out.code, 0, out.err);
    assert.equal(out.out, `#${id} → in-progress\n`);
    assert.equal(out.err, '');
    if (activated) {
      assert.equal(
        git(root, ['rev-list', '--count', `${before}..${STATE_REF}`]).trim(),
        '1',
        'only the transition commit',
      );
    }
    assertNoUsage(root);
  }
});

// 20261018-131621 — `in-validation` is retired: delivery is `done` and the only
// failure route out of review is back to `in-progress`, with no class flag.

test('20261018-131621 CR4: review pass delivers straight to done', () => {
  const { root, file, id } = repoWithChange();
  task(id, 'done', 1, '', root);
  reach(id, root, 'in-review');
  review(id, 'pass', {}, root);
  const c = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(c.frontmatter.status, 'done');
  assert.match(c.stages.find((s) => s.key === 'log').body, /`\[review\]` in-review → done/);
});

test('20261018-131621 CR5: review fail returns to in-progress without a class flag', () => {
  const { root, file, id } = repoWithChange();
  reach(id, root, 'in-review');
  review(id, 'fail', { reason: 'motivo' }, root);
  const c = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(c.frontmatter.status, 'in-progress');
  assert.match(
    c.stages.find((s) => s.key === 'log').body,
    /`\[review\]` in-review → in-progress: motivo/,
  );
});

// --- 20261020-172221 CR6: an epic delivers when its children do ----------
//
// Without this an epic is a label: it can be closed while the work it names is
// still open, and nothing says so. `discarded` counts as resolved — a recorded
// decision, not unfinished work.

function epicWithChild(childStatus) {
  const fixture = repoWithChange();
  const dir = path.join(fixture.root, '.changeledger', 'changes');
  const epicId = '20260613-110000';
  fs.writeFileSync(
    path.join(dir, `${epicId}-epic.md`),
    `---\nid: "${epicId}"\ntitle: Épica\ntype: epic\nstatus: in-progress\ncreated: 2026-06-13T11:00:00Z\ndepends_on: []\n---\n\n## Request\n\nObjetivo.\n\n## Proposal\n\nFrontera.\n\n## Log\n\n- **2026-06-13T11:00:00Z** \`[status]\` draft → approved\n- **2026-06-13T11:05:00Z** \`[status]\` approved → in-progress\n`,
  );
  fs.writeFileSync(
    path.join(dir, '20260613-130000-child.md'),
    `---\nid: "20260613-130000"\ntitle: Hijo\ntype: quick\nstatus: ${childStatus}\ncreated: 2026-06-13T13:00:00Z\ndepends_on: []\nparent: "${epicId}"\n---\n\n## Request\n\nAlgo.\n\n## Log\n\n- **2026-06-13T13:00:00Z** \`[note]\` created\n`,
  );
  return { ...fixture, epicId };
}

test('20261020-172221 CR6: an epic with a live child cannot close, and the refusal names it', () => {
  const { root, epicId } = epicWithChild('in-progress');
  assert.throws(
    () => status(epicId, 'done', root),
    (error) => {
      assert.match(error.message, /still has unresolved children/);
      assert.match(error.message, /20260613-130000 \(in-progress\)/);
      return true;
    },
  );
  const text = fs.readFileSync(
    path.join(root, '.changeledger', 'changes', `${epicId}-epic.md`),
    'utf8',
  );
  assert.match(text, /status: in-progress/, 'a refused transition leaves the document untouched');
});

for (const resolved of ['done', 'discarded']) {
  test(`20261020-172221 CR6: a ${resolved} child does not hold its epic open`, () => {
    const { root, epicId } = epicWithChild(resolved);
    assert.doesNotThrow(() => status(epicId, 'done', root));
  });
}

// `done` has two write seats and the guard was wired into one. `review pass`
// is the only route for a review_required type, and nothing restricts `parent`
// to the `epic` type — `--parent` and `check` both accept any id — so a
// `documentation` parent walked in-review → done with a `draft` child. The
// scoped validation that seat already runs cannot stand in for the guard: it
// judges a one-change repo, where no child is visible (20261020-172221 D1).
function reviewableParentWithChild(childStatus) {
  const fixture = repoWithChange();
  const dir = path.join(fixture.root, '.changeledger', 'changes');
  const parentId = '20260613-110000';
  fs.writeFileSync(
    path.join(dir, `${parentId}-parent.md`),
    `---\nid: "${parentId}"\ntitle: Padre\ntype: documentation\nstatus: in-review\ncreated: 2026-06-13T11:00:00Z\ndepends_on: []\n---\n\n## Request\n\nObjetivo.\n\n## Investigation\n\nIndagado.\n\n## Specification\n\n- [x] CR1 Given algo When algo Then algo\n\n## Log\n\n- **2026-06-13T11:00:00Z** \`[status]\` draft → approved\n- **2026-06-13T11:05:00Z** \`[status]\` approved → in-progress\n- **2026-06-13T11:10:00Z** \`[status]\` in-progress → in-review\n`,
  );
  fs.writeFileSync(
    path.join(dir, '20260613-130000-child.md'),
    `---\nid: "20260613-130000"\ntitle: Hijo\ntype: quick\nstatus: ${childStatus}\ncreated: 2026-06-13T13:00:00Z\ndepends_on: []\nparent: "${parentId}"\n---\n\n## Request\n\nAlgo.\n\n## Log\n\n- **2026-06-13T13:00:00Z** \`[note]\` created\n`,
  );
  return { ...fixture, parentId };
}

test('20261020-172221 CR6: review pass does not deliver a parent with a live child', () => {
  const { root, parentId } = reviewableParentWithChild('in-progress');
  assert.throws(
    () => review(parentId, 'pass', {}, root),
    (error) => {
      assert.match(error.message, /still has unresolved children/);
      assert.match(error.message, /20260613-130000 \(in-progress\)/);
      return true;
    },
  );
  const text = fs.readFileSync(
    path.join(root, '.changeledger', 'changes', `${parentId}-parent.md`),
    'utf8',
  );
  assert.match(text, /status: in-review/, 'a refused verdict leaves the document untouched');
});

test('20261020-172221 CR6: review pass delivers a parent whose children are resolved', () => {
  const { root, parentId } = reviewableParentWithChild('done');
  assert.doesNotThrow(() => review(parentId, 'pass', {}, root));
});

// The refusal names the subject by id. `epic` is a template type a repo may
// rename or never adopt, and the guard fires on any change with children.
test('20261020-172221 CR6: the refusal does not call a non-epic parent an epic', () => {
  const { root, parentId } = reviewableParentWithChild('in-progress');
  assert.throws(
    () => review(parentId, 'pass', {}, root),
    (error) => {
      assert.doesNotMatch(error.message, /\bepic\b/);
      return true;
    },
  );
});

// --- 20261020-172221 CR7: the epic is visible from the CLI --------------
//
// The edge only points upward — a child names its epic, the epic's own
// document says nothing — which is what keeps it exclusive. So the grouping
// has to be derived at read time, and these are the three seats that do it.

function patchChange(root, id, transform) {
  const dir = path.join(root, '.changeledger', 'changes');
  for (const name of fs.readdirSync(dir)) {
    if (!name.startsWith(id)) continue;
    const file = path.join(dir, name);
    fs.writeFileSync(file, transform(fs.readFileSync(file, 'utf8')));
  }
}

function epicWithChildren() {
  const fixture = repoWithChange();
  const epicId = '20260613-110000';
  const dir = path.join(fixture.root, '.changeledger', 'changes');
  fs.writeFileSync(
    path.join(dir, `${epicId}-epic.md`),
    `---\nid: "${epicId}"\ntitle: Épica\ntype: epic\nstatus: draft\ncreated: 2026-06-13T11:00:00Z\ndepends_on: []\n---\n\n## Request\n\nObjetivo.\n\n## Proposal\n\nFrontera.\n\n## Log\n`,
  );
  for (const [id, title] of [
    ['20260613-140000', 'Hijo uno'],
    ['20260613-150000', 'Hijo dos'],
  ]) {
    fs.writeFileSync(
      path.join(dir, `${id}-child.md`),
      `---\nid: "${id}"\ntitle: ${title}\ntype: quick\nstatus: draft\ncreated: 2026-06-13T14:00:00Z\ndepends_on: []\nparent: "${epicId}"\n---\n\n## Request\n\nAlgo.\n\n## Log\n`,
    );
  }
  return { ...fixture, epicId };
}

test('20261020-172221 CR7: list --parent returns exactly the children of that epic', () => {
  const { root, epicId, id: unrelated } = epicWithChildren();
  const ids = list({ parent: epicId }, root).map((c) => c.id);
  assert.deepEqual(ids, ['20260613-140000', '20260613-150000']);
  assert.ok(!ids.includes(unrelated), 'an unrelated change must not appear');
  assert.ok(!ids.includes(epicId), 'the epic is not its own child');
  // An epic with no children answers empty, never "everything".
  assert.deepEqual(list({ parent: '20260613-990000' }, root), []);
});

test('20261020-172221 CR7: show names the children and the parent, each with its status', () => {
  const { root, epicId } = epicWithChildren();
  const parentView = show(epicId, root);
  assert.deepEqual(
    parentView.children.map((c) => [c.id, c.status, c.title]),
    [
      ['20260613-140000', 'draft', 'Hijo uno'],
      ['20260613-150000', 'draft', 'Hijo dos'],
    ],
  );
  const childView = show('20260613-140000', root);
  assert.equal(childView.frontmatter.parent, epicId);
  assert.deepEqual(childView.children, [], 'a child of a two-level hierarchy has none of its own');
});

// `--print` is a SEPARATE seat (`scaffoldChange`) and it is the mandatory one
// in an activated repo, where `new` refuses to write. The first cut of this
// change dropped `parent` there and only an unrelated ReferenceError exposed
// it; a silent drop would have been invisible to the whole suite.
test('20261020-172221 CR7: the --print scaffold carries the parent too', () => {
  const { root, epicId } = epicWithChildren();
  const scaffold = scaffoldChange(
    {
      type: 'quick',
      slug: 'impreso',
      title: 'Hijo impreso',
      parent: epicId,
      now: '2026-06-13T17:00:00Z',
    },
    root,
    { ownerHandle: () => '' },
  );
  assert.match(scaffold.text, new RegExp(`^parent: "${epicId}"$`, 'm'));
});

test('20261020-172221 CR7: new --parent writes the field into the scaffold', () => {
  const { root, epicId } = epicWithChildren();
  const created = newChange(
    {
      type: 'quick',
      slug: 'nuevo',
      title: 'Nuevo hijo',
      parent: epicId,
      now: '2026-06-13T16:00:00Z',
    },
    root,
    { ownerHandle: () => '' },
  );
  const text = fs.readFileSync(created, 'utf8');
  assert.match(text, new RegExp(`^parent: "${epicId}"$`, 'm'));
  assert.equal(list({ parent: epicId }, root).length, 3);
});

// Two creation seats, one rule. The first fix here restated the parent rules
// instead of running the gate `--from` runs, and promptly diverged again on
// the clause it had not restated: a third level landed through the scaffold
// and `check` turned the repo red (20261020-172221 D4, then D1 of the next
// round). So this asserts EQUIVALENCE, not messages — any rule either seat
// gains or loses shows up here, including rules nobody has written yet.
test('20261020-172221 CR7: the two creation seats accept and refuse the same documents', () => {
  const outcome = (fn) => {
    try {
      fn();
      return 'accept';
    } catch {
      return 'refuse';
    }
  };

  const cases = {
    missing: () => '20200101-000000',
    live: (_root, epicId) => epicId,
    closed: (root, epicId) => {
      patchChange(root, epicId, (text) => text.replace('status: draft', 'status: done'));
      return epicId;
    },
    'closed and archived': (root, epicId) => {
      patchChange(root, epicId, (text) =>
        text
          .replace('status: draft', 'status: done')
          .replace('depends_on: []', 'depends_on: []\narchived: true'),
      );
      return epicId;
    },
    'third level': () => '20260613-140000',
  };

  for (const [label, prepare] of Object.entries(cases)) {
    const scaffoldFixture = epicWithChildren();
    const parent = prepare(scaffoldFixture.root, scaffoldFixture.epicId);
    const args = {
      type: 'quick',
      slug: 'candidato',
      title: 'Candidato',
      parent,
      now: '2026-06-13T18:00:00Z',
    };
    const viaScaffold = outcome(() =>
      newChange(args, scaffoldFixture.root, { ownerHandle: () => '' }),
    );

    const documentFixture = epicWithChildren();
    prepare(documentFixture.root, documentFixture.epicId);
    const printed = scaffoldChange(args, documentFixture.root, { ownerHandle: () => '' });
    const source = path.join(documentFixture.root, 'candidato.md');
    fs.writeFileSync(source, printed.text);
    const viaDocument = outcome(() =>
      newChangeFrom(
        { type: 'quick', slug: 'candidato', title: 'Candidato', from: source },
        documentFixture.root,
      ),
    );

    assert.equal(
      viaScaffold,
      viaDocument,
      `the seats disagree on a ${label} parent: scaffold ${viaScaffold}, document ${viaDocument}`,
    );
    if (viaScaffold === 'refuse') {
      assert.ok(
        !fs
          .readdirSync(path.join(scaffoldFixture.root, '.changeledger', 'changes'))
          .some((n) => n.includes('candidato')),
        'a refused creation writes nothing',
      );
    }
  }
});

// The gate diffs against the repo's OWN current errors, so an unrelated break
// elsewhere never blocks a clean scaffold. Without that diff `new` would stop
// working repo-wide the moment any document went red.
test('20261020-172221 CR7: a pre-existing error elsewhere does not block a clean scaffold', () => {
  const { root, epicId } = epicWithChildren();
  fs.writeFileSync(
    path.join(root, '.changeledger', 'changes', '20260613-160000-roto.md'),
    `---\nid: "20260613-160000"\ntitle: Roto\ntype: quick\nstatus: draft\ncreated: 2026-06-13T16:00:00Z\ndepends_on: []\nparent: "no-es-un-id"\n---\n\n## Request\n\nAlgo.\n\n## Log\n`,
  );
  assert.ok(checkRepo(loadRepo(root)).errors.length > 0, 'the fixture must start from a red repo');
  assert.doesNotThrow(() =>
    newChange(
      {
        type: 'quick',
        slug: 'limpio',
        title: 'Limpio',
        parent: epicId,
        now: '2026-06-13T20:00:00Z',
      },
      root,
      { ownerHandle: () => '' },
    ),
  );
});

// The matrix above only proves the seats agree; these pin WHAT they agree on,
// so a regression that relaxes both at once is still caught.
test('20261020-172221 CR7: neither seat creates a child of a missing, closed or second-level parent', () => {
  const { root, epicId } = epicWithChildren();
  patchChange(root, epicId, (text) => text.replace('status: draft', 'status: done'));
  for (const [label, parent] of [
    ['missing', '20200101-000000'],
    ['closed', epicId],
    ['second level', '20260613-140000'],
  ]) {
    assert.throws(
      () =>
        newChange(
          { type: 'quick', slug: 'x', title: 'X', parent, now: '2026-06-13T18:00:00Z' },
          root,
          { ownerHandle: () => '' },
        ),
      /nothing was written/,
      `a ${label} parent must be refused`,
    );
  }
});

// Archiving hides a document; it does not resolve the work, so an archived
// child still holds its parent open. `list --parent` hides it by default, so
// the refusal has to say where to find it (20261020-172221 D3).
// Three reading seats, one answer: `list --parent` hides an archived child,
// `childrenOpenError` names it as hidden, and `show` used to list it with no
// marker at all (20261020-172221 D3b).
test('20261020-172221 CR7: show marks a child that `list --parent` hides', () => {
  const { root, epicId } = epicWithChildren();
  patchChange(root, '20260613-140000', (text) =>
    text.replace('depends_on: []', 'depends_on: []\narchived: true'),
  );
  const children = show(epicId, root).children;
  const archived = children.find((c) => String(c.id) === '20260613-140000');
  const plain = children.find((c) => String(c.id) === '20260613-150000');
  assert.equal(archived.archived, true, 'the hidden child is marked');
  assert.equal(plain.archived, false, 'the listed one is not');
});

// `epic` is a template type a repo may rename or never adopt, and `parent`
// accepts any id, so a refusal that asserts the type lies about the document
// it names. The CR6 seat was taught this; the CR5 seat was not (D4 of round 5).
test('20261020-172221 CR5: the graduation refusal does not call a non-epic parent an epic', () => {
  const { root } = epicWithChildren();
  patchChange(root, '20260613-140000', (text) => text.replace('status: draft', 'status: done'));
  assert.throws(
    () => scaffoldSpec('20260613-140000', 'alguna', root),
    (error) => {
      assert.match(error.message, /belongs to 20260613-110000/);
      assert.doesNotMatch(error.message, /\bepic\b/);
      return true;
    },
  );
});

test('20261020-172221 CR6/CR7: the refusal says an unresolved child is archived', () => {
  const { root, epicId } = epicWithChildren();
  const dir = path.join(root, '.changeledger', 'changes');
  const child = fs.readdirSync(dir).find((n) => n.startsWith('20260613-140000'));
  const file = path.join(dir, child);
  fs.writeFileSync(
    file,
    fs.readFileSync(file, 'utf8').replace('depends_on: []', 'depends_on: []\narchived: true'),
  );
  const other = fs.readdirSync(dir).find((n) => n.startsWith('20260613-150000'));
  fs.writeFileSync(
    path.join(dir, other),
    fs.readFileSync(path.join(dir, other), 'utf8').replace('status: draft', 'status: done'),
  );

  const listed = list({ parent: epicId }, root).map((c) => String(c.id));
  assert.ok(
    !listed.includes('20260613-140000'),
    'the child that holds the epic open is hidden from `list --parent` by default',
  );
  assert.throws(
    () => status(epicId, 'done', root),
    (error) => {
      assert.match(error.message, /20260613-140000 \(draft, archived: `list --parent --all`\)/);
      return true;
    },
  );
});

// The short cycle is a CLAIM about configuration until something walks it.
// `test/config.test.mjs` pins the type's YAML; this executes the lifecycle it
// is supposed to produce, which is what CR4's second and third clauses say.
test('20261020-172221 CR4: an epic walks draft → approved → in-progress → done with no review and no criteria', () => {
  const { root } = repoWithChange();
  const file = newChange(
    { type: 'epic', slug: 'epica', title: 'Épica', now: '2026-06-13T11:00:00Z' },
    root,
    { ownerHandle: () => '' },
  );
  const id = parseChange(fs.readFileSync(file, 'utf8')).frontmatter.id;
  fs.writeFileSync(
    file,
    fs
      .readFileSync(file, 'utf8')
      .replace('## Request\n', '## Request\n\nObjetivo.\n')
      .replace('## Proposal\n', '## Proposal\n\nFrontera.\n'),
  );

  approve(id, root);
  status(id, 'in-progress', root);
  // Straight to done: the delivery gate that would demand a review verdict is
  // keyed on `review_required`, which this type does not declare.
  status(id, 'done', root);
  assert.equal(parseChange(fs.readFileSync(file, 'utf8')).frontmatter.status, 'done');

  // No Specification stage, so nothing demands criteria coverage or readiness.
  const { errors, warnings } = checkRepo(loadRepo(root));
  const own = [...errors, ...warnings].filter((e) => e.file.startsWith(id));
  assert.deepEqual(own, [], `an epic must raise nothing of its own: ${JSON.stringify(own)}`);
});

// --- 20261020-172221 CR8: archiving deletes its own merged branch --------
//
// This reaches about 5% of the dead branches in the consuming repos — the rest
// were never created by ChangeLedger and the repository's own
// `delete_branch_on_merge` is what reaches those. It exists so the tool stops
// adding to that pile. The safety is the merge proof, not the flag: every
// commit is already reachable from the integration branch, so dropping the ref
// loses nothing.

function archivableOnBranch({ merged, status = 'done' }) {
  const fixture = repoWithChange();
  const { root, id } = fixture;
  configureChangeBranches(root, { integration: 'dev', format: '"{type}/{id}"' });
  git(root, ['init', '-q', '-b', 'dev']);
  git(root, ['config', 'user.email', 't@e.com']);
  git(root, ['config', 'user.name', 'T']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'seed']);
  const branch = `feature/${id}`;
  git(root, ['checkout', '-q', '-b', branch, 'dev']);
  fs.writeFileSync(path.join(root, 'work.txt'), 'work\n');
  git(root, ['add', 'work.txt']);
  git(root, ['commit', '-qm', 'work']);
  git(root, ['checkout', '-q', 'dev']);
  if (merged) git(root, ['merge', '--no-ff', '-q', '-m', 'merge', branch]);
  // The branch event is what `recordedBranch` reads; the change's own Log is
  // the record, never the current checkout.
  const file = path.join(root, '.changeledger', 'changes', `${id}-x.md`);
  fs.appendFileSync(file, `- **2026-06-13T12:30:00Z** \`[branch]\` set: ${branch} (auto)\n`);
  // Only a terminal change has stopped needing its branch, so every fixture
  // here is one unless it is testing that gate (20261020-172221 D4).
  fs.writeFileSync(
    file,
    fs.readFileSync(file, 'utf8').replace(/^status: .*$/m, `status: ${status}`),
  );
  const branches = () =>
    git(root, ['branch', '--format=%(refname:short)']).split('\n').filter(Boolean);
  return { root, id, branch, branches };
}

test('20261020-172221 CR8: a merged branch is deleted and the result says so', () => {
  const { root, id, branch, branches } = archivableOnBranch({ merged: true });
  const result = archive(id, root);
  assert.equal(result.branchOutcome, null, 'a merged branch must be deleted');
  assert.equal(result.branch, branch);
  assert.ok(!branches().includes(branch), `branch survived: ${branches().join(', ')}`);
});

test('20261020-172221 CR8: an unmerged branch survives and the result explains why', () => {
  const { root, id, branch, branches } = archivableOnBranch({ merged: false });
  const result = archive(id, root);
  assert.match(result.branchOutcome, /is not merged into "dev"/);
  assert.ok(branches().includes(branch), 'an unmerged branch must never be deleted');
});

// The merge proof alone does NOT identify the change's own branch:
// `isAncestor(dev, dev)` is trivially true, and `changeledger branch <id> dev`
// is accepted — the drift warning itself suggests it when the checkout has
// moved. Without these two guards `archive` deleted the shared integration
// branch, reproduced end to end in both layouts.
test('20261020-172221 CR8: the integration branch is never deleted', () => {
  const { root, id, branches } = archivableOnBranch({ merged: true });
  const file = path.join(root, '.changeledger', 'changes', `${id}-x.md`);
  fs.appendFileSync(file, '- **2026-06-13T12:40:00Z** `[branch]` set: dev (auto)\n');
  git(root, ['checkout', '-q', `feature/${id}`]);
  const result = archive(id, root);
  assert.match(result.branchOutcome, /is the integration branch/);
  assert.ok(branches().includes('dev'), 'the integration branch must survive');
});

test('20261020-172221 CR8: only the branch this change declares is deleted', () => {
  const { root, id, branches } = archivableOnBranch({ merged: true });
  git(root, ['branch', 'someone-elses']);
  const file = path.join(root, '.changeledger', 'changes', `${id}-x.md`);
  fs.appendFileSync(file, '- **2026-06-13T12:40:00Z** `[branch]` set: someone-elses (auto)\n');
  const result = archive(id, root);
  assert.match(result.branchOutcome, /is not the branch this change declares/);
  assert.ok(branches().includes('someone-elses'));
});

test('20261020-172221 CR8: the branch of the current checkout is never deleted', () => {
  const { root, id, branch, branches } = archivableOnBranch({ merged: true });
  git(root, ['checkout', '-q', branch]);
  const result = archive(id, root);
  assert.match(result.branchOutcome, /is the current checkout/);
  assert.ok(branches().includes(branch));
});

// `archive` had no config dependency before this change. A type whose
// `integrates_into` names a retired `git.release_branch` makes the lookup
// throw, and that must never cost an archive that has already landed:
// terminal changes are history (20261012-174310).
test('20261020-172221 CR8: an unresolvable integration branch never costs the archive', () => {
  const { root, id } = archivableOnBranch({ merged: true });
  const file = path.join(root, '.changeledger', 'changes', `${id}-x.md`);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('type: feature', 'type: hotfix'));
  const result = archive(id, root);
  assert.match(result.branchOutcome, /could not be resolved/);
  assert.match(fs.readFileSync(file, 'utf8'), /archived: true/, 'the archive still landed');
});

// `archived` hides a document in the viewer and says nothing about the work
// being over. A live change still owns its branch, and the merge proof says
// nothing here: a branch forked from the integration branch with no commits of
// its own is trivially an ancestor of it, so the proof passes on exactly the
// branch that is still being used (20261020-172221 D4).
for (const status of ['draft', 'approved', 'in-progress', 'in-review']) {
  test(`20261020-172221 CR8: archiving a ${status} change keeps its branch`, () => {
    const { root, id, branch, branches } = archivableOnBranch({ merged: true, status });
    const result = archive(id, root);
    assert.match(result.branchOutcome, new RegExp(`is ${status}, not done or discarded`));
    assert.ok(branches().includes(branch), 'the branch of a live change survives');
  });
}

test('20261020-172221 CR8: a discarded change releases its branch like a done one', () => {
  const { root, id, branch, branches } = archivableOnBranch({ merged: true, status: 'discarded' });
  assert.equal(archive(id, root).branchOutcome, null);
  assert.ok(!branches().includes(branch));
});

test('20261020-172221 CR8: --keep-branch keeps a merged branch', () => {
  const { root, id, branch, branches } = archivableOnBranch({ merged: true });
  const result = archive(id, root, { keepBranch: true });
  assert.match(result.branchOutcome, /kept on request/);
  assert.ok(branches().includes(branch));
});

test('20261020-172221 CR8: no remote reference is touched, and the archive still lands', () => {
  const { root, id } = archivableOnBranch({ merged: true });
  const argv = [];
  archive(id, root, {
    gitRun: (args, cwd) => {
      argv.push(args);
      return git(cwd, args);
    },
  });
  assert.ok(
    !argv.some(
      (a) => a.includes('push') || a.some((token) => String(token).startsWith('refs/remotes')),
    ),
    `a remote was touched: ${JSON.stringify(argv)}`,
  );
  const text = fs.readFileSync(path.join(root, '.changeledger', 'changes', `${id}-x.md`), 'utf8');
  assert.match(text, /archived: true/, 'the archive is the point of the command');
});
