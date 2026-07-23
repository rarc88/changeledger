import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { STATE_REF } from '../src/ledger-store.mjs';
import {
  parseReceiveBatch,
  validateReceiveBatch,
  validateStateUpdate,
} from '../src/state-validation.mjs';
import { changeText, createStateRepo, git, stateConfig } from './helpers/state-repo.mjs';

const INTEGRATION_REF = 'refs/heads/dev';

function fixture(objectFormat = 'sha1', overrideConfig) {
  const configText = (overrideConfig ?? stateConfig()).replace(
    'statuses:',
    'git:\n  integration_branch: dev\nstatuses:',
  );
  const created = createStateRepo({ objectFormat, configText });
  const authority = path.join(created.root, '.changeledger', 'authority.yml');
  fs.writeFileSync(
    authority,
    `format_version: 2\nstate_ref: ${STATE_REF}\nbaseline: ${created.baseline}\nproject_id: project-1\ninventory_digest: ${'a'.repeat(64)}\nminimum_client_version: 0.13.0\n`,
  );
  git(created.root, ['add', authority]);
  git(created.root, ['commit', '-qm', 'test: activate v2']);
  return { ...created, integration: git(created.root, ['rev-parse', INTEGRATION_REF]) };
}

function advanceState(created, mutate, message = 'test: state') {
  git(created.root, ['checkout', '-q', 'changeledger/state']);
  mutate(created.state);
  git(created.root, ['add', '.changeledger-state']);
  git(created.root, ['commit', '-qm', message]);
  const head = git(created.root, ['rev-parse', 'HEAD']);
  git(created.root, ['checkout', '-q', 'dev']);
  return head;
}

function advanceIntegration(created, file, text, message = 'test: integration') {
  fs.mkdirSync(path.dirname(path.join(created.root, file)), { recursive: true });
  fs.writeFileSync(path.join(created.root, file), text);
  git(created.root, ['add', file]);
  git(created.root, ['commit', '-qm', message]);
  return git(created.root, ['rev-parse', 'HEAD']);
}

const roomy = { max_commits: 20, max_object_bytes: 1_000_000, timeout_ms: 5000 };

test('193104 CR1: strict batch framing and duplicate protected refs fail closed', () => {
  assert.throws(() => parseReceiveBatch('a b refs/heads/x', { oidLength: 40 }), /truncated line/);
  assert.throws(
    () => parseReceiveBatch(`a ${'b'.repeat(40)} refs/heads/x\n`, { oidLength: 40 }),
    /line 1: invalid old OID/,
  );
  assert.throws(
    () =>
      parseReceiveBatch(
        `${'a'.repeat(40)} ${'b'.repeat(40)} refs/heads/x\n\n${'a'.repeat(40)} ${'b'.repeat(40)} refs/heads/y\n`,
        { oidLength: 40 },
      ),
    /line 2/,
  );
  assert.throws(
    () =>
      parseReceiveBatch(`${'a'.repeat(40)}  ${'b'.repeat(40)} refs/heads/x\n`, { oidLength: 40 }),
    /line 1/,
  );
  const created = fixture();
  const line = `${created.baseline} ${created.baseline} ${STATE_REF}\n`;
  assert.throws(
    () =>
      validateReceiveBatch(line + line, {
        repoRoot: created.root,
        stateRef: STATE_REF,
        integrationRef: INTEGRATION_REF,
        limits: roomy,
      }),
    /duplicate protected ref.*line 2/,
  );
  assert.deepEqual(
    validateReceiveBatch(`${created.integration} ${created.integration} refs/heads/topic\n`, {
      repoRoot: created.root,
      stateRef: STATE_REF,
      integrationRef: INTEGRATION_REF,
      limits: roomy,
    }),
    [],
  );
});

test('193104 correction CR1: configured protected ref is validated before filtering', () => {
  const created = fixture();
  git(created.root, ['update-ref', 'refs/heads/main', created.integration]);
  assert.throws(
    () =>
      validateReceiveBatch(`${created.integration} ${created.integration} refs/heads/topic\n`, {
        repoRoot: created.root,
        stateRef: STATE_REF,
        integrationRef: 'refs/heads/main',
        limits: roomy,
      }),
    /does not match confirmed state config/,
  );
});

test('193104 correction CR2: exact authority baseline can create an absent state ref', () => {
  const created = fixture();
  git(created.root, ['update-ref', '-d', STATE_REF]);
  const zero = '0'.repeat(40);
  const result = validateReceiveBatch(`${zero} ${created.baseline} ${STATE_REF}\n`, {
    repoRoot: created.root,
    stateRef: STATE_REF,
    integrationRef: INTEGRATION_REF,
    limits: roomy,
  });
  assert.equal(result[0].newOid, created.baseline);
});

