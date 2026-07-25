import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { migrateStructuredSections } from '../src/fix.mjs';
import { sanitizedGitEnv } from '../src/git.mjs';
import {
  createStateBaseline,
  deactivateStateActivation,
  doctorStateMigration,
  exportStateRecovery,
  installStateActivation,
  prepareStateActivation,
  previewStateMigration,
  previewStateMigrationPlan,
} from '../src/state-migration.mjs';
import { CONFIRMED_REF, OBSERVED_REF, PENDING_REF } from '../src/state-store.mjs';

const ACTIVATION_REF = 'refs/changeledger/activation';

import { parseYaml, stringifyYaml } from '../src/yaml.mjs';

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

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

// A real legacy ledger equivalent to the one the 20260721-193106 production
// audit reproduced: task-metadata and Log-event formats accepted by a prior
// ChangeLedger version, versioned under test/fixtures/<fixture>/ instead of
// synthesized inline (20260722-185043 CR5). `legacy-ledger` migrates cleanly
// end to end; `legacy-ledger-unnormalizable` isolates a document no
// normalizer covers, which must still fail the whole source closed.
function fixtureLedgerRepo(fixture, objectFormat = 'sha1') {
  const fixtureRoot = path.join(import.meta.dirname, 'fixtures', fixture);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `changeledger-${fixture}-`));
  const init = ['init', '-q', '-b', 'dev'];
  if (objectFormat !== 'sha1') init.push(`--object-format=${objectFormat}`);
  git(root, init);
  git(root, ['config', 'user.name', 'Test User']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  fs.mkdirSync(path.join(root, '.changeledger', 'specs'), { recursive: true });
  fs.copyFileSync(
    path.join(fixtureRoot, 'config.yml'),
    path.join(root, '.changeledger', 'config.yml'),
  );
  copyDir(path.join(fixtureRoot, 'changes'), path.join(root, '.changeledger', 'changes'));
  if (fs.existsSync(path.join(fixtureRoot, 'specs'))) {
    copyDir(path.join(fixtureRoot, 'specs'), path.join(root, '.changeledger', 'specs'));
  }
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'chore: legacy ledger']);
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), `changeledger-${fixture}-remote-`));
  const bare = ['init', '--bare', '-q'];
  if (objectFormat !== 'sha1') bare.push(`--object-format=${objectFormat}`);
  git(remote, bare);
  git(root, ['remote', 'add', 'origin', remote]);
  git(root, ['push', '-q', '-u', 'origin', 'dev']);
  return { root, remote, head: git(root, ['rev-parse', 'dev']) };
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

test('104052 CR1: an annotated tag source records its commit, by either route', () => {
  const { root, head } = legacyRepo();
  git(root, ['tag', '-a', 'v1', '-m', 'release one', head]);
  git(root, ['push', '-q', 'origin', 'refs/tags/v1']);
  const tag = git(root, ['rev-parse', 'refs/tags/v1']);
  assert.notEqual(tag, head, 'an annotated tag must be its own object');

  const local = previewStateMigration({ sources: ['local:refs/tags/v1'] }, root);
  const remote = previewStateMigration({ sources: ['origin:refs/tags/v1'] }, root);

  // A source is a ref a human named, so peeling is the expected reading -- but
  // both routes must peel identically, or what the plan pins depends on how the
  // command was worded rather than on what it points at (audit row MIG-05).
  assert.equal(local.plan.sources[0].commit, head);
  assert.equal(remote.plan.sources[0].commit, head);
  for (const plan of [local.plan, remote.plan]) {
    for (const document of plan.documents) {
      for (const candidate of document.candidates) assert.equal(candidate.commit, head);
    }
  }
  // The digests legitimately differ: the inventory pins how the source was named
  // (`name`, `kind`, `remote`, and each candidate's `source`), which is real
  // provenance. Everything else must match, which is the determinism that broke.
  const withoutSourceNaming = (plan) => ({
    ...plan,
    inventory_digest: null,
    sources: plan.sources.map(({ commit, ref }) => ({ commit, ref })),
    documents: plan.documents.map((document) => ({
      ...document,
      candidates: document.candidates.map(({ source, ...rest }) => rest),
    })),
  });
  assert.deepEqual(withoutSourceNaming(local.plan), withoutSourceNaming(remote.plan));
  assert.notEqual(local.plan.inventory_digest, remote.plan.inventory_digest);
});

// The published state ref is truth the system reads about itself, so unlike a
// source ref a human named it must *be* a commit. `update-ref` and receive-pack
// both refuse to create this condition, so the remote's loose ref is written by
// hand -- the same vector audit row MIG-04 reproduced.
function corruptRemoteStateRef(remote, oid) {
  const loose = path.join(remote, 'refs', 'heads', 'changeledger', 'state');
  fs.mkdirSync(path.dirname(loose), { recursive: true });
  fs.writeFileSync(loose, `${oid}\n`);
  const packed = path.join(remote, 'packed-refs');
  if (fs.existsSync(packed)) {
    fs.writeFileSync(
      packed,
      fs
        .readFileSync(packed, 'utf8')
        .split('\n')
        .filter((line) => !line.includes('refs/heads/changeledger/state'))
        .join('\n'),
    );
  }
}

for (const kind of ['tag', 'blob', 'tree']) {
  test(`104052 CR2: create refuses a published state ref that is a ${kind}`, () => {
    const { root, remote } = legacyRepo();
    const preview = previewStateMigration({ sources: ['local:refs/heads/dev'] }, root);
    const planFile = writePlan(root, preview.text);
    const first = createStateBaseline({ planFile }, root);

    // The tree and the manifest blob already live in the remote's object store,
    // reachable from the baseline commit that was just published; only the tag
    // has to be sent, and it can only go to a tag ref -- git refuses to write a
    // non-commit to a branch, which is exactly why the state ref below must be
    // corrupted by hand rather than pushed.
    let oid;
    if (kind === 'tag') {
      git(root, ['tag', '-a', 'evil', '-m', 'evil', first.baseline]);
      oid = git(root, ['rev-parse', 'refs/tags/evil']);
      git(root, ['push', '-q', 'origin', 'refs/tags/evil']);
    } else if (kind === 'tree') {
      oid = git(root, ['rev-parse', `${first.baseline}^{tree}`]);
    } else {
      oid = git(root, ['rev-parse', `${first.baseline}:.changeledger-state/manifest.yml`]);
    }
    corruptRemoteStateRef(remote, oid);
    const authority = path.join(root, '.changeledger', 'authority.yml');
    const beforeAuthority = fs.existsSync(authority);
    const beforeRefs = git(root, ['for-each-ref', '--format=%(refname) %(objectname)']);

    assert.throws(
      () => createStateBaseline({ planFile }, root),
      /^Error: state baseline ref refs\/heads\/changeledger\/state must point to a commit$/,
    );
    assert.equal(fs.existsSync(authority), beforeAuthority);
    assert.equal(git(root, ['for-each-ref', '--format=%(refname) %(objectname)']), beforeRefs);
  });
}

