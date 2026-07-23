import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  abortStatePending,
  CONFIRMED_REF,
  OBSERVED_REF,
  PENDING_REF,
  readStateReplica,
  stateRemote,
  stateReplicaStatus,
  syncStateReplica,
} from '../src/state-store.mjs';
import { createStateRepo } from './helpers/state-repo.mjs';

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function replicaFixture(objectFormat) {
  const spec = (title) =>
    `---\ntitle: ${title}\nupdated: 2026-07-22T00:00:00Z\ntags: [replica]\n---\n\n# ${title}\n`;
  const created = createStateRepo({
    objectFormat,
    specs: {
      'A.md': spec('A'),
      'B.md': spec('B'),
      'line\nbreak.md': spec('Line'),
      ':(magic).md': spec('Magic'),
    },
  });
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-state-remote-'));
  const init = ['init', '--bare', '-q'];
  if (objectFormat !== 'sha1') init.push(`--object-format=${objectFormat}`);
  git(remote, init);
  git(created.root, ['remote', 'add', 'origin', remote]);
  git(created.root, ['push', '-q', 'origin', 'refs/heads/changeledger/state']);
  git(created.root, ['update-ref', CONFIRMED_REF, created.baseline]);
  git(created.root, ['update-ref', OBSERVED_REF, created.baseline]);
  return { ...created, remote };
}

function editStateFile(root, relative, before, after, message) {
  git(root, ['checkout', '-q', 'changeledger/state']);
  const file = path.join(root, '.changeledger-state', relative);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(before, after));
  git(root, ['add', file]);
  git(root, ['commit', '-qm', `test: ${message}`]);
  const head = git(root, ['rev-parse', 'HEAD']);
  git(root, ['checkout', '-q', 'dev']);
  return head;
}

