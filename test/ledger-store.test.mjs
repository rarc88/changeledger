import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { status } from '../src/commands/agent.mjs';
import { buildAgentContext } from '../src/commands/agent-context.mjs';
import { check } from '../src/commands/check.mjs';
import { buildContext } from '../src/commands/context.mjs';
import { newChange } from '../src/commands/new.mjs';
import { registerRepo } from '../src/commands/register.mjs';
import { search } from '../src/commands/search.mjs';
import { loadLedgerStore } from '../src/ledger-store.mjs';
import { loadRepo } from '../src/repo.mjs';
import { serialize } from '../src/viewer/domain.mjs';
import { changeText, createStateRepo, stateConfig } from './helpers/state-repo.mjs';

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function fixture({ mutateState, objectFormat } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-state-store-'));
  const initArgs = ['init', '-q', '-b', 'dev'];
  if (objectFormat) initArgs.push(`--object-format=${objectFormat}`);
  git(root, initArgs);
  git(root, ['config', 'user.name', 'Test User']);
  git(root, ['config', 'user.email', 'test@example.com']);
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  fs.mkdirSync(path.join(root, '.changeledger'), { recursive: true });
  fs.writeFileSync(path.join(root, '.changeledger', 'config.yml'), 'project_id: local\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'chore: base']);

  git(root, ['checkout', '-q', '--orphan', 'changeledger/state']);
  git(root, ['rm', '-qrf', '--ignore-unmatch', '.']);
  const state = path.join(root, '.changeledger-state');
  fs.mkdirSync(path.join(state, 'changes'), { recursive: true });
  fs.mkdirSync(path.join(state, 'specs'), { recursive: true });
  fs.mkdirSync(path.join(state, 'releases'), { recursive: true });
  fs.writeFileSync(path.join(state, 'manifest.yml'), 'format_version: 1\nproject_id: project-1\n');
  fs.writeFileSync(
    path.join(state, 'config.yml'),
    'project_id: project-1\nlanguage: es\nchanges_dir: ignored\ntypes:\n  feature:\n    stages: [request]\n',
  );
  fs.writeFileSync(
    path.join(state, 'changes', '20260721-000000-demo.md'),
    '---\nid: "20260721-000000"\ntitle: Demo\ntype: feature\nstatus: done\ncreated: 2026-07-21T00:00:00Z\ndepends_on: []\n---\n\n## Request\n\nDemo.\n',
  );
  fs.writeFileSync(
    path.join(state, 'specs', 'demo.md'),
    '---\ntitle: Demo\nupdated: 2026-07-21T00:00:00Z\ntags: [feature]\ngraduated_from: ["20260721-000000"]\n---\n\n# Demo\n',
  );
  fs.writeFileSync(
    path.join(state, 'releases', '1.0.0.yml'),
    'version: 1.0.0\nchanges: ["20260721-000000"]\n',
  );
  mutateState?.(state);
  git(root, ['add', '.changeledger-state']);
  git(root, ['commit', '-qm', 'chore: state']);
  const baseline = git(root, ['rev-parse', 'HEAD']);

  git(root, ['checkout', '-q', 'dev']);
  fs.rmSync(path.join(root, '.changeledger', 'config.yml'));
  fs.writeFileSync(
    path.join(root, '.changeledger', 'authority.yml'),
    `format_version: 1\nstate_ref: refs/heads/changeledger/state\nbaseline: ${baseline}\nproject_id: project-1\n`,
  );
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'chore: authority']);
  return { root, baseline };
}

test('193101 CR1/CR2/CR6: state store loads one complete Git snapshot, not worktree files', () => {
  const { root, baseline } = fixture();
  const store = loadLedgerStore(root);
  const snapshot = store.load();

  assert.equal(snapshot.mode, 'state');
  assert.equal(snapshot.revision, baseline);
  assert.equal(snapshot.manifest.project_id, 'project-1');
  assert.equal(snapshot.config.project_id, 'project-1');
  assert.equal(snapshot.changes[0].frontmatter.id, '20260721-000000');
  assert.equal(snapshot.specs[0].name, 'demo.md');
  assert.equal(snapshot.releases[0].name, '1.0.0.yml');
  assert.match(snapshot.changes[0].file, new RegExp(`^git:${baseline}:`));
  assert.equal(fs.existsSync(path.join(root, '.changeledger', 'changes')), false);
});

