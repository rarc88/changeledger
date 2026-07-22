import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
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
import { CONFIRMED_REF, OBSERVED_REF, PENDING_REF } from '../src/state-store.mjs';
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

test('193103 CR1: remote preview fetches objects without moving user-visible refs', () => {
  const { root, head } = legacyRepo();
  fs.writeFileSync(path.join(root, 'advance.txt'), 'advance\n');
  git(root, ['add', 'advance.txt']);
  git(root, ['commit', '-qm', 'test: advance source']);
  const advanced = git(root, ['rev-parse', 'dev']);
  git(root, ['push', '-q', 'origin', 'dev']);
  git(root, ['update-ref', 'refs/remotes/origin/dev', head]);
  const fetchHead = path.join(root, '.git', 'FETCH_HEAD');
  const beforeFetchHead = fs.existsSync(fetchHead) ? fs.readFileSync(fetchHead, 'utf8') : null;

  const preview = previewStateMigration({ sources: ['origin:refs/heads/dev'] }, root);

  assert.equal(preview.plan.sources[0].commit, advanced);
  assert.equal(git(root, ['rev-parse', 'dev']), advanced);
  assert.equal(git(root, ['rev-parse', 'refs/remotes/origin/dev']), head);
  assert.equal(
    fs.existsSync(fetchHead) ? fs.readFileSync(fetchHead, 'utf8') : null,
    beforeFetchHead,
  );
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
  assert.match(preview.inventoryDigest, /^[0-9a-f]{64}$/);
  assert.equal(preview.baseline, null);
  assert.equal(preview.branch, null);
  assert.equal(preview.sources[0].name, 'local:refs/heads/dev');

  const baseline = runJson('state', 'migrate', '--create', '--plan', planFile);
  assert.match(baseline.baseline, OID_PATTERN);
  assert.match(baseline.inventoryDigest, /^[0-9a-f]{64}$/);
  assert.equal(baseline.network, true);

  const activation = runJson('state', 'activate', '--prepare', '--baseline', baseline.baseline);
  assert.match(activation.commit, OID_PATTERN);
  assert.equal(activation.baseline, baseline.baseline);
  const humanActivation = execFileSync(
    process.execPath,
    [cli, 'state', 'activate', '--prepare', '--baseline', baseline.baseline],
    { cwd: root, encoding: 'utf8' },
  );
  assert.match(humanActivation, /Receipt:/);
  assert.match(humanActivation, /local:refs\/heads\/dev/);
  assert.match(humanActivation, new RegExp(preview.plan.sources[0].commit));

  const diagnosis = runJson('state', 'doctor', '--activation-ref', activation.branch);
  assert.equal(diagnosis.ok, true);
  assert.equal(diagnosis.network, false);

  git(root, ['update-ref', CONFIRMED_REF, baseline.baseline]);
  git(root, ['update-ref', OBSERVED_REF, baseline.baseline]);
  git(root, ['checkout', '-q', activation.branch]);
  git(root, ['branch', '-f', 'dev', activation.commit]);
  git(root, ['checkout', '-q', 'dev']);
  git(root, ['update-ref', PENDING_REF, baseline.baseline]);
  const blockedExport = spawnSync(
    process.execPath,
    [cli, 'state', 'export', '--recovery-branch', '--json'],
    { cwd: root, encoding: 'utf8' },
  );
  assert.notEqual(blockedExport.status, 0);
  const blockedReceipt = JSON.parse(blockedExport.stderr);
  assert.equal(blockedReceipt.baseline, baseline.baseline);
  assert.equal(blockedReceipt.inventoryDigest, baseline.inventoryDigest);
  assert.equal(blockedReceipt.sources[0].name, 'local:refs/heads/dev');
  assert.equal(blockedReceipt.branch, `changeledger/recover-${baseline.baseline.slice(0, 12)}`);
  assert.equal(blockedReceipt.ref, `refs/heads/${blockedReceipt.branch}`);
  assert.equal(blockedReceipt.network, false);
  assert.equal(blockedReceipt.written, false);
  git(root, ['update-ref', '-d', PENDING_REF]);
  const recovery = runJson('state', 'export', '--recovery-branch');
  assert.equal(recovery.confirmed, baseline.baseline);
  assert.equal(recovery.network, false);
  assert.equal(recovery.written, true);
  assert.equal(recovery.baseline, baseline.baseline);
  assert.equal(recovery.inventoryDigest, baseline.inventoryDigest);
});