function advanceState(root, title) {
  git(root, ['checkout', '-q', 'changeledger/state']);
  const file = path.join(root, '.changeledger-state', 'changes', '20260721-000000-change.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^title: .*$/m, `title: ${title}`));
  git(root, ['add', file]);
  git(root, ['commit', '-qm', `test: ${title}`]);
  const head = git(root, ['rev-parse', 'HEAD']);
  git(root, ['checkout', '-q', 'dev']);
  return head;
}

test('193102 CR1/CR2/CR6/CR7: sync advances and publishes transactionally in both formats', () => {
  for (const objectFormat of ['sha1', 'sha256']) {
    let created;
    try {
      created = replicaFixture(objectFormat);
    } catch (error) {
      if (
        objectFormat === 'sha256' &&
        /unknown option|unsupported|not supported/i.test(error.message)
      ) {
        continue;
      }
      throw error;
    }

    const remoteAdvance = advanceState(created.root, 'Remote');
    git(created.root, ['push', '-q', 'origin', 'refs/heads/changeledger/state']);
    git(created.root, ['update-ref', 'refs/heads/changeledger/state', created.baseline]);

    const advanced = syncStateReplica(created.root, {
      now: () => '2026-07-22T10:30:00Z',
      validateRevision: () => {},
    });
    assert.equal(advanced.action, 'advance-confirmed', objectFormat);
    assert.equal(advanced.effective, remoteAdvance, objectFormat);
    assert.equal(readStateReplica(created.root).confirmed, remoteAdvance, objectFormat);
    assert.equal(readStateReplica(created.root).observedAt, '2026-07-22T10:30:00Z');

    git(created.root, ['update-ref', 'refs/heads/changeledger/state', remoteAdvance]);
    const pending = advanceState(created.root, 'Pending');
    git(created.root, ['update-ref', PENDING_REF, pending]);
    const published = syncStateReplica(created.root, {
      now: () => '2026-07-22T10:31:00Z',
      validateRevision: () => {},
    });
    assert.equal(published.action, 'publish-pending', objectFormat);
    assert.equal(published.effective, pending, objectFormat);
    assert.equal(git(created.remote, ['rev-parse', 'refs/heads/changeledger/state']), pending);
    assert.equal(readStateReplica(created.root).pending, null);
    assert.equal(readStateReplica(created.root).confirmed, pending);
    assert.equal(readStateReplica(created.root).observed, pending);
  }
});

test('193102 CR3/CR4: sync replays one disjoint NUL-framed delta in both formats', () => {
  for (const objectFormat of ['sha1', 'sha256']) {
    let created;
    try {
      created = replicaFixture(objectFormat);
    } catch (error) {
      if (
        objectFormat === 'sha256' &&
        /unknown option|unsupported|not supported/i.test(error.message)
      ) {
        continue;
      }
      throw error;
    }
    const pending = editStateFile(
      created.root,
      'specs/line\nbreak.md',
      '# Line',
      '# Local',
      'local pending',
    );
    git(created.root, ['update-ref', PENDING_REF, pending]);
    git(created.root, ['update-ref', 'refs/heads/changeledger/state', created.baseline]);
    const remote = editStateFile(created.root, 'specs/B.md', '# B', '# Remote', 'remote advance');
    git(created.root, ['push', '-q', 'origin', 'refs/heads/changeledger/state']);
    git(created.root, ['update-ref', 'refs/heads/changeledger/state', created.baseline]);
    const validated = [];

    const result = syncStateReplica(created.root, {
      validateRevision: (revision) => validated.push(revision),
    });

    assert.equal(result.action, 'replay-pending', objectFormat);
    assert.equal(result.replayedFrom, pending, objectFormat);
    assert.equal(git(created.root, ['rev-parse', `${result.effective}^`]), remote, objectFormat);
    assert.match(
      git(created.root, ['show', `${result.effective}:.changeledger-state/specs/line\nbreak.md`]),
      /# Local/,
      objectFormat,
    );
    assert.match(
      git(created.root, ['show', `${result.effective}:.changeledger-state/specs/B.md`]),
      /# Remote/,
      objectFormat,
    );
    assert.deepEqual(
      validated,
      [remote, pending, git(created.root, ['rev-parse', `${result.effective}^{tree}`])],
      objectFormat,
    );
    assert.equal(readStateReplica(created.root).pending, null, objectFormat);
  }
});

test('193102 CR1: clean sync CAS rejects a pending created during remote validation', () => {
  const created = replicaFixture('sha1');
  const remote = advanceState(created.root, 'Remote race');
  git(created.root, ['push', '-q', 'origin', 'refs/heads/changeledger/state']);
  git(created.root, ['update-ref', 'refs/heads/changeledger/state', created.baseline]);
  const pending = advanceState(created.root, 'Local race');
  git(created.root, ['update-ref', 'refs/heads/changeledger/state', created.baseline]);

  assert.throws(
    () =>
      syncStateReplica(created.root, {
        validateRevision(revision) {
          if (revision === remote) git(created.root, ['update-ref', PENDING_REF, pending]);
        },
      }),
    (error) => {
      assert.match(error.message, /changed concurrently; retry the operation/);
      assert.match(error.cause?.message ?? '', /cannot lock ref|reference already exists/i);
      return true;
    },
  );
  assert.equal(readStateReplica(created.root).confirmed, created.baseline);
  assert.equal(readStateReplica(created.root).pending, pending);
  assert.equal(git(created.root, ['rev-parse', `${pending}^`]), created.baseline);
});

test('203031 CR1: a filesystem failure during replay keeps its operation and cause', () => {
  const created = replicaFixture('sha1');
  const pending = editStateFile(created.root, 'specs/A.md', '# A', '# Local', 'local pending');
  git(created.root, ['update-ref', PENDING_REF, pending]);
  git(created.root, ['update-ref', 'refs/heads/changeledger/state', created.baseline]);
  editStateFile(created.root, 'specs/B.md', '# B', '# Remote', 'remote advance');
  git(created.root, ['push', '-q', 'origin', 'refs/heads/changeledger/state']);
  git(created.root, ['update-ref', 'refs/heads/changeledger/state', created.baseline]);

  const fsError = new Error('ENOSPC: no space left on device, write');
  fsError.code = 'ENOSPC';

  assert.throws(
    () =>
      syncStateReplica(created.root, {
        validateCandidate: () => {
          throw fsError;
        },
      }),
    (error) => {
      assert.doesNotMatch(error.message, /state replica conflict/);
      assert.match(error.message, /replay/i);
      assert.match(error.message, /ENOSPC/);
      assert.equal(error.cause, fsError);
      return true;
    },
  );
  assert.equal(readStateReplica(created.root).pending, pending);
  assert.equal(readStateReplica(created.root).confirmed, created.baseline);
});

function forceOrphanRemote(created) {
  const tree = git(created.root, ['rev-parse', `${created.baseline}^{tree}`]);
  const orphan = git(created.root, ['commit-tree', tree, '-m', 'orphan remote rewrite']);
  git(created.root, ['push', '-qf', 'origin', `${orphan}:refs/heads/changeledger/state`]);
  return orphan;
}

test('203031 CR3: a corrupt confirmed is blamed only on its own validation failure', () => {
  const corrupt = replicaFixture('sha1');
  const remoteHead = forceOrphanRemote(corrupt);

  assert.throws(
    () =>
      syncStateReplica(corrupt.root, {
        validateRevision(revision) {
          if (revision === corrupt.baseline) throw new Error('schema validation failed');
        },
      }),
    (error) => {
      assert.match(error.message, /state replica corrupt/);
      assert.match(error.message, new RegExp(`confirmed ${corrupt.baseline}`));
      assert.match(error.message, new RegExp(`remote ${remoteHead}`));
      assert.match(error.message, /schema validation failed/);
      return true;
    },
  );

  const ambiguous = replicaFixture('sha1');
  forceOrphanRemote(ambiguous);

  assert.throws(() => syncStateReplica(ambiguous.root), /does not descend from confirmed/);
});

test('193102 CR2/CR6: publication pushes the exact planned OID, never a mutable ref', () => {
  const created = replicaFixture('sha1');
  const planned = advanceState(created.root, 'Planned');
  git(created.root, ['update-ref', PENDING_REF, planned]);
  git(created.root, ['update-ref', 'refs/heads/changeledger/state', created.baseline]);
  const replacement = advanceState(created.root, 'Replacement');
  git(created.root, ['update-ref', 'refs/heads/changeledger/state', created.baseline]);

  assert.throws(() =>
    syncStateReplica(created.root, {
      pushState(root, remote, refspec) {
        git(root, ['update-ref', PENDING_REF, replacement]);
        git(root, ['push', remote, refspec]);
      },
    }),
  );
  assert.equal(git(created.remote, ['rev-parse', 'refs/heads/changeledger/state']), planned);
  assert.equal(readStateReplica(created.root).confirmed, created.baseline);
  assert.equal(readStateReplica(created.root).pending, replacement);
});

test('193102 CR4: replay treats Git pathspec-looking filenames as exact literals', () => {
  const created = replicaFixture('sha1');
  const pending = editStateFile(
    created.root,
    'specs/:(magic).md',
    '# Magic',
    '# Local literal',
    'literal path pending',
  );
  git(created.root, ['update-ref', PENDING_REF, pending]);
  git(created.root, ['update-ref', 'refs/heads/changeledger/state', created.baseline]);
  editStateFile(created.root, 'specs/B.md', '# B', '# Remote', 'remote advance');
  git(created.root, ['push', '-q', 'origin', 'refs/heads/changeledger/state']);
  git(created.root, ['update-ref', 'refs/heads/changeledger/state', created.baseline]);

  const result = syncStateReplica(created.root);

  assert.equal(result.action, 'replay-pending');
  assert.match(
    git(created.root, ['show', `${result.effective}:.changeledger-state/specs/:(magic).md`]),
    /# Local literal/,
  );
});

test('193102 CR5: overlap or invalid replay preserves pending and confirmed refs', () => {
  for (const invalidCandidate of [false, true]) {
    const created = replicaFixture('sha1');
    const localPath = invalidCandidate ? 'specs/A.md' : 'specs/A.md';
    const remotePath = invalidCandidate ? 'specs/B.md' : 'specs/A.md';
    const pending = editStateFile(created.root, localPath, '# A', '# Local', 'local pending');
    git(created.root, ['update-ref', PENDING_REF, pending]);
    git(created.root, ['update-ref', 'refs/heads/changeledger/state', created.baseline]);
    const remote = editStateFile(
      created.root,
      remotePath,
      invalidCandidate ? '# B' : '# A',
      '# Remote',
      'remote advance',
    );
    git(created.root, ['push', '-q', 'origin', 'refs/heads/changeledger/state']);
    git(created.root, ['update-ref', 'refs/heads/changeledger/state', created.baseline]);

    assert.throws(
      () =>
        syncStateReplica(created.root, {
          validateRevision(revision) {
            if (invalidCandidate && revision !== remote && revision !== pending) {
              throw new Error('combined invalid');
            }
          },
        }),
      invalidCandidate ? /combined invalid/ : /state replica conflict.*specs\/A\.md/,
    );
    const refs = readStateReplica(created.root);
    assert.equal(refs.confirmed, created.baseline);
    assert.equal(refs.observed, remote);
    assert.equal(refs.pending, pending);
  }
});

test('193102 CR6: timeout preserves pending and a lost accepted response is confirmed next time', () => {
  for (const accepted of [false, true]) {
    const created = replicaFixture('sha1');
    const pending = advanceState(created.root, accepted ? 'Accepted' : 'Timeout');
    git(created.root, ['update-ref', PENDING_REF, pending]);
    git(created.root, ['update-ref', 'refs/heads/changeledger/state', created.baseline]);

    const ambiguous = syncStateReplica(created.root, {
      pushState(root, remote, refspec) {
        if (accepted) git(root, ['push', remote, refspec]);
        throw new Error(accepted ? 'response lost' : 'timed out');
      },
    });
    assert.equal(ambiguous.pending, true);
    assert.equal(ambiguous.confirmed, false);
    assert.equal(readStateReplica(created.root).pending, pending);
    assert.equal(readStateReplica(created.root).confirmed, created.baseline);

    if (accepted) {
      const recovered = syncStateReplica(created.root);
      assert.equal(recovered.action, 'confirm-observed');
      assert.equal(readStateReplica(created.root).confirmed, pending);
      assert.equal(readStateReplica(created.root).pending, null);
    } else {
      assert.equal(
        git(created.remote, ['rev-parse', 'refs/heads/changeledger/state']),
        created.baseline,
      );
    }
  }
});

test('193102 CR6: abort confirms published pending and requires explicit offline fallback', () => {
  const published = replicaFixture('sha1');
  const pending = advanceState(published.root, 'Published before abort');
  git(published.root, ['update-ref', PENDING_REF, pending]);
  git(published.root, ['push', '-q', 'origin', `${PENDING_REF}:refs/heads/changeledger/state`]);
  const confirmed = abortStatePending(published.root);
  assert.equal(confirmed.confirmed, true);
  assert.equal(confirmed.aborted, false);
  assert.equal(readStateReplica(published.root).confirmed, pending);
  assert.equal(readStateReplica(published.root).pending, null);

  const unavailable = replicaFixture('sha1');
  const local = advanceState(unavailable.root, 'Local only');
  git(unavailable.root, ['update-ref', PENDING_REF, local]);
  fs.rmSync(unavailable.remote, { recursive: true });
  assert.throws(() => abortStatePending(unavailable.root), /use --offline/);
  assert.equal(readStateReplica(unavailable.root).pending, local);
  const aborted = abortStatePending(unavailable.root, { offline: true });
  assert.equal(aborted.aborted, true);
  assert.equal(aborted.confirmed, false);
  assert.equal(readStateReplica(unavailable.root).pending, null);
  assert.equal(readStateReplica(unavailable.root).confirmed, unavailable.baseline);
});

test('193102 CR6: abort fails closed when ancestry cannot be established', () => {
  const created = replicaFixture('sha1');
  const pending = advanceState(created.root, 'Ancestry error');
  git(created.root, ['update-ref', PENDING_REF, pending]);

  assert.throws(
    () =>
      abortStatePending(created.root, {
        isAncestor() {
          throw new Error('object database unavailable');
        },
      }),
    /object database unavailable/,
  );
  assert.equal(readStateReplica(created.root).pending, pending);
  assert.equal(readStateReplica(created.root).confirmed, created.baseline);
});

test('163407 CR1: an ambiguous changeledger.remote fails closed naming the values', () => {
  const created = replicaFixture('sha1');
  git(created.root, ['config', '--add', 'changeledger.remote', 'origin']);
  git(created.root, ['config', '--add', 'changeledger.remote', 'backup']);

  assert.throws(
    () => stateRemote(created.root),
    /ambiguous changeledger\.remote configuration: origin, backup/,
  );
});

test('163407 CR2: an absent changeledger.remote keeps the documented origin fallback', () => {
  const created = replicaFixture('sha1');
  assert.equal(stateRemote(created.root), 'origin');
});

test('181235 CR1: reading local replica status works without a resolvable remote', () => {
  const created = replicaFixture('sha1');
  git(created.root, ['remote', 'remove', 'origin']);

  const status = stateReplicaStatus(created.root);
  assert.equal(status.remote, null);
  assert.equal(status.confirmed, created.baseline);
  assert.equal(status.condition, 'unknown');

  assert.throws(
    () => syncStateReplica(created.root),
    /state sync requires configured remote "origin"/,
  );
});

test('181235 CR2: an explicitly empty changeledger.remote fails closed', () => {
  const created = replicaFixture('sha1');
  git(created.root, ['config', 'changeledger.remote', '']);

  assert.throws(
    () => stateRemote(created.root),
    /changeledger\.remote is configured with an empty value/,
  );
  assert.equal(stateRemote(created.root, { required: false }), null);
});
