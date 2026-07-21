import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parseChange } from '../src/change.mjs';
import { list } from '../src/commands/agent.mjs';
import { graduate, scaffoldSpec, skipGraduation } from '../src/commands/graduate.mjs';
import { init } from '../src/commands/init.mjs';
import { newChange } from '../src/commands/new.mjs';
import { loadRepo, loadRepoAsync } from '../src/repo.mjs';
import { parseSpec } from '../src/spec.mjs';
import { initializeStateStore, readStateStore } from '../src/state-store.mjs';
import { serialize } from '../src/viewer/domain.mjs';

// Isolate the global registry so init() doesn't touch the real home.
process.env.CHANGELEDGER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-grad-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  init(root);
  const file = path.join(root, '.changeledger', 'changes', '20260613-120000-x.md');
  fs.writeFileSync(
    file,
    `---
id: "20260613-120000"
title: Login OAuth
type: feature
status: done
created: 2026-06-13T12:00:00Z
depends_on: []
---

## Request

Login OAuth.

## Investigation

Current behavior.

## Proposal

OAuth integration.

## Specification

El sistema soporta login OAuth.

## Plan

## Log

- **2026-06-13T12:00:00Z** \`[note]\` created
`,
  );
  return { root, file, id: '20260613-120000' };
}

// Writes an existing spec with a known body and a stale `updated`.
function seedSpec(root, name, body) {
  const specsDir = path.join(root, '.changeledger', 'specs');
  fs.mkdirSync(specsDir, { recursive: true });
  const file = path.join(specsDir, name);
  fs.writeFileSync(
    file,
    `---\ntitle: Arch\nupdated: 2020-01-01T00:00:00Z\ntags: [architecture]\n---\n${body}`,
  );
  return file;
}

function refineScaffold(file) {
  fs.writeFileSync(
    file,
    fs.readFileSync(file, 'utf8').replace('<!-- changeledger:spec-scaffold -->\n\n', ''),
  );
}

test('CR1: graduate --into links an existing spec without touching its body', () => {
  const { root, file, id } = repo();
  const specFile = seedSpec(root, 'architecture.md', '\n# Arch\n\nCuerpo intacto.\n');

  const beforeBody = parseSpec(fs.readFileSync(specFile, 'utf8')).body;
  graduate(id, 'architecture', root, { into: true });

  const after = fs.readFileSync(specFile, 'utf8');
  const spec = parseSpec(after);
  assert.equal(spec.body, beforeBody); // body preserved
  assert.deepEqual(spec.frontmatter.graduated_from, [id]);
  assert.doesNotMatch(after, /2020-01-01T00:00:00Z/); // updated refreshed
  const change = parseChange(fs.readFileSync(file, 'utf8'));
  assert.match(
    change.stages.find((s) => s.key === 'log').body,
    /`\[graduation\]` spec: `architecture.md`/,
  );
  assert.equal(change.frontmatter.reviewed, true);
});