for (const objectFormat of ['sha1', 'sha256']) {
  test(`193104 CR2: state validates every new snapshot with ${objectFormat}`, () => {
    let created;
    try {
      created = fixture(objectFormat);
    } catch (error) {
      if (objectFormat === 'sha256' && /unknown|unsupported|sha256/i.test(error.message)) return;
      throw error;
    }
    const middle = advanceState(created, (state) => {
      const file = path.join(state, 'changes', '20260721-000000-change.md');
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('title: Demo', 'title: Middle'));
    });
    const head = advanceState(created, (state) => {
      const file = path.join(state, 'changes', '20260721-000000-change.md');
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('title: Middle', 'title: Head'));
    });
    git(created.root, ['update-ref', STATE_REF, created.baseline]);
    const receipt = validateStateUpdate({
      repoRoot: created.root,
      oldOid: created.baseline,
      newOid: head,
      ref: STATE_REF,
      stateRef: STATE_REF,
      integrationRef: INTEGRATION_REF,
      limits: roomy,
    });
    assert.equal(receipt.commits, 2);
    assert.equal(receipt.written, false);
    git(created.root, ['update-ref', STATE_REF, head]);

    const invalid = advanceState(created, (state) => {
      fs.writeFileSync(path.join(state, 'stray.txt'), 'invalid\n');
    });
    const final = advanceState(created, (state) => fs.rmSync(path.join(state, 'stray.txt')));
    git(created.root, ['update-ref', STATE_REF, head]);
    assert.throws(
      () =>
        validateStateUpdate({
          repoRoot: created.root,
          oldOid: head,
          newOid: final,
          ref: STATE_REF,
          stateRef: STATE_REF,
          integrationRef: INTEGRATION_REF,
          limits: roomy,
        }),
      new RegExp(invalid.slice(0, 8)),
    );
    assert.throws(
      () =>
        validateStateUpdate({
          repoRoot: created.root,
          oldOid: created.baseline,
          newOid: '0'.repeat(created.baseline.length),
          ref: STATE_REF,
          stateRef: STATE_REF,
          integrationRef: INTEGRATION_REF,
          limits: roomy,
        }),
      /cannot be deleted/,
    );
    assert.ok(middle);
  });
}

test('193104 CR3/CR8: integration preserves authority and legacy roots', () => {
  const created = fixture();
  const code = advanceIntegration(created, 'src/app.mjs', 'export const value = 1;\n');
  git(created.root, ['update-ref', INTEGRATION_REF, created.integration]);
  assert.equal(
    validateStateUpdate({
      repoRoot: created.root,
      oldOid: created.integration,
      newOid: code,
      ref: INTEGRATION_REF,
      stateRef: STATE_REF,
      integrationRef: INTEGRATION_REF,
      limits: roomy,
    }).ok,
    true,
  );
  git(created.root, ['update-ref', INTEGRATION_REF, code]);
  const legacy = advanceIntegration(created, '.changeledger/changes/legacy.md', 'legacy\n');
  git(created.root, ['update-ref', INTEGRATION_REF, code]);
  assert.throws(
    () =>
      validateStateUpdate({
        repoRoot: created.root,
        oldOid: code,
        newOid: legacy,
        ref: INTEGRATION_REF,
        stateRef: STATE_REF,
        integrationRef: INTEGRATION_REF,
        limits: roomy,
      }),
    /protected path changed.*legacy\.md/,
  );
  git(created.root, ['update-ref', INTEGRATION_REF, code]);
  fs.rmSync(path.join(created.root, '.changeledger', 'authority.yml'));
  git(created.root, ['add', '-u']);
  git(created.root, ['commit', '-qm', 'test: remove authority']);
  const removed = git(created.root, ['rev-parse', 'HEAD']);
  git(created.root, ['update-ref', INTEGRATION_REF, code]);
  assert.throws(
    () =>
      validateStateUpdate({
        repoRoot: created.root,
        oldOid: code,
        newOid: removed,
        ref: INTEGRATION_REF,
        stateRef: STATE_REF,
        integrationRef: INTEGRATION_REF,
        limits: roomy,
      }),
    /protected path changed.*authority\.yml/,
  );
});

test('193104 CR3: integration ref must match config and merge side commits cannot hide legacy writes', () => {
  const created = fixture();
  git(created.root, ['branch', 'topic']);
  git(created.root, ['checkout', '-q', 'topic']);
  const legacy = path.join(created.root, '.changeledger', 'changes', 'hidden.md');
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  fs.writeFileSync(legacy, 'hidden\n');
  git(created.root, ['add', legacy]);
  git(created.root, ['commit', '-qm', 'test: hidden legacy write']);
  git(created.root, ['checkout', '-q', 'dev']);
  fs.writeFileSync(path.join(created.root, 'app.mjs'), 'export const app = true;\n');
  git(created.root, ['add', 'app.mjs']);
  git(created.root, ['commit', '-qm', 'test: code']);
  git(created.root, ['merge', '-q', '--no-ff', 'topic', '-m', 'test: merge']);
  const merge = git(created.root, ['rev-parse', 'HEAD']);
  git(created.root, ['update-ref', INTEGRATION_REF, created.integration]);
  assert.throws(
    () =>
      validateStateUpdate({
        repoRoot: created.root,
        oldOid: created.integration,
        newOid: merge,
        ref: INTEGRATION_REF,
        stateRef: STATE_REF,
        integrationRef: INTEGRATION_REF,
        limits: roomy,
      }),
    /protected path changed.*hidden\.md/,
  );

  git(created.root, ['update-ref', 'refs/heads/main', created.integration]);
  assert.throws(
    () =>
      validateStateUpdate({
        repoRoot: created.root,
        oldOid: created.integration,
        newOid: merge,
        ref: 'refs/heads/main',
        stateRef: STATE_REF,
        integrationRef: 'refs/heads/main',
        limits: roomy,
      }),
    /does not match confirmed state config/,
  );
});