test('104052 CR3: prepare refuses a published baseline that is not a commit', () => {
  const { root, remote } = legacyRepo();
  const preview = previewStateMigration({ sources: ['local:refs/heads/dev'] }, root);
  const first = createStateBaseline({ planFile: writePlan(root, preview.text) }, root);
  git(root, ['tag', '-a', 'evil', '-m', 'evil', first.baseline]);
  const tag = git(root, ['rev-parse', 'refs/tags/evil']);
  git(root, ['push', '-q', 'origin', 'refs/tags/evil']);
  corruptRemoteStateRef(remote, tag);

  assert.throws(
    () => prepareStateActivation({ baseline: tag }, root),
    /^Error: state baseline ref refs\/heads\/changeledger\/state must point to a commit$/,
  );
  assert.equal(
    git(root, ['for-each-ref', '--format=%(refname)', 'refs/heads/changeledger/']),
    '',
    'no activation branch may be created',
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

  const revalidated = runJson('state', 'migrate', '--preview', '--plan', planFile);
  assert.equal(revalidated.inventoryDigest, preview.inventoryDigest);
  assert.equal(revalidated.written, false);
  assert.equal(revalidated.network, false);
  assert.equal(revalidated.baseline, null);

  const baseline = runJson('state', 'migrate', '--create', '--plan', planFile);
  assert.match(baseline.baseline, OID_PATTERN);
  assert.match(baseline.inventoryDigest, /^[0-9a-f]{64}$/);
  assert.equal(baseline.network, true);

  const activation = runJson('state', 'activate', '--prepare', '--baseline', baseline.baseline);
  git(root, ['update-ref', ACTIVATION_REF, activation.commit]);
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
  const selected = conflict.candidates.find(
    (candidate) => candidate.source === 'local:refs/heads/dev',
  );
  conflict.resolution = { blob: selected.blob, basename: selected.basename };
  const resolvedPlan = writePlan(root, stringifyYaml(preview.plan));
  const validated = previewStateMigrationPlan({ planFile: resolvedPlan }, root);
  assert.equal(validated.inventoryDigest, preview.plan.inventory_digest);
  assert.equal(validated.written, false);

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

test('202101 CR4: a large blob read no longer throws with an unbounded git-output message', () => {
  const { root } = legacyRepo();
  const changeFile = path.join(root, '.changeledger', 'changes', '20260722-000000-demo.md');
  const padded = `${change('20260722-000000')}\n<!-- ${'x'.repeat(2 * 1024 * 1024)} -->\n`;
  fs.writeFileSync(changeFile, padded);
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'test: pad blob to 2MiB']);

  const preview = previewStateMigration({ sources: ['local:refs/heads/dev'] }, root);
  const document = preview.plan.documents.find(
    (entry) => entry.identity === 'change:20260722-000000',
  );
  assert.ok(document);
});

test('202100 CR: an object over the read budget is rejected with a bounded diagnostic', () => {
  // A single blob larger than git-batch's per-call read budget (32 MiB) cannot
  // be materialized within a bounded `cat-file --batch` call. It is rejected
  // fail-closed, naming the object, its size and the budget -- a short, bounded
  // message, not an opaque multi-MiB ENOBUFS partial buffer. (Byte-bounded
  // chunking, replacing the former aggregate ceiling, keeps a state whose
  // TOTAL exceeds the budget readable; only a single over-budget object is
  // refused.)
  const { root } = legacyRepo();
  const changeFile = path.join(root, '.changeledger', 'changes', '20260722-000000-demo.md');
  const padded = `${change('20260722-000000')}\n<!-- ${'x'.repeat(33 * 1024 * 1024)} -->\n`;
  fs.writeFileSync(changeFile, padded);
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'test: pad blob past the read budget']);

  assert.throws(
    () => previewStateMigration({ sources: ['local:refs/heads/dev'] }, root),
    (error) => {
      assert.ok(error.message.length <= 2200, `message too long: ${error.message.length}`);
      assert.match(error.message, /over the \d+-byte read budget/);
      return true;
    },
  );
});

test('202101 CR1: create with many invalid documents produces a bounded diagnostic', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-migration-'));
  const init = ['init', '-q', '-b', 'dev'];
  git(root, init);
  git(root, ['config', 'user.name', 'Test User']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  fs.mkdirSync(path.join(root, '.changeledger', 'changes'), { recursive: true });
  fs.mkdirSync(path.join(root, '.changeledger', 'specs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# contract\n');
  fs.writeFileSync(path.join(root, '.changeledger', 'config.yml'), config());
  for (let i = 0; i < 7; i += 1) {
    const id = `20260722-00000${i}`;
    fs.writeFileSync(
      path.join(root, '.changeledger', 'changes', `${id}-invalid.md`),
      `---\nid: "${id}"\ntype: quick\nstatus: draft\ncreated: 2026-07-22T00:00:00Z\ndepends_on: []\n---\n\n## Request\n\nMissing title.\n\n## Log\n`,
    );
  }
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'chore: legacy with many invalid changes']);
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-migration-remote-'));
  git(remote, ['init', '--bare', '-q']);
  git(root, ['remote', 'add', 'origin', remote]);
  git(root, ['push', '-q', '-u', 'origin', 'dev']);

  // 20260722-185043 CR1/CR6: preview now runs the exact same full checkRepo
  // create does, so it catches this (a local, non-legacy defect) itself —
  // proof that preview and create produce the identical bounded diagnostic,
  // not two independently-maintained checks that could drift apart.
  const assertBoundedDiagnostic = (error) => {
    assert.ok(error.message.length <= 4000, `message too long: ${error.message.length}`);
    assert.match(error.message, /migration candidate validation failed/);
    const shown = [...error.message.matchAll(/missing frontmatter "title"/g)];
    assert.equal(shown.length, 5);
    assert.match(error.message, /and 2 more errors/);
    return true;
  };

  assert.throws(
    () => previewStateMigration({ sources: ['local:refs/heads/dev'] }, root),
    assertBoundedDiagnostic,
  );
  assert.equal(git(root, ['ls-remote', '--refs', 'origin', 'refs/heads/changeledger/state']), '');
});

test('185043 CR1/CR6: a modern, non-legacy document with a local defect still fails preview closed', () => {
  // `migrateStructuredSections` never touches this document (no legacy task
  // metadata or Log format) and `classifyLegacyChange` marks it compatible —
  // it is genuinely NOT a legacy-normalization problem. CR1/CR6 still require
  // preview to reject it: preview runs the same full checkRepo create does,
  // so an ordinary local defect (missing frontmatter) is never a green
  // preview that only fails later at create.
  const { root } = legacyRepo();
  const file = '20260722-000001-no-title.md';
  fs.writeFileSync(
    path.join(root, '.changeledger', 'changes', file),
    '---\nid: "20260722-000001"\ntype: quick\nstatus: draft\ncreated: 2026-07-22T00:00:00Z\ndepends_on: []\n---\n\n## Request\n\nMissing title.\n\n## Log\n',
  );
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'test: modern document missing title']);
  git(root, ['push', '-q', 'origin', 'dev']);

  assert.throws(
    () => previewStateMigration({ sources: ['local:refs/heads/dev'] }, root),
    new RegExp(`${file}: missing frontmatter "title"`),
  );
  assert.equal(git(root, ['ls-remote', '--refs', 'origin', 'refs/heads/changeledger/state']), '');
});

for (const objectFormat of ['sha1', 'sha256']) {
  test(`185043 CR1/CR4: a legacy rewrite cannot hide an unrelated defect (${objectFormat})`, (t) => {
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
    const file = '20260722-000001-mixed-defect.md';
    fs.writeFileSync(
      path.join(root, '.changeledger', 'changes', file),
      `---
id: "20260722-000001"
type: quick
status: approved
created: 2026-07-22T00:00:00Z
depends_on: []
---

## Request

Missing title alongside a migratable legacy Log.

## Log

- **2026-07-22T00:01:00Z** — status: draft → approved
`,
    );
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'test: mixed legacy and unrelated defect']);
    git(root, ['push', '-q', 'origin', 'dev']);

    assert.throws(
      () => previewStateMigration({ sources: ['local:refs/heads/dev'] }, root),
      new RegExp(`${file}: .*missing frontmatter "title"`),
    );
    assert.equal(git(root, ['ls-remote', '--refs', 'origin', 'refs/heads/changeledger/state']), '');
  });
}

