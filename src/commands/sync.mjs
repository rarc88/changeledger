// `changeledger sync` — stage 3 of the global state: the state ref travels to
// and from the repo's own remote, in pure git, over a ref that lives in an
// ordinary branch namespace (`refs/heads/changeledger/state`), so `fetch` and
// `push` transport it with no provider adapter anywhere.
//
// Two properties shape everything below.
//
// It always COMPARES first. A fetch refreshes the remote-tracking copy, and the
// relation between the local tip and that copy is classified into exactly four
// states: identical (nothing to do), remote ahead (fast-forward the local ref by
// CAS), local ahead (push), diverged (both moved). Only after that comparison
// does anything get written.
//
// It is never blocking. No remote, no remote ref, an unreachable remote or a
// checkout that is not activated are informative no-ops with exit 0: no other
// command consults `sync`, waits for it, or changes behavior when it has never
// run. What it must never do is guess — a document that changed on both sides
// stops and reports, because the state ceiling puts automatic multi-source
// conflict resolution outside the tool.

import path from 'node:path';
import { findChangeledgerDir } from '../config.mjs';
import { capturedRun, isAncestor } from '../git.mjs';
import { treeEntries } from '../git-batch.mjs';
import {
  advanceStateRef,
  commitMergedState,
  optionalRefOid,
  readStateRef,
  resolveOwnedActivation,
  STATE_REF,
  STATE_ROOT,
} from '../state-store.mjs';

// The branch name the state ref carries inside `refs/heads/`, and therefore the
// suffix of its remote-tracking copy under `refs/remotes/<remote>/`.
const STATE_BRANCH = STATE_REF.slice('refs/heads/'.length);

// Which remote the state ref travels over. `origin` when it exists — the name
// every clone gets by default — otherwise the single configured remote. Several
// remotes and no `origin` is a genuine ambiguity: picking one for the human
// would publish the journal somewhere they never named.
export function resolveRemote(repoRoot, run) {
  const remotes = run(['remote'], repoRoot)
    .split('\n')
    .map((name) => name.trim())
    .filter(Boolean);
  if (remotes.length === 0) return null;
  if (remotes.includes('origin')) return 'origin';
  if (remotes.length === 1) return remotes[0];
  throw new Error(
    `cannot decide which remote holds the state ref: this repo configures ${remotes.join(', ')} and none is "origin"`,
  );
}

// Refreshes the remote-tracking copy. Three outcomes, and the two failure modes
// are told apart by `ls-remote --exit-code`'s own exit status (2 = reachable,
// no matching ref) rather than by matching git's prose, which is a presentation
// surface: `absent` means the remote simply has no state ref yet (a first
// publish), `unreachable` means the network or the remote failed and the whole
// flow must carry on untouched.
function fetchState(repoRoot, remote, run) {
  try {
    run(
      ['fetch', '--quiet', remote, `+${STATE_REF}:refs/remotes/${remote}/${STATE_BRANCH}`],
      repoRoot,
    );
    return 'ok';
  } catch {
    try {
      run(['ls-remote', '--exit-code', remote, STATE_REF], repoRoot);
    } catch (probe) {
      return probe.cause?.status === 2 ? 'absent' : 'unreachable';
    }
    return 'unreachable';
  }
}

// Publishes `revision` as the remote state ref. Deliberately not a force push:
// the remote's own fast-forward check is the CAS on that side, so a remote that
// moved between the fetch and here is rejected instead of overwritten. The
// remote-tracking copy is advanced explicitly afterwards, so a later `--status`
// reports the relation this push just established rather than a stale one.
function pushState(repoRoot, remote, revision, run) {
  try {
    run(['push', '--quiet', remote, `${revision}:${STATE_REF}`], repoRoot);
  } catch (e) {
    throw new Error(
      `cannot publish ${STATE_REF} to ${remote}: ${e.message}\nNothing local was lost — resolve the rejection and re-run \`changeledger sync\`.`,
      { cause: e },
    );
  }
  run(['update-ref', `refs/remotes/${remote}/${STATE_BRANCH}`, revision], repoRoot);
}

// The four states, and nothing else. A remote with no state ref at all is the
// first publish, which is the same write as "local ahead".
function classify(repoRoot, local, remote, run) {
  if (remote === null) return 'ahead';
  if (local === remote) return 'identical';
  if (isAncestor(repoRoot, local, remote, run)) return 'behind';
  if (isAncestor(repoRoot, remote, local, run)) return 'ahead';
  return 'diverged';
}

const COLLECTION_CLASSES = new Map([
  ['changes', 'change'],
  ['specs', 'spec'],
  ['releases', 'release'],
]);

