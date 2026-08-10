import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { withFileLock } from '../src/atomic-write.mjs';
import { parseChange } from '../src/change.mjs';
import { graduate, scaffoldSpec, skipGraduation } from '../src/commands/graduate.mjs';
import { init } from '../src/commands/init.mjs';
import { newChange } from '../src/commands/new.mjs';
import { loadRepo } from '../src/repo.mjs';
import { parseSpec } from '../src/spec.mjs';
import { STATE_REF, STATE_ROOT, writeActivation } from '../src/state-store.mjs';
import { sanitizedEnv } from './helpers/git-env.mjs';
import { buildTree, commitTree, updateRef } from './helpers/state-repo.mjs';

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

// Activated variant: the change document (from `repo()`) and, optionally, a
// pre-existing spec both live only in the state ref's snapshot — nothing on
// disk backs either, so a fallback to the worktree would fail outright.
function activatedRepo({ specName, specBody } = {}) {
  const { root, file, id } = repo();
  const changeName = path.basename(file);
  const changeText = fs.readFileSync(file, 'utf8');
  fs.rmSync(file);

  const files = {
    '.changeledger-state/manifest.yml': 'format_version: 1\nproject_id: demo\n',
    '.changeledger-state/config.yml': fs.readFileSync(
      path.join(root, '.changeledger', 'config.yml'),
      'utf8',
    ),
    [`.changeledger-state/changes/${changeName}`]: changeText,
  };
  if (specName) {
    files[`.changeledger-state/specs/${specName}`] =
      `---\ntitle: Arch\nupdated: 2020-01-01T00:00:00Z\ntags: [architecture]\n---\n${specBody}`;
  }

  execFileSync('git', ['init', '-q'], { cwd: root, env: sanitizedEnv(), stdio: 'ignore' });
  const tree = buildTree(root, files);
  const revision = commitTree(root, tree, { message: 'chore: state' });
  updateRef(root, STATE_REF, revision);
  writeActivation(root, { stateRef: STATE_REF });

  return { root, id, changeName };
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

function fsWithRenameFailures({
  changeFile,
  specFile,
  failChange,
  failSpecWrite = false,
  failSpecRollback = false,
}) {
  let specRenames = 0;
  return {
    ...fs,
    renameSync(from, to) {
      if (to === specFile) {
        specRenames += 1;
        if (failSpecWrite) throw failSpecWrite;
        if (failSpecRollback && specRenames === 2) throw failSpecRollback;
      }
      if (to === changeFile && failChange) throw failChange;
      return fs.renameSync(from, to);
    },
  };
}

function fsWithChangeLockCleanupFailure(changeFile, cleanupError) {
  const lockFile = path.join(path.dirname(changeFile), `.${path.basename(changeFile)}.lock`);
  let lockFd;
  return {
    ...fs,
    openSync(file, flags, mode) {
      const fd = fs.openSync(file, flags, mode);
      if (file === lockFile) lockFd = fd;
      return fd;
    },
    closeSync(fd) {
      if (fd === lockFd) {
        lockFd = undefined;
        fs.closeSync(fd);
        throw cleanupError;
      }
      return fs.closeSync(fd);
    },
  };
}

function refineScaffold(file) {
  fs.writeFileSync(
    file,
    fs.readFileSync(file, 'utf8').replace('<!-- changeledger:spec-scaffold -->\n\n', ''),
  );
}

test('161652 CR3: every graduation write rejects a future schema before writing', () => {
  const mutators = [
    ['--new', ({ id, root }) => scaffoldSpec(id, 'future', root)],
    ['--into', ({ id, root }) => graduate(id, 'future', root, { into: true })],
    ['--skip', ({ id, root }) => skipGraduation(id, 'no durable truth', root)],
  ];

  for (const [name, mutate] of mutators) {
    const fixture = repo();
    const configFile = path.join(fixture.root, '.changeledger', 'config.yml');
    fs.writeFileSync(
      configFile,
      fs.readFileSync(configFile, 'utf8').replace(/^schema_version: \d+$/m, 'schema_version: 6'),
    );
    const before = fs.readFileSync(fixture.file, 'utf8');
    assert.throws(
      () => mutate(fixture),
      /^Error: config schema 6 is newer than supported schema 5; update ChangeLedger before writing$/,
      name,
    );
    assert.equal(fs.readFileSync(fixture.file, 'utf8'), before, name);
    assert.equal(fs.existsSync(path.join(fixture.root, '.changeledger', 'specs')), false, name);
  }
});

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

test('161653 CR1: a failed change rename restores both files byte for byte', () => {
  const { root, file, id } = repo();
  const specFile = seedSpec(root, 'architecture.md', '\n# Arch\n\nCuerpo intacto.\n');
  const before = {
    change: fs.readFileSync(file, 'utf8'),
    spec: fs.readFileSync(specFile, 'utf8'),
  };
  const changeError = new Error('change rename failed');

  assert.throws(
    () =>
      graduate(id, 'architecture', root, {
        into: true,
        fsImpl: fsWithRenameFailures({ changeFile: file, specFile, failChange: changeError }),
      }),
    (error) => error === changeError,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before.change);
  assert.equal(fs.readFileSync(specFile, 'utf8'), before.spec);
});

test('161653 CR2: a failed spec rename leaves both files byte for byte unchanged', () => {
  const { root, file, id } = repo();
  const specFile = seedSpec(root, 'architecture.md', '\n# Arch\n\nCuerpo intacto.\n');
  const before = {
    change: fs.readFileSync(file, 'utf8'),
    spec: fs.readFileSync(specFile, 'utf8'),
  };
  const specError = new Error('spec rename failed');

  assert.throws(
    () =>
      graduate(id, 'architecture', root, {
        into: true,
        fsImpl: fsWithRenameFailures({
          changeFile: file,
          specFile,
          failSpecWrite: specError,
        }),
      }),
    (error) => error === specError,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before.change);
  assert.equal(fs.readFileSync(specFile, 'utf8'), before.spec);
});

test('161653 CR3: change-lock cleanup failure keeps the committed graduation', () => {
  const { root, file, id } = repo();
  const specFile = seedSpec(root, 'architecture.md', '\n# Arch\n\nCuerpo intacto.\n');
  const cleanupError = new Error('change lock cleanup failed');

  assert.throws(
    () =>
      graduate(id, 'architecture', root, {
        into: true,
        fsImpl: fsWithChangeLockCleanupFailure(file, cleanupError),
      }),
    (error) => error === cleanupError,
  );
  assert.deepEqual(parseSpec(fs.readFileSync(specFile, 'utf8')).frontmatter.graduated_from, [id]);
  const change = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(change.frontmatter.reviewed, true);
  assert.match(change.stages.find((stage) => stage.key === 'log').body, /`\[graduation\]`/);
});

test('161653 CR4: spec rollback excludes a competing mutation until compensation completes', () => {
  const { root, file, id } = repo();
  const specFile = seedSpec(root, 'architecture.md', '\n# Arch\n\nCuerpo intacto.\n');
  const specLock = path.join(path.dirname(specFile), `.${path.basename(specFile)}.lock`);
  const changeError = new Error('change rename failed');
  let specRenames = 0;
  let competitorRan = false;
  let lockHeldDuringRollback = false;
  const fsImpl = {
    ...fs,
    renameSync(from, to) {
      if (to === file) throw changeError;
      if (to === specFile) {
        specRenames += 1;
        if (specRenames === 2) {
          lockHeldDuringRollback = fs.existsSync(specLock);
          assert.throws(
            () =>
              withFileLock(
                specFile,
                () => {
                  competitorRan = true;
                },
                { waitMs: 1, retryMs: 1 },
              ),
            /timed out waiting for lock/,
          );
        }
      }
      return fs.renameSync(from, to);
    },
  };

  assert.throws(
    () => graduate(id, 'architecture', root, { into: true, fsImpl }),
    (error) => error === changeError,
  );
  assert.equal(lockHeldDuringRollback, true);
  assert.equal(competitorRan, false);
});

test('161653 CR5: failed rollback preserves the change and rollback errors in order', () => {
  const { root, file, id } = repo();
  const specFile = seedSpec(root, 'architecture.md', '\n# Arch\n\nCuerpo intacto.\n');
  const changeError = new Error('change rename failed');
  const rollbackError = new Error('spec rollback rename failed');
  let thrown;

  try {
    graduate(id, 'architecture', root, {
      into: true,
      fsImpl: fsWithRenameFailures({
        changeFile: file,
        specFile,
        failChange: changeError,
        failSpecRollback: rollbackError,
      }),
    });
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown instanceof AggregateError);
  assert.equal(thrown.message, `graduation failed and spec rollback failed: ${specFile}`);
  assert.equal(thrown.cause, changeError);
  assert.deepEqual(thrown.errors, [changeError, rollbackError]);
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
    { ownerHandle: () => '' },
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

test('103551 CR1: graduate --into rejects change-local criterion headings without writing', () => {
  const { root, file, id } = repo();
  const specFile = seedSpec(
    root,
    'architecture.md',
    '\n# Arch\n\n### CR1 — Copied scenario\n\n- **Then** copied output.\n',
  );
  const before = {
    change: fs.readFileSync(file, 'utf8'),
    spec: fs.readFileSync(specFile, 'utf8'),
  };

  assert.throws(
    () => graduate(id, 'architecture', root, { into: true }),
    /^Error: spec contains change-local criterion heading "CR1"; rewrite it as durable current truth$/,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before.change);
  assert.equal(fs.readFileSync(specFile, 'utf8'), before.spec);
});

test('103551 CR2 correction: graduate rejects a heading after an indented pseudo-fence without writing', () => {
  const { root, file, id } = repo();
  const specFile = seedSpec(
    root,
    'architecture.md',
    '    ```\n### CR33 — Visible after indented code\n',
  );
  const before = {
    change: fs.readFileSync(file, 'utf8'),
    spec: fs.readFileSync(specFile, 'utf8'),
  };

  assert.throws(
    () => graduate(id, 'architecture', root, { into: true }),
    /^Error: spec contains change-local criterion heading "CR33"; rewrite it as durable current truth$/,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before.change);
  assert.equal(fs.readFileSync(specFile, 'utf8'), before.spec);
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

// 20260808-151643 — active-mode routing.

test('CR5: graduate --into on an active repo lands spec + change in exactly one commit', () => {
  const { root, id, changeName } = activatedRepo({
    specName: 'architecture.md',
    specBody: '\n# Arch\n\nCuerpo intacto.\n',
  });
  const before = stateRefTip(root);

  const result = graduate(id, 'architecture', root, { into: true });

  const tip = stateRefTip(root);
  assert.notEqual(tip, before);
  assert.equal(
    execFileSync('git', ['rev-list', '--count', `${before}..${tip}`], {
      encoding: 'utf8',
      cwd: root,
      env: sanitizedEnv(),
    }).trim(),
    '1',
  );
  assert.equal(result, 'specs/architecture.md');

  const changeFm = parseChange(stateDocText(root, tip, `changes/${changeName}`)).frontmatter;
  assert.equal(changeFm.reviewed, true);
  const specText = stateDocText(root, tip, 'specs/architecture.md');
  assert.match(specText, /graduated_from:.*20260613-120000/);
  assert.match(specText, /Cuerpo intacto\./);
  assert.equal(fs.existsSync(path.join(root, STATE_ROOT)), false);
});

test('CR5: graduate --into on an active repo without the spec throws, no write', () => {
  const { root, id } = activatedRepo();
  const before = stateRefTip(root);

  assert.throws(
    () => graduate(id, 'architecture', root, { into: true }),
    /does not exist — use --new/,
  );
  assert.equal(stateRefTip(root), before);
});

test('CR5: graduate --into on an active repo rejects an unrefined scaffold, no write', () => {
  const { root, id } = activatedRepo({
    specName: 'architecture.md',
    specBody: '<!-- changeledger:spec-scaffold -->\n\n# Arch\n',
  });
  const before = stateRefTip(root);

  assert.throws(
    () => graduate(id, 'architecture', root, { into: true }),
    /still contains the scaffold marker/,
  );
  assert.equal(stateRefTip(root), before);
});

test('CR3: scaffoldSpec on an active repo writes only the spec, one commit', () => {
  const { root, id, changeName } = activatedRepo();
  const before = stateRefTip(root);

  const result = scaffoldSpec(id, 'architecture', root);

  const tip = stateRefTip(root);
  assert.notEqual(tip, before);
  assert.equal(result, 'specs/architecture.md');
  assert.match(stateDocText(root, tip, 'specs/architecture.md'), /changeledger:spec-scaffold/);
  // The change itself is untouched by scaffolding.
  assert.equal(
    stateDocText(root, tip, `changes/${changeName}`),
    stateDocText(root, before, `changes/${changeName}`),
  );
});

test('skipGraduation on an active repo marks reviewed and logs the reason, one commit', () => {
  const { root, id, changeName } = activatedRepo();
  const before = stateRefTip(root);

  skipGraduation(id, 'no durable truth', root);

  const tip = stateRefTip(root);
  assert.notEqual(tip, before);
  const fm = parseChange(stateDocText(root, tip, `changes/${changeName}`)).frontmatter;
  assert.equal(fm.reviewed, true);
  assert.match(stateDocText(root, tip, `changes/${changeName}`), /no durable truth/);
  assert.equal(fs.existsSync(path.join(root, STATE_ROOT)), false);
});