test('193101 CR2: repository readers use the selected snapshot instead of legacy paths', () => {
  const { root, baseline } = fixture();
  const repo = loadRepo(root);
  assert.equal(repo.mode, 'state');
  assert.equal(repo.revision, baseline);
  assert.equal(serialize(repo).ledger_revision, baseline);
  assert.deepEqual(
    search('Demo', {}, root).map((hit) => hit.ref),
    ['spec:demo', '#20260721-000000'],
  );
  const output = { log: (text) => (output.text = text), warn() {}, error() {} };
  check(['--json'], root, output);
  assert.equal(JSON.parse(output.text).revision, baseline);
});

test('193101 CR1: missing collections are empty, but manifest and config are mandatory', () => {
  const { root } = fixture({
    mutateState(state) {
      fs.rmSync(path.join(state, 'changes'), { recursive: true });
      fs.rmSync(path.join(state, 'specs'), { recursive: true });
      fs.rmSync(path.join(state, 'releases'), { recursive: true });
    },
  });
  const snapshot = loadLedgerStore(root).load();
  assert.deepEqual([snapshot.changes, snapshot.specs, snapshot.releases], [[], [], []]);

  const missing = fixture({ mutateState: (state) => fs.rmSync(path.join(state, 'manifest.yml')) });
  assert.throws(
    () => loadLedgerStore(missing.root).load(),
    /missing .changeledger-state\/manifest.yml/,
  );
});

test('193101 CR1/CR3: invalid state authority fails closed without loading legacy files', () => {
  const mismatch = fixture({
    mutateState(state) {
      fs.writeFileSync(path.join(state, 'manifest.yml'), 'format_version: 1\nproject_id: other\n');
    },
  });
  assert.throws(() => loadLedgerStore(mismatch.root).load(), /project_id does not match authority/);

  const { root } = fixture();
  fs.writeFileSync(
    path.join(root, '.changeledger', 'authority.yml'),
    `format_version: 1\nstate_ref: refs/heads/changeledger/state\nbaseline: ${'d'.repeat(40)}\nproject_id: project-1\n`,
  );
  assert.throws(() => loadLedgerStore(root).load(), /state authority is unavailable/);
});

test('193101 correction CR3: authority baseline must be an exact full commit OID', () => {
  const { root } = fixture();
  fs.writeFileSync(
    path.join(root, '.changeledger', 'authority.yml'),
    'format_version: 1\nstate_ref: refs/heads/changeledger/state\nbaseline: refs/heads/changeledger/state\nproject_id: project-1\n',
  );
  assert.throws(() => loadLedgerStore(root).load(), /baseline must be an exact commit OID/);
});

test('193101 hardening CR3: authority baseline OID must name a commit object itself', () => {
  for (const objectFormat of ['sha1', 'sha256']) {
    const { root, baseline } = fixture({ objectFormat });
    git(root, ['tag', '-a', 'baseline-tag', baseline, '-m', 'annotated baseline']);
    const candidates = [
      git(root, ['rev-parse', 'refs/tags/baseline-tag']),
      git(root, ['rev-parse', `${baseline}^{tree}`]),
      git(root, ['rev-parse', `${baseline}:.changeledger-state/manifest.yml`]),
    ];

    for (const candidate of candidates) {
      fs.writeFileSync(
        path.join(root, '.changeledger', 'authority.yml'),
        `format_version: 1\nstate_ref: refs/heads/changeledger/state\nbaseline: ${candidate}\nproject_id: project-1\n`,
      );
      assert.throws(
        () => loadLedgerStore(root).load(),
        /baseline must identify a commit object/,
        `${objectFormat} must reject ${git(root, ['cat-file', '-t', candidate])}`,
      );
    }
  }
});

test('193101 hardening CR8: state mutation requires an explicit snapshot baseline', () => {
  const { root } = fixture();
  const store = loadLedgerStore(root);
  const before = store.load();
  assert.throws(
    () =>
      store.mutate({ message: 'test: missing baseline' }, ({ snapshot, write }) => {
        write(snapshot.changes[0].statePath, snapshot.changes[0].text.replace('Demo', 'Unsafe'));
      }),
    /expectedRevision is required/,
  );
  assert.equal(store.load().revision, before.revision);
});