test('202101 CR2: activation re-validation of a forged manifest produces a bounded diagnostic', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-migration-forged-'));
  git(root, ['init', '-q', '-b', 'dev']);
  git(root, ['config', 'user.name', 'Test User']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# contract\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'chore: base']);

  const canonicalValue = (value) => {
    if (Array.isArray(value)) return value.map(canonicalValue);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key])]),
    );
  };
  const digestValue = (value) =>
    crypto
      .createHash('sha256')
      .update(JSON.stringify(canonicalValue(value)))
      .digest('hex');
  const sha256Of = (text) => crypto.createHash('sha256').update(text).digest('hex');

  git(root, ['checkout', '-q', '--orphan', 'changeledger/state']);
  git(root, ['rm', '-qrf', '--ignore-unmatch', '.']);
  const state = path.join(root, '.changeledger-state');
  fs.mkdirSync(path.join(state, 'changes'), { recursive: true });
  const configText = config();
  fs.writeFileSync(path.join(state, 'config.yml'), configText);
  const documents = [{ identity: 'config', kind: 'config', name: 'config.yml', text: configText }];
  for (let i = 0; i < 7; i += 1) {
    const id = `20260722-0001${i}0`;
    const text = `---\nid: "${id}"\ntype: quick\nstatus: draft\ncreated: 2026-07-22T00:00:00Z\ndepends_on: []\n---\n\n## Request\n\nMissing title.\n\n## Log\n`;
    const name = `${id}-forged.md`;
    fs.writeFileSync(path.join(state, 'changes', name), text);
    documents.push({ identity: `change:${id}`, kind: 'change', name, text });
  }
  const inventory = {
    project_id: 'project-1',
    minimum_client_version: '0.13.0',
    sources: [],
    documents: documents.map(({ identity, kind }) => ({ identity, kind, candidates: [] })),
  };
  const inventoryDigest = digestValue(inventory);
  const decisions = documents.map(({ identity, kind, name, text }) => ({
    identity,
    target:
      kind === 'config' ? '.changeledger-state/config.yml' : `.changeledger-state/changes/${name}`,
    replacement: true,
    sha256: sha256Of(text),
  }));
  fs.writeFileSync(
    path.join(state, 'manifest.yml'),
    stringifyYaml({
      format_version: 1,
      project_id: 'project-1',
      inventory_digest: inventoryDigest,
      minimum_client_version: '0.13.0',
      sources: [],
      inventory,
      decisions,
    }),
  );
  git(root, ['add', '.changeledger-state']);
  git(root, ['commit', '-qm', 'chore: forged state']);
  const baseline = git(root, ['rev-parse', 'HEAD']);

  git(root, ['checkout', '-q', 'dev']);
  fs.mkdirSync(path.join(root, '.changeledger'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.changeledger', 'authority.yml'),
    `format_version: 1\nstate_ref: refs/heads/changeledger/state\nbaseline: ${baseline}\nproject_id: project-1\n`,
  );
  git(root, ['add', '.changeledger/authority.yml']);
  git(root, ['commit', '-qm', 'chore: authority']);

  assert.throws(
    () => doctorStateMigration({ activationRef: 'refs/heads/dev' }, root),
    (error) => {
      assert.ok(error.message.length <= 4000, `message too long: ${error.message.length}`);
      assert.match(error.message, /state baseline validation failed/);
      const shown = [...error.message.matchAll(/missing frontmatter "title"/g)];
      assert.equal(shown.length, 5);
      assert.match(error.message, /and 2 more errors/);
      return true;
    },
  );
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
    () => previewStateMigrationPlan({ planFile }, root),
    /migration plan is stale: replacement replacement\.md expected .* actual .*/,
  );
  assert.throws(
    () => createStateBaseline({ planFile }, root),
    /migration plan is stale: replacement replacement\.md expected .* actual .*/,
  );
  assert.equal(git(root, ['ls-remote', '--refs', 'origin', 'refs/heads/changeledger/state']), '');
});

for (const objectFormat of ['sha1', 'sha256']) {
  test(`185043 CR2/CR4: replacement identity is bound before preview or create (${objectFormat})`, (t) => {
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
    const preview = previewStateMigration({ sources: ['local:refs/heads/dev'] }, root);
    const document = preview.plan.documents.find(
      (entry) => entry.identity === 'change:20260722-000000',
    );
    const replacement = change('20260722-999999', 'Wrong identity');
    fs.writeFileSync(path.join(root, 'replacement.md'), replacement);
    document.resolution = {
      replacement: 'replacement.md',
      basename: '20260722-999999-wrong-identity.md',
      sha256: crypto.createHash('sha256').update(replacement).digest('hex'),
    };
    const planFile = writePlan(root, stringifyYaml(preview.plan));
    const mismatch =
      /migration replacement identity mismatch: expected change:20260722-000000 actual change:20260722-999999/;

    assert.throws(() => previewStateMigrationPlan({ planFile }, root), mismatch);
    assert.throws(() => createStateBaseline({ planFile }, root), mismatch);
    assert.equal(git(root, ['ls-remote', '--refs', 'origin', 'refs/heads/changeledger/state']), '');
  });

  test(`185043 CR3/CR4/CR6: activation rejects a forged replacement identity (${objectFormat})`, (t) => {
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
    const preview = previewStateMigration({ sources: ['local:refs/heads/dev'] }, root);
    const document = preview.plan.documents.find(
      (entry) => entry.identity === 'change:20260722-000000',
    );
    const replacementName = '20260722-000000-demo.md';
    const replacement = change('20260722-000000', 'Valid replacement');
    fs.writeFileSync(path.join(root, 'replacement.md'), replacement);
    document.resolution = {
      replacement: 'replacement.md',
      basename: replacementName,
      sha256: crypto.createHash('sha256').update(replacement).digest('hex'),
    };
    const baseline = createStateBaseline(
      { planFile: writePlan(root, stringifyYaml(preview.plan)) },
      root,
    ).baseline;

    git(root, ['checkout', '-q', '--detach', baseline]);
    const target = path.join(root, '.changeledger-state', 'changes', replacementName);
    const forgedContent = change('20260722-999999', 'Forged replacement identity');
    fs.writeFileSync(target, forgedContent);
    const manifestFile = path.join(root, '.changeledger-state', 'manifest.yml');
    const manifest = parseYaml(fs.readFileSync(manifestFile, 'utf8'));
    const decision = manifest.decisions.find(
      (entry) => entry.identity === 'change:20260722-000000',
    );
    decision.sha256 = crypto.createHash('sha256').update(forgedContent).digest('hex');
    fs.writeFileSync(manifestFile, stringifyYaml(manifest));
    git(root, ['add', '.changeledger-state']);
    git(root, ['commit', '-qm', 'test: forge replacement identity']);
    const forgedBaseline = git(root, ['rev-parse', 'HEAD']);
    git(root, [
      'push',
      '-q',
      '--force',
      'origin',
      `${forgedBaseline}:refs/heads/changeledger/state`,
    ]);
    git(root, ['checkout', '-q', 'dev']);

    assert.throws(
      () => prepareStateActivation({ baseline: forgedBaseline }, root),
      /state manifest replacement identity mismatch: expected change:20260722-000000 actual change:20260722-999999/,
    );
  });
}

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
  git(root, ['update-ref', ACTIVATION_REF, activation.commit]);

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

test('202058 CR2: recovery export refuses a confirmed history that removed an identity', () => {
  const { root } = legacyRepo();
  const preview = previewStateMigration({ sources: ['origin:refs/heads/dev'] }, root);
  const baseline = createStateBaseline({ planFile: writePlan(root, preview.text) }, root);
  const activation = prepareStateActivation({ baseline: baseline.baseline }, root);
  git(root, ['update-ref', ACTIVATION_REF, activation.commit]);
  git(root, ['checkout', '-q', activation.branch]);
  git(root, ['branch', '-f', 'dev', activation.commit]);
  git(root, ['checkout', '-q', 'dev']);

  // Forge a schema-valid confirmed descendant whose tree dropped the change
  // document; nothing references it, so only identity continuity can object.
  git(root, ['checkout', '-q', '-b', 'forge', baseline.baseline]);
  fs.rmSync(path.join(root, '.changeledger-state', 'changes', '20260722-000000-demo.md'));
  git(root, ['add', '-A', '.changeledger-state']);
  git(root, ['commit', '-qm', 'test: forged confirmed drops the change']);
  const forged = git(root, ['rev-parse', 'HEAD']);
  git(root, ['checkout', '-q', 'dev']);
  git(root, ['branch', '-qD', 'forge']);
  git(root, ['update-ref', CONFIRMED_REF, forged]);
  git(root, ['update-ref', OBSERVED_REF, forged]);

  assert.throws(
    () => exportStateRecovery(root),
    new RegExp(`state revision ${forged} removes changes identity "20260722-000000"`),
  );
  assert.throws(() =>
    git(root, ['rev-parse', '--verify', `refs/heads/changeledger/recover-${forged.slice(0, 12)}`]),
  );
});

test('163406 CR1: preview lists non-inventoried legacy files without failing', () => {
  const { root } = legacyRepo();
  fs.writeFileSync(path.join(root, '.changeledger', 'changes', '.gitkeep'), '');
  git(root, ['add', '.changeledger/changes/.gitkeep']);
  git(root, ['commit', '-qm', 'test: gitkeep']);
  const blob = git(root, ['rev-parse', 'HEAD:.changeledger/changes/.gitkeep']);

  const preview = previewStateMigration({ sources: ['local:refs/heads/dev'] }, root);

  assert.deepEqual(
    preview.plan.uninventoried.map((entry) => entry.path),
    ['.changeledger/changes/.gitkeep'],
  );
  assert.equal(preview.plan.uninventoried[0].blob, blob);
  assert.equal(preview.uninventoried[0].path, '.changeledger/changes/.gitkeep');
});

