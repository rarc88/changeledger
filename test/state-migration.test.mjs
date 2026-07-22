import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { sanitizedGitEnv } from '../src/git.mjs';
import {
  createStateBaseline,
  doctorStateMigration,
  exportStateRecovery,
  prepareStateActivation,
  previewStateMigration,
} from '../src/state-migration.mjs';
import { CONFIRMED_REF, OBSERVED_REF } from '../src/state-store.mjs';
import { stringifyYaml } from '../src/yaml.mjs';

const OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

function git(root, args, input) {
  return execFileSync('git', args, {
    cwd: root,
    env: sanitizedGitEnv(),
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function change(id, title = 'Demo') {
  return `---
id: "${id}"
title: ${title}
type: quick
status: draft
created: 2026-07-22T00:00:00Z
depends_on: []
---

## Request

${title}.

## Log
`;
}

function config() {
  return `schema_version: 3
project_id: project-1
project_name: Demo
language: en
tdd: false
changes_dir: .changeledger/changes
specs_dir: .changeledger/specs
git:
  integration_branch: dev
statuses: [draft, approved, in-progress, in-review, in-validation, blocked, done, discarded]
stages: [request, investigation, proposal, specification, plan, log]
types:
  quick:
    stages: [request, log]
    review_required: false
release:
  impacts:
    quick: patch
`;
}

function legacyRepo(objectFormat = 'sha1') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-migration-'));
  const init = ['init', '-q', '-b', 'dev'];
  if (objectFormat !== 'sha1') init.push(`--object-format=${objectFormat}`);
  git(root, init);
  git(root, ['config', 'user.name', 'Test User']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  fs.mkdirSync(path.join(root, '.changeledger', 'changes'), { recursive: true });
  fs.mkdirSync(path.join(root, '.changeledger', 'specs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# contract\n');
  fs.writeFileSync(path.join(root, 'keep.txt'), 'keep\n');
  fs.writeFileSync(path.join(root, '.changeledger', 'config.yml'), config());
  fs.writeFileSync(
    path.join(root, '.changeledger', 'changes', '20260722-000000-demo.md'),
    change('20260722-000000'),
  );
  fs.writeFileSync(
    path.join(root, '.changeledger', 'specs', 'demo.md'),
    '---\ntitle: Demo\nupdated: 2026-07-22T00:00:00Z\ntags: []\n---\n\nCurrent truth.\n',
  );
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'chore: legacy']);
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-migration-remote-'));
  const bare = ['init', '--bare', '-q'];
  if (objectFormat !== 'sha1') bare.push(`--object-format=${objectFormat}`);
  git(remote, bare);
  git(root, ['remote', 'add', 'origin', remote]);
  git(root, ['push', '-q', '-u', 'origin', 'dev']);
  return { root, remote, head: git(root, ['rev-parse', 'dev']) };
}

function writePlan(root, text) {
  const file = path.join(root, 'migration-plan.yml');
  fs.writeFileSync(file, text);
  return file;
}

test('193103 CR1/CR2: preview is deterministic and groups logical identities', () => {
  const { root, head } = legacyRepo();
  const beforeStatus = git(root, ['status', '--porcelain=v1']);
  const beforeRefs = git(root, ['for-each-ref', '--format=%(refname) %(objectname)']);

  const first = previewStateMigration({ sources: ['local:refs/heads/dev'] }, root);
  const second = previewStateMigration({ sources: ['local:refs/heads/dev'] }, root);

  assert.equal(first.text, second.text);
  assert.equal(first.plan.sources[0].commit, head);
  assert.deepEqual(
    first.plan.documents.map((entry) => entry.identity),
    ['change:20260722-000000', 'config', 'spec:demo'],
  );
  assert.ok(first.plan.documents.every((entry) => entry.resolution?.blob));
  assert.equal(git(root, ['status', '--porcelain=v1']), beforeStatus);
  assert.equal(git(root, ['for-each-ref', '--format=%(refname) %(objectname)']), beforeRefs);
});

test('193103 CR11/CR12: CLI works before and after authority with JSON receipts', () => {
  const { root } = legacyRepo();
  const cli = path.resolve('bin/changeledger.mjs');
  const runJson = (...args) =>
    JSON.parse(
      execFileSync(process.execPath, [cli, ...args, '--json'], {
        cwd: root,
        encoding: 'utf8',
      }),
    );

  const planFile = path.join(root, 'migration-plan.yml');
  const preview = runJson(
    'state',
    'migrate',
    '--preview',
    '--source',
    'local:refs/heads/dev',
    '--output',
    planFile,
  );
  assert.equal(preview.plan.sources[0].name, 'local:refs/heads/dev');
  assert.equal(preview.written, true);
  assert.equal(preview.network, false);

  const baseline = runJson('state', 'migrate', '--create', '--plan', planFile);
  assert.match(baseline.baseline, OID_PATTERN);
  assert.match(baseline.inventoryDigest, /^[0-9a-f]{64}$/);
  assert.equal(baseline.network, true);

  const activation = runJson('state', 'activate', '--prepare', '--baseline', baseline.baseline);
  assert.match(activation.commit, OID_PATTERN);
  assert.equal(activation.baseline, baseline.baseline);

  const diagnosis = runJson('state', 'doctor', '--activation-ref', activation.branch);
  assert.equal(diagnosis.ok, true);
  assert.equal(diagnosis.network, false);

  git(root, ['update-ref', CONFIRMED_REF, baseline.baseline]);
  git(root, ['update-ref', OBSERVED_REF, baseline.baseline]);
  git(root, ['checkout', '-q', activation.branch]);
  git(root, ['branch', '-f', 'dev', activation.commit]);
  git(root, ['checkout', '-q', 'dev']);
  const recovery = runJson('state', 'export', '--recovery-branch');
  assert.equal(recovery.confirmed, baseline.baseline);
  assert.equal(recovery.network, false);
  assert.equal(recovery.written, true);
});

test('193103 CR2/CR4: divergent identity and stale plans fail before publication', () => {
  const { root } = legacyRepo();
  git(root, ['checkout', '-qb', 'other']);
  fs.writeFileSync(
    path.join(root, '.changeledger', 'changes', '20260722-000000-demo.md'),
    change('20260722-000000', 'Different'),
  );
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'test: diverge']);

  const preview = previewStateMigration(
    { sources: ['local:refs/heads/dev', 'local:refs/heads/other'] },
    root,
  );
  const conflict = preview.plan.documents.find(
    (entry) => entry.identity === 'change:20260722-000000',
  );
  assert.equal(conflict.resolution, null);
  assert.throws(
    () => createStateBaseline({ planFile: writePlan(root, preview.text) }, root),
    /migration conflict: change:20260722-000000 has divergent candidates/,
  );

  const clean = previewStateMigration({ sources: ['local:refs/heads/dev'] }, root);
  git(root, ['checkout', '-q', 'dev']);
  fs.writeFileSync(path.join(root, 'advance.txt'), 'advance\n');
  git(root, ['add', 'advance.txt']);
  git(root, ['commit', '-qm', 'test: advance']);
  assert.throws(
    () => createStateBaseline({ planFile: writePlan(root, clean.text) }, root),
    /migration plan is stale.*expected.*actual/s,
  );
  assert.equal(git(root, ['ls-remote', '--refs', 'origin', 'refs/heads/changeledger/state']), '');
});

