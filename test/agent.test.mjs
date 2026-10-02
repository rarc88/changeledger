import assert from 'node:assert/strict';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { parseChange } from '../src/change.mjs';
import { writeLedgerFiles } from '../src/change-store.mjs';
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
  reopen,
  review,
  show,
  status,
  task,
  validation,
} from '../src/commands/agent.mjs';
import { edit } from '../src/commands/edit.mjs';
import { fix } from '../src/commands/fix.mjs';
import { skipGraduation } from '../src/commands/graduate.mjs';
import { init as initializeRepo } from '../src/commands/init.mjs';
import { newChange, newChangeFrom, scaffoldChange } from '../src/commands/new.mjs';
import { VERSION } from '../src/framing.mjs';
import { capturedRun } from '../src/git.mjs';
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-agent-'));
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
    ['validation', ({ id, root }) => validation(id, 'pass', {}, root)],
    ['reopen', ({ id, root }) => reopen(id, 'reason', root)],
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
  assert.throws(() => status(id, 'done', root), /use human validation in the viewer/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('task done marks the task with a timestamp', () => {
  const { root, file, id } = repoWithChange();
  task(id, 'done', 1, '', root);
  const t = parseChange(fs.readFileSync(file, 'utf8')).tasks[0];
  assert.equal(t.state, 'done');
  assert.match(t.resolvedAt, /^\d{4}-\d{2}-\d{2}T/);
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
  write({ id: '20260613-120005', status: 'in-validation', reviewed: false });
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
  assert.equal(isPendingGraduation(change('in-validation', undefined)), false);
});

test('131649 CR3-CR5: list combines owner, unowned, status and type filters', () => {
  const { root, write } = repoWithArchiveCandidates();
  write({ id: '20260613-120001', owner: 'Roberto Ruiz', status: 'in-validation' });
  write({ id: '20260613-120002', owner: 'raruiz-hiberuscom', status: 'in-validation' });
  write({ id: '20260613-120003', status: 'in-validation' });
  write({ id: '20260613-120004', owner: 'Roberto Ruiz', type: 'bug' });

  assert.deepEqual(
    list({ owner: 'Roberto Ruiz', status: 'in-validation', type: 'feature' }, root).map(
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

test('171002 CR1: status blocks review-required in-progress → in-validation', () => {
  const { root, file, id } = repoWithChange();
  reach(id, root, 'in-progress');
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(
    () => status(id, 'in-validation', root),
    /feature changes must be reviewed before validation — move to in-review first/,
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
    /^Error: audit changes do not require review — move to in-validation instead$/,
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
    /^Error: audit changes do not require review — move to in-validation instead$/m,
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

test('171002 CR5: a chore goes directly to in-validation, not done', () => {
  const { root, file, id } = repoWithChore();
  status(id, 'approved', root);
  status(id, 'in-progress', root, { ownerHandle: () => '' });
  status(id, 'in-validation', root);
  const c = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(c.frontmatter.status, 'in-validation');
  assert.match(c.stages.find((s) => s.key === 'log').body, /in-progress → in-validation/);
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
  assert.throws(() => status(id, 'done', root), /use human validation in the viewer/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('171002 CR1: review pass moves to validation and marks the delegation', () => {
  const { root, file, id } = repoWithChange();
  reach(id, root, 'in-review');
  review(id, 'pass', {}, root);
  const c = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(c.frontmatter.status, 'in-validation');
  assert.match(
    c.stages.find((s) => s.key === 'log').body,
    /review → in-validation \(delegated subagent, clean context\)/,
  );
});

test('122950 support: status and review preserve non-canonical valid YAML style', () => {
  const { root, file, id } = repoWithChange();
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

test('171002 CR2: human validation pass closes the complete change', () => {
  const { root, file, id } = repoWithChange();
  task(id, 'done', 1, '', root);
  reach(id, root, 'in-review');
  review(id, 'pass', {}, root);
  validation(id, 'pass', {}, root);
  const c = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(c.frontmatter.status, 'done');
  assert.match(c.stages.find((s) => s.key === 'log').body, /validation → done \(human accepted\)/);
});

test('125139 CR3/CR5/CR6: conversation channel attributes human validation decisions', () => {
  const accepted = repoWithChange();
  task(accepted.id, 'done', 1, '', accepted.root);
  reach(accepted.id, accepted.root, 'in-review');
  review(accepted.id, 'pass', {}, accepted.root);
  validation(accepted.id, 'pass', { channel: 'conversation' }, accepted.root);
  assert.match(
    parseChange(fs.readFileSync(accepted.file, 'utf8')).stages.find((stage) => stage.key === 'log')
      .body,
    /validation → done \(human accepted via conversation\)/,
  );

  const rejected = repoWithChange();
  reach(rejected.id, rejected.root, 'in-review');
  review(rejected.id, 'pass', {}, rejected.root);
  validation(
    rejected.id,
    'fail',
    { reason: 'Falla en dispositivo', actor: 'human', channel: 'conversation' },
    rejected.root,
  );
  assert.match(
    parseChange(fs.readFileSync(rejected.file, 'utf8')).stages.find((stage) => stage.key === 'log')
      .body,
    /human rejected via conversation\): Falla en dispositivo/,
  );
});

test('105205 CR1: agent rejection requires a reason and records its actor', () => {
  const { root, file, id } = repoWithChange();
  reach(id, root, 'in-review');
  review(id, 'pass', {}, root);
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => validation(id, 'fail', { actor: 'agent' }, root), /requires a reason/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  validation(id, 'fail', { reason: 'fails on device', actor: 'agent' }, root);
  const parsed = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(parsed.frontmatter.status, 'in-progress');
  assert.match(
    parsed.stages.find((s) => s.key === 'log').body,
    /agent rejected\): fails on device/,
  );
});

test('150231 CR2/CR3: human acceptance rejects incomplete or inconsistent changes without writing', () => {
  for (const defect of ['task', 'log']) {
    const { root, file, id } = repoWithChange();
    if (defect === 'log') task(id, 'done', 1, '', root);
    reach(id, root, 'in-review');
    review(id, 'pass', {}, root);
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
      () => validation(id, 'pass', {}, root),
      defect === 'task' ? /1 task\(s\) are not done/ : /Log line .*reconstructed status/,
    );
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  }
});

test('150231 CR6: human acceptance ignores an unrelated unparseable change', () => {
  const { root, file, id } = repoWithChange();
  task(id, 'done', 1, '', root);
  reach(id, root, 'in-review');
  review(id, 'pass', {}, root);
  fs.writeFileSync(path.join(root, '.changeledger', 'changes', 'broken.md'), 'not frontmatter\n');

  assert.doesNotThrow(() => validation(id, 'pass', {}, root));
  assert.equal(parseChange(fs.readFileSync(file, 'utf8')).frontmatter.status, 'done');
});

function acceptedChange() {
  const result = repoWithChange();
  task(result.id, 'done', 1, '', result.root);
  reach(result.id, result.root, 'in-review');
  review(result.id, 'pass', {}, result.root);
  validation(result.id, 'pass', {}, result.root);
  return result;
}

test('150232 CR1/CR2/CR5: human reopens provisional done with a required reason', () => {
  const { root, file, id } = acceptedChange();
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => reopen(id, '', root), /requires a reason/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  reopen(id, 'complete original acceptance', root);
  const parsed = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(parsed.frontmatter.status, 'in-progress');
  assert.match(
    parsed.stages.find((s) => s.key === 'log').body,
    /done → in-progress \(human reopened\)/,
  );
  assert.throws(() => validation(id, 'pass', {}, root), /requires status in-validation/);
});

test('105205 CR2: agent reopens only a provisional done change and records its actor', () => {
  const { root, file, id } = acceptedChange();
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => reopen(id, '', root, { actor: 'agent' }), /requires a reason/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  reopen(id, 'complete original scope', root, { actor: 'agent' });
  const parsed = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(parsed.frontmatter.status, 'in-progress');
  assert.match(
    parsed.stages.find((s) => s.key === 'log').body,
    /agent reopened\): complete original scope/,
  );
});

test('150232 CR3: durable closure boundaries reject reopening without writes', () => {
  for (const boundary of ['reviewed', 'graduated', 'archived', 'released']) {
    const { root, file, id } = acceptedChange();
    let text = fs.readFileSync(file, 'utf8');
    if (boundary === 'reviewed')
      text = text.replace('depends_on: []', 'depends_on: []\nreviewed: true');
    if (boundary === 'graduated') text += '\n- **2026-06-13T13:00:00Z** `[graduation]` skipped\n';
    if (boundary === 'archived')
      text = text.replace('depends_on: []', 'depends_on: []\narchived: true');
    fs.writeFileSync(file, text);
    if (boundary === 'released') {
      const dir = path.join(root, '.changeledger', 'releases');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, '1.0.0.yml'),
        `version: 1.0.0\ncreated: 2026-06-13T13:00:00Z\nchanges: ["${id}"]\n`,
      );
    }
    const before = fs.readFileSync(file, 'utf8');
    assert.throws(() => reopen(id, 'late', root), /cannot reopen/);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  }
});

test('150232 CR3: release publication wins a deterministic race with reopen', async () => {
  const { root, file, id } = acceptedChange();
  const before = fs.readFileSync(file, 'utf8');
  const releasesDir = path.join(root, '.changeledger', 'releases');
  fs.mkdirSync(releasesDir, { recursive: true });
  const lock = path.join(releasesDir, '..history.lock');
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, created: new Date().toISOString() }));
  const moduleUrl = new URL('../src/commands/agent.mjs', import.meta.url).href;
  const script = `import { reopen } from ${JSON.stringify(moduleUrl)}; reopen(process.argv[1], 'race', process.argv[2]);`;
  let settled = false;
  const attempt = execFileAsync(process.execPath, ['--input-type=module', '-e', script, id, root]);
  attempt.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );

  await delay(100);
  assert.equal(settled, false, 'reopen must wait for the release-history lock');
  fs.writeFileSync(
    path.join(releasesDir, '1.0.0.yml'),
    `version: 1.0.0\ncreated: 2026-06-13T13:00:00Z\nchanges: ["${id}"]\n`,
  );
  fs.unlinkSync(lock);

  await assert.rejects(attempt, /cannot reopen: change belongs to a recorded release/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('171002 CR3: human rejection requires a reason and returns to in-progress', () => {
  const { root, file, id } = repoWithChange();
  reach(id, root, 'in-review');
  review(id, 'pass', {}, root);
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => validation(id, 'fail', {}, root), /requires a reason/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  validation(id, 'fail', { reason: 'fails on device' }, root);
  const c = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(c.frontmatter.status, 'in-progress');
  assert.match(c.stages.find((s) => s.key === 'log').body, /human rejected\): fails on device/);
});

test('171002 CR2: generic status cannot close a change on behalf of the human', () => {
  const { root, file, id } = repoWithChore();
  status(id, 'approved', root);
  status(id, 'in-progress', root, { ownerHandle: () => '' });
  status(id, 'in-validation', root);
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => status(id, 'done', root), /use human validation in the viewer/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('CR7: review fail --retry returns to in-progress with the reason', () => {
  const { root, file, id } = repoWithChange();
  reach(id, root, 'in-review');
  review(id, 'fail', { mode: 'retry', reason: 'CR3 not met' }, root);
  const c = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(c.frontmatter.status, 'in-progress');
  assert.match(
    c.stages.find((s) => s.key === 'log').body,
    /review → in-progress \(retry\): CR3 not met/,
  );
});

test('CR8: review fail --block escalates to blocked with the reason', () => {
  const { root, file, id } = repoWithChange();
  reach(id, root, 'in-review');
  review(id, 'fail', { mode: 'block', reason: 'spec is ambiguous' }, root);
  const c = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(c.frontmatter.status, 'blocked');
  assert.match(c.stages.find((s) => s.key === 'log').body, /review → blocked: spec is ambiguous/);
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

// 20260729-162616 CR2: review() now validates every one of its three outcomes
// through assertTransition, the same lifecycle authority status()/validation()/
// discard()/reopen() already use — instead of writing setStatus directly once
// its own bespoke `current !== 'in-review'` guard passes. Under today's graph
// every in-review edge is legal (`in-review: ['in-validation', 'in-progress',
// 'blocked']` mirrors review()'s three outcomes exactly), so assertTransition
// can never actually throw through review() right now — exactly like the
// equally-defensive call already in reopen() (`assertTransition('done',
// 'in-progress', ...)`, always legal too). These tests pin the illegal-current
// rejection (the only reachable one) across all three verdict paths, not just
// `pass`, so a future edit that narrows the graph or the review-required gate
// is enforced here the same way it already is for the other verbs.
test('162616 CR2: review fail --retry rejects an illegal current status without writing', () => {
  const { root, file, id } = repoWithChange();
  status(id, 'approved', root);
  status(id, 'in-progress', root, { ownerHandle: () => '' });
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(
    () => review(id, 'fail', { mode: 'retry', reason: 'x' }, root),
    /review requires status in-review \(current: in-progress\)/,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('162616 CR2: review fail --block rejects an illegal current status without writing', () => {
  const { root, file, id } = repoWithChange();
  status(id, 'approved', root);
  status(id, 'in-progress', root, { ownerHandle: () => '' });
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(
    () => review(id, 'fail', { mode: 'block', reason: 'x' }, root),
    /review requires status in-review \(current: in-progress\)/,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('CR10: review fail requires a reason', () => {
  const { root, file, id } = repoWithChange();
  reach(id, root, 'in-review');
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(
    () => review(id, 'fail', { mode: 'retry' }, root),
    /fail requires a reason — changeledger review <id> fail --retry\|--block "<reason>"/,
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
  // Drive the feature through review and human validation to test terminal done.
  status(id, 'in-review', root);
  review(id, 'pass', {}, root);
  validation(id, 'pass', {}, root);
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

test('CR1: full lifecycle through review/validation/reopen/discard stays on the ref', () => {
  const { root, id, name } = activatedRepoWithChange();
  const relPath = `changes/${name}`;
  task(id, 'done', 1, '', root);
  status(id, 'approved', root, { actor: 'human', channel: 'conversation' });
  status(id, 'in-progress', root, { ownerHandle: () => '' });
  status(id, 'in-review', root);

  review(id, 'pass', {}, root);
  assert.equal(
    parseChange(stateDocText(root, stateRefTip(root), relPath)).frontmatter.status,
    'in-validation',
  );

  validation(id, 'pass', {}, root);
  assert.equal(
    parseChange(stateDocText(root, stateRefTip(root), relPath)).frontmatter.status,
    'done',
  );

  reopen(id, 'needs a fix', root);
  assert.equal(
    parseChange(stateDocText(root, stateRefTip(root), relPath)).frontmatter.status,
    'in-progress',
  );
  assert.equal(lastCommitMessage(root), `reopen: ${id}`);

  status(id, 'in-review', root);
  review(id, 'fail', { mode: 'retry', reason: 'oops' }, root);
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
  validation(id, 'pass', {}, root);

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
    name: 'reopen',
    at: 'done',
    run: ({ id, root }) => reopen(id, 'more work', root),
    types: ['status'],
  },
  {
    name: 'review',
    at: 'in-review',
    run: ({ id, root }) => review(id, 'pass', {}, root),
    types: ['review'],
  },
  {
    name: 'validation',
    at: 'in-validation',
    run: ({ id, root }) => validation(id, 'pass', {}, root),
    types: ['validation'],
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
      expectOne('review fail', () =>
        review(id, 'fail', { mode: 'retry', reason: 'r' }, root, quiet),
      );
      expectOne('status in-review', () => status(id, 'in-review', root, own));
      expectOne('review pass', () => review(id, 'pass', {}, root, quiet));
      expectOne('validation fail', () => validation(id, 'fail', { reason: 'no' }, root, quiet));
      expectOne('status in-review', () => status(id, 'in-review', root, own));
      expectOne('review pass', () => review(id, 'pass', {}, root, quiet));
      expectOne('validation pass', () => validation(id, 'pass', {}, root, quiet));
      expectOne('reopen', () => reopen(id, 'again', root, quiet));
      expectOne('status in-review', () => status(id, 'in-review', root, own));
      expectOne('review pass', () => review(id, 'pass', {}, root, quiet));
      expectOne('validation pass', () => validation(id, 'pass', {}, root, quiet));
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
        'review:in-review→in-validation',
        'validation:in-validation→in-progress',
        'status:in-progress→in-review',
        'review:in-review→in-validation',
        'validation:in-validation→done',
        'status:done→in-progress',
        'status:in-progress→in-review',
        'review:in-review→in-validation',
        'validation:in-validation→done',
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