test('163406 CR2: recovery succeeds and preserves a file left out of the inventory', () => {
  const { root } = legacyRepo();
  fs.writeFileSync(path.join(root, '.changeledger', 'changes', '.gitkeep'), '');
  git(root, ['add', '.changeledger/changes/.gitkeep']);
  git(root, ['commit', '-qm', 'test: gitkeep']);

  const preview = previewStateMigration({ sources: ['local:refs/heads/dev'] }, root);
  const baseline = createStateBaseline({ planFile: writePlan(root, preview.text) }, root);
  const activation = prepareStateActivation({ baseline: baseline.baseline }, root);
  git(root, ['update-ref', ACTIVATION_REF, activation.commit]);

  assert.equal(git(root, ['show', `${activation.commit}:.changeledger/changes/.gitkeep`]), '');

  git(root, ['update-ref', CONFIRMED_REF, baseline.baseline]);
  git(root, ['update-ref', OBSERVED_REF, baseline.baseline]);
  git(root, ['checkout', '-q', activation.branch]);
  git(root, ['branch', '-f', 'dev', activation.commit]);
  git(root, ['checkout', '-q', 'dev']);

  const recovery = exportStateRecovery(root);
  assert.equal(git(root, ['show', `${recovery.commit}:.changeledger/changes/.gitkeep`]), '');
  assert.equal(git(root, ['show', `${recovery.commit}:.changeledger/config.yml`]), config().trim());
});

test('181234 CR1: an identical recovery retry reuses the branch instead of failing', () => {
  const { root } = legacyRepo();
  const preview = previewStateMigration({ sources: ['local:refs/heads/dev'] }, root);
  const baseline = createStateBaseline({ planFile: writePlan(root, preview.text) }, root);
  const activation = prepareStateActivation({ baseline: baseline.baseline }, root);

  git(root, ['update-ref', CONFIRMED_REF, baseline.baseline]);
  git(root, ['update-ref', OBSERVED_REF, baseline.baseline]);
  git(root, ['checkout', '-q', activation.branch]);
  git(root, ['branch', '-f', 'dev', activation.commit]);
  git(root, ['checkout', '-q', 'dev']);
  git(root, ['update-ref', ACTIVATION_REF, activation.commit]);

  const first = exportStateRecovery(root);
  const retry = exportStateRecovery(root);
  assert.equal(retry.commit, first.commit);
  assert.equal(retry.branch, first.branch);
  assert.equal(git(root, ['rev-parse', retry.ref]), first.commit);
});