test('193101 hardening CR8: a no-op mutation still linearizes against its snapshot', () => {
  const { root } = createStateRepo();
  const store = loadLedgerStore(root);
  const observed = store.load();
  let advanced;

  assert.throws(
    () =>
      store.mutate(
        { message: 'test: outer no-op', expectedRevision: observed.revision },
        ({ snapshot }) => {
          advanced = store.mutate(
            { message: 'test: concurrent successor', expectedRevision: snapshot.revision },
            ({ snapshot: current, write }) => {
              const change = current.changes[0];
              write(change.statePath, change.text.replace('title: Demo', 'title: Advanced'));
            },
          );
        },
      ),
    /Ledger state changed concurrently/,
  );
  assert.equal(store.load().revision, advanced.revision);
});

test('193101 hardening CR8: effective identity deltas preserve S1 without a commit', () => {
  const { root } = createStateRepo();
  const store = loadLedgerStore(root);
  const before = store.load();

  const after = store.mutate(
    { message: 'test: identity delta', expectedRevision: before.revision },
    ({ snapshot, write, remove }) => {
      write(snapshot.configStatePath, snapshot.configText);
      remove('.changeledger-state/specs/missing.md');
    },
  );

  assert.equal(after.revision, before.revision);
  assert.equal(store.load().revision, before.revision);
});

test('193101 hardening CR8: an effective identity delta rejects a concurrent successor', () => {
  const { root } = createStateRepo();
  const store = loadLedgerStore(root);
  const observed = store.load();
  let advanced;

  assert.throws(
    () =>
      store.mutate(
        { message: 'test: identity race', expectedRevision: observed.revision },
        ({ snapshot, write }) => {
          write(snapshot.configStatePath, snapshot.configText);
          advanced = store.mutate(
            { message: 'test: concurrent successor', expectedRevision: snapshot.revision },
            ({ snapshot: current, write: writeCurrent }) => {
              const change = current.changes[0];
              writeCurrent(change.statePath, change.text.replace('title: Demo', 'title: Advanced'));
            },
          );
        },
      ),
    /Ledger state changed concurrently/,
  );
  assert.equal(store.load().revision, advanced.revision);
});

test('193101 CR3: a legacy repository retains the worktree adapter', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-worktree-store-'));
  fs.mkdirSync(path.join(root, '.changeledger', 'changes'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.changeledger', 'config.yml'),
    'project_id: legacy\nchanges_dir: .changeledger/changes\ntypes:\n  feature:\n    stages: [request]\n',
  );
  fs.writeFileSync(
    path.join(root, '.changeledger', 'changes', '20260721-000000-demo.md'),
    '---\nid: "20260721-000000"\ntitle: Demo\ntype: feature\nstatus: draft\ncreated: 2026-07-21T00:00:00Z\ndepends_on: []\n---\n\n## Request\n\nDemo.\n',
  );

  const snapshot = loadLedgerStore(root).load();
  assert.equal(snapshot.mode, 'worktree');
  assert.equal(snapshot.revision, null);
  assert.equal(snapshot.changes.length, 1);
});

test('193101 CR7: the state tree rejects files outside the closed layout', () => {
  const { root } = fixture({
    mutateState(state) {
      fs.writeFileSync(path.join(state, 'unexpected.txt'), 'nope\n');
    },
  });
  assert.throws(() => loadLedgerStore(root).load(), /invalid state path/);
});

test('193101 correction CR7: state writes reject a parallel lookalike root', () => {
  const { root } = fixture();
  const store = loadLedgerStore(root);
  const before = store.load();
  assert.throws(
    () =>
      store.mutate(
        { message: 'test: hidden parallel state', expectedRevision: before.revision },
        ({ write }) => {
          write('xchangeledger-state/changes/hidden.md', changeText({ id: '20260721-000001' }));
        },
      ),
    /invalid state path/,
  );
  assert.equal(store.load().revision, before.revision);
});

