import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildContext } from '../src/commands/context.mjs';
import { stateAbort, stateStatus, stateSync } from '../src/commands/state.mjs';
import { loadLedgerStore } from '../src/ledger-store.mjs';
import { CONFIRMED_REF, PENDING_REF, PUBLIC_STATE_REF } from '../src/state-store.mjs';
import { createStateRepo, git } from './helpers/state-repo.mjs';

function fixture() {
  const created = createStateRepo();
  fs.writeFileSync(
    path.join(created.root, '.changeledger', 'authority.yml'),
    `format_version: 2\nstate_ref: ${PUBLIC_STATE_REF}\nbaseline: ${created.baseline}\nproject_id: project-1\n`,
  );
  git(created.root, ['add', '.changeledger/authority.yml']);
  git(created.root, ['commit', '-qm', 'test: replica authority']);
  git(created.root, ['update-ref', CONFIRMED_REF, created.baseline]);
  git(created.root, ['update-ref', 'refs/changeledger/observed', created.baseline]);
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-state-command-'));
  git(remote, ['init', '--bare', '-q']);
  git(created.root, ['remote', 'add', 'origin', remote]);
  git(created.root, ['push', '-q', 'origin', PUBLIC_STATE_REF]);
  return { ...created, remote };
}

test('193102 CR1/CR7: state status is local-only and state sync advances the effective snapshot', () => {
  const created = fixture();
  git(created.root, ['checkout', '-q', 'changeledger/state']);
  const change = path.join(
    created.root,
    '.changeledger-state',
    'changes',
    '20260721-000000-change.md',
  );
  fs.writeFileSync(change, fs.readFileSync(change, 'utf8').replace('title: Demo', 'title: Remote'));
  git(created.root, ['add', change]);
  git(created.root, ['commit', '-qm', 'test: remote state']);
  const remoteHead = git(created.root, ['rev-parse', 'HEAD']);
  git(created.root, ['push', '-q', 'origin', PUBLIC_STATE_REF]);
  git(created.root, ['checkout', '-q', 'dev']);
  git(created.root, ['update-ref', PUBLIC_STATE_REF, created.baseline]);

  const before = stateStatus(created.root);
  assert.equal(before.condition, 'unknown');
  assert.equal(before.confirmed, created.baseline);
  assert.equal(loadLedgerStore(created.root).load().revision, created.baseline);

  const result = stateSync(created.root);
  assert.equal(result.action, 'advance-confirmed');
  const after = loadLedgerStore(created.root).load();
  assert.equal(after.revision, remoteHead);
  assert.equal(after.ledgerFreshness, 'fresh');
  assert.equal(after.ledgerConfirmation, 'confirmed');
  assert.equal(after.changes[0].frontmatter.title, 'Remote');
  assert.match(
    buildContext(undefined, created.root),
    new RegExp(
      `Ledger snapshot: ${remoteHead} — freshness: fresh; confirmation: confirmed \\(no implicit network refresh\\)`,
    ),
  );
});

test('193102 CR3/CR6: state abort requires --pending and supports explicit offline discard', () => {
  const created = fixture();
  const store = loadLedgerStore(created.root);
  const before = store.load();
  const pending = store.mutate(
    { message: 'test: pending', expectedRevision: before.revision, offline: true },
    ({ snapshot, write }) => {
      write(
        snapshot.changes[0].statePath,
        snapshot.changes[0].text.replace('title: Demo', 'title: Pending'),
      );
    },
  );
  assert.equal(pending.ledgerConfirmation, 'pending publication');
  assert.throws(() => stateAbort(created.root), /requires --pending/);
  const result = stateAbort(created.root, { pending: true, offline: true });
  assert.equal(result.aborted, true);
  assert.throws(() => git(created.root, ['rev-parse', '--verify', PENDING_REF]));
  assert.equal(loadLedgerStore(created.root).load().revision, created.baseline);
});

test('193102 CR3/CR7: CLI propagates --offline to the shared mutation boundary', () => {
  const created = fixture();
  fs.rmSync(created.remote, { recursive: true });
  const output = execFileSync(
    process.execPath,
    [path.resolve('bin/changeledger.mjs'), 'owner', '20260721-000000', 'alice', '--offline'],
    { cwd: created.root, encoding: 'utf8' },
  );

  assert.match(output, /confirmation: pending publication/);
  assert.ok(git(created.root, ['rev-parse', '--verify', PENDING_REF]));
  assert.equal(loadLedgerStore(created.root).load().changes[0].frontmatter.owner, 'alice');
});