test('193103 CR4: edited inventory cannot retain the preview digest', () => {
  const { root } = legacyRepo();
  const preview = previewStateMigration({ sources: ['local:refs/heads/dev'] }, root);
  preview.plan.documents[0].candidates[0].path = '.changeledger/changes/forged.md';

  assert.throws(
    () => createStateBaseline({ planFile: writePlan(root, stringifyYaml(preview.plan)) }, root),
    /migration plan integrity check failed: inventory_digest does not match inventory/,
  );
  assert.equal(git(root, ['ls-remote', '--refs', 'origin', 'refs/heads/changeledger/state']), '');
});

for (const objectFormat of ['sha1', 'sha256']) {
  test(`193103 CR1/CR3: tree inventory preserves NUL-framed names with ${objectFormat}`, (t) => {
    let fixture;
    try {
      fixture = legacyRepo(objectFormat);
    } catch (error) {
      if (objectFormat === 'sha256' && /unknown|unsupported|object-format/i.test(error.message)) {
        t.skip('Git build has no SHA-256 repository support');
        return;
      }
      throw error;
    }
    const { root } = fixture;
    const oddName = 'line\nbreak.md';
    fs.writeFileSync(
      path.join(root, '.changeledger', 'specs', oddName),
      '---\ntitle: Odd\nupdated: 2026-07-22T00:00:00Z\ntags: []\n---\n\nOdd.\n',
    );
    git(root, ['add', '.changeledger/specs']);
    git(root, ['commit', '-qm', 'test: odd path']);

    const preview = previewStateMigration({ sources: ['local:refs/heads/dev'] }, root);
    const odd = preview.plan.documents.find((entry) => entry.identity === 'spec:line\nbreak');
    assert.equal(odd.resolution.basename, oddName);
    const result = createStateBaseline({ planFile: writePlan(root, preview.text) }, root);
    const tree = git(root, ['ls-tree', '-r', '-z', '--name-only', result.baseline]);
    assert.ok(tree.split('\0').includes(`.changeledger-state/specs/${oddName}`));
  });
}

test('193103 CR3: symlinks and gitlinks fail closed without checkout', () => {
  const { root } = legacyRepo();
  fs.symlinkSync('demo.md', path.join(root, '.changeledger', 'specs', 'alias.md'));
  git(root, ['add', '.changeledger/specs/alias.md']);
  git(root, ['commit', '-qm', 'test: symlink']);
  const branch = git(root, ['branch', '--show-current']);

  assert.throws(
    () => previewStateMigration({ sources: ['local:refs/heads/dev'] }, root),
    /unsupported Git entry 120000 blob.*alias\.md/,
  );
  assert.equal(git(root, ['branch', '--show-current']), branch);
});