test('193101 correction CR6/CR8: every state transaction guards current and candidate schemas', () => {
  const future = createStateRepo({ configText: stateConfig({ schemaVersion: 4 }) });
  const futureStore = loadLedgerStore(future.root);
  const futureRevision = futureStore.load().revision;
  assert.throws(
    () =>
      futureStore.mutate(
        { message: 'test: must reject future source', expectedRevision: futureRevision },
        ({ snapshot, write }) => {
          write(snapshot.changes[0].statePath, snapshot.changes[0].text.replace('Demo', 'Changed'));
        },
      ),
    /config schema 4 is newer than supported schema 3/,
  );
  assert.equal(futureStore.load().revision, futureRevision);

  const supported = createStateRepo();
  const supportedStore = loadLedgerStore(supported.root);
  const supportedRevision = supportedStore.load().revision;
  assert.throws(
    () =>
      supportedStore.mutate(
        { message: 'test: must reject future candidate', expectedRevision: supportedRevision },
        ({ snapshot, write }) => {
          write(
            snapshot.configStatePath,
            snapshot.configText.replace('schema_version: 3', 'schema_version: 4'),
          );
        },
      ),
    /config schema 4 is newer than supported schema 3/,
  );
  assert.equal(supportedStore.load().revision, supportedRevision);
});

test('193101 correction CR8: expected revision prevents bulk preflight from crossing snapshots', () => {
  const { root } = createStateRepo();
  const store = loadLedgerStore(root);
  const initial = store.load();
  const advanced = store.mutate(
    { message: 'test: concurrent advance', expectedRevision: initial.revision },
    ({ snapshot, write }) => {
      write(snapshot.changes[0].statePath, snapshot.changes[0].text.replace('Demo', 'Advanced'));
    },
  );
  assert.throws(
    () =>
      store.mutate(
        { message: 'test: stale bulk', expectedRevision: initial.revision },
        ({ snapshot, write }) => {
          write(
            snapshot.changes[0].statePath,
            snapshot.changes[0].text.replace('Advanced', 'Stale'),
          );
        },
      ),
    /changed concurrently; retry/,
  );
  assert.equal(store.load().revision, advanced.revision);
  assert.match(store.load().changes[0].text, /Advanced/);
});

test('193101 correction CR8: lifecycle rejects a ref advance after its S1 preflight', () => {
  const { root } = createStateRepo({ changes: [changeText({ status: 'approved' })] });
  const store = loadLedgerStore(root);
  const before = store.load();
  assert.throws(
    () =>
      status('20260721-000000', 'in-progress', root, {
        actor: 'agent',
        ownerHandle() {
          store.mutate(
            {
              message: 'test: concurrent lifecycle advance',
              expectedRevision: before.revision,
            },
            ({ snapshot, write }) => {
              write(
                snapshot.changes[0].statePath,
                snapshot.changes[0].text.replace('title: Demo', 'title: Concurrent'),
              );
            },
          );
          return 'test-user';
        },
      }),
    /changed concurrently; retry/,
  );
  const after = store.load();
  assert.notEqual(after.revision, before.revision);
  assert.equal(after.changes[0].frontmatter.status, 'approved');
});