test('193103 CR12: JSON failures are machine-readable complete receipts', () => {
  const { root } = legacyRepo();
  const cli = path.resolve('bin/changeledger.mjs');
  const commands = [
    ['migrate', ['state', 'migrate', '--preview', '--json'], false],
    ['migrate', ['state', 'migrate', '--create', '--json'], false],
    [
      'migrate',
      ['state', 'migrate', '--preview', '--source', 'origin:refs/heads/missing', '--json'],
      true,
    ],
    ['activate', ['state', 'activate', '--baseline', 'f'.repeat(40), '--json'], false],
    ['activate', ['state', 'activate', '--prepare', '--json'], false],
    ['activate', ['state', 'activate', '--prepare', '--baseline', 'f'.repeat(40), '--json'], true],
    ['doctor', ['state', 'doctor', '--activation-ref', 'refs/heads/missing', '--json'], false],
    ['doctor', ['state', 'doctor', '--json'], false],
    ['export', ['state', 'export', '--recovery-branch', '--json'], false],
  ];
  for (const [command, args, network] of commands) {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
    assert.notEqual(result.status, 0, command);
    const receipt = JSON.parse(result.stderr);
    assert.equal(receipt.ok, false, command);
    assert.equal(receipt.command, command, command);
    assert.equal(receipt.network, network, command);
    assert.equal(receipt.written, false, command);
    assert.ok(Object.hasOwn(receipt, 'sources'), command);
    assert.ok(Object.hasOwn(receipt, 'sourceOids'), command);
    assert.ok(Object.hasOwn(receipt, 'baseline'), command);
    assert.ok(Object.hasOwn(receipt, 'branch'), command);
    assert.ok(Object.hasOwn(receipt, 'ref'), command);
    assert.ok(Object.hasOwn(receipt, 'inventoryDigest'), command);
    assert.match(receipt.error, /./, command);
  }
});