test('CR2: graduate --into on a missing spec errors without writing', () => {
  const { root, file, id } = repo();
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(
    () => graduate(id, 'ghost', root, { into: true }),
    /^Error: Spec "ghost\.md" does not exist — use --new to create a scaffold$/,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('CR2: scaffoldSpec on an existing spec errors', () => {
  const { root, id } = repo();
  scaffoldSpec(id, 'auth', root);
  assert.throws(() => scaffoldSpec(id, 'auth', root), /^Error: Spec "auth\.md" already exists$/);
});

test('CR2: scaffoldSpec creates a seed without resolving graduation', () => {
  const { root, file, id } = repo();
  const before = fs.readFileSync(file, 'utf8');
  const specFile = scaffoldSpec(id, 'auth', root);
  assert.equal(path.basename(specFile), 'auth.md');

  const spec = parseSpec(fs.readFileSync(specFile, 'utf8'));
  assert.equal(spec.frontmatter.title, 'Login OAuth');
  assert.deepEqual(spec.frontmatter.tags, ['feature']);
  assert.deepEqual(spec.frontmatter.graduated_from, []);
  assert.match(spec.body, /soporta login OAuth/);
  assert.match(spec.body, /changeledger:spec-scaffold/);
  assert.match(spec.body, new RegExp(`Scaffold from change ${id}`));

  assert.equal(fs.readFileSync(file, 'utf8'), before);
  const change = parseChange(fs.readFileSync(file, 'utf8'));
  assert.notEqual(change.frontmatter.reviewed, true);
  assert.doesNotMatch(change.stages.find((s) => s.key === 'log').body, /graduado a spec/);
});

test('111457 CR2: graduate --into accumulates provenance without duplicate ids', () => {
  const { root, id } = repo();
  const specFile = seedSpec(root, 'architecture.md', '\n# Arch\n\nCuerpo.\n');
  graduate(id, 'architecture', root, { into: true });

  const secondId = '20260613-130000';
  writeChange(root, secondId, 'done');
  graduate(secondId, 'architecture', root, { into: true });
  graduate(secondId, 'architecture', root, { into: true });

  const spec = parseSpec(fs.readFileSync(specFile, 'utf8'));
  assert.deepEqual(spec.frontmatter.graduated_from, [id, secondId]);
});

test('162020 CR1: graduate rejects a slug that normalizes to empty without writing', () => {
  const { root, file, id } = repo();
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(
    () => scaffoldSpec(id, '!!!', root),
    /slug must contain at least one ASCII letter or number/,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(fs.existsSync(path.join(root, '.changeledger', 'specs', '.md')), false);
});

test('162020 CR2: graduate keeps valid slug behavior', () => {
  const { root, file, id } = repo();
  const specFile = scaffoldSpec(id, 'architecture-note', root);
  assert.equal(path.basename(specFile), 'architecture-note.md');
  const change = parseChange(fs.readFileSync(file, 'utf8'));
  assert.doesNotMatch(change.stages.find((s) => s.key === 'log').body, /graduado a spec/);
});

test('162020 CR3: new and graduate share slug normalization behavior', () => {
  const { root, id } = repo();
  const changeFile = newChange(
    {
      type: 'chore',
      slug: 'Árbol Técnico',
      title: 'x',
      now: '2026-06-13T12:00:01Z',
    },
    root,
  );
  const specFile = scaffoldSpec(id, 'Árbol Técnico', root);
  assert.equal(path.basename(changeFile), '20260613-120001-arbol-tecnico.md');
  assert.equal(path.basename(specFile), 'arbol-tecnico.md');
});

test('CR1/CR2: graduate with no specs_dir in config lands where loadRepo reads', () => {
  const { root, id } = repo();
  // Drop the specs_dir key so graduate and loadRepo must agree on the default.
  const configFile = path.join(root, '.changeledger', 'config.yml');
  const stripped = fs.readFileSync(configFile, 'utf8').replace(/^specs_dir:.*\n/m, '');
  fs.writeFileSync(configFile, stripped);

  const specFile = scaffoldSpec(id, 'auth', root);
  assert.ok(fs.existsSync(specFile), 'spec file written to disk');

  const repoData = loadRepo(root);
  assert.ok(
    repoData.specs.some((s) => s.name === 'auth.md'),
    'loadRepo sees the graduated spec',
  );
});

test('scaffoldSpec refuses to overwrite an existing spec', () => {
  const { root, id } = repo();
  scaffoldSpec(id, 'auth', root);
  assert.throws(() => scaffoldSpec(id, 'auth', root), /already exists/);
});

test('scaffoldSpec throws on an unknown change id', () => {
  const { root } = repo();
  assert.throws(() => scaffoldSpec('99999999-000000', 'x', root), /No change with id/);
});

test('CR2: scaffoldSpec refuses a non-done change and creates no spec', () => {
  const { root } = repo();
  const f = writeChange(root, '20260104-000000', 'in-progress');
  const before = fs.readFileSync(f, 'utf8');
  assert.throws(() => scaffoldSpec('20260104-000000', 'x', root), /only done changes/);
  assert.equal(fs.readFileSync(f, 'utf8'), before);
  assert.ok(!fs.existsSync(path.join(root, '.changeledger', 'specs', 'x.md')));
});

// Write a bare change file with a given id and status.
function writeChange(root, id, status, extra = '') {
  const file = path.join(root, '.changeledger', 'changes', `${id}-y.md`);
  fs.writeFileSync(
    file,
    `---\nid: "${id}"\ntitle: Y\ntype: feature\nstatus: ${status}\ncreated: 2026-01-01T00:00:00Z\ndepends_on: []\n${extra}---\n\n## Request\n\nY.\n\n## Investigation\n\nCurrent.\n\n## Proposal\n\nSelected.\n\n## Specification\n\nY.\n\n## Plan\n\n## Log\n`,
  );
  return file;
}

test('150231 CR4/CR5: every graduation mode preflights closure integrity without writes', () => {
  for (const mode of ['new', 'into', 'skip']) {
    const { root, file, id } = repo();
    fs.writeFileSync(
      file,
      fs.readFileSync(file, 'utf8').replace('## Plan\n', '## Plan\n\n- [ ] unfinished\n'),
    );
    const changeBefore = fs.readFileSync(file, 'utf8');
    let specFile;
    if (mode === 'into') specFile = seedSpec(root, 'architecture.md', '\n# Arch\n\nStable.\n');
    const specBefore = specFile ? fs.readFileSync(specFile, 'utf8') : null;

    assert.throws(() => {
      if (mode === 'new') scaffoldSpec(id, 'blocked', root);
      else if (mode === 'into') graduate(id, 'architecture', root, { into: true });
      else skipGraduation(id, 'none', root);
    }, /1 task\(s\) are not done/);
    assert.equal(fs.readFileSync(file, 'utf8'), changeBefore);
    assert.equal(fs.existsSync(path.join(root, '.changeledger', 'specs', 'blocked.md')), false);
    if (specFile) assert.equal(fs.readFileSync(specFile, 'utf8'), specBefore);
  }
});

test('150231 CR6: graduation preflight is scoped to the selected change', () => {
  const { root, file, id } = repo();
  fs.writeFileSync(
    path.join(root, '.changeledger', 'changes', 'unparseable.md'),
    'not a frontmatter block\n',
  );

  assert.doesNotThrow(() => skipGraduation(id, 'no durable truth', root));
  assert.equal(parseChange(fs.readFileSync(file, 'utf8')).frontmatter.reviewed, true);
});

test('CR3: graduate --into marks the change reviewed after scaffold refinement', () => {
  const { root, file, id } = repo();
  const specFile = scaffoldSpec(id, 'auth', root);
  refineScaffold(specFile);
  graduate(id, 'auth', root, { into: true });
  assert.equal(parseChange(fs.readFileSync(file, 'utf8')).frontmatter.reviewed, true);
});

test('CR3: graduate --into rejects an unrefined scaffold without writing', () => {
  const { root, file, id } = repo();
  const specFile = scaffoldSpec(id, 'auth', root);
  const changeBefore = fs.readFileSync(file, 'utf8');
  const specBefore = fs.readFileSync(specFile, 'utf8');
  assert.throws(
    () => graduate(id, 'auth', root, { into: true }),
    /still contains the scaffold marker/,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), changeBefore);
  assert.equal(fs.readFileSync(specFile, 'utf8'), specBefore);
});

test('skipGraduation marks reviewed, logs the reason, creates no spec (CR2)', () => {
  const { root, file, id } = repo();
  const out = skipGraduation(id, 'bug fix, sin verdad persistente', root);
  assert.equal(out, file);
  const c = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(c.frontmatter.reviewed, true);
  assert.match(
    c.stages.find((s) => s.key === 'log').body,
    /`\[graduation\]` skipped: bug fix, sin verdad persistente$/m,
  );
  const specsDir = path.join(root, '.changeledger', 'specs');
  assert.equal(fs.existsSync(specsDir) && fs.readdirSync(specsDir).length > 0, false);
});

test('skipGraduation without a reason logs the bare marker (CR3)', () => {
  const { root, file, id } = repo();
  skipGraduation(id, '', root);
  const log = parseChange(fs.readFileSync(file, 'utf8')).stages.find((s) => s.key === 'log').body;
  assert.match(log, /`\[graduation\]` skipped$/m);
});

test('skipGraduation refuses a non-done change and writes nothing (CR6)', () => {
  const { root } = repo();
  const f = writeChange(root, '20260102-000000', 'in-progress');
  const before = fs.readFileSync(f, 'utf8');
  assert.throws(() => skipGraduation('20260102-000000', 'x', root), /only done changes/);
  assert.equal(fs.readFileSync(f, 'utf8'), before);
});

test('185958 CR1: validation failure before mutateFileAtomic leaves changeFile untouched', () => {
  const { root, file, id } = repo();
  const before = fs.readFileSync(file, 'utf8');
  // spec doesn't exist; --into requires it to exist → should throw before any write
  assert.throws(() => graduate(id, 'missing-spec', root, { into: true }), /does not exist/);
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'changeFile must not be modified');
});

test('185958 CR3: spec write failure leaves changeFile unmodified', () => {
  const { root, file, id } = repo();
  const before = fs.readFileSync(file, 'utf8');
  const specsDir = path.join(root, '.changeledger', 'specs');
  const specName = path.join(specsDir, 'auth.md');
  // Make specName a directory — writeFileAtomic will fail trying to write a file at a dir path
  fs.mkdirSync(specName, { recursive: true });
  assert.throws(() => scaffoldSpec(id, 'auth', root));
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'changeFile must not be modified');
  fs.rmdirSync(specName); // cleanup
});

test('185958 CR4: orphaned spec (write OK, log failed) is detectable and recoverable', () => {
  const { root, file, id } = repo();
  // Simulate orphaned spec: spec exists, but changeFile has no reviewed flag
  const specsDir = path.join(root, '.changeledger', 'specs');
  fs.mkdirSync(specsDir, { recursive: true });
  fs.writeFileSync(
    path.join(specsDir, 'auth.md'),
    '---\ntitle: Auth\nupdated: 2026-06-13T12:00:00Z\ntags: []\n---\n\n# Auth\n',
  );
  // Retry without --into → "already exists" (CR4 detectable state)
  assert.throws(() => scaffoldSpec(id, 'auth', root), /already exists/);
  // Retry with --into → succeeds (CR4 recoverable)
  assert.doesNotThrow(() => graduate(id, 'auth', root, { into: true }));
  assert.equal(parseChange(fs.readFileSync(file, 'utf8')).frontmatter.reviewed, true);
});

test('185958 CR5 / CR2 / CR3: scaffold then --into happy paths', () => {
  const { root, id } = repo();
  const specFile = scaffoldSpec(id, 'auth', root);
  assert.ok(fs.existsSync(specFile));
  refineScaffold(specFile);
  assert.doesNotThrow(() => graduate(id, 'auth', root, { into: true }));
  // --into case on a second done change
  const f2 = writeChange(root, '20260615-120000', 'done');
  const { id: id2 } = parseChange(fs.readFileSync(f2, 'utf8')).frontmatter;
  assert.doesNotThrow(() => graduate(id2, 'auth', root, { into: true }));
});

test('CR2: a scaffolded change remains pending graduation', () => {
  const { root, id } = repo();
  scaffoldSpec(id, 'auth', root);
  assert.equal(
    loadRepo(root).changes.find((change) => change.frontmatter.id === id).frontmatter.reviewed,
    undefined,
  );
});

function globalRepo({ remote = false, owner = 'ana' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-global-grad-'));
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Graduate Test',
    GIT_AUTHOR_EMAIL: 'graduate@example.com',
    GIT_COMMITTER_NAME: 'Graduate Test',
    GIT_COMMITTER_EMAIL: 'graduate@example.com',
  };
  for (const key of [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_COMMON_DIR',
    'GIT_CEILING_DIRECTORIES',
  ]) {
    delete env[key];
  }
  const git = (args) => execFileSync('git', args, { cwd: root, env, encoding: 'utf8' }).trim();
  const id = '20260721-160000';
  const change = `---
id: "${id}"
title: Global graduation
type: feature
status: done
created: 2026-07-21T16:00:00Z
depends_on: []
owner: ${owner}
---

## Request

Global graduation.

## Investigation

State branch stores lifecycle.

## Proposal

Specs remain canonical on integration.

## Specification

Graduation is two-phase.

## Plan

- [x] Complete
  - **Resolved:** \`2026-07-21T16:00:00Z\`

## Log
`;
  git(['init', '-q', '-b', 'dev']);
  git(['config', 'user.name', owner]);
  git(['config', 'user.email', 'graduate@example.com']);
  fs.mkdirSync(path.join(root, '.changeledger', 'specs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'README.md'), '# global graduation\n');
  fs.writeFileSync(
    path.join(root, '.changeledger', 'specs', 'architecture.md'),
    '---\ntitle: Architecture\nupdated: 2026-01-01T00:00:00Z\ntags: [feature]\ngraduated_from: []\n---\n\n# Architecture\n\nDurable truth.\n',
  );
  git(['add', '.']);
  git(['commit', '-qm', `baseline [#${id}]`]);
  const initialized = initializeStateStore({
    repoRoot: root,
    branch: 'changeledger/state',
    projectId: 'global-graduate',
    integrationBranch: 'dev',
    changes: [{ name: `${id}-global-graduation.md`, text: change }],
    gitEnv: env,
  });
  fs.writeFileSync(
    path.join(root, '.changeledger', 'config.yml'),
    `schema_version: 4
language: en
changes_dir: .changeledger/changes
specs_dir: .changeledger/specs
git:
  integration_branch: dev
  change_branch_format: "{type}/{id}"
  state_branch: changeledger/state
  state_baseline: ${initialized.head}
statuses: [draft, approved, in-progress, in-review, in-validation, blocked, done, discarded]
stages: [request, investigation, proposal, specification, plan, log]
types:
  feature:
    stages: [request, investigation, proposal, specification, plan, log]
    review_required: true
project_id: global-graduate
project_name: global-graduate
`,
  );
  git(['add', '.changeledger/config.yml']);
  git(['commit', '-qm', `activate global state [#${id}]`]);
  let remoteRoot;
  if (remote) {
    remoteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-global-grad-remote-'));
    execFileSync('git', ['init', '--bare', '-q', remoteRoot], { env });
    git(['remote', 'add', 'origin', remoteRoot]);
    git(['push', '-qu', 'origin', 'dev']);
    git(['push', '-q', 'origin', 'changeledger/state']);
  }
  return { root, env, git, id, remoteRoot };
}

test('124231 CR20: global graduation remains pending until the linked spec is canonical', () => {
  const { root, env, git, id } = globalRepo();
  const prepared = graduate(id, 'architecture', root, { into: true, actorHandle: () => 'ana' });
  assert.equal(prepared.pending, true);
  assert.equal(
    readStateStore(root, 'changeledger/state', { gitEnv: env }).changes[0].frontmatter.reviewed,
    undefined,
  );
  assert.deepEqual(loadRepo(root).specs[0].frontmatter.graduated_from, []);

  const specFile = path.join(root, '.changeledger', 'specs', 'architecture.md');
  git(['add', specFile]);
  git(['commit', '-qm', `publish canonical spec [#${id}]`]);

  const finalized = graduate(id, 'architecture', root, {
    into: true,
    actorHandle: () => 'ana',
  });
  assert.equal(finalized.pending, true);
  assert.equal(finalized.confirmed, false);
  assert.match(finalized.canonicalRevision, /^[0-9a-f]{40}$/);
  assert.equal(
    readStateStore(root, 'changeledger/state', { gitEnv: env }).changes[0].frontmatter.reviewed,
    true,
  );
  assert.deepEqual(loadRepo(root).specs[0].frontmatter.graduated_from, [id]);
});

test('124231 CR20: an unpublished local integration spec is not canonical when origin exists', () => {
  const { root, env, git, id } = globalRepo({ remote: true });
  const specFile = path.join(root, '.changeledger', 'specs', 'architecture.md');

  assert.equal(
    graduate(id, 'architecture', root, { into: true, actorHandle: () => 'ana' }).pending,
    true,
  );
  git(['add', specFile]);
  git(['commit', '-qm', `local spec only [#${id}]`]);

  const unpublished = graduate(id, 'architecture', root, {
    into: true,
    actorHandle: () => 'ana',
  });
  assert.equal(unpublished.pending, true);
  assert.equal(
    readStateStore(root, 'changeledger/state', { gitEnv: env }).changes[0].frontmatter.reviewed,
    undefined,
  );

  git(['push', '-q', 'origin', 'dev']);
  const finalized = graduate(id, 'architecture', root, {
    into: true,
    actorHandle: () => 'ana',
  });
  assert.equal(finalized.pending, false);
  assert.equal(finalized.confirmed, true);
});

test('124231 CR20: a stale origin tracking ref cannot certify a remotely rewound integration branch', () => {
  const { root, env, git, id, remoteRoot } = globalRepo({ remote: true });
  const remoteBaseline = git(['rev-parse', 'refs/remotes/origin/dev']);
  const specFile = path.join(root, '.changeledger', 'specs', 'architecture.md');

  assert.equal(
    graduate(id, 'architecture', root, { into: true, actorHandle: () => 'ana' }).pending,
    true,
  );
  git(['add', specFile]);
  git(['commit', '-qm', `publish then rewind spec [#${id}]`]);
  git(['push', '-q', 'origin', 'dev']);
  assert.notEqual(git(['rev-parse', 'refs/remotes/origin/dev']), remoteBaseline);

  git(['push', '-q', '--force', remoteRoot, `${remoteBaseline}:refs/heads/dev`]);
  const result = graduate(id, 'architecture', root, {
    into: true,
    actorHandle: () => 'ana',
  });

  assert.equal(result.pending, true);
  assert.equal(result.reason, 'canonical-spec');
  assert.equal(
    readStateStore(root, 'changeledger/state', { gitEnv: env }).changes[0].frontmatter.reviewed,
    undefined,
  );
});

test('124231 CR20: readers use the same refreshed integration evidence as graduation', async () => {
  const { root, env, git, id, remoteRoot } = globalRepo({ remote: true });
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-global-grad-writer-'));
  const writer = path.join(parent, 'repo');
  execFileSync('git', ['clone', '-q', '-b', 'dev', remoteRoot, writer], { env });
  const writerGit = (args) =>
    execFileSync('git', args, { cwd: writer, env, encoding: 'utf8' }).trim();
  writerGit(['config', 'user.name', 'Integration Writer']);
  writerGit(['config', 'user.email', 'writer@example.com']);
  const writerSpec = path.join(writer, '.changeledger', 'specs', 'architecture.md');
  fs.writeFileSync(
    writerSpec,
    fs.readFileSync(writerSpec, 'utf8').replace('graduated_from: []', `graduated_from: [${id}]`),
  );
  writerGit(['add', writerSpec]);
  writerGit(['commit', '-qm', `remote canonical spec [#${id}]`]);
  writerGit(['push', '-q', 'origin', 'dev']);
  assert.notEqual(writerGit(['rev-parse', 'dev']), git(['rev-parse', 'refs/remotes/origin/dev']));

  const result = graduate(id, 'architecture', root, {
    into: true,
    actorHandle: () => 'ana',
  });
  assert.equal(result.pending, false);
  const loaded = loadRepo(root);
  assert.equal(loaded.changes[0].frontmatter.reviewed, true);
  assert.deepEqual(loaded.specs[0].frontmatter.graduated_from, [id]);
  assert.deepEqual(list({ pending: 'graduation' }, root), []);
  assert.equal(serialize(loaded).state_store.pending, false);
  assert.deepEqual(serialize(loaded).specs[0].graduated_from, [id]);
  assert.deepEqual((await loadRepoAsync(root)).specs[0].frontmatter.graduated_from, [id]);
});

test('124231 CR20: deleted or unreachable remote integration authority stays pending', () => {
  for (const failure of ['deleted', 'unreachable']) {
    const { root, env, git, id, remoteRoot } = globalRepo({ remote: true });
    const specFile = path.join(root, '.changeledger', 'specs', 'architecture.md');
    assert.equal(
      graduate(id, 'architecture', root, { into: true, actorHandle: () => 'ana' }).pending,
      true,
    );
    git(['add', specFile]);
    git(['commit', '-qm', `publish before ${failure} [#${id}]`]);
    git(['push', '-q', 'origin', 'dev']);
    if (failure === 'deleted') git(['push', '-q', remoteRoot, '--delete', 'dev']);
    else git(['remote', 'set-url', 'origin', path.join(root, 'missing-origin.git')]);

    const result = graduate(id, 'architecture', root, {
      into: true,
      actorHandle: () => 'ana',
    });
    assert.equal(result.pending, true);
    assert.equal(result.reason, 'canonical-spec');
    assert.equal(
      readStateStore(root, 'changeledger/state', { gitEnv: env }).changes[0].frontmatter.reviewed,
      undefined,
    );
  }
});

test('124231 CR21: global graduation reports rejected publication and records the effective owner', () => {
  const { root, env, git, id, remoteRoot } = globalRepo({ remote: true });
  const specFile = path.join(root, '.changeledger', 'specs', 'architecture.md');
  assert.equal(
    graduate(id, 'architecture', root, { into: true, actorHandle: () => 'ana' }).pending,
    true,
  );
  git(['add', specFile]);
  git(['commit', '-qm', `publish spec [#${id}]`]);
  git(['push', '-q', 'origin', 'dev']);

  const before = readStateStore(root, 'changeledger/state', { gitEnv: env }).head;
  assert.throws(
    () => graduate(id, 'architecture', root, { into: true, actorHandle: () => 'luis' }),
    /owned by "ana"/,
  );
  assert.equal(readStateStore(root, 'changeledger/state', { gitEnv: env }).head, before);

  const hook = path.join(remoteRoot, 'hooks', 'pre-receive');
  fs.writeFileSync(
    hook,
    '#!/bin/sh\nwhile read old new ref; do [ "$ref" = "refs/heads/changeledger/state" ] && exit 1; done\nexit 0\n',
  );
  fs.chmodSync(hook, 0o755);
  const result = graduate(id, 'architecture', root, {
    into: true,
    actorHandle: () => 'ana',
  });
  assert.equal(result.pending, true);
  assert.equal(result.confirmed, false);
  const state = readStateStore(root, 'changeledger/state', { gitEnv: env });
  const message = execFileSync('git', ['show', '-s', '--format=%B', state.head], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
  assert.match(message, /^Change-Actor: ana$/m);

  const loaded = loadRepo(root);
  assert.equal(loaded.state.pending.pending, true);
  assert.deepEqual(list({ pending: 'graduation' }, root), []);
  assert.equal(serialize(loaded).state_store.pending, true);
});

test('124231 CR21: CLI distinguishes a locally saved graduation from global confirmation', () => {
  const { root, env, git, id, remoteRoot } = globalRepo({
    remote: true,
    owner: 'Graduate Test',
  });
  const specFile = path.join(root, '.changeledger', 'specs', 'architecture.md');
  assert.equal(
    graduate(id, 'architecture', root, {
      into: true,
      actorHandle: () => 'Graduate Test',
    }).pending,
    true,
  );
  git(['add', specFile]);
  git(['commit', '-qm', `publish CLI spec [#${id}]`]);
  git(['push', '-q', 'origin', 'dev']);

  const hook = path.join(remoteRoot, 'hooks', 'pre-receive');
  fs.writeFileSync(
    hook,
    '#!/bin/sh\nwhile read old new ref; do [ "$ref" = "refs/heads/changeledger/state" ] && exit 1; done\nexit 0\n',
  );
  fs.chmodSync(hook, 0o755);
  const result = spawnSync(
    process.execPath,
    [path.resolve('bin/changeledger.mjs'), 'graduate', id, 'architecture', '--into'],
    {
      cwd: root,
      env: {
        ...env,
        PATH: '/usr/bin:/bin',
        GH_CONFIG_DIR: path.join(root, '.changeledger-test-gh'),
      },
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Graduation .* saved locally/);
  assert.match(result.stderr, /changeledger state sync/);
});

test('124231 CR21: global skip authorizes its actor and preserves pending publication', () => {
  const { root, env, git, id } = globalRepo({ remote: true });
  const before = readStateStore(root, 'changeledger/state', { gitEnv: env }).head;
  assert.throws(
    () => skipGraduation(id, 'No durable truth', root, { actorHandle: () => 'luis' }),
    /owned by "ana"/,
  );
  assert.equal(readStateStore(root, 'changeledger/state', { gitEnv: env }).head, before);

  git(['remote', 'set-url', 'origin', path.join(root, 'missing-origin.git')]);
  const result = skipGraduation(id, 'No durable truth', root, { actorHandle: () => 'ana' });
  assert.equal(result.pending, true);
  assert.equal(result.confirmed, false);
});