test('193104 correction CR3: normalized legacy roots cannot bypass protection', () => {
  const config = stateConfig().replace(
    'changes_dir: .changeledger/changes',
    'changes_dir: ./.changeledger/changes',
  );
  const created = fixture('sha1', config);
  const next = advanceIntegration(created, '.changeledger/changes/bypass.md', 'bypass\n');
  git(created.root, ['update-ref', INTEGRATION_REF, created.integration]);
  assert.throws(
    () =>
      validateStateUpdate({
        repoRoot: created.root,
        oldOid: created.integration,
        newOid: next,
        ref: INTEGRATION_REF,
        stateRef: STATE_REF,
        integrationRef: INTEGRATION_REF,
        limits: roomy,
      }),
    /protected path changed.*bypass\.md/,
  );
});

test('163408 CR1: an unrelated-ref batch skips full snapshot validation even if the state is broken', () => {
  const created = fixture();
  git(created.root, ['checkout', '-q', 'changeledger/state']);
  fs.writeFileSync(path.join(created.state, 'manifest.yml'), 'not: valid: yaml: [');
  git(created.root, ['add', '.changeledger-state']);
  git(created.root, ['commit', '-qm', 'test: corrupt manifest']);
  const corrupted = git(created.root, ['rev-parse', 'HEAD']);
  git(created.root, ['checkout', '-q', 'dev']);
  git(created.root, ['update-ref', STATE_REF, corrupted]);

  const result = validateReceiveBatch(
    `${created.integration} ${created.integration} refs/heads/topic\n`,
    {
      repoRoot: created.root,
      stateRef: STATE_REF,
      integrationRef: INTEGRATION_REF,
      limits: roomy,
    },
  );
  assert.deepEqual(result, []);
});

test('163408 CR1: an unrelated-ref batch is accepted while integration protection is not yet active', () => {
  const created = fixture();
  fs.rmSync(path.join(created.root, '.changeledger', 'authority.yml'));
  git(created.root, ['add', '.changeledger']);
  git(created.root, ['commit', '-qm', 'test: revert authority']);
  const reverted = git(created.root, ['rev-parse', 'HEAD']);
  git(created.root, ['update-ref', INTEGRATION_REF, reverted]);

  const result = validateReceiveBatch(`${reverted} ${reverted} refs/heads/topic\n`, {
    repoRoot: created.root,
    stateRef: STATE_REF,
    integrationRef: INTEGRATION_REF,
    limits: roomy,
  });
  assert.deepEqual(result, []);
});

test('163408 CR2: the legacy-path filter is case-insensitive', () => {
  const created = fixture();
  const next = advanceIntegration(created, '.changeledger/CHANGES/bypass.md', 'bypass\n');
  git(created.root, ['update-ref', INTEGRATION_REF, created.integration]);
  assert.throws(
    () =>
      validateStateUpdate({
        repoRoot: created.root,
        oldOid: created.integration,
        newOid: next,
        ref: INTEGRATION_REF,
        stateRef: STATE_REF,
        integrationRef: INTEGRATION_REF,
        limits: roomy,
      }),
    /protected path changed.*bypass\.md/,
  );
});