// The class of a state path, for a human reading the report: the collection it
// belongs to, or the tree's own two top-level documents.
function documentClass(fullPath) {
  const parts = fullPath.split('/');
  if (parts.length === 2) return parts[1] === 'manifest.yml' ? 'manifest' : 'config';
  return COLLECTION_CLASSES.get(parts[1]) ?? 'document';
}

function documentName(fullPath) {
  return fullPath.slice(`${STATE_ROOT}/`.length);
}

// Names every colliding document with its class and both sides' blob oids, over
// the two ref tips the divergence is between — so the human can diff exactly
// those revisions without first reconstructing what `sync` compared.
function collisionReport(collisions, { local, remote, trackingRef }) {
  const lines = [
    `${STATE_REF} diverged and the same document changed differently on both sides — nothing was written.`,
    `  local  ${STATE_REF} ${local}`,
    `  remote ${trackingRef} ${remote}`,
    'Colliding documents:',
  ];
  for (const { fullPath, localOid, remoteOid } of [...collisions].sort((one, other) =>
    one.fullPath < other.fullPath ? -1 : 1,
  )) {
    const kind = documentClass(fullPath);
    const shortOid = (oid) => (oid === null ? 'deleted' : oid.slice(0, 7));
    const note =
      kind === 'spec' ? ' — concurrent graduations of the same spec are the usual cause' : '';
    lines.push(
      `  - ${kind} ${documentName(fullPath)}: local ${shortOid(localOid)} vs remote ${shortOid(remoteOid)}${note}`,
    );
  }
  lines.push(
    'Resolve these documents with the human, then re-run `changeledger sync`; every other document was left untouched.',
  );
  return lines.join('\n');
}

function entriesByPath(repoRoot, revision, run) {
  return new Map(treeEntries(repoRoot, revision, run).map((entry) => [entry.path, entry]));
}

// The commit both sides last agreed on. Its absence is not a divergence a tool
// may resolve: two ledgers with no common ancestor are two different projects,
// and merging them would invent a history neither side ever had.
function mergeBase(repoRoot, local, remote, run) {
  let out = '';
  try {
    out = run(['merge-base', local, remote], repoRoot).trim();
  } catch {
    out = '';
  }
  if (out === '') {
    throw new Error(
      `${STATE_REF} (${local}) and the remote copy (${remote}) share no history — these are two independent ledgers, not a divergence a tool may reconcile. Nothing was written.`,
    );
  }
  return out;
}

// Per-document three-way comparison against the merge base. A side "changed" a
// path when its oid differs from the base's — an addition and a deletion are
// changes like any other. Both sides changing the same path is a COLLISION only
// when they disagree: an identical oid is byte-identical content, the same
// document landed twice, and taking it resolves no conflict at all.
//
// Every path of the tree is judged the same way, `manifest.yml` and
// `config.yml` included: they are documents of the state tree, so two sides
// editing either of them differently stops exactly like two graduations of one
// spec do.
function reconcile(repoRoot, { local, remote, base }, run) {
  const baseEntries = entriesByPath(repoRoot, base, run);
  const localEntries = entriesByPath(repoRoot, local, run);
  const remoteEntries = entriesByPath(repoRoot, remote, run);

  const collisions = [];
  const merged = new Map(baseEntries);
  for (const fullPath of new Set([
    ...baseEntries.keys(),
    ...localEntries.keys(),
    ...remoteEntries.keys(),
  ])) {
    const baseOid = baseEntries.get(fullPath)?.oid ?? null;
    const localOid = localEntries.get(fullPath)?.oid ?? null;
    const remoteOid = remoteEntries.get(fullPath)?.oid ?? null;
    const localChanged = localOid !== baseOid;
    const remoteChanged = remoteOid !== baseOid;
    if (localChanged && remoteChanged && localOid !== remoteOid) {
      collisions.push({ fullPath, localOid, remoteOid });
      continue;
    }
    const winner = localChanged
      ? localEntries.get(fullPath)
      : remoteChanged
        ? remoteEntries.get(fullPath)
        : baseEntries.get(fullPath);
    if (winner) merged.set(fullPath, winner);
    else merged.delete(fullPath);
  }
  return { collisions, merged: [...merged.values()] };
}