test('163406 CR3: recovery still fails closed on a real path collision', () => {
  const { root } = legacyRepo();
  const preview = previewStateMigration({ sources: ['local:refs/heads/dev'] }, root);
  const baseline = createStateBaseline({ planFile: writePlan(root, preview.text) }, root);
  const activation = prepareStateActivation({ baseline: baseline.baseline }, root);

  git(root, ['update-ref', CONFIRMED_REF, baseline.baseline]);
  git(root, ['update-ref', OBSERVED_REF, baseline.baseline]);
  git(root, ['checkout', '-q', activation.branch]);
  git(root, ['branch', '-f', 'dev', activation.commit]);
  git(root, ['checkout', '-q', 'dev']);
  git(root, ['update-ref', ACTIVATION_REF, activation.commit]);
  fs.mkdirSync(path.join(root, '.changeledger', 'changes'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.changeledger', 'changes', '20260722-000000-demo.md'),
    change('20260722-000000', 'Drifted'),
  );
  git(root, ['add', '.changeledger/changes']);
  git(root, ['commit', '-qm', 'test: drifted legacy file']);

  assert.throws(
    () => exportStateRecovery(root),
    /legacy recovery target is occupied: \.changeledger\/changes\/20260722-000000-demo\.md/,
  );
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

test('163409: create rejects a divergent existing state baseline without writing', () => {
  const { root } = legacyRepo();
  const cli = path.resolve('bin/changeledger.mjs');
  const runJson = (...args) =>
    JSON.parse(
      execFileSync(process.execPath, [cli, ...args, '--json'], { cwd: root, encoding: 'utf8' }),
    );
  const planFile = path.join(root, 'migration-plan.yml');

  runJson(
    'state',
    'migrate',
    '--preview',
    '--source',
    'local:refs/heads/dev',
    '--output',
    planFile,
  );
  const baseline1 = runJson('state', 'migrate', '--create', '--plan', planFile);

  fs.writeFileSync(
    path.join(root, '.changeledger', 'specs', 'extra.md'),
    '---\ntitle: Extra\nupdated: 2026-07-22T00:00:00Z\ntags: []\n---\n\nExtra.\n',
  );
  git(root, ['add', '.changeledger/specs/extra.md']);
  git(root, ['commit', '-qm', 'test: extra spec']);
  runJson(
    'state',
    'migrate',
    '--preview',
    '--source',
    'local:refs/heads/dev',
    '--output',
    planFile,
  );

  const result = spawnSync(
    process.execPath,
    [cli, 'state', 'migrate', '--create', '--plan', planFile, '--json'],
    { cwd: root, encoding: 'utf8' },
  );
  assert.notEqual(result.status, 0);
  const receipt = JSON.parse(result.stderr);
  assert.match(receipt.error, /state baseline already exists with different content/);
  assert.equal(receipt.written, false);
  assert.equal(
    git(root, ['ls-remote', '--refs', 'origin', 'refs/heads/changeledger/state']).split(/\s+/)[0],
    baseline1.baseline,
  );
});

test('163409: doctor --online reports a missing remote state', () => {
  const { root } = legacyRepo();
  const preview = previewStateMigration({ sources: ['origin:refs/heads/dev'] }, root);
  const baseline = createStateBaseline({ planFile: writePlan(root, preview.text) }, root);
  const activation = prepareStateActivation({ baseline: baseline.baseline }, root);
  git(root, ['push', 'origin', '--delete', 'refs/heads/changeledger/state']);

  const diagnosis = doctorStateMigration({ activationRef: activation.branch, online: true }, root);
  assert.equal(diagnosis.ok, false);
  assert.ok(diagnosis.categories.data_divergence.includes('remote state is missing'));
});

test('163409: doctor --online reports a remote state that does not descend from baseline', () => {
  const { root } = legacyRepo();
  const preview = previewStateMigration({ sources: ['origin:refs/heads/dev'] }, root);
  const baseline = createStateBaseline({ planFile: writePlan(root, preview.text) }, root);
  const activation = prepareStateActivation({ baseline: baseline.baseline }, root);
  const emptyTree = git(root, ['hash-object', '-t', 'tree', '-w', '--stdin'], '');
  const orphan = git(root, ['commit-tree', emptyTree, '-m', 'orphan']);
  git(root, ['push', '--force', 'origin', `${orphan}:refs/heads/changeledger/state`]);

  const diagnosis = doctorStateMigration({ activationRef: activation.branch, online: true }, root);
  assert.equal(diagnosis.ok, false);
  assert.ok(
    diagnosis.categories.data_divergence.includes('remote state does not descend from baseline'),
  );
});

test('163409: doctor classifies authority.yml divergence from the baseline manifest', () => {
  const { root } = legacyRepo();
  const preview = previewStateMigration({ sources: ['origin:refs/heads/dev'] }, root);
  const baseline = createStateBaseline({ planFile: writePlan(root, preview.text) }, root);
  const activation = prepareStateActivation({ baseline: baseline.baseline }, root);

  git(root, ['checkout', '-q', activation.branch]);
  const tampered = stringifyYaml({
    format_version: 2,
    state_ref: 'refs/heads/changeledger/state',
    baseline: baseline.baseline,
    project_id: 'wrong-project',
    inventory_digest: 'f'.repeat(64),
    minimum_client_version: '0.0.0',
  });
  fs.writeFileSync(path.join(root, '.changeledger', 'authority.yml'), tampered);
  git(root, ['add', '.changeledger/authority.yml']);
  git(root, ['commit', '-qm', 'test: tamper authority']);
  const tamperedCommit = git(root, ['rev-parse', 'HEAD']);
  git(root, ['checkout', '-q', 'dev']);

  const diagnosis = doctorStateMigration({ activationRef: tamperedCommit }, root);
  assert.equal(diagnosis.ok, false);
  assert.ok(diagnosis.categories.data_divergence.includes('project_id does not match baseline'));
  assert.ok(
    diagnosis.categories.data_divergence.includes('inventory_digest does not match baseline'),
  );
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
  git(root, ['update-ref', ACTIVATION_REF, activation.commit]);
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
    git(root, ['update-ref', ACTIVATION_REF, activation.commit]);
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
  git(root, ['update-ref', ACTIVATION_REF, activation.commit]);
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

for (const objectFormat of ['sha1', 'sha256']) {
  test(`185043 CR1/CR5: preview classifies a legacy ledger per document (${objectFormat})`, (t) => {
    let fixture;
    try {
      fixture = fixtureLedgerRepo('legacy-ledger', objectFormat);
    } catch (error) {
      if (objectFormat === 'sha256' && /unknown|unsupported|object-format/i.test(error.message)) {
        t.skip('Git build has no SHA-256 repository support');
        return;
      }
      throw error;
    }
    const { root } = fixture;

    const preview = previewStateMigration({ sources: ['local:refs/heads/dev'] }, root);
    const legacy = preview.plan.documents.find((d) => d.identity === 'change:20260716-124623');
    const current = preview.plan.documents.find((d) => d.identity === 'change:20260722-090000');
    const spec = preview.plan.documents.find((d) => d.identity === 'spec:batch-parsing');

    assert.equal(legacy.compatibility, 'legacy');
    assert.equal(legacy.normalization.rule, 'structured-sections');
    assert.equal(legacy.normalization.version, 1);
    assert.match(legacy.normalization.sha256, /^[0-9a-f]{64}$/);

    assert.equal(current.compatibility, true);
    assert.ok(!('normalization' in current));
    assert.equal(spec.compatibility, true);
  });
}

for (const objectFormat of ['sha1', 'sha256']) {
  test(`185043 CR1/CR4/CR5: all ten audited legacy blockers stay explicit (${objectFormat})`, (t) => {
    let fixture;
    try {
      fixture = fixtureLedgerRepo('legacy-ledger-manual', objectFormat);
    } catch (error) {
      if (objectFormat === 'sha256' && /unknown|unsupported|object-format/i.test(error.message)) {
        t.skip('Git build has no SHA-256 repository support');
        return;
      }
      throw error;
    }
    const preview = previewStateMigration({ sources: ['local:refs/heads/dev'] }, fixture.root);
    const manual = preview.plan.documents.filter(
      (document) => document.compatibility === 'requires-replacement',
    );
    assert.equal(manual.length, 10);
    assert.ok(manual.every((document) => document.resolution === null));
    assert.equal(
      manual.filter((document) =>
        document.replacement.reasons.some((reason) => reason.includes('untyped Log entry')),
      ).length,
      6,
    );
    assert.equal(
      manual.filter((document) =>
        document.replacement.reasons.some((reason) =>
          reason.includes('ambiguous legacy task metadata'),
        ),
      ).length,
      2,
    );
    assert.equal(
      manual.filter((document) =>
        document.replacement.reasons.some((reason) =>
          reason.includes('reconstructed status is "in-validation"'),
        ),
      ).length,
      1,
    );
    assert.equal(
      manual.filter((document) =>
        document.replacement.reasons.some((reason) =>
          reason.includes('must name target and verification'),
        ),
      ).length,
      1,
    );
  });
}

test('185043 CR2: create requires an explicit normalization decision before applying it', () => {
  const { root } = fixtureLedgerRepo('legacy-ledger');
  const preview = previewStateMigration({ sources: ['local:refs/heads/dev'] }, root);
  const planFile = writePlan(root, preview.text);

  assert.throws(
    () => previewStateMigrationPlan({ planFile }, root),
    /requires an explicit normalization decision for change:20260716-124623/,
  );
  assert.throws(
    () => createStateBaseline({ planFile }, root),
    /requires an explicit normalization decision for change:20260716-124623/,
  );
  assert.equal(
    git(root, ['ls-remote', '--refs', 'origin', 'refs/heads/changeledger/state']),
    '',
    'no baseline is published without the explicit decision',
  );
});

for (const objectFormat of ['sha1', 'sha256']) {
  test(`185043 CR2/CR3/CR5/CR6: normalization previews, creates and activates end to end (${objectFormat})`, (t) => {
    let fixture;
    try {
      fixture = fixtureLedgerRepo('legacy-ledger', objectFormat);
    } catch (error) {
      if (objectFormat === 'sha256' && /unknown|unsupported|object-format/i.test(error.message)) {
        t.skip('Git build has no SHA-256 repository support');
        return;
      }
      throw error;
    }
    const { root, head } = fixture;
    const preview = previewStateMigration({ sources: ['local:refs/heads/dev'] }, root);
    const plan = parseYaml(preview.text);
    const legacy = plan.documents.find((d) => d.identity === 'change:20260716-124623');
    legacy.resolution.normalize = {
      rule: legacy.normalization.rule,
      version: legacy.normalization.version,
    };
    const planFile = writePlan(root, stringifyYaml(plan));

    const validation = previewStateMigrationPlan({ planFile }, root);
    assert.equal(validation.written, false);
    assert.equal(validation.inventoryDigest, plan.inventory_digest);
    assert.equal(git(root, ['ls-remote', '--refs', 'origin', 'refs/heads/changeledger/state']), '');

    const baseline = createStateBaseline({ planFile }, root);

    assert.equal(git(root, ['rev-parse', 'dev']), head, 'the source branch is never advanced');
    const sourceBlob = git(root, [
      'rev-parse',
      'dev:.changeledger/changes/20260716-124623-legacy-format.md',
    ]);
    assert.equal(sourceBlob, legacy.resolution.blob, 'the source blob itself is untouched');

    const sourceText = fs.readFileSync(
      path.join(
        import.meta.dirname,
        'fixtures',
        'legacy-ledger',
        'changes',
        '20260716-124623-legacy-format.md',
      ),
      'utf8',
    );
    const expected = migrateStructuredSections(sourceText).text;
    const stateText = git(root, [
      'show',
      `${baseline.baseline}:.changeledger-state/changes/20260716-124623-legacy-format.md`,
    ]);
    assert.equal(stateText, expected.trimEnd());

    const manifest = parseYaml(
      git(root, ['show', `${baseline.baseline}:.changeledger-state/manifest.yml`]),
    );
    const decision = manifest.decisions.find((d) => d.identity === 'change:20260716-124623');
    assert.equal(decision.blob, legacy.resolution.blob);
    assert.deepEqual(decision.normalization, { rule: 'structured-sections', version: 1 });

    const activation = prepareStateActivation({ baseline: baseline.baseline }, root);
    assert.match(activation.commit, OID_PATTERN);
  });
}

for (const objectFormat of ['sha1', 'sha256']) {
  test(`185043 CR2/CR4/CR5/CR6: manual replacement previews and migrates end to end (${objectFormat})`, (t) => {
    let fixture;
    try {
      fixture = fixtureLedgerRepo('legacy-ledger-unnormalizable', objectFormat);
    } catch (error) {
      if (objectFormat === 'sha256' && /unknown|unsupported|object-format/i.test(error.message)) {
        t.skip('Git build has no SHA-256 repository support');
        return;
      }
      throw error;
    }
    const { root, head } = fixture;
    const preview = previewStateMigration({ sources: ['local:refs/heads/dev'] }, root);
    const plan = parseYaml(preview.text);
    const manual = plan.documents.find((d) => d.identity === 'change:20260710-080000');
    const planFile = writePlan(root, stringifyYaml(plan));

    assert.throws(
      () => previewStateMigrationPlan({ planFile }, root),
      /migration conflict: change:20260710-080000 requires an explicit replacement/,
    );

    const replacementName = '20260710-080000-unnormalizable.md';
    const replacementText = change('20260710-080000', 'Reemplazo humano verificado');
    const replacementFile = path.join(root, 'replacement.md');
    fs.writeFileSync(replacementFile, replacementText);
    manual.resolution = {
      replacement: 'replacement.md',
      basename: replacementName,
      sha256: crypto.createHash('sha256').update(replacementText).digest('hex'),
    };
    fs.writeFileSync(planFile, stringifyYaml(plan));

    const beforeSource = git(root, ['show', `dev:.changeledger/changes/${replacementName}`]);
    const validation = previewStateMigrationPlan({ planFile }, root);
    assert.equal(validation.written, false);
    assert.equal(validation.inventoryDigest, plan.inventory_digest);

    const baseline = createStateBaseline({ planFile }, root);
    assert.equal(git(root, ['rev-parse', 'dev']), head);
    assert.equal(git(root, ['show', `dev:.changeledger/changes/${replacementName}`]), beforeSource);
    assert.equal(
      git(root, ['show', `${baseline.baseline}:.changeledger-state/changes/${replacementName}`]),
      replacementText.trimEnd(),
    );

    const manifest = parseYaml(
      git(root, ['show', `${baseline.baseline}:.changeledger-state/manifest.yml`]),
    );
    const decision = manifest.decisions.find((d) => d.identity === manual.identity);
    assert.equal(decision.replacement, 'replacement.md');
    assert.equal(decision.sha256, manual.resolution.sha256);
    assert.match(prepareStateActivation({ baseline: baseline.baseline }, root).commit, OID_PATTERN);
  });
}

for (const objectFormat of ['sha1', 'sha256']) {
  test(`185043 CR1/CR4: recognized ambiguous legacy requires replacement (${objectFormat})`, (t) => {
    let fixture;
    try {
      fixture = fixtureLedgerRepo('legacy-ledger-unnormalizable', objectFormat);
    } catch (error) {
      if (objectFormat === 'sha256' && /unknown|unsupported|object-format/i.test(error.message)) {
        t.skip('Git build has no SHA-256 repository support');
        return;
      }
      throw error;
    }
    const { root, head } = fixture;

    const beforeTree = git(root, ['rev-parse', 'dev^{tree}']);
    const preview = previewStateMigration({ sources: ['local:refs/heads/dev'] }, root);
    const document = preview.plan.documents.find(
      (item) => item.identity === 'change:20260710-080000',
    );
    assert.equal(document.compatibility, 'requires-replacement');
    assert.equal(document.resolution, null);
    assert.equal(document.replacement.rule, 'structured-sections');
    assert.equal(document.replacement.version, 1);
    assert.match(document.replacement.reasons.join('\n'), /ambiguous legacy task metadata/);
    assert.match(
      document.replacement.reasons.join('\n'),
      /untyped Log entry has no migratable timestamp/,
    );
    assert.equal(document.candidates[0].commit, head);
    assert.equal(
      document.candidates[0].path,
      '.changeledger/changes/20260710-080000-unnormalizable.md',
    );
    assert.equal(git(root, ['rev-parse', 'dev^{tree}']), beforeTree);
    assert.equal(git(root, ['ls-remote', '--refs', 'origin', 'refs/heads/changeledger/state']), '');
  });
}

for (const objectFormat of ['sha1', 'sha256']) {
  test(`185043 CR1/CR4: Plan legacy cannot hide an unrelated typed-Log contradiction (${objectFormat})`, (t) => {
    let fixture;
    try {
      fixture = fixtureLedgerRepo('legacy-ledger-unnormalizable', objectFormat);
    } catch (error) {
      if (objectFormat === 'sha256' && /unknown|unsupported|object-format/i.test(error.message)) {
        t.skip('Git build has no SHA-256 repository support');
        return;
      }
      throw error;
    }
    const { root } = fixture;
    const file = path.join(root, '.changeledger', 'changes', '20260710-080000-unnormalizable.md');
    const text = fs
      .readFileSync(file, 'utf8')
      .replace('status: blocked', 'status: in-validation')
      .replace(
        '- **2026-07-10T08:00:00Z** — status: draft → approved',
        '- **2026-07-10T08:00:00Z** `[status]` draft → approved',
      )
      .replace(
        '- **2026-07-10T08:05:00Z** — status: approved → in-progress',
        '- **2026-07-10T08:05:00Z** `[status]` approved → in-progress',
      )
      .replace(
        '- **2026-07-10T08:10:00Z** — status: in-progress → blocked',
        '- **2026-07-10T08:10:00Z** `[status]` in-progress → in-review',
      )
      .replace('- Nota suelta sin timestamp reconocible\n', '');
    fs.writeFileSync(file, text);
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'test: isolate Plan legacy from typed Log defect']);
    git(root, ['push', '-q', 'origin', 'dev']);

    assert.throws(
      () => previewStateMigration({ sources: ['local:refs/heads/dev'] }, root),
      /Log reconstructs status "in-review" but frontmatter says "in-validation"/,
    );
    assert.equal(git(root, ['ls-remote', '--refs', 'origin', 'refs/heads/changeledger/state']), '');
  });
}

test('185043 CR6: preview fails closed on a global rule even when every document is individually valid', () => {
  const { root } = legacyRepo();
  fs.writeFileSync(
    path.join(root, '.changeledger', 'changes', '20260722-000001-cycle-a.md'),
    `---
id: "20260722-000001"
title: Cycle A
type: quick
status: draft
created: 2026-07-22T00:00:00Z
depends_on: ["20260722-000002"]
---

## Request

Cycle A.

## Log
`,
  );
  fs.writeFileSync(
    path.join(root, '.changeledger', 'changes', '20260722-000002-cycle-b.md'),
    `---
id: "20260722-000002"
title: Cycle B
type: quick
status: draft
created: 2026-07-22T00:00:00Z
depends_on: ["20260722-000001"]
---

## Request

Cycle B.

## Log
`,
  );
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'test: dependency cycle']);
  git(root, ['push', '-q', 'origin', 'dev']);

  assert.throws(
    () => previewStateMigration({ sources: ['local:refs/heads/dev'] }, root),
    /dependency cycle/,
  );
  assert.equal(
    git(root, ['ls-remote', '--refs', 'origin', 'refs/heads/changeledger/state']),
    '',
    'a global-rule failure at preview time publishes nothing',
  );
});

for (const objectFormat of ['sha1', 'sha256']) {
  test(`185043 CR1/CR4: an isolated untyped Log requires replacement (${objectFormat})`, (t) => {
    // Regression: migrateStructuredSections can leave text byte-identical
    // (changed: false) while still recording an unmigratable defect in
    // `manual` — classifyLegacyChange must check `manual` before `changed`,
    // or this document is silently classified valid at preview and only
    // rejected later at create, breaking CR1's preview/create parity.
    let fixture;
    try {
      fixture = fixtureLedgerRepo('legacy-ledger-untyped-log-only', objectFormat);
    } catch (error) {
      if (objectFormat === 'sha256' && /unknown|unsupported|object-format/i.test(error.message)) {
        t.skip('Git build has no SHA-256 repository support');
        return;
      }
      throw error;
    }
    const { root } = fixture;

    const preview = previewStateMigration({ sources: ['local:refs/heads/dev'] }, root);
    const document = preview.plan.documents.find(
      (item) => item.identity === 'change:20260710-090000',
    );
    assert.equal(document.compatibility, 'requires-replacement');
    assert.equal(document.resolution, null);
    assert.deepEqual(document.replacement, {
      rule: 'structured-sections',
      version: 1,
      reasons: ['line 19: untyped Log entry has no migratable timestamp'],
    });
    assert.equal(git(root, ['ls-remote', '--refs', 'origin', 'refs/heads/changeledger/state']), '');
  });
}

// A repo whose integration branch (dev) has been fast-forwarded onto the exact
// cutover commit the prepare step built: dev's tip now carries
// `.changeledger/authority.yml` v2 and the legacy `.changeledger/config.yml`
// has been removed, exactly as a real post-merge integration branch would.
function preparedForInstall(objectFormat = 'sha1') {
  const { root, head } = legacyRepo(objectFormat);
  const preview = previewStateMigration({ sources: ['local:refs/heads/dev'] }, root);
  const baseline = createStateBaseline({ planFile: writePlan(root, preview.text) }, root);
  const activation = prepareStateActivation({ baseline: baseline.baseline }, root);
  git(root, ['update-ref', 'refs/heads/dev', activation.commit]);
  return { root, head, baseline: baseline.baseline, activation };
}

// `readStateMetadata` also serves install, deactivate and doctor, which read the
// baseline recorded in a LOCAL activation authority and never fetch it. Guarding
// only the fetch ingress would leave those three reading truth from a non-commit,
// so this pins the assertion on a path `fetchRef` cannot reach.
test('104052 CR2b: a local authority naming a non-commit baseline is refused', () => {
  const { root, baseline } = preparedForInstall();
  // `prepareStateActivation` writes the authority into the activation commit,
  // not the worktree, and the helper only moves the branch ref.
  git(root, ['reset', '--hard', '-q', 'dev']);
  git(root, ['tag', '-a', '-m', 'evil', 'evil', baseline]);
  const tag = git(root, ['rev-parse', 'refs/tags/evil']);
  const authority = path.join(root, '.changeledger', 'authority.yml');
  fs.writeFileSync(
    authority,
    fs.readFileSync(authority, 'utf8').replace(`baseline: ${baseline}`, `baseline: ${tag}`),
  );
  git(root, ['add', '.changeledger/authority.yml']);
  git(root, ['commit', '-qm', 'test: forge a non-commit baseline']);

  // The diagnostic names the corrupt object, not the published state ref: this
  // baseline was read from a local authority and never fetched, so pointing an
  // operator at refs/heads/changeledger/state would send them to the wrong place.
  assert.throws(
    () => installStateActivation({ integrationRef: 'refs/heads/dev' }, root),
    new RegExp(`^Error: state baseline ${tag} must point to a commit$`),
  );
  assert.throws(() => git(root, ['rev-parse', '--verify', ACTIVATION_REF]));
});

test('20260723-202646 CR3: install verifies content and fixes activation via CAS', () => {
  const { root, baseline, activation } = preparedForInstall();
  const T = git(root, ['rev-parse', 'dev']);
  assert.equal(T, activation.commit);

  const result = installStateActivation({ integrationRef: 'refs/heads/dev' }, root);
  assert.equal(result.activation, T);
  assert.equal(result.baseline, baseline);
  assert.equal(result.written, true);
  assert.equal(result.network, false);
  assert.equal(git(root, ['rev-parse', '--verify', ACTIVATION_REF]), T);

  // Idempotent: pointing at the same tip already installed writes nothing.
  const repeated = installStateActivation({ integrationRef: 'refs/heads/dev' }, root);
  assert.equal(repeated.activation, T);
  assert.equal(repeated.written, false);
  assert.equal(git(root, ['rev-parse', '--verify', ACTIVATION_REF]), T);
});

test('20260723-202646 CR3/CR6: install accepts a remote-tracking integration ref', () => {
  const { root } = preparedForInstall();
  git(root, ['push', '-q', 'origin', 'dev']);
  const T = git(root, ['rev-parse', 'refs/remotes/origin/dev']);
  const result = installStateActivation({ integrationRef: 'refs/remotes/origin/dev' }, root);
  assert.equal(result.activation, T);
  assert.equal(git(root, ['rev-parse', '--verify', ACTIVATION_REF]), T);
});

test('20260723-202646 CR3: install rejects a ref that is not the integration branch', () => {
  const { root, activation } = preparedForInstall();
  assert.throws(
    () => installStateActivation({ integrationRef: activation.branch }, root),
    (error) => {
      assert.equal(
        error.message,
        'state activation install requires --integration-ref to name git.integration_branch dev',
      );
      return true;
    },
  );
  assert.throws(() => git(root, ['rev-parse', '--verify', ACTIVATION_REF]));
});

test('20260723-202646 CR3: install refuses to replace a divergent activation', () => {
  const { root, baseline } = preparedForInstall();
  const T = git(root, ['rev-parse', 'dev']);
  git(root, ['update-ref', ACTIVATION_REF, baseline]);
  assert.throws(
    () => installStateActivation({ integrationRef: 'refs/heads/dev' }, root),
    (error) => {
      assert.equal(
        error.message,
        `state activation already points to ${baseline}; refusing to replace it with ${T}`,
      );
      return true;
    },
  );
  assert.equal(git(root, ['rev-parse', '--verify', ACTIVATION_REF]), baseline);
});

for (const objectFormat of ['sha1', 'sha256']) {
  test(`235910 CR1/CR2: install and deactivate reject a blob activation with ${objectFormat}`, () => {
    const { root, baseline } = preparedForInstall(objectFormat);
    const blob = git(root, ['hash-object', '-w', '--stdin'], 'not an activation commit\n');
    git(root, ['update-ref', ACTIVATION_REF, blob]);
    git(root, ['update-ref', CONFIRMED_REF, baseline]);
    git(root, ['update-ref', OBSERVED_REF, baseline]);
    git(root, ['update-ref', PENDING_REF, baseline]);
    const beforeRefs = git(root, ['for-each-ref', '--format=%(refname) %(objectname)']);
    const beforeObjects = git(root, ['count-objects', '-v']);

    for (const operation of [installStateActivation, deactivateStateActivation]) {
      const activity = {};
      assert.throws(
        () => operation({ integrationRef: 'refs/heads/dev' }, root, activity),
        new Error('state activation ref refs/changeledger/activation must point to a commit'),
      );
      assert.equal(activity.written, false);
      assert.equal(git(root, ['for-each-ref', '--format=%(refname) %(objectname)']), beforeRefs);
      assert.equal(git(root, ['count-objects', '-v']), beforeObjects);
    }

    const cli = path.resolve('bin/changeledger.mjs');
    for (const mode of ['--install', '--deactivate']) {
      const result = spawnSync(
        process.execPath,
        [cli, 'state', 'activate', mode, '--integration-ref', 'refs/heads/dev', '--json'],
        { cwd: root, encoding: 'utf8' },
      );
      assert.notEqual(result.status, 0);
      const receipt = JSON.parse(result.stderr);
      assert.equal(
        receipt.error,
        'state activation ref refs/changeledger/activation must point to a commit',
      );
      assert.equal(receipt.written, false);
      assert.equal(receipt.repository_path, fs.realpathSync(root));
      assert.equal(git(root, ['for-each-ref', '--format=%(refname) %(objectname)']), beforeRefs);
      assert.equal(git(root, ['count-objects', '-v']), beforeObjects);
    }
  });
}

test('235910 correction: a peelable tag keeps its direct OID through install and deactivate CAS', () => {
  const installFixture = preparedForInstall();
  git(installFixture.root, [
    'tag',
    '-a',
    'activation-install',
    installFixture.activation.commit,
    '-m',
    'test: tagged activation',
  ]);
  const installTag = git(installFixture.root, ['rev-parse', 'refs/tags/activation-install']);
  git(installFixture.root, ['update-ref', ACTIVATION_REF, installTag]);

  const installed = installStateActivation(
    { integrationRef: 'refs/heads/dev' },
    installFixture.root,
  );
  assert.equal(installed.written, false);
  assert.equal(installed.oldOid, installTag);
  assert.equal(git(installFixture.root, ['rev-parse', '--verify', ACTIVATION_REF]), installTag);

  const deactivateFixture = activatedThenRecovered();
  git(deactivateFixture.root, [
    'tag',
    '-a',
    'activation-deactivate',
    deactivateFixture.cutover,
    '-m',
    'test: tagged activation',
  ]);
  const deactivateTag = git(deactivateFixture.root, [
    'rev-parse',
    'refs/tags/activation-deactivate',
  ]);
  git(deactivateFixture.root, ['update-ref', ACTIVATION_REF, deactivateTag]);

  const deactivated = deactivateStateActivation(
    { integrationRef: 'refs/heads/dev' },
    deactivateFixture.root,
  );
  assert.equal(deactivated.written, true);
  assert.equal(deactivated.oldOid, deactivateTag);
  assert.throws(() => git(deactivateFixture.root, ['rev-parse', '--verify', ACTIVATION_REF]));
});

test('20260723-202646 CR3: install fails when the source moves concurrently', () => {
  const { root, head } = preparedForInstall();
  assert.throws(
    () =>
      installStateActivation(
        {
          integrationRef: 'refs/heads/dev',
          beforeRefTransaction: () => git(root, ['update-ref', 'refs/heads/dev', head]),
        },
        root,
      ),
    (error) => {
      assert.equal(error.message, 'state activation source changed concurrently; retry');
      return true;
    },
  );
  assert.throws(() => git(root, ['rev-parse', '--verify', ACTIVATION_REF]));
});

for (const [field, patch, message] of [
  [
    'project_id',
    'project_id: tampered',
    'state activation source project_id does not match baseline manifest',
  ],
  [
    'inventory_digest',
    `inventory_digest: ${'b'.repeat(64)}`,
    'state activation source inventory_digest does not match baseline manifest',
  ],
  [
    'minimum_client_version',
    'minimum_client_version: 99.0.0',
    'state activation source minimum_client_version does not match baseline manifest',
  ],
]) {
  test(`20260723-202646 CR3: install rejects authority whose ${field} diverges from the baseline`, () => {
    const { root } = preparedForInstall();
    const authority = git(root, ['show', 'dev:.changeledger/authority.yml']);
    const line = authority.match(new RegExp(`^${field}: .*$`, 'm'))[0];
    const tampered = authority.replace(line, patch);
    const blob = git(root, ['hash-object', '-w', '--stdin'], tampered);
    // Build a new dev tip that replaces only the authority blob.
    git(root, ['read-tree', 'dev']);
    git(root, [
      'update-index',
      '--add',
      '--cacheinfo',
      `100644,${blob},.changeledger/authority.yml`,
    ]);
    const newTree = git(root, ['write-tree']);
    const parent = git(root, ['rev-parse', 'dev']);
    const commit = git(root, [
      'commit-tree',
      newTree,
      '-p',
      parent,
      '-m',
      'test: tamper authority',
    ]);
    git(root, ['update-ref', 'refs/heads/dev', commit]);
    assert.throws(
      () => installStateActivation({ integrationRef: 'refs/heads/dev' }, root),
      (error) => {
        assert.equal(error.message, message);
        return true;
      },
    );
    assert.throws(() => git(root, ['rev-parse', '--verify', ACTIVATION_REF]));
  });
}

test('20260723-202646 correction: install rejects an unsupported state_ref before CAS', () => {
  const { root } = preparedForInstall();
  const authority = git(root, ['show', 'dev:.changeledger/authority.yml']);
  const tampered = authority.replace(
    'state_ref: refs/heads/changeledger/state',
    'state_ref: refs/heads/not-changeledger-state',
  );
  const blob = git(root, ['hash-object', '-w', '--stdin'], tampered);
  git(root, ['read-tree', 'dev']);
  git(root, ['update-index', '--add', '--cacheinfo', `100644,${blob},.changeledger/authority.yml`]);
  const tree = git(root, ['write-tree']);
  const parent = git(root, ['rev-parse', 'dev']);
  const commit = git(root, ['commit-tree', tree, '-p', parent, '-m', 'test: invalid state ref']);
  git(root, ['update-ref', 'refs/heads/dev', commit]);

  assert.throws(
    () => installStateActivation({ integrationRef: 'refs/heads/dev' }, root),
    /Unsupported state authority ref: refs\/heads\/not-changeledger-state/,
  );
  assert.throws(() => git(root, ['rev-parse', '--verify', ACTIVATION_REF]));
});

// A repo activated and then recovered: activation points at the cutover commit,
// confirmed/observed are consistent, and the integration branch has advanced to
// a fresh commit that no longer carries `.changeledger/authority.yml`.
function activatedThenRecovered() {
  const { root, baseline, activation } = preparedForInstall();
  const cutover = git(root, ['rev-parse', 'dev']);
  installStateActivation({ integrationRef: 'refs/heads/dev' }, root);
  git(root, ['update-ref', CONFIRMED_REF, baseline]);
  git(root, ['update-ref', OBSERVED_REF, baseline]);
  // Recovery advances the integration branch to a commit without authority.
  git(root, ['read-tree', 'dev']);
  git(root, ['update-index', '--force-remove', '--', '.changeledger/authority.yml']);
  const recoveredTree = git(root, ['write-tree']);
  const recovered = git(root, ['commit-tree', recoveredTree, '-p', cutover, '-m', 'test: recover']);
  git(root, ['update-ref', 'refs/heads/dev', recovered]);
  return { root, baseline, cutover, recovered, activation };
}

test('20260723-202646 CR5: deactivate removes activation/confirmed/observed atomically', () => {
  const { root, baseline, recovered } = activatedThenRecovered();

  const result = deactivateStateActivation({ integrationRef: 'refs/heads/dev' }, root);
  assert.equal(result.written, true);
  assert.throws(() => git(root, ['rev-parse', '--verify', ACTIVATION_REF]));
  assert.throws(() => git(root, ['rev-parse', '--verify', CONFIRMED_REF]));
  assert.throws(() => git(root, ['rev-parse', '--verify', OBSERVED_REF]));
  // The baseline commit and its state snapshot are preserved for recovery.
  assert.equal(git(root, ['rev-parse', '--verify', `${baseline}^{commit}`]), baseline);
  assert.equal(
    git(root, ['ls-remote', '--refs', 'origin', 'refs/heads/changeledger/state']).split(/\s/)[0],
    baseline,
  );
  assert.equal(git(root, ['rev-parse', 'dev']), recovered);

  // Idempotent: all three refs already absent returns success without writing.
  const repeated = deactivateStateActivation({ integrationRef: 'refs/heads/dev' }, root);
  assert.equal(repeated.written, false);

  assert.throws(() => deactivateStateActivation({ integrationRef: 'not-a-full-ref' }, root));
});

test('20260723-202646 CR5: deactivate rejects an integration ref that still carries authority', () => {
  const { root, cutover } = activatedThenRecovered();
  git(root, ['update-ref', 'refs/heads/dev', cutover]);
  assert.throws(
    () => deactivateStateActivation({ integrationRef: 'refs/heads/dev' }, root),
    (error) => {
      assert.equal(
        error.message,
        'state activation deactivation requires refs/heads/dev without .changeledger/authority.yml',
      );
      return true;
    },
  );
  assert.equal(git(root, ['rev-parse', '--verify', ACTIVATION_REF]), cutover);
});

test('20260723-202646 correction: deactivate rejects a different authority-free branch', () => {
  const { root, cutover } = activatedThenRecovered();
  git(root, ['branch', 'not-dev', 'dev']);
  assert.throws(
    () => deactivateStateActivation({ integrationRef: 'refs/heads/not-dev' }, root),
    (error) => {
      assert.equal(
        error.message,
        'state activation deactivation requires --integration-ref to name git.integration_branch dev',
      );
      return true;
    },
  );
  assert.equal(git(root, ['rev-parse', '--verify', ACTIVATION_REF]), cutover);
  assert.equal(git(root, ['rev-parse', '--verify', CONFIRMED_REF]).length >= 40, true);
  assert.equal(git(root, ['rev-parse', '--verify', OBSERVED_REF]).length >= 40, true);
});

test('20260723-202646 CR5: deactivate refuses while a pending state exists', () => {
  const { root, baseline } = activatedThenRecovered();
  git(root, ['update-ref', PENDING_REF, baseline]);
  assert.throws(
    () => deactivateStateActivation({ integrationRef: 'refs/heads/dev' }, root),
    (error) => {
      assert.equal(
        error.message,
        'state activation deactivation requires no refs/changeledger/pending',
      );
      return true;
    },
  );
  assert.equal(git(root, ['rev-parse', '--verify', ACTIVATION_REF]).length >= 40, true);
});

test('20260723-202646 correction: pending-only state is not already deactivated', () => {
  const { root, baseline } = activatedThenRecovered();
  git(root, ['update-ref', '-d', ACTIVATION_REF]);
  git(root, ['update-ref', '-d', CONFIRMED_REF]);
  git(root, ['update-ref', '-d', OBSERVED_REF]);
  git(root, ['update-ref', PENDING_REF, baseline]);

  assert.throws(
    () => deactivateStateActivation({ integrationRef: 'refs/heads/dev' }, root),
    new Error('state activation deactivation requires no refs/changeledger/pending'),
  );
  assert.equal(git(root, ['rev-parse', '--verify', PENDING_REF]), baseline);
});

test('20260723-202646 correction: deactivate CAS verifies pending stays absent', () => {
  const { root, baseline, cutover } = activatedThenRecovered();

  assert.throws(
    () =>
      deactivateStateActivation(
        {
          integrationRef: 'refs/heads/dev',
          beforeRefTransaction: () => git(root, ['update-ref', PENDING_REF, baseline]),
        },
        root,
      ),
    /state activation refs changed concurrently; retry/,
  );
  assert.equal(git(root, ['rev-parse', '--verify', ACTIVATION_REF]), cutover);
  assert.equal(git(root, ['rev-parse', '--verify', CONFIRMED_REF]), baseline);
  assert.equal(git(root, ['rev-parse', '--verify', OBSERVED_REF]), baseline);
  assert.equal(git(root, ['rev-parse', '--verify', PENDING_REF]), baseline);
});

test('20260723-202646 CR5: deactivate requires matching confirmed and observed', () => {
  const { root, cutover } = activatedThenRecovered();
  git(root, ['update-ref', OBSERVED_REF, cutover]);
  assert.throws(
    () => deactivateStateActivation({ integrationRef: 'refs/heads/dev' }, root),
    (error) => {
      assert.equal(
        error.message,
        'state activation deactivation requires matching refs/changeledger/confirmed and refs/changeledger/observed',
      );
      return true;
    },
  );
});
