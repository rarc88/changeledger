// `changeledger activate` — the clone-side half of stage-2 adoption. A repo that
// was already cut over publishes its ledger in `refs/heads/changeledger/state`;
// every other checkout of it (a fresh clone, a linked worktree) still has to
// take the activation decision locally, because activation is deliberately
// checkout-independent and lives outside `refs/heads/` (20260723-202646).
//
// This command is only that decision. It never publishes, mutates or repairs
// the state: no state ref means there is nothing to activate against, and it
// says so instead of silently initializing one.

import path from 'node:path';
import { findChangeledgerDir } from '../config.mjs';
import { capturedRun } from '../git.mjs';
import {
  ACTIVATION_REF,
  optionalRefOid,
  readStateRef,
  STATE_REF,
  seedStateRef,
  writeActivation,
} from '../state-store.mjs';
import { resolveRemote } from './sync.mjs';

export function activate(cwd = process.cwd(), output = console, run = capturedRun) {
  const changeledgerDir = findChangeledgerDir(cwd);
  if (!changeledgerDir) {
    throw new Error(
      'Not a ChangeLedger repo (no .changeledger/ found). Run `changeledger init` first.',
    );
  }
  const repoRoot = path.dirname(changeledgerDir);

  // `readStateRef` asserts the ref names a commit OBJECT via `cat-file -t`,
  // never a `^{commit}` peel — an annotated tag under the state ref must be
  // refused, not silently followed to the commit it wraps (MIG-04).
  let revision = readStateRef(repoRoot, run);
  if (revision === null) {
    // A fresh clone holds the state ref only as a remote-tracking copy: seed
    // the local ref from it (tree validated before the ref exists) instead of
    // demanding a manual `git update-ref`. Absent that copy too, the original
    // actionable error stands — activate never publishes or initializes state.
    const remote = resolveRemote(repoRoot, run);
    const tracking =
      remote === null
        ? null
        : optionalRefOid(
            repoRoot,
            `refs/remotes/${remote}/${STATE_REF.slice('refs/heads/'.length)}`,
            run,
          );
    if (tracking !== null) {
      seedStateRef(repoRoot, { revision: tracking }, run);
      output.log(`Seeded ${STATE_REF} from refs/remotes/${remote} at ${tracking}`);
      revision = readStateRef(repoRoot, run);
    } else {
      throw new Error(
        `no state to activate: ${STATE_REF} does not exist in this repo — fetch it, or run \`changeledger cutover\` on the integration branch to publish it`,
      );
    }
  }

  // `repaired` is an activation written before it recorded the ledger it owns:
  // every read refuses it, and this command is the remedy those errors name, so
  // saying "nothing to do" would contradict the write that just happened.
  const { created, repaired } = writeActivation(repoRoot, { stateRef: STATE_REF }, run);
  if (created) output.log(`Activated ${ACTIVATION_REF} → ${STATE_REF} at ${revision}`);
  else if (repaired) {
    output.log(`Repaired ${ACTIVATION_REF}: it now declares the ledger it activates`);
  } else output.log(`Already activated against ${STATE_REF} at ${revision} — nothing to do`);
  return 0;
}