// The offline half: the relation against whatever the last fetch left behind.
// Every command here is a local object/ref read, so any point of the flow can
// measure freshness without paying for, or waiting on, the network.
// `--status` is free at any point of the flow (20260811-163204): it answers
// from whatever remote-tracking copies of the state ref already exist, without
// resolving any remote — resolution can legitimately be ambiguous (several
// remotes, none called origin) and a freshness report must not fail for it.
function reportStatus(repoRoot, { local }, output, run) {
  const copies = run(
    ['for-each-ref', '--format=%(refname) %(objectname)', `refs/remotes/*/${STATE_BRANCH}`],
    repoRoot,
  )
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [refname, oid] = line.split(' ');
      return { refname, oid };
    });
  output.log(`Local  ${STATE_REF} ${local}`);
  if (copies.length === 0) {
    output.log(
      `Relation: unknown — no remote-tracking copy of the state ref yet; run \`changeledger sync\` to fetch one`,
    );
    return 0;
  }
  for (const { refname, oid } of copies) {
    output.log(`Remote ${refname} ${oid} (as of the last fetch)`);
    const relation = classify(repoRoot, local, oid, run);
    const explanation = {
      identical: 'identical — the last fetch and the local journal agree',
      behind: 'behind — the fetched copy carries documents this journal lacks',
      ahead: 'ahead — this journal carries documents the fetched copy lacks',
      diverged: 'diverged — both sides moved since they last agreed',
    }[relation];
    output.log(`Relation: ${explanation}`);
  }
  return 0;
}

export function sync(
  { status = false } = {},
  cwd = process.cwd(),
  output = console,
  run = capturedRun,
) {
  const changeledgerDir = findChangeledgerDir(cwd);
  if (!changeledgerDir) {
    throw new Error(
      'Not a ChangeLedger repo (no .changeledger/ found). Run `changeledger init` first.',
    );
  }
  const repoRoot = path.dirname(changeledgerDir);

  // Activation is the local checkout's own decision and never travels with the
  // ref: a fetch must not be able to change how a repo operates. So an
  // unactivated checkout is told what the manual step is and nothing else.
  const local = readStateRef(repoRoot, run);
  if (resolveOwnedActivation(repoRoot, run) === null) {
    output.log(
      local === null
        ? `Nothing to sync: this repo is not activated and ${STATE_REF} does not exist here.`
        : `${STATE_REF} is present but this checkout is not activated — run \`changeledger activate\` to adopt it. sync changed nothing.`,
    );
    return 0;
  }
  if (local === null) {
    throw new Error(
      `this repo is activated against ${STATE_REF}, but that ref does not exist — restore it before syncing`,
    );
  }

  if (status) return reportStatus(repoRoot, { local }, output, run);

  const remote = resolveRemote(repoRoot, run);
  if (remote === null) {
    output.log(`No Git remote is configured — ${STATE_REF} stays local. Nothing to sync.`);
    return 0;
  }
  const trackingRef = `refs/remotes/${remote}/${STATE_BRANCH}`;

  const fetched = fetchState(repoRoot, remote, run);
  if (fetched === 'unreachable') {
    output.warn(
      `Warning: could not reach the remote "${remote}" — no ref was touched and every local command works as before. Re-run \`changeledger sync\` when the network is back.`,
    );
    return 0;
  }
  const tracked = fetched === 'absent' ? null : optionalRefOid(repoRoot, trackingRef, run);

  const relation = classify(repoRoot, local, tracked, run);
  if (relation === 'identical') {
    output.log(`Already in sync with "${remote}" at ${local}.`);
    return 0;
  }
  if (relation === 'behind') {
    advanceStateRef(repoRoot, { expectedRevision: local, revision: tracked }, run);
    output.log(`Fast-forwarded ${STATE_REF} from ${local} to ${tracked} (from "${remote}").`);
    return 0;
  }
  if (relation === 'ahead') {
    pushState(repoRoot, remote, local, run);
    output.log(`Published ${STATE_REF} at ${local} to "${remote}".`);
    return 0;
  }

  const base = mergeBase(repoRoot, local, tracked, run);
  const { collisions, merged } = reconcile(repoRoot, { local, remote: tracked, base }, run);
  if (collisions.length > 0) {
    throw new Error(collisionReport(collisions, { local, remote: tracked, trackingRef }));
  }
  const { revision } = commitMergedState(
    repoRoot,
    {
      expectedRevision: local,
      otherRevision: tracked,
      entries: merged,
      message: `chore: reconcile state with ${remote}`,
    },
    run,
  );
  output.log(
    `Reconciled disjoint journals into ${revision}: ${STATE_REF} keeps both ${local} and ${tracked}.`,
  );
  pushState(repoRoot, remote, revision, run);
  output.log(`Published ${STATE_REF} at ${revision} to "${remote}".`);
  return 0;
}
