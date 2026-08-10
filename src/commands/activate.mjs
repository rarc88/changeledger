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
import { ACTIVATION_REF, readStateRef, STATE_REF, writeActivation } from '../state-store.mjs';

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
  const revision = readStateRef(repoRoot, run);
  if (revision === null) {
    throw new Error(
      `no state to activate: ${STATE_REF} does not exist in this repo — fetch it, or run \`changeledger cutover\` on the integration branch to publish it`,
    );
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