for (const objectFormat of ['sha1', 'sha256']) {
  test(`204131 CR1: deleting the protected integration ref gets a specific diagnostic (${objectFormat})`, () => {
    let created;
    try {
      created = fixture(objectFormat);
    } catch (error) {
      if (objectFormat === 'sha256' && /unknown|unsupported|sha256/i.test(error.message)) return;
      throw error;
    }
    const zero = '0'.repeat(objectFormat === 'sha256' ? 64 : 40);

    assert.throws(
      () =>
        validateStateUpdate({
          repoRoot: created.root,
          oldOid: created.integration,
          newOid: zero,
          ref: INTEGRATION_REF,
          stateRef: STATE_REF,
          integrationRef: INTEGRATION_REF,
          limits: roomy,
        }),
      (error) => {
        assert.match(error.message, new RegExp(INTEGRATION_REF.replace(/\//g, '\\/')));
        assert.match(error.message, /forbidden|prohibited/i);
        assert.doesNotMatch(error.message, /integration protection is not active/);
        return true;
      },
    );
  });
}

test('204131 CR2: a genuinely absent protection config keeps its existing diagnostic', () => {
  const created = fixture();
  fs.rmSync(path.join(created.root, '.changeledger', 'authority.yml'));
  git(created.root, ['add', '.changeledger']);
  git(created.root, ['commit', '-qm', 'test: revert authority']);
  const reverted = git(created.root, ['rev-parse', 'HEAD']);
  git(created.root, ['update-ref', INTEGRATION_REF, reverted]);
  const next = advanceIntegration(created, 'topic.md', 'topic\n');

  assert.throws(
    () =>
      validateStateUpdate({
        repoRoot: created.root,
        oldOid: reverted,
        newOid: next,
        ref: INTEGRATION_REF,
        stateRef: STATE_REF,
        integrationRef: INTEGRATION_REF,
        limits: roomy,
      }),
    /integration protection is not active/,
  );
});

test('163408 CR3: a state update cannot rewrite integration_branch away mid-range', () => {
  const created = fixture();
  const drifted = advanceState(
    created,
    (state) => {
      const file = path.join(state, 'config.yml');
      fs.writeFileSync(
        file,
        fs
          .readFileSync(file, 'utf8')
          .replace('integration_branch: dev', 'integration_branch: other'),
      );
    },
    'test: drift integration_branch',
  );
  const restored = advanceState(
    created,
    (state) => {
      const file = path.join(state, 'config.yml');
      fs.writeFileSync(
        file,
        fs
          .readFileSync(file, 'utf8')
          .replace('integration_branch: other', 'integration_branch: dev'),
      );
    },
    'test: restore integration_branch',
  );
  git(created.root, ['update-ref', STATE_REF, created.baseline]);

  assert.throws(
    () =>
      validateStateUpdate({
        repoRoot: created.root,
        oldOid: created.baseline,
        newOid: restored,
        ref: STATE_REF,
        stateRef: STATE_REF,
        integrationRef: INTEGRATION_REF,
        limits: roomy,
      }),
    /state update changes integration_branch away from protected ref refs\/heads\/dev/,
  );
  assert.ok(drifted);
});

test('202058 CR1: a state update that deletes a change identity is rejected', () => {
  const created = fixture();
  const deleted = advanceState(created, (state) => {
    fs.rmSync(path.join(state, 'changes', '20260721-000000-change.md'));
  });
  git(created.root, ['update-ref', STATE_REF, created.baseline]);
  assert.throws(
    () =>
      validateStateUpdate({
        repoRoot: created.root,
        oldOid: created.baseline,
        newOid: deleted,
        ref: STATE_REF,
        stateRef: STATE_REF,
        integrationRef: INTEGRATION_REF,
        limits: roomy,
      }),
    /removes changes identity "20260721-000000"/,
  );
});

test('202058 CR1: a state update that deletes a spec or release identity is rejected', () => {
  const created = fixture();
  const withSpecAndRelease = advanceState(created, (state) => {
    fs.mkdirSync(path.join(state, 'specs'), { recursive: true });
    fs.writeFileSync(
      path.join(state, 'specs', 'one.md'),
      '---\ntitle: One\nupdated: 2026-07-22T00:00:00Z\ntags: []\n---\n',
    );
    fs.mkdirSync(path.join(state, 'releases'), { recursive: true });
    fs.writeFileSync(
      path.join(state, 'releases', '1.0.0.yml'),
      'version: 1.0.0\ncreated: 2026-07-22T00:00:00Z\nchanges: []\n',
    );
  });
  git(created.root, ['update-ref', STATE_REF, withSpecAndRelease]);
  const specDeleted = advanceState(created, (state) => {
    fs.rmSync(path.join(state, 'specs', 'one.md'));
  });
  git(created.root, ['update-ref', STATE_REF, withSpecAndRelease]);
  assert.throws(
    () =>
      validateStateUpdate({
        repoRoot: created.root,
        oldOid: withSpecAndRelease,
        newOid: specDeleted,
        ref: STATE_REF,
        stateRef: STATE_REF,
        integrationRef: INTEGRATION_REF,
        limits: roomy,
      }),
    /removes specs identity "one\.md"/,
  );

  git(created.root, ['update-ref', STATE_REF, withSpecAndRelease]);
  const releaseDeleted = advanceState(created, (state) => {
    fs.rmSync(path.join(state, 'releases', '1.0.0.yml'));
  });
  git(created.root, ['update-ref', STATE_REF, withSpecAndRelease]);
  assert.throws(
    () =>
      validateStateUpdate({
        repoRoot: created.root,
        oldOid: withSpecAndRelease,
        newOid: releaseDeleted,
        ref: STATE_REF,
        stateRef: STATE_REF,
        integrationRef: INTEGRATION_REF,
        limits: roomy,
      }),
    /removes releases identity "1\.0\.0\.yml"/,
  );
});

test('202058 CR1: archiving or discarding a change keeps its identity and is accepted', () => {
  const created = fixture();
  const archived = advanceState(created, (state) => {
    const file = path.join(state, 'changes', '20260721-000000-change.md');
    fs.writeFileSync(
      file,
      fs.readFileSync(file, 'utf8').replace('depends_on: []\n', 'depends_on: []\narchived: true\n'),
    );
  });
  git(created.root, ['update-ref', STATE_REF, created.baseline]);
  const receipt = validateStateUpdate({
    repoRoot: created.root,
    oldOid: created.baseline,
    newOid: archived,
    ref: STATE_REF,
    stateRef: STATE_REF,
    integrationRef: INTEGRATION_REF,
    limits: roomy,
  });
  assert.equal(receipt.commits, 1);
});

test('202058 CR1: a merge commit is checked against every one of its parents', () => {
  // The dropped identity ("20260722-000001") exists ONLY on the side branch --
  // mainline never has it, so comparing the merge against mainline alone shows
  // no disappearance (mainline never had it to lose). Only comparing against
  // the SIDE parent reveals it. A first-parent-only implementation would miss
  // this entirely and pass. The merge also resolves a real, unrelated conflict
  // on conflict.md so the dropped identity is hidden alongside legitimate work.
  const created = fixture();
  git(created.root, ['checkout', '-q', 'changeledger/state']);
  git(created.root, ['branch', 'state-side']);
  const conflictSpec = (title) =>
    `---\ntitle: ${title}\nupdated: 2026-07-22T00:00:00Z\ntags: []\n---\n\n# ${title}\n`;
  fs.mkdirSync(path.join(created.state, 'specs'), { recursive: true });
  fs.writeFileSync(path.join(created.state, 'specs', 'conflict.md'), conflictSpec('Main'));
  git(created.root, ['add', '.changeledger-state']);
  git(created.root, ['commit', '-qm', 'test: mainline edits conflict.md']);
  const mainHead = git(created.root, ['rev-parse', 'HEAD']);
  git(created.root, ['checkout', '-q', 'state-side']);
  fs.mkdirSync(path.join(created.state, 'specs'), { recursive: true });
  fs.writeFileSync(path.join(created.state, 'specs', 'conflict.md'), conflictSpec('Side'));
  fs.writeFileSync(
    path.join(created.state, 'changes', '20260722-000001-change.md'),
    '---\nid: "20260722-000001"\ntitle: Side only\ntype: feature\nstatus: draft\ncreated: 2026-07-22T00:00:00Z\ndepends_on: []\n---\n\n## Request\n\nSide only.\n\n## Plan\n\n- [ ] Do it\n\n## Log\n',
  );
  git(created.root, ['add', '.changeledger-state']);
  git(created.root, ['commit', '-qm', 'test: side edits conflict.md and adds a change']);
  const sideHead = git(created.root, ['rev-parse', 'HEAD']);
  git(created.root, ['checkout', '-q', 'changeledger/state']);
  git(created.root, ['reset', '-q', '--hard', mainHead]);
  const mergeResult = spawnSync('git', ['merge', '--no-ff', sideHead, '-m', 'test: merge sides'], {
    cwd: created.root,
  });
  assert.notEqual(mergeResult.status, 0, 'expected a real merge conflict on conflict.md');
  fs.writeFileSync(path.join(created.state, 'specs', 'conflict.md'), conflictSpec('Resolved'));
  fs.rmSync(path.join(created.state, 'changes', '20260722-000001-change.md'));
  git(created.root, ['add', '.changeledger-state']);
  git(created.root, ['commit', '--no-edit']);
  const merge = git(created.root, ['rev-parse', 'HEAD']);
  const parents = git(created.root, ['rev-list', '--parents', '-n', '1', merge])
    .split(' ')
    .slice(1);
  assert.deepEqual(parents, [mainHead, sideHead]);
  // Confirm the property the test relies on: mainline never had the identity,
  // so a first-parent-only comparison would find nothing missing.
  assert.equal(
    fs.existsSync(path.join(created.state, 'changes', '20260722-000001-change.md')),
    false,
  );
  git(created.root, ['checkout', '-q', 'dev']);
  git(created.root, ['update-ref', STATE_REF, created.baseline]);
  assert.throws(
    () =>
      validateStateUpdate({
        repoRoot: created.root,
        oldOid: created.baseline,
        newOid: merge,
        ref: STATE_REF,
        stateRef: STATE_REF,
        integrationRef: INTEGRATION_REF,
        limits: roomy,
      }),
    /removes changes identity "20260722-000001"/,
  );
});

// 203027: proves the incremental (delta) path and the full closed-snapshot
// path agree on the same verdict/diagnostic for the same content. `s1` is an
// unrelated, valid interior commit; `s2` (built on top of `s1`) introduces the
// violation. Path A validates `s1..s2` (a 1-commit range, so `s2` has no
// already-cached parent inside the batch and is always fully validated).
// Path B validates `baseline..s2` (a 2-commit range: `s1` is validated first
// as the range's boundary commit, so `s2`'s single parent IS already cached,
// making it eligible for incremental derivation). Both must throw identically.
function assertEquivalentRejection(created, unrelatedMutate, violatingMutate, expectedMessage) {
  const s1 = advanceState(created, unrelatedMutate, 'test: unrelated interior commit');
  const s2 = advanceState(created, violatingMutate, 'test: violation');

  git(created.root, ['update-ref', STATE_REF, s1]);
  assert.throws(
    () =>
      validateStateUpdate({
        repoRoot: created.root,
        oldOid: s1,
        newOid: s2,
        ref: STATE_REF,
        stateRef: STATE_REF,
        integrationRef: INTEGRATION_REF,
        limits: roomy,
      }),
    expectedMessage,
    'boundary (full) path',
  );

  git(created.root, ['update-ref', STATE_REF, created.baseline]);
  assert.throws(
    () =>
      validateStateUpdate({
        repoRoot: created.root,
        oldOid: created.baseline,
        newOid: s2,
        ref: STATE_REF,
        stateRef: STATE_REF,
        integrationRef: INTEGRATION_REF,
        limits: roomy,
      }),
    expectedMessage,
    'incremental path',
  );
}

function addUnrelatedChange(state) {
  fs.writeFileSync(
    path.join(state, 'changes', '20260721-000001-second.md'),
    '---\nid: "20260721-000001"\ntitle: Second\ntype: feature\nstatus: draft\ncreated: 2026-07-21T00:00:00Z\ndepends_on: []\n---\n\n## Request\n\nSecond.\n\n## Plan\n\n- [ ] Do it\n\n## Log\n',
  );
}

test('203027: incremental and full validation reject a disappeared identity identically', () => {
  const created = fixture();
  assertEquivalentRejection(
    created,
    addUnrelatedChange,
    (state) => fs.rmSync(path.join(state, 'changes', '20260721-000000-change.md')),
    /removes changes identity "20260721-000000"/,
  );
});

test('203027: incremental and full validation reject a duplicate id identically', () => {
  const created = fixture();
  assertEquivalentRejection(
    created,
    addUnrelatedChange,
    (state) =>
      fs.writeFileSync(
        path.join(state, 'changes', '20260721-000002-dup.md'),
        '---\nid: "20260721-000001"\ntitle: Duplicate\ntype: feature\nstatus: draft\ncreated: 2026-07-21T00:00:00Z\ndepends_on: []\n---\n\n## Request\n\nDup.\n\n## Plan\n\n- [ ] Do it\n\n## Log\n',
      ),
    /duplicate id "20260721-000001"/,
  );
});

test('203027: incremental and full validation reject a missing dependency identically', () => {
  const created = fixture();
  assertEquivalentRejection(
    created,
    addUnrelatedChange,
    (state) =>
      fs.writeFileSync(
        path.join(state, 'changes', '20260721-000002-broken.md'),
        '---\nid: "20260721-000002"\ntitle: Broken\ntype: feature\nstatus: draft\ncreated: 2026-07-21T00:00:00Z\ndepends_on: ["99999999-999999"]\n---\n\n## Request\n\nBroken.\n\n## Plan\n\n- [ ] Do it\n\n## Log\n',
      ),
    /depends_on references missing change "99999999-999999"/,
  );
});

test('203027: incremental and full validation reject a self-referencing relation identically', () => {
  const created = fixture();
  assertEquivalentRejection(
    created,
    addUnrelatedChange,
    (state) =>
      fs.writeFileSync(
        path.join(state, 'changes', '20260721-000002-selfref.md'),
        '---\nid: "20260721-000002"\ntitle: Selfref\ntype: feature\nstatus: draft\ncreated: 2026-07-21T00:00:00Z\ndepends_on: []\nrelated_to: ["20260721-000002"]\n---\n\n## Request\n\nSelfref.\n\n## Plan\n\n- [ ] Do it\n\n## Log\n',
      ),
    /related_to cannot reference its own change "20260721-000002"/,
  );
});

test('203027: incremental and full validation reject a graduated_from missing change identically', () => {
  const created = fixture();
  assertEquivalentRejection(
    created,
    addUnrelatedChange,
    (state) =>
      fs.writeFileSync(
        path.join(state, 'specs', 'orphan.md'),
        '---\ntitle: Orphan\nupdated: 2026-07-21T00:00:00Z\ntags: []\ngraduated_from: ["99999999-999999"]\n---\n',
      ),
    /graduated_from references missing change "99999999-999999"/,
  );
});

test('203027: incremental and full validation reject a release naming a non-done change identically', () => {
  const created = fixture();
  assertEquivalentRejection(
    created,
    addUnrelatedChange,
    (state) =>
      fs.writeFileSync(
        path.join(state, 'releases', '1.0.0.yml'),
        'version: 1.0.0\ncreated: 2026-07-21T00:00:00Z\nchanges: ["20260721-000001"]\n',
      ),
    /references change "20260721-000001" whose status is not done/,
  );
});

test('203027: incremental and full validation reject a config project_id drift identically', () => {
  const created = fixture();
  assertEquivalentRejection(
    created,
    addUnrelatedChange,
    (state) =>
      fs.writeFileSync(
        path.join(state, 'config.yml'),
        fs
          .readFileSync(path.join(state, 'config.yml'), 'utf8')
          .replace('project_id: project-1', 'project_id: different'),
      ),
    /project_id/,
  );
});

test('203027: incremental and full validation reject a renamed spec identically', () => {
  // git's own rename detection is on by default for `log --raw`; without
  // --no-renames a renamed spec/release surfaces as a two-path `R100` record
  // that the raw-entry parser doesn't understand (change filenames are
  // id-locked and can't rename, so only specs/releases can trigger this),
  // throwing an opaque parse error on the incremental path instead of the
  // correct, 20260722-202058 identity-disappearance rejection the boundary
  // (full) path gives -- a rename IS a disappearance, since a spec's identity
  // is its filename.
  const created = fixture();
  assertEquivalentRejection(
    created,
    (state) => {
      addUnrelatedChange(state);
      fs.writeFileSync(
        path.join(state, 'specs', 'one.md'),
        '---\ntitle: One\nupdated: 2026-07-21T00:00:00Z\ntags: []\n---\n\n# One\n\nLorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.\n',
      );
    },
    (state) => {
      const text = fs.readFileSync(path.join(state, 'specs', 'one.md'), 'utf8');
      fs.rmSync(path.join(state, 'specs', 'one.md'));
      fs.writeFileSync(path.join(state, 'specs', 'two.md'), text);
    },
    /removes specs identity "one\.md"/,
  );
});

test('203027: a commit touching the manifest falls back to full validation instead of skipping it', () => {
  const created = fixture();
  advanceState(created, addUnrelatedChange, 'test: unrelated interior commit');
  const s2 = advanceState(
    created,
    (state) =>
      fs.writeFileSync(
        path.join(state, 'manifest.yml'),
        fs
          .readFileSync(path.join(state, 'manifest.yml'), 'utf8')
          .replace('project_id: project-1', 'project_id: different'),
      ),
    'test: manifest drift',
  );
  git(created.root, ['update-ref', STATE_REF, created.baseline]);
  assert.throws(
    () =>
      validateStateUpdate({
        repoRoot: created.root,
        oldOid: created.baseline,
        newOid: s2,
        ref: STATE_REF,
        stateRef: STATE_REF,
        integrationRef: INTEGRATION_REF,
        limits: roomy,
      }),
    /project_id/,
  );
});

test('193104 CR7: operational limits have stable diagnostics', () => {
  const created = fixture();
  const one = advanceState(created, (state) => {
    fs.writeFileSync(
      path.join(state, 'specs', 'one.md'),
      '---\ntitle: One\nupdated: 2026-07-22T00:00:00Z\ntags: []\n---\n',
    );
  });
  const two = advanceState(created, (state) => {
    fs.writeFileSync(
      path.join(state, 'specs', 'two.md'),
      '---\ntitle: Two\nupdated: 2026-07-22T00:00:00Z\ntags: []\n---\n',
    );
  });
  const three = advanceState(created, (state) => {
    fs.writeFileSync(
      path.join(state, 'specs', 'three.md'),
      '---\ntitle: Three\nupdated: 2026-07-22T00:00:00Z\ntags: []\n---\n',
    );
  });
  git(created.root, ['update-ref', STATE_REF, created.baseline]);
  assert.throws(
    () =>
      validateStateUpdate({
        repoRoot: created.root,
        oldOid: created.baseline,
        newOid: three,
        ref: STATE_REF,
        stateRef: STATE_REF,
        integrationRef: INTEGRATION_REF,
        limits: { ...roomy, max_commits: 2 },
      }),
    /commit limit 2 exceeded/,
  );
  git(created.root, ['update-ref', STATE_REF, two]);
  assert.throws(
    () =>
      validateStateUpdate({
        repoRoot: created.root,
        oldOid: two,
        newOid: three,
        ref: STATE_REF,
        stateRef: STATE_REF,
        integrationRef: INTEGRATION_REF,
        limits: { ...roomy, max_object_bytes: 1 },
      }),
    /object byte limit 1 exceeded/,
  );
  assert.ok(one);
});

test('193104 CR7: deadline expires with the exact configured diagnostic', () => {
  const created = fixture();
  const ticks = [0, 101];
  assert.throws(
    () =>
      validateStateUpdate({
        repoRoot: created.root,
        oldOid: created.baseline,
        newOid: created.baseline,
        ref: STATE_REF,
        stateRef: STATE_REF,
        integrationRef: INTEGRATION_REF,
        limits: { ...roomy, timeout_ms: 100 },
        now: () => ticks.shift() ?? 101,
      }),
    /validation timeout 100ms exceeded/,
  );
});

test('193104 CR1/CR7: one receive batch shares a single monotonic deadline', () => {
  const created = fixture();
  let tick = 0;
  const input = [
    `${created.baseline} ${created.baseline} ${STATE_REF}`,
    `${created.integration} ${created.integration} ${INTEGRATION_REF}`,
    '',
  ].join('\n');
  assert.throws(
    () =>
      validateReceiveBatch(input, {
        repoRoot: created.root,
        stateRef: STATE_REF,
        integrationRef: INTEGRATION_REF,
        limits: { ...roomy, timeout_ms: 1000 },
        now: () => tick++ * 100,
      }),
    /validation timeout 1000ms exceeded/,
  );
});

test('193104 correction CR7: commit and object budgets are aggregate across a batch', () => {
  const created = fixture();
  const stateNext = advanceState(created, (state) => {
    fs.writeFileSync(
      path.join(state, 'specs', 'aggregate.md'),
      '---\ntitle: Aggregate\nupdated: 2026-07-22T00:00:00Z\ntags: []\n---\n',
    );
  });
  const integrationNext = advanceIntegration(
    created,
    'src/aggregate.mjs',
    'export const aggregate = true;\n',
  );
  git(created.root, ['update-ref', STATE_REF, created.baseline]);
  git(created.root, ['update-ref', INTEGRATION_REF, created.integration]);
  const input = `${created.baseline} ${stateNext} ${STATE_REF}\n${created.integration} ${integrationNext} ${INTEGRATION_REF}\n`;
  assert.throws(
    () =>
      validateReceiveBatch(input, {
        repoRoot: created.root,
        stateRef: STATE_REF,
        integrationRef: INTEGRATION_REF,
        limits: { ...roomy, max_commits: 1 },
      }),
    /commit limit 1 exceeded/,
  );
  const state = validateStateUpdate({
    repoRoot: created.root,
    oldOid: created.baseline,
    newOid: stateNext,
    ref: STATE_REF,
    stateRef: STATE_REF,
    integrationRef: INTEGRATION_REF,
    limits: roomy,
  });
  const integration = validateStateUpdate({
    repoRoot: created.root,
    oldOid: created.integration,
    newOid: integrationNext,
    ref: INTEGRATION_REF,
    stateRef: STATE_REF,
    integrationRef: INTEGRATION_REF,
    limits: roomy,
  });
  assert.throws(
    () =>
      validateReceiveBatch(input, {
        repoRoot: created.root,
        stateRef: STATE_REF,
        integrationRef: INTEGRATION_REF,
        limits: {
          ...roomy,
          max_object_bytes: Math.max(state.object_bytes, integration.object_bytes),
        },
      }),
    /object byte limit .* exceeded/,
  );
});

test('170612 CR1: incremental path rejects a non-regular Git mode (symlink), fail-closed', () => {
  const created = fixture();
  const head = advanceState(
    created,
    (state) => {
      fs.symlinkSync('manifest.yml', path.join(state, 'changes', 'x.md'));
    },
    'test: symlink change entry',
  );
  git(created.root, ['update-ref', STATE_REF, created.baseline]);
  let captured;
  assert.throws(
    () =>
      validateStateUpdate({
        repoRoot: created.root,
        oldOid: created.baseline,
        newOid: head,
        ref: STATE_REF,
        stateRef: STATE_REF,
        integrationRef: INTEGRATION_REF,
        limits: roomy,
      }),
    (error) => {
      captured = error;
      return (
        /unsupported Git entry 120000/.test(error.message) &&
        /\.changeledger-state\/changes\/x\.md/.test(error.message)
      );
    },
  );
  assert.ok(captured.receipt, 'fail-closed receipt is attached');
  assert.equal(captured.ok, undefined);
});

test('170612 CR3: incremental path keeps accepting 100644 and 100755 blobs', () => {
  const created = fixture();
  git(created.root, ['config', 'core.fileMode', 'true']);
  git(created.root, ['checkout', '-q', 'changeledger/state']);
  const rel = '.changeledger-state/changes/20260721-111111-exec.md';
  const abs = path.join(created.root, rel);
  fs.writeFileSync(abs, changeText({ id: '20260721-111111', title: 'Exec' }));
  fs.chmodSync(abs, 0o755);
  git(created.root, ['add', rel]);
  git(created.root, ['commit', '-qm', 'test: executable change entry']);
  const head = git(created.root, ['rev-parse', 'HEAD']);
  git(created.root, ['checkout', '-q', 'dev']);
  assert.equal(git(created.root, ['ls-tree', head, rel]).split(' ')[0], '100755');
  git(created.root, ['update-ref', STATE_REF, created.baseline]);
  const receipt = validateStateUpdate({
    repoRoot: created.root,
    oldOid: created.baseline,
    newOid: head,
    ref: STATE_REF,
    stateRef: STATE_REF,
    integrationRef: INTEGRATION_REF,
    limits: roomy,
  });
  assert.equal(receipt.ok, true);
});