test('193101 correction CR2/CR3/CR6: context and register use authority-only state', () => {
  const { root } = createStateRepo();
  const snapshot = loadLedgerStore(root).load();
  const context = buildContext('20260721-000000', root);
  assert.match(context, new RegExp(`Ledger snapshot: ${snapshot.revision}`));
  assert.match(context, /# Selected change/);
  assert.match(context, /title: Demo/);
  const previousHome = process.env.CHANGELEDGER_HOME;
  process.env.CHANGELEDGER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-registry-'));
  try {
    const registered = registerRepo(root, { warn() {} });
    assert.equal(registered.id, 'project-1');
  } finally {
    if (previousHome === undefined) delete process.env.CHANGELEDGER_HOME;
    else process.env.CHANGELEDGER_HOME = previousHome;
  }
});

test('193101 CR8: a state mutation validates and publishes one successor without touching legacy files', () => {
  const { root } = fixture({
    mutateState(state) {
      fs.rmSync(path.join(state, 'specs'), { recursive: true });
      fs.rmSync(path.join(state, 'releases'), { recursive: true });
      fs.writeFileSync(
        path.join(state, 'config.yml'),
        [
          'project_id: project-1',
          'changes_dir: .changeledger-state/changes',
          'statuses: [draft, approved, in-progress, in-validation, blocked, done, discarded]',
          'stages: [request, log]',
          'types:',
          '  feature:',
          '    stages: [request]',
          '',
        ].join('\n'),
      );
      fs.writeFileSync(
        path.join(state, 'changes', '20260721-000000-demo.md'),
        '---\nid: "20260721-000000"\ntitle: Demo\ntype: feature\nstatus: draft\ncreated: 2026-07-21T00:00:00Z\ndepends_on: []\n---\n\n## Request\n\nDemo.\n',
      );
    },
  });
  const store = loadLedgerStore(root);
  const before = store.load();

  const after = store.mutate(
    { message: 'test: update ledger snapshot', expectedRevision: before.revision },
    ({ snapshot, write }) => {
      const change = snapshot.changes[0];
      write(change.statePath, change.text.replace('title: Demo', 'title: Updated'));
    },
  );

  assert.notEqual(after.revision, before.revision);
  assert.equal(after.changes[0].frontmatter.title, 'Updated');
  assert.equal(fs.existsSync(path.join(root, '.changeledger', 'changes')), false);
  assert.equal(
    git(root, ['show', `${before.revision}:.changeledger-state/changes/20260721-000000-demo.md`]),
    before.changes[0].text.trim(),
  );
});

test('193101 CR8: an invalid candidate leaves the state ref at S1', () => {
  const { root } = fixture();
  const store = loadLedgerStore(root);
  const before = store.load();

  assert.throws(
    () =>
      store.mutate(
        { message: 'test: invalid ledger snapshot', expectedRevision: before.revision },
        ({ snapshot, write }) => {
          write(snapshot.changes[0].statePath, 'not a change document\n');
        },
      ),
    /Ledger state validation failed/,
  );
  assert.equal(store.load().revision, before.revision);
});

test('193101 CR8: lifecycle status writes only the state successor', () => {
  const { root } = fixture({
    mutateState(state) {
      fs.rmSync(path.join(state, 'specs'), { recursive: true });
      fs.rmSync(path.join(state, 'releases'), { recursive: true });
      fs.writeFileSync(
        path.join(state, 'config.yml'),
        [
          'project_id: project-1',
          'changes_dir: .changeledger-state/changes',
          'statuses: [draft, approved, in-progress, in-validation, blocked, done, discarded]',
          'stages: [request, log]',
          'types:',
          '  feature:',
          '    stages: [request]',
          '',
        ].join('\n'),
      );
      fs.writeFileSync(
        path.join(state, 'changes', '20260721-000000-demo.md'),
        '---\nid: "20260721-000000"\ntitle: Demo\ntype: feature\nstatus: draft\ncreated: 2026-07-21T00:00:00Z\ndepends_on: []\n---\n\n## Request\n\nDemo.\n',
      );
    },
  });
  const before = loadLedgerStore(root).load();

  status('20260721-000000', 'approved', root);

  const after = loadLedgerStore(root).load();
  assert.notEqual(after.revision, before.revision);
  assert.equal(after.changes[0].frontmatter.status, 'approved');
  assert.equal(fs.existsSync(path.join(root, '.changeledger', 'changes')), false);
});

test('193101 CR2: agent context selects its change from the state snapshot', () => {
  const { root } = fixture();
  const context = buildAgentContext('investigation', '20260721-000000', root);
  assert.match(context, /title: Demo/);
  assert.match(context, /Effective policy: language=es/);
});

test('193101 CR8: new creates a change only in the state successor', () => {
  const { root } = fixture({
    mutateState(state) {
      fs.rmSync(path.join(state, 'specs'), { recursive: true });
      fs.rmSync(path.join(state, 'releases'), { recursive: true });
      fs.writeFileSync(
        path.join(state, 'config.yml'),
        [
          'project_id: project-1',
          'changes_dir: .changeledger-state/changes',
          'statuses: [draft, approved, in-progress, in-validation, blocked, done, discarded]',
          'stages: [request, log]',
          'types:',
          '  feature:',
          '    stages: [request]',
          '',
        ].join('\n'),
      );
      fs.writeFileSync(
        path.join(state, 'changes', '20260721-000000-demo.md'),
        '---\nid: "20260721-000000"\ntitle: Demo\ntype: feature\nstatus: draft\ncreated: 2026-07-21T00:00:00Z\ndepends_on: []\n---\n\n## Request\n\nDemo.\n',
      );
    },
  });
  const before = loadLedgerStore(root).load();

  const file = newChange(
    {
      type: 'feature',
      slug: 'state-change',
      title: 'State change',
      now: '2026-07-21T01:00:00Z',
    },
    root,
  );

  const after = loadLedgerStore(root).load();
  assert.match(file, /^git:/);
  assert.notEqual(after.revision, before.revision);
  assert.ok(after.changes.some((change) => change.frontmatter.id === '20260721-010000'));
  assert.equal(fs.existsSync(path.join(root, '.changeledger', 'changes')), false);
});

test('193101 CR7: state snapshots and mutations are portable across SHA-1 and SHA-256', () => {
  for (const objectFormat of ['sha1', 'sha256']) {
    let created;
    try {
      created = createStateRepo({ objectFormat, changes: [changeText()] });
    } catch (error) {
      if (
        objectFormat === 'sha256' &&
        /unknown option|unsupported|not supported/i.test(error.message)
      ) {
        continue;
      }
      throw error;
    }
    const store = loadLedgerStore(created.root);
    const before = store.load();
    status('20260721-000000', 'approved', created.root);
    const after = store.load();
    assert.notEqual(after.revision, before.revision, objectFormat);
    assert.equal(after.changes[0].frontmatter.status, 'approved', objectFormat);
    assert.equal(after.revision.length, objectFormat === 'sha256' ? 64 : 40);
  }
});

test('193101 correction CR7: state paths use raw NUL framing across Git formats', () => {
  const specText = [
    '---',
    'title: Portable path',
    'updated: 2026-07-22T00:00:00Z',
    'tags: [portability]',
    '---',
    '',
    '# Portable path',
    '',
  ].join('\n');
  const names = [
    'café.md',
    'carriage\rreturn.md',
    'colon:name.md',
    'line\nbreak.md',
    'quote"back\\slash\tname.md',
  ];

  for (const objectFormat of ['sha1', 'sha256']) {
    let created;
    try {
      created = createStateRepo({
        objectFormat,
        specs: Object.fromEntries(names.map((name) => [name, specText])),
      });
    } catch (error) {
      if (
        objectFormat === 'sha256' &&
        /unknown option|unsupported|not supported/i.test(error.message)
      ) {
        continue;
      }
      throw error;
    }

    for (const quotePath of ['true', 'false']) {
      git(created.root, ['config', 'core.quotePath', quotePath]);
      const snapshot = loadLedgerStore(created.root).load();
      assert.deepEqual(
        snapshot.specs.map((spec) => spec.name).sort(),
        names.toSorted(),
        `${objectFormat} with core.quotePath=${quotePath}`,
      );
    }

    const store = loadLedgerStore(created.root);
    const before = store.load();
    const target = before.specs.find((spec) => spec.name === 'line\nbreak.md');
    const after = store.mutate(
      { message: 'test: update unusual path', expectedRevision: before.revision },
      ({ write }) => write(target.statePath, target.text.replace('# Portable', '# Updated')),
    );
    assert.notEqual(after.revision, before.revision, objectFormat);
    assert.match(
      after.specs.find((spec) => spec.name === target.name).text,
      /# Updated path/,
      objectFormat,
    );
  }
});

test('193101 correction CR7: state path grammar rejects suffix line breaks', () => {
  const { root } = createStateRepo();
  const store = loadLedgerStore(root);
  const before = store.load();

  assert.throws(
    () =>
      store.mutate(
        { message: 'test: reject suffix break', expectedRevision: before.revision },
        ({ write }) => write('.changeledger-state/specs/look-valid.md\n', '# Invalid\n'),
      ),
    /invalid state path/,
  );
  assert.equal(store.load().revision, before.revision);
});