test('193103 CR12: failure receipts retain every source OID observed before failure', () => {
  const { root } = legacyRepo();
  const cli = path.resolve('bin/changeledger.mjs');
  const localOid = git(root, ['rev-parse', 'refs/heads/dev']);

  const result = spawnSync(
    process.execPath,
    [
      cli,
      'state',
      'migrate',
      '--preview',
      '--source',
      'local:refs/heads/dev',
      '--source',
      'origin:refs/heads/missing',
      '--json',
    ],
    { cwd: root, encoding: 'utf8' },
  );

  assert.notEqual(result.status, 0);
  const receipt = JSON.parse(result.stderr);
  assert.equal(receipt.sourceOids['local:refs/heads/dev'], localOid);
  assert.equal(
    receipt.sources.find((source) => source.name === 'local:refs/heads/dev').commit,
    localOid,
  );
  assert.equal(receipt.sourceOids['origin:refs/heads/missing'], null);
  assert.equal(receipt.network, true);
  assert.equal(receipt.written, false);
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

test('193103 CR4: replacement content is rehashed before any publication', () => {
  const { root } = legacyRepo();
  const preview = previewStateMigration({ sources: ['local:refs/heads/dev'] }, root);
  const replacement = 'replacement.md';
  const replacementFile = path.join(root, replacement);
  const original = change('20260722-000000', 'Replacement');
  fs.writeFileSync(replacementFile, original);
  const document = preview.plan.documents.find(
    (entry) => entry.identity === 'change:20260722-000000',
  );
  document.resolution = {
    replacement,
    basename: '20260722-000000-demo.md',
    sha256: crypto.createHash('sha256').update(original).digest('hex'),
  };
  const planFile = writePlan(root, stringifyYaml(preview.plan));
  fs.writeFileSync(replacementFile, change('20260722-000000', 'Changed later'));

  assert.throws(
    () => createStateBaseline({ planFile }, root),
    /migration plan is stale: replacement replacement\.md expected .* actual .*/,
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
  fs.symlinkSync('demo.md', path.join(root, '.changeledger', 'specs', 'alias'));
  git(root, ['add', '.changeledger/specs/alias']);
  git(root, ['commit', '-qm', 'test: symlink']);
  const branch = git(root, ['branch', '--show-current']);

  assert.throws(
    () => previewStateMigration({ sources: ['local:refs/heads/dev'] }, root),
    /migration source local:refs\/heads\/dev.*unsupported Git entry 120000 blob.*alias/s,
  );
  assert.equal(git(root, ['branch', '--show-current']), branch);

  git(root, ['reset', '--hard', 'HEAD^']);
  const head = git(root, ['rev-parse', 'HEAD']);
  git(root, ['update-index', '--add', '--cacheinfo', `160000,${head},.changeledger/specs/module`]);
  git(root, ['commit', '-qm', 'test: gitlink']);
  assert.throws(
    () => previewStateMigration({ sources: ['local:refs/heads/dev'] }, root),
    /migration source local:refs\/heads\/dev.*unsupported Git entry 160000 commit.*module/s,
  );
});

test('193103 CR3: invalid documents report source, commit and path', () => {
  const { root } = legacyRepo();
  const file = '.changeledger/specs/broken.md';
  fs.writeFileSync(path.join(root, file), 'not frontmatter\n');
  git(root, ['add', file]);
  git(root, ['commit', '-qm', 'test: invalid document']);
  const head = git(root, ['rev-parse', 'HEAD']);

  assert.throws(
    () => previewStateMigration({ sources: ['local:refs/heads/dev'] }, root),
    new RegExp(`local:refs/heads/dev.*${head}.*\\.changeledger/specs/broken\\.md`, 's'),
  );

  const escaped = legacyRepo();
  const escapedConfig = path.join(escaped.root, '.changeledger', 'config.yml');
  fs.writeFileSync(
    escapedConfig,
    fs
      .readFileSync(escapedConfig, 'utf8')
      .replace('changes_dir: .changeledger/changes', 'changes_dir: ../outside'),
  );
  git(escaped.root, ['add', escapedConfig]);
  git(escaped.root, ['commit', '-qm', 'test: escaped path']);
  const escapedHead = git(escaped.root, ['rev-parse', 'HEAD']);
  assert.throws(
    () => previewStateMigration({ sources: ['local:refs/heads/dev'] }, escaped.root),
    new RegExp(`local:refs/heads/dev.*${escapedHead}.*\\.changeledger/config\\.yml`, 's'),
  );
});

for (const objectFormat of ['sha1', 'sha256']) {
  test(`163405 CR1/CR2/CR3: blob fidelity holds with ${objectFormat}`, (t) => {
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

    const validFile = '.changeledger/specs/tilde.md';
    fs.writeFileSync(
      path.join(root, validFile),
      '---\ntitle: café\nupdated: 2026-07-22T00:00:00Z\ntags: []\n---\n\n✓ válido.\n',
    );
    git(root, ['add', validFile]);
    git(root, ['commit', '-qm', 'test: valid utf8']);
    const sourceBlob = git(root, ['rev-parse', `HEAD:${validFile}`]);

    const preview = previewStateMigration({ sources: ['local:refs/heads/dev'] }, root);
    const baseline = createStateBaseline({ planFile: writePlan(root, preview.text) }, root);
    const stateBlob = git(root, [
      'rev-parse',
      `${baseline.baseline}:.changeledger-state/specs/tilde.md`,
    ]);
    assert.equal(stateBlob, sourceBlob, 'valid UTF-8 content must keep its exact source blob OID');

    prepareStateActivation({ baseline: baseline.baseline }, root);

    const brokenRoot = legacyRepo(objectFormat).root;
    const brokenFile = '.changeledger/specs/broken-encoding.md';
    const bytes = Buffer.concat([
      Buffer.from('---\ntitle: '),
      Buffer.from([0xe9]),
      Buffer.from('\nupdated: 2026-07-22T00:00:00Z\ntags: []\n---\n\nBroken.\n'),
    ]);
    fs.writeFileSync(path.join(brokenRoot, brokenFile), bytes);
    git(brokenRoot, ['add', brokenFile]);
    git(brokenRoot, ['commit', '-qm', 'test: invalid encoding']);
    const brokenHead = git(brokenRoot, ['rev-parse', 'HEAD']);
    const brokenBlob = git(brokenRoot, ['rev-parse', `HEAD:${brokenFile}`]);

    let caught;
    try {
      previewStateMigration({ sources: ['local:refs/heads/dev'] }, brokenRoot);
      assert.fail('expected preview to reject invalid UTF-8');
    } catch (error) {
      caught = error;
    }
    assert.match(
      caught.message,
      new RegExp(`local:refs/heads/dev at ${brokenHead}:${brokenFile.replaceAll('.', '\\.')}`),
    );
    assert.match(caught.message, new RegExp(brokenBlob));
    assert.match(caught.message, /not valid UTF-8/);
    assert.equal(
      git(brokenRoot, ['ls-remote', '--refs', 'origin', 'refs/heads/changeledger/state']),
      '',
    );
  });
}

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

  git(root, ['branch', 'test-revert', activation.commit]);
  git(root, ['checkout', '-q', 'test-revert']);
  git(root, ['revert', '--no-edit', activation.commit]);
  assert.equal(
    git(root, ['rev-parse', 'HEAD^{tree}']),
    git(root, ['rev-parse', `${parent}^{tree}`]),
  );
  git(root, ['checkout', '-q', 'dev']);
  git(root, ['branch', '-D', 'test-revert']);

  git(root, ['branch', '-f', activation.branch, parent]);
  assert.throws(
    () => prepareStateActivation({ baseline: first.baseline }, root),
    /already exists with different content/,
  );
  assert.equal(git(root, ['rev-parse', activation.branch]), parent);
});

test('193103 CR6/CR8: activation removes the exact integration inventory, including losing candidates', () => {
  const { root } = legacyRepo();
  git(root, ['checkout', '-qb', 'other']);
  fs.rmSync(path.join(root, '.changeledger', 'changes', '20260722-000000-demo.md'));
  fs.writeFileSync(
    path.join(root, '.changeledger', 'changes', '20260722-000000-renamed.md'),
    change('20260722-000000', 'Chosen elsewhere'),
  );
  git(root, ['add', '.changeledger/changes']);
  git(root, ['commit', '-qm', 'test: alternate candidate']);
  const preview = previewStateMigration(
    { sources: ['local:refs/heads/dev', 'local:refs/heads/other'] },
    root,
  );
  const document = preview.plan.documents.find(
    (entry) => entry.identity === 'change:20260722-000000',
  );
  const chosen = document.candidates.find((candidate) => candidate.source.endsWith('/other'));
  document.resolution = { blob: chosen.blob, basename: chosen.basename };
  const baseline = createStateBaseline(
    { planFile: writePlan(root, stringifyYaml(preview.plan)) },
    root,
  );
  const activation = prepareStateActivation({ baseline: baseline.baseline }, root);

  assert.throws(() =>
    git(root, ['show', `${activation.commit}:.changeledger/changes/20260722-000000-demo.md`]),
  );
  assert.equal(
    git(root, ['show', `${activation.commit}^:.changeledger/changes/20260722-000000-demo.md`]),
    change('20260722-000000').trim(),
  );
  assert.equal(git(root, ['show', `${activation.commit}:keep.txt`]), 'keep');
});

test('193103 CR6: activation guards the integration head atomically with branch creation', () => {
  const { root } = legacyRepo();
  const preview = previewStateMigration({ sources: ['origin:refs/heads/dev'] }, root);
  const baseline = createStateBaseline({ planFile: writePlan(root, preview.text) }, root);
  const branch = `changeledger/activate-${baseline.baseline.slice(0, 12)}`;

  assert.throws(
    () =>
      prepareStateActivation(
        {
          baseline: baseline.baseline,
          beforeRefTransaction: () =>
            git(root, ['update-ref', 'refs/heads/dev', baseline.baseline]),
        },
        root,
      ),
    /state refs changed concurrently/,
  );
  assert.throws(() => git(root, ['rev-parse', '--verify', branch]));
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

test('193103 CR10: doctor rejects an activation tree with unrelated changes', () => {
  const { root } = legacyRepo();
  const preview = previewStateMigration({ sources: ['origin:refs/heads/dev'] }, root);
  const baseline = createStateBaseline({ planFile: writePlan(root, preview.text) }, root);
  const activation = prepareStateActivation({ baseline: baseline.baseline }, root);
  git(root, ['checkout', '-q', activation.branch]);
  fs.rmSync(path.join(root, 'keep.txt'));
  git(root, ['add', '-u', 'keep.txt']);
  git(root, ['commit', '--amend', '--no-edit', '-q']);

  const diagnosis = doctorStateMigration({ activationRef: activation.branch }, root);
  assert.equal(diagnosis.ok, false);
  assert.match(diagnosis.problems.join('\n'), /activation tree does not match exact cutover/);
});

test('193103 CR10: doctor distinguishes local and online source divergence', () => {
  const { root } = legacyRepo();
  git(root, ['branch', 'other', 'dev']);
  const localPreview = previewStateMigration(
    {
      sources: ['local:refs/heads/dev', 'local:refs/heads/other', 'origin:refs/heads/dev'],
    },
    root,
  );
  const localBaseline = createStateBaseline({ planFile: writePlan(root, localPreview.text) }, root);
  const activation = prepareStateActivation({ baseline: localBaseline.baseline }, root);
  git(root, ['checkout', '-q', 'other']);
  fs.writeFileSync(path.join(root, 'other.txt'), 'advanced\n');
  git(root, ['add', 'other.txt']);
  git(root, ['commit', '-qm', 'test: advance local source']);
  git(root, ['checkout', '-q', 'dev']);

  const local = doctorStateMigration({ activationRef: activation.branch }, root);
  assert.equal(local.ok, false);
  assert.match(local.categories.data_divergence.join('\n'), /local:refs\/heads\/other/);
  assert.equal(local.sources.find((source) => source.name.endsWith('/other')).network, false);

  git(root, ['checkout', '-qb', 'remote-advance', 'dev']);
  fs.writeFileSync(path.join(root, 'remote.txt'), 'advanced\n');
  git(root, ['add', 'remote.txt']);
  git(root, ['commit', '-qm', 'test: advance remote source']);
  git(root, ['push', '-q', 'origin', 'remote-advance:refs/heads/dev']);
  git(root, ['checkout', '-q', 'dev']);
  const online = doctorStateMigration({ activationRef: activation.branch, online: true }, root);
  assert.equal(online.ok, false);
  assert.match(online.categories.data_divergence.join('\n'), /origin:refs\/heads\/dev/);
  assert.equal(online.sources.find((source) => source.name.startsWith('origin:')).network, true);
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

test('193103 CR9: recovery requires active authority on the guarded integration head', () => {
  const setup = () => {
    const { root } = legacyRepo();
    const preview = previewStateMigration({ sources: ['origin:refs/heads/dev'] }, root);
    const baseline = createStateBaseline({ planFile: writePlan(root, preview.text) }, root);
    const activation = prepareStateActivation({ baseline: baseline.baseline }, root);
    git(root, ['update-ref', CONFIRMED_REF, baseline.baseline]);
    git(root, ['update-ref', OBSERVED_REF, baseline.baseline]);
    git(root, ['checkout', '-q', activation.branch]);
    return { root, baseline, activation };
  };

  const absent = setup();
  git(absent.root, ['branch', '-f', 'dev', `${absent.activation.commit}^`]);
  assert.throws(() => exportStateRecovery(absent.root), /integration authority is missing/);
  assert.throws(() =>
    git(absent.root, [
      'rev-parse',
      '--verify',
      `changeledger/recover-${absent.baseline.baseline.slice(0, 12)}`,
    ]),
  );

  const mismatched = setup();
  git(mismatched.root, ['checkout', '-qb', 'mismatched-authority']);
  const authority = path.join(mismatched.root, '.changeledger', 'authority.yml');
  fs.writeFileSync(
    authority,
    fs.readFileSync(authority, 'utf8').replace('project_id: project-1', 'project_id: other'),
  );
  git(mismatched.root, ['add', authority]);
  git(mismatched.root, ['commit', '-qm', 'test: mismatched integration authority']);
  const mismatchedHead = git(mismatched.root, ['rev-parse', 'HEAD']);
  git(mismatched.root, ['checkout', '-q', mismatched.activation.branch]);
  git(mismatched.root, ['branch', '-f', 'dev', mismatchedHead]);
  assert.throws(
    () => exportStateRecovery(mismatched.root),
    /integration authority does not match active authority/,
  );
});

test('193103 CR9: recovery verifies the replica snapshot atomically with branch creation', () => {
  const { root } = legacyRepo();
  const preview = previewStateMigration({ sources: ['origin:refs/heads/dev'] }, root);
  const baseline = createStateBaseline({ planFile: writePlan(root, preview.text) }, root);
  const activation = prepareStateActivation({ baseline: baseline.baseline }, root);
  git(root, ['update-ref', CONFIRMED_REF, baseline.baseline]);
  git(root, ['update-ref', OBSERVED_REF, baseline.baseline]);
  git(root, ['checkout', '-q', activation.branch]);
  git(root, ['branch', '-f', 'dev', activation.commit]);
  git(root, ['checkout', '-q', 'dev']);
  const branch = `changeledger/recover-${baseline.baseline.slice(0, 12)}`;

  assert.throws(
    () =>
      exportStateRecovery(root, {
        beforeRefTransaction: () =>
          git(root, ['update-ref', CONFIRMED_REF, activation.commit, baseline.baseline]),
      }),
    /changed concurrently/,
  );
  assert.throws(() => git(root, ['rev-parse', '--verify', branch]));
});