test('193103 CR5/CR6/CR8: baseline and activation are idempotent without checkout', () => {
  const { root } = legacyRepo();
  const preview = previewStateMigration({ sources: ['origin:refs/heads/dev'] }, root);
  const planFile = writePlan(root, preview.text);

  const first = createStateBaseline({ planFile }, root);
  const second = createStateBaseline({ planFile }, root);
  assert.equal(first.baseline, second.baseline);
  assert.equal(first.inventoryDigest, preview.plan.inventory_digest);
  assert.match(
    git(root, ['ls-remote', '--refs', 'origin', 'refs/heads/changeledger/state']),
    new RegExp(`^${first.baseline}\\s`),
  );

  const branchBefore = git(root, ['branch', '--show-current']);
  const worktreeBefore = git(root, ['status', '--porcelain=v1']);
  const activation = prepareStateActivation({ baseline: first.baseline }, root);
  const repeated = prepareStateActivation({ baseline: first.baseline }, root);
  assert.equal(repeated.commit, activation.commit);
  assert.equal(git(root, ['branch', '--show-current']), branchBefore);
  assert.equal(git(root, ['status', '--porcelain=v1']), worktreeBefore);
  assert.equal(git(root, ['show', `${activation.commit}:keep.txt`]), 'keep');
  assert.throws(() => git(root, ['show', `${activation.commit}:.changeledger/config.yml`]));
  assert.match(
    git(root, ['show', `${activation.commit}:.changeledger/authority.yml`]),
    new RegExp(`baseline: ${first.baseline}`),
  );
  const parent = git(root, ['rev-parse', `${activation.commit}^`]);
  const inverse = git(root, [
    'diff-tree',
    '--no-commit-id',
    '--name-status',
    '-r',
    activation.commit,
  ]);
  assert.equal(parent, git(root, ['rev-parse', 'dev']));
  assert.match(inverse, /D\s+\.changeledger\/config\.yml/);
  assert.match(inverse, /A\s+\.changeledger\/authority\.yml/);

  git(root, ['branch', '-f', activation.branch, parent]);
  assert.throws(
    () => prepareStateActivation({ baseline: first.baseline }, root),
    /already exists with different content/,
  );
  assert.equal(git(root, ['rev-parse', activation.branch]), parent);
});

test('193103 CR9/CR10: doctor inspects activation and recovery exports confirmed state', () => {
  const { root } = legacyRepo();
  const preview = previewStateMigration({ sources: ['origin:refs/heads/dev'] }, root);
  const baseline = createStateBaseline({ planFile: writePlan(root, preview.text) }, root);
  const activation = prepareStateActivation({ baseline: baseline.baseline }, root);

  const diagnosis = doctorStateMigration({ activationRef: activation.branch }, root);
  assert.equal(diagnosis.ok, true);
  assert.equal(diagnosis.baseline, baseline.baseline);
  assert.equal(diagnosis.network, false);

  git(root, ['update-ref', CONFIRMED_REF, baseline.baseline]);
  git(root, ['update-ref', OBSERVED_REF, baseline.baseline]);
  git(root, ['checkout', '-q', activation.branch]);
  git(root, ['branch', '-f', 'dev', activation.commit]);
  git(root, ['checkout', '-q', 'dev']);
  const recovery = exportStateRecovery(root);
  assert.equal(git(root, ['branch', '--show-current']), 'dev');
  assert.equal(git(root, ['show', `${recovery.commit}:.changeledger/config.yml`]), config().trim());
  assert.throws(() => git(root, ['show', `${recovery.commit}:.changeledger/authority.yml`]));
});

test('193103 CR9: recovery rejects pending, stale observation and branch collision atomically', () => {
  const { root } = legacyRepo();
  const preview = previewStateMigration({ sources: ['origin:refs/heads/dev'] }, root);
  const baseline = createStateBaseline({ planFile: writePlan(root, preview.text) }, root);
  const activation = prepareStateActivation({ baseline: baseline.baseline }, root);
  git(root, ['update-ref', CONFIRMED_REF, baseline.baseline]);
  git(root, ['update-ref', OBSERVED_REF, baseline.baseline]);
  git(root, ['checkout', '-q', activation.branch]);
  git(root, ['branch', '-f', 'dev', activation.commit]);
  git(root, ['checkout', '-q', 'dev']);
  const before = git(root, ['status', '--porcelain=v1']);

  git(root, ['update-ref', 'refs/changeledger/pending', baseline.baseline]);
  assert.throws(() => exportStateRecovery(root), /requires no refs\/changeledger\/pending/);
  git(root, ['update-ref', '-d', 'refs/changeledger/pending']);

  git(root, ['update-ref', OBSERVED_REF, activation.commit]);
  assert.throws(() => exportStateRecovery(root), /requires a fresh confirmed state/);
  git(root, ['update-ref', OBSERVED_REF, baseline.baseline]);

  const branch = `changeledger/recover-${baseline.baseline.slice(0, 12)}`;
  git(root, ['branch', branch, activation.commit]);
  assert.throws(() => exportStateRecovery(root), /already exists with different content/);
  assert.equal(git(root, ['rev-parse', branch]), activation.commit);
  assert.equal(git(root, ['status', '--porcelain=v1']), before);
});
