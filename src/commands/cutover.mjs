// `changeledger cutover` — the one-shot stage-2 adoption tool, and its undo.
//
// It moves a repo whose ledger lives in the worktree to the shared state ref:
// it reads the ledger from ONE explicit source (the integration branch's HEAD
// commit), validates the whole snapshot with the repo's own `checkRepo` rules
// BEFORE constructing anything, publishes the state ref, takes the activation
// decision, and finally commits the worktree cleanup that removes `changes/`,
// `specs/` and `releases/` while keeping `config.yml` (the discovery marker
// `findChangeledgerDir` needs; the authority over config CONTENT once activated
// is the copy inside the ref).
//
// The v2 migrator this replaces is a reference, not a port: no two-phase
// protocol, no editable plan file, no multi-source resolution. What is kept is
// its validation ORDER (validate everything, then build, then publish), its
// idempotency by content equality rather than by re-running the pipeline, and
// two of its bugs promoted to criteria — a ref must be asserted to BE a commit
// (never peeled from an annotated tag), and the undo must be a first-class path
// rather than a manual procedure.

import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parseChange } from '../change.mjs';
import { checkRepo } from '../check.mjs';
import {
  findChangeledgerDir,
  integrationBranch,
  loadConfig,
  resolveRepoPath,
  resolveSpecsDir,
} from '../config.mjs';
import { capturedRun, defaultBaseBranch, gitTopLevel, isAncestor, mutatingRun } from '../git.mjs';
import { assertRegularBlobEntry, treeEntries } from '../git-batch.mjs';
import { resolveReleasesDir } from '../release.mjs';
import { parseSpec } from '../spec.mjs';
import {
  ACTIVATION_REF,
  initState,
  mutateState,
  readActivation,
  readSnapshot,
  readStateRef,
  STATE_REF,
  STATE_ROOT,
  writeActivation,
} from '../state-store.mjs';
import { parseYaml } from '../yaml.mjs';
import { readLedgerAt, toPosix } from './ledger-tree.mjs';

// The cleanup commit is the repo-visible record of the cut, and the only place
// the published baseline is written down. `--undo` and the re-run detection
// both read it back from here, so the subject is matched exactly and the
// baseline travels as a trailer. The body's first line is the canonical
// operational-commit declaration (`src/git.mjs`), so this commit is exempt from
// the `[#id]` marker lint in the consuming repo without any special case.
const CUTOVER_SUBJECT = 'chore(state): cut the ledger over to the state ref';
const CUTOVER_BODY = `ChangeLedger: none — the ledger now lives in ${STATE_REF}`;
const BASELINE_TRAILER = 'Changeledger-Cutover-Baseline';
const BASELINE_RE = new RegExp(`^${BASELINE_TRAILER}: ([0-9a-f]{40,64})$`, 'm');

const UNDO_SUBJECT = 'chore(state): undo the ledger cutover';
const UNDO_BODY = 'ChangeLedger: none — restores the ledger to the worktree';

const BASELINE_MESSAGE = 'chore: publish the cutover baseline';

// Where each state collection is read from, as paths inside the git tree. The
// configured directories go through `resolveRepoPath`'s containment guard first
// (a cloned repo's config is untrusted input), then are expressed relative to
// git's own top-level — which is not necessarily the ChangeLedger repo root.
function ledgerLayout(repoRoot, changeledgerDir, config, run) {
  // One path form for everything derived here (20260812-022248): the caller's
  // cwd may reach the repo through a symlink or a Windows 8.3 short name,
  // while git reports its top-level in resolved long form — mixing the two
  // makes `path.relative` fabricate ../-climbing pathspecs that git rejects
  // as outside the repository. Both inputs are realpathed once, so every
  // relative below shares git's own form.
  const realRoot = fs.realpathSync.native(repoRoot);
  const realDir = fs.realpathSync.native(changeledgerDir);
  const topLevel = gitTopLevel(realRoot, run);
  const rel = (absolute) => toPosix(path.relative(topLevel, absolute));
  return {
    topLevel,
    ledgerDirRel: rel(realDir),
    configPath: rel(path.join(realDir, 'config.yml')),
    nestedSubject: 'the ledger',
    missingConfigSubject: 'the integration commit',
    collections: [
      {
        name: 'changes',
        extension: '.md',
        prefix: `${rel(resolveRepoPath(realRoot, config.changes_dir, 'changes_dir'))}/`,
      },
      {
        name: 'specs',
        extension: '.md',
        prefix: `${rel(resolveSpecsDir(realRoot, config))}/`,
      },
      {
        name: 'releases',
        extension: '.yml',
        prefix: `${rel(resolveReleasesDir(realRoot))}/`,
      },
    ],
  };
}

// Parses the snapshot into the shape `checkRepo` consumes — the same shape
// `loadRepo` builds for an activated repo — and runs the repo's full validation
// over it. Nothing has been written at this point and nothing may be: a single
// error aborts the whole cutover.
function validateLedger(source) {
  const config = parseYaml(source.configText);
  const changes = [];
  const specs = [];
  const releases = [];

  for (const [name, text] of source.documents) {
    const base = name.slice(name.indexOf('/') + 1);
    try {
      if (name.startsWith('changes/')) changes.push({ name: base, text, ...parseChange(text) });
      else if (name.startsWith('specs/')) specs.push({ name: base, ...parseSpec(text) });
      else releases.push({ name: base, ...parseYaml(text) });
    } catch (e) {
      throw new Error(`the ledger cannot be cut over — ${name}: ${e.message}`);
    }
  }
  changes.sort((a, b) => String(a.frontmatter?.id).localeCompare(String(b.frontmatter?.id)));

  const { errors } = checkRepo({ config, changes, specs, releases });
  if (errors.length) {
    const detail = errors.map((e) => `  ${e.file}: ${e.message}`).join('\n');
    throw new Error(
      `the ledger cannot be cut over — ${errors.length} validation error(s), nothing was written:\n${detail}`,
    );
  }
  return config;
}

// Content equality against what is already published. `readSnapshot` exposes
// documents as text and the manifest parsed, so the config blob is read
// directly to compare the bytes the cutover would publish. Over this exclusive
// layout (every entry a 100644 blob at a layout-valid path) identical paths and
// identical contents mean an identical tree.
function publishedMatches(repoRoot, tip, source, projectId, run) {
  const snapshot = readSnapshot(repoRoot, { revision: tip }, run);
  if (String(snapshot.manifest.project_id) !== String(projectId)) return false;
  if (
    run(['cat-file', 'blob', `${tip}:${STATE_ROOT}/config.yml`], repoRoot) !== source.configText
  ) {
    return false;
  }
  const published = Object.keys(snapshot.documents).sort();
  const candidate = [...source.documents.keys()].sort();
  if (published.length !== candidate.length) return false;
  return published.every(
    (name, i) => name === candidate[i] && snapshot.documents[name] === source.documents.get(name),
  );
}

// Every commit reachable from HEAD whose SUBJECT is exactly CUTOVER_SUBJECT,
// newest first, split into complete records (subject plus baseline trailer) and
// the exact-subject commits that carry no trailer.
//
// `--grep` only prefilters (it matches anywhere in a message, so a commit that
// merely quotes the subject would match); the subject line alone decides.
// Traversal follows ALL parents on purpose: a topic branch that merges the
// integration branch, with the integration branch then fast-forwarding onto
// that merge, is an ordinary workflow, and it leaves the cut reachable only as
// the merge's SECOND parent. Ignoring those parents made the undo report that
// nothing is reachable while the repo stayed activated with no ledger in the
// worktree.
function scanCutovers(repoRoot, output, run) {
  const out = run(
    ['log', '--topo-order', '--format=%H', '-F', `--grep=${CUTOVER_SUBJECT}`, 'HEAD'],
    repoRoot,
  );
  const records = [];
  const trailerless = [];
  for (const oid of out.split('\n').map((line) => line.trim())) {
    if (oid === '') continue;
    const message = run(['log', '-1', '--format=%B', oid], repoRoot);
    if (message.split('\n')[0].trim() !== CUTOVER_SUBJECT) continue;
    const match = message.match(BASELINE_RE);
    if (match) {
      records.push({ oid, baseline: match[1] });
      continue;
    }
    // A hand-written exact-subject commit is a decoy: warn with its identity
    // and keep searching for the real record. A genuine cut whose trailer a
    // message rewrite dropped looks identical here, so it is remembered rather
    // than forgotten — see `findCutover`.
    output.warn(
      `Ignoring exact-subject cutover commit ${oid}: it has no ${BASELINE_TRAILER} trailer`,
    );
    trailerless.push(oid);
  }
  return { records, trailerless };
}

// THE definition of "this repo's cutover commit", shared by the re-run
// detection and by the undo. Deliberately not "HEAD is the cutover commit" —
// the reversibility condition the Proposal states is the state ref still
// pointing at the published baseline, and nothing about where HEAD happens to
// be; tying it to HEAD killed the escape hatch on the first ordinary commit or
// merge that landed after the cut.
//
// The state ref is what tells the live cut from a retired one: the cut this
// repo is standing on is the record whose baseline the ref still holds, whether
// it was reached through a merge or along the branch. Only when no record
// agrees with the ref does the newest by descendancy stand in, so the
// past-the-baseline and half-cut diagnostics below still name a commit.
//
// A baseline oid is not a unique identifier, so agreement with the ref can be
// claimed by more than one record: committer dates are INPUTS, so a cut → undo
// → re-cut of identical content under pinned dates reproduces the previous
// baseline oid with nothing forged, and a trailer is plain text anyone can
// write. Letting topology break that tie meant `--undo` reverting a commit that
// published nothing and deleting the ref the real cut was standing on.
//
// The tie is broken by undo evidence, not by topology: a record with a
// COMPLETED undo commit after it has been retired, whatever its trailer still
// claims, so it does not compete. What remains is the live cut. Only when the
// evidence singles out no record — the forged shape, where a decoy has no undo
// behind it — does the ambiguity fail closed with the contenders named.
//
// "Completed" is the subject AND the diff, `isInverseCommit` — the same
// definition `findCompletedUndo` uses. Taking the subject as sufficient made
// retirement forgeable and handed an attacker the whole tie: an exact-subject
// commit reverting nothing retires the real cut, a same-baseline decoy is then
// the sole survivor, and `--undo` reverts the decoy — restoring content that
// was never published and dropping both refs, on exit 0.
//
// "After this record" is the FIRST-PARENT lineage, the same invariant
// `findCompletedUndo` states one level down: an undo counts only where it took
// EFFECT, on the branch standing on its restored ledger. A merge that discarded
// an undo (`-s ours`, or any merge that kept the cut's tree) restored nothing
// here, so the branch is still standing on the cut and that cut is not retired.
// Following every parent instead let a genuine revert parked on a discarded
// side branch retire the live record, collapsing the tie onto a poisoned decoy
// — the same exit-0 wrong restore as the forged shape, through another door.
//
// The accepted degradation: an honest undo reachable ONLY through a merge's
// second parent no longer retires its record. Such a history keeps both records
// competing and lands on the fail-closed tie below, naming the contenders —
// loud and recoverable by hand, never a silent wrong selection.
function retiredByUndo(repoRoot, oids, run) {
  const out = run(
    [
      'log',
      '--topo-order',
      '--first-parent',
      '--format=%H',
      '-F',
      `--grep=${UNDO_SUBJECT}`,
      'HEAD',
    ],
    repoRoot,
  );
  const undos = out
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (oid) =>
        oid !== '' && run(['log', '-1', '--format=%s', oid], repoRoot).trim() === UNDO_SUBJECT,
    );
  return new Set(
    oids.filter((oid) =>
      undos.some(
        (undo) => isAncestor(repoRoot, oid, undo, run) && isInverseCommit(repoRoot, oid, undo, run),
      ),
    ),
  );
}

// This selection is trusted for DIAGNOSIS only. Before anything is written,
// `undoCutover`'s `assertRevertRestoresSnapshot` re-decides on content — that
// is the write-path gate, and every topology rule here is defense in depth.
//
// `state` is the repo's own cutover evidence — the state ref (`tip`) and the
// activation. With evidence present and no record at all, exact-subject commits
// that lost their trailer are the only explanation left, and the operator gets
// them by oid instead of a false "nothing is reachable".
function findCutover(repoRoot, { tip = null, activated = false }, output, run) {
  const { records, trailerless } = scanCutovers(repoRoot, output, run);
  let live = tip === null ? [] : records.filter((record) => record.baseline === tip);
  if (live.length > 1) {
    const retired = retiredByUndo(
      repoRoot,
      live.map((record) => record.oid),
      run,
    );
    const standing = live.filter((record) => !retired.has(record.oid));
    if (standing.length !== 1) {
      const contenders = standing.length > 0 ? standing : live;
      throw new Error(
        `the live cutover commit is ambiguous — ${contenders.map((record) => record.oid).join(', ')} declare the baseline ${tip} that ${STATE_REF} holds and no later undo commit singles out one of them as still live, so which cut this repo stands on cannot be decided; resolve it by hand`,
      );
    }
    live = standing;
  }
  const found = live[0] ?? records[0] ?? null;
  if (found === null && trailerless.length > 0 && (tip !== null || activated)) {
    throw new Error(
      `no verifiable cutover commit is reachable from HEAD — ${trailerless.join(', ')} has the cutover subject but carries no ${BASELINE_TRAILER} trailer, so its baseline cannot be verified; resolve it by hand`,
    );
  }
  return found;
}

// The precondition both directions share whenever they are about to produce a
// commit of their own: nothing already staged (the commit must contain exactly
// what this command produced, never someone else's staged work) and a ledger
// with no uncommitted edit (the source of truth being published is the COMMIT,
// so an unstaged edit would be silently dropped by the cut and destroyed by the
// cleanup). Resuming an interrupted cut is the one path that skips it: there the
// index already holds exactly the pending cleanup, verified entry by entry by
// `exactStagedCleanup`, and the commit to produce is that very cleanup.
function ledgerPathspecs(layout) {
  return [
    layout.ledgerDirRel,
    ...layout.collections.map((collection) => collection.prefix.slice(0, -1)),
  ].filter((value, index, paths) => value !== '' && paths.indexOf(value) === index);
}

function assertCleanLedger(repoRoot, layout, operation, run) {
  const staged = run(['diff', '--cached', '--name-only'], repoRoot).trim();
  if (staged !== '') {
    throw new Error(
      `${operation} requires an empty index; commit or reset the staged changes first:\n${staged}`,
    );
  }
  const dirty = run(
    ['status', '--porcelain', '--', ...ledgerPathspecs(layout)],
    layout.topLevel,
  ).trim();
  if (dirty !== '') {
    throw new Error(
      `${operation} requires a clean ledger in the configured paths; commit or discard these first:\n${dirty}`,
    );
  }
}

function nulNames(text) {
  return text.split('\0').filter(Boolean).sort();
}

function sameNames(left, right) {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

function exactStagedCleanup(repoRoot, layout, run) {
  const cleanupPaths = layout.collections.map((collection) => collection.prefix.slice(0, -1));
  const staged = nulNames(
    run(['diff', '--cached', '--name-only', '-z'], repoRoot, { encoding: 'utf8' }),
  );
  if (staged.length === 0) return false;
  const stagedDeletions = nulNames(
    run(['diff', '--cached', '--name-only', '-z', '--diff-filter=D'], repoRoot, {
      encoding: 'utf8',
    }),
  );
  const expected = nulNames(
    run(['ls-tree', '-r', '--name-only', '-z', 'HEAD', '--', ...cleanupPaths], layout.topLevel, {
      encoding: 'utf8',
    }),
  );
  if (!sameNames(staged, expected) || !sameNames(staged, stagedDeletions)) return false;

  const ledgerPaths = ledgerPathspecs(layout);
  const unstaged = run(['diff', '--name-only', '-z', '--', ...ledgerPaths], layout.topLevel, {
    encoding: 'utf8',
  });
  const untracked = run(
    ['ls-files', '--others', '--exclude-standard', '-z', '--', ...ledgerPaths],
    layout.topLevel,
    { encoding: 'utf8' },
  );
  const ignored = run(
    ['ls-files', '--others', '--ignored', '--exclude-standard', '-z', '--', ...ledgerPaths],
    layout.topLevel,
    { encoding: 'utf8' },
  );
  return unstaged === '' && untracked === '' && ignored === '';
}

function resolveContext(cwd, operation, run) {
  const changeledgerDir = findChangeledgerDir(cwd);
  if (!changeledgerDir) {
    throw new Error(
      'Not a ChangeLedger repo (no .changeledger/ found). Run `changeledger init` first.',
    );
  }
  const repoRoot = path.dirname(changeledgerDir);
  const config = loadConfig(changeledgerDir);
  const branch = integrationBranch(config) ?? defaultBaseBranch(repoRoot, run);
  const checkout = run(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot).trim();
  if (checkout !== branch) {
    throw new Error(
      `${operation} rewrites the integration branch "${branch}" and its worktree, so it must run with that branch checked out (currently on "${checkout}")`,
    );
  }
  const head = run(['rev-parse', 'HEAD'], repoRoot).trim();
  return { changeledgerDir, repoRoot, config, branch, head };
}

export function cutover({ undo = false } = {}, cwd = process.cwd(), output = console) {
  const run = capturedRun;
  const ctx = resolveContext(cwd, undo ? 'cutover --undo' : 'cutover', run);
  return undo ? undoCutover(ctx, output, run) : runCutover(ctx, output, run);
}

function runCutover(ctx, output, run) {
  const { changeledgerDir, repoRoot, config, head } = ctx;

  // Already cut: the re-run is a no-op by identity, not by re-deriving a
  // snapshot from a worktree the previous run deliberately emptied. Found
  // anywhere in the history, not only at HEAD, so ordinary commits landing
  // after the cut do not turn the re-run into a spurious failure.
  let tip = readStateRef(repoRoot, run);
  const activation = readActivation(repoRoot, run);
  const recorded = findCutover(repoRoot, { tip, activated: activation !== null }, output, run);
  if (recorded !== null) {
    if (tip !== null && activation !== null) {
      output.log(
        `Already cut over — ${STATE_REF} at ${tip} (baseline ${recorded.baseline}); nothing to do`,
      );
      return 0;
    }
    // Exactly one of the two present is a half-finished cut. Neither present
    // means that cut was already undone, and this repo can be cut over again.
    if (tip !== null || activation !== null) {
      throw new Error(
        `the cutover commit ${recorded.oid} is in this history but ${tip === null ? STATE_REF : ACTIVATION_REF} is missing — this repo is half cut over; resolve it by hand`,
      );
    }
  }

  if (activation !== null && (tip === null || activation.state_ref !== STATE_REF)) {
    throw new Error(
      `this repo is already activated (${ACTIVATION_REF}) — cutover only runs on a repo that is not yet activated`,
    );
  }
  const layout = ledgerLayout(repoRoot, changeledgerDir, config, run);
  if (activation === null) assertCleanLedger(repoRoot, layout, 'cutover', run);
  const source = readLedgerAt(repoRoot, head, layout, run);
  const ledgerConfig = validateLedger(source);
  const projectId = ledgerConfig.project_id;
  if (typeof projectId !== 'string' || projectId === '') {
    throw new Error(
      'the ledger cannot be cut over — config.yml has no project_id; run `changeledger register` first',
    );
  }

  if (activation !== null) {
    if (!publishedMatches(repoRoot, tip, source, projectId, run)) {
      throw new Error(
        `this repo is already activated (${ACTIVATION_REF}) — cutover only resumes when ${STATE_REF} matches the integration commit`,
      );
    }
    if (!exactStagedCleanup(repoRoot, layout, run)) {
      assertCleanLedger(repoRoot, layout, 'cutover', run);
    }
    commitCleanup(ctx, layout, tip, output);
    output.log(`Cut over ${source.documents.size} document(s) — ${STATE_REF} at ${tip}`);
    output.log(`Activated ${ACTIVATION_REF}; the worktree keeps only ${layout.configPath}`);
    return 0;
  }

  // Everything above this line is a read. Everything below writes.
  if (tip === null) {
    tip = initState(repoRoot, { projectId, config: ledgerConfig }, run).revision;
  } else if (initializedPublicationMatches(repoRoot, tip, ledgerConfig, projectId, run)) {
    throw new Error(
      `half-published cutover: ${STATE_REF} is present at ${tip} but ${ACTIVATION_REF} is absent; run git update-ref -d refs/heads/changeledger/state, then re-run cutover`,
    );
  } else if (!publishedMatches(repoRoot, tip, source, projectId, run)) {
    throw new Error(
      `${STATE_REF} already exists at ${tip} and does not hold the ledger this cutover would publish — refusing to touch refs, worktree or history`,
    );
  }

  const baseline = mutateState(
    repoRoot,
    { expectedRevision: tip, message: BASELINE_MESSAGE },
    (stage) => {
      // The config is republished byte for byte: `initState` serializes a
      // parsed mapping, which would silently drop the file's comments and key
      // order the moment the ref becomes the authority for config content.
      stage.write('config.yml', source.configText);
      for (const [name, text] of source.documents) stage.write(name, text);
    },
    run,
  ).revision;

  writeActivation(repoRoot, { stateRef: STATE_REF }, run);
  commitCleanup(ctx, layout, baseline, output);

  output.log(`Cut over ${source.documents.size} document(s) — ${STATE_REF} at ${baseline}`);
  output.log(`Activated ${ACTIVATION_REF}; the worktree keeps only ${layout.configPath}`);
  return 0;
}

function initializedPublicationMatches(repoRoot, tip, config, projectId, run) {
  const snapshot = readSnapshot(repoRoot, { revision: tip }, run);
  return (
    String(snapshot.manifest.project_id) === String(projectId) &&
    Object.keys(snapshot.documents).length === 0 &&
    isDeepStrictEqual(snapshot.config, config)
  );
}

function commitCleanup({ repoRoot }, layout, baseline, output) {
  const paths = layout.collections.map((c) => c.prefix.slice(0, -1));
  mutatingRun(['rm', '-r', '-q', '--ignore-unmatch', '--', ...paths], layout.topLevel);
  // `git rm` only sees tracked files, so a collection directory that is empty
  // on disk — either emptied by the rm or already empty before the cut —
  // survives it and contradicts "keeps only config.yml" literally. Removing
  // the leftovers is cosmetic, and this runs BETWEEN the rm and the cleanup
  // commit: aborting here would strand the cut in its interrupted window over
  // a nicety (20260812-020449 — Windows delete-pending semantics did exactly
  // that). ENOENT is the happy case; anything else is warned with its code,
  // never thrown.
  for (const rel of paths) {
    const dir = path.join(layout.topLevel, rel);
    try {
      fs.rmdirSync(dir);
    } catch (e) {
      if (e.code !== 'ENOENT') {
        output.warn(
          `Warning: could not remove the emptied directory ${rel} (${e.code ?? e.message}); the cut is unaffected`,
        );
      }
    }
  }
  mutatingRun(
    [
      'commit',
      '--no-verify',
      '--allow-empty',
      '-q',
      '-m',
      CUTOVER_SUBJECT,
      '-m',
      `${CUTOVER_BODY}\n\n${BASELINE_TRAILER}: ${baseline}`,
    ],
    repoRoot,
  );
}

// Undoes a `git revert -n` that could not apply. `--abort` is git's own name
// for exactly this and restores index and worktree; it is guarded because a
// revert that failed before touching anything leaves nothing in progress for it
// to abort, and that must not mask the real conflict error being raised.
function abortRevert(repoRoot) {
  try {
    mutatingRun(['revert', '--abort'], repoRoot);
  } catch {
    // nothing in progress to abort — the conflict error is still the one to
    // report, so this is deliberately swallowed
  }
}

function rawDiff(repoRoot, revision, run) {
  const out = run(
    ['diff-tree', '--no-commit-id', '--raw', '--no-abbrev', '-r', revision],
    repoRoot,
  );
  const entries = new Map();
  for (const line of out.split('\n')) {
    if (line.trim() === '') continue;
    const match = line.match(/^:(\d+) (\d+) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])\t(.+)$/);
    if (!match) return null;
    entries.set(match[6], {
      oldMode: match[1],
      newMode: match[2],
      oldOid: match[3],
      newOid: match[4],
      status: match[5],
    });
  }
  return entries;
}

// The semantic ground truth, checked before anything is written: what undoing
// this record would put back MUST be, byte for byte, the ledger the state ref
// publishes. Selection is topological and every topological rule so far has
// had a next decoy — a forged trailer, a discarded revert, a hand-reapplied cut
// that retires the real record forever. This asks the question those rules only
// approximate, and no history can lie about it: the genuine cut's cleanup
// commit removed exactly the published snapshot, so it always passes, while a
// decoy's cleanup commit removed something else and always fails.
//
// Blob oids are the comparison, not text: identical oid is identical bytes in
// the same object store, with no decoding in between.
//
// Bytes alone are not the snapshot, so the entry KIND is checked too. The store
// admits regular blobs only (`assertRegularBlobEntry`), and a decoy whose
// parent tree carries the very published blob at mode 120000 is byte-faithful
// yet materializes a dangling SYMLINK where the document belongs. The mode is
// checked for admissibility rather than equality on purpose: publication
// normalizes every document to 100644, so an executable document's honest undo
// legitimately restores 100755. Both are regular files; a symlink is not.
function assertRevertRestoresSnapshot(repoRoot, cutoverCommit, tip, layout, run) {
  const refuse = (detail) => {
    throw new Error(
      `the cutover ${cutoverCommit} cannot be undone — reverting it would not restore the ledger ${STATE_REF} publishes at ${tip}: ${detail}; refusing to revert, resolve it by hand`,
    );
  };

  const diff = rawDiff(repoRoot, cutoverCommit, run);
  if (diff === null) refuse(`its diff cannot be read`);
  const restored = new Map();
  for (const [gitPath, entry] of diff) {
    if (entry.status !== 'D') refuse(`${gitPath} is not a removal it could put back`);
    const collection = layout.collections.find((candidate) => gitPath.startsWith(candidate.prefix));
    if (!collection) refuse(`${gitPath} is outside the configured ledger collections`);
    restored.set(`${collection.name}/${gitPath.slice(collection.prefix.length)}`, {
      oid: entry.oldOid,
      mode: entry.oldMode,
    });
  }

  const snapshot = readSnapshot(repoRoot, { revision: tip }, run);
  const published = new Map(treeEntries(repoRoot, tip, run).map((entry) => [entry.path, entry]));
  const names = [...new Set([...restored.keys(), ...Object.keys(snapshot.documents)])].sort();
  for (const name of names) {
    const candidate = restored.get(name);
    if (candidate === undefined) refuse(`${name} is published but the revert would not restore it`);
    if (!Object.hasOwn(snapshot.documents, name)) {
      refuse(`${name} would be restored but is not published`);
    }
    const entry = published.get(`${STATE_ROOT}/${name}`);
    if (entry === undefined) refuse(`${name} cannot be read from the published snapshot`);
    if (entry.oid !== candidate.oid) {
      refuse(`${name} would be restored as ${candidate.oid}, but ${entry.oid} is published`);
    }
    try {
      assertRegularBlobEntry(candidate.mode, name);
    } catch {
      refuse(
        `${name} would be restored at mode ${candidate.mode}, but ${STATE_REF} publishes regular files only (${entry.mode})`,
      );
    }
  }
}

function isInverseCommit(repoRoot, cutoverCommit, candidate, run) {
  const cut = rawDiff(repoRoot, cutoverCommit, run);
  const undo = rawDiff(repoRoot, candidate, run);
  if (!cut || !undo || cut.size === 0 || cut.size !== undo.size) return false;
  for (const [name, removed] of cut) {
    const restored = undo.get(name);
    if (
      removed.status !== 'D' ||
      restored?.status !== 'A' ||
      removed.oldMode !== restored.newMode ||
      removed.newMode !== restored.oldMode ||
      removed.oldOid !== restored.newOid ||
      removed.newOid !== restored.oldOid
    ) {
      return false;
    }
  }
  return true;
}

// Unlike the cutover search above, this one stays on the first-parent line, and
// the asymmetry is the point. Finding the cut is about REACHABILITY: a cut on a
// second parent is still this repo's cut, and its content is in the tree. An
// undo is only "interrupted" when its restored ledger is what the branch is
// standing on — an undo commit that a merge reached but discarded (`-s ours`,
// or any merge that kept the cut's tree) restored nothing here, and treating it
// as interrupted would refuse a plain undo that can still run.
function findCompletedUndo(repoRoot, cutoverCommit, run) {
  const out = run(
    [
      'log',
      '--topo-order',
      '--first-parent',
      '--format=%H',
      '-F',
      `--grep=${UNDO_SUBJECT}`,
      'HEAD',
    ],
    repoRoot,
  );
  for (const oid of out.split('\n').map((line) => line.trim())) {
    if (!oid) continue;
    const subject = run(['log', '-1', '--format=%s', oid], repoRoot).trim();
    if (
      subject === UNDO_SUBJECT &&
      isAncestor(repoRoot, cutoverCommit, oid, run) &&
      isInverseCommit(repoRoot, cutoverCommit, oid, run)
    ) {
      return oid;
    }
  }
  return null;
}

function cleanupPathsUnchanged(repoRoot, candidate, layout, run) {
  const paths = layout.collections.map((collection) => collection.prefix.slice(0, -1));
  return run(['diff', '--name-only', candidate, 'HEAD', '--', ...paths], repoRoot).trim() === '';
}

function observedActivation(repoRoot, run) {
  const activation = readActivation(repoRoot, run);
  if (activation === null) return null;
  return {
    authority: activation,
    oid: run(['rev-parse', '--verify', ACTIVATION_REF], repoRoot).trim(),
  };
}

function deleteCutoverRefs(repoRoot, stateOid, activationOid, run) {
  const commands = [];
  if (activationOid) commands.push(`delete ${ACTIVATION_REF} ${activationOid}`);
  commands.push(`delete ${STATE_REF} ${stateOid}`);
  run(['update-ref', '--stdin'], repoRoot, { input: `${commands.join('\n')}\n` });
}

function undoCutover(ctx, output, run) {
  const { changeledgerDir, config, repoRoot } = ctx;

  const tip = readStateRef(repoRoot, run);
  const found = findCutover(
    repoRoot,
    { tip, activated: readActivation(repoRoot, run) !== null },
    output,
    run,
  );
  if (found === null) {
    throw new Error(
      `nothing to undo — no commit with the subject "${CUTOVER_SUBJECT}" is reachable from HEAD`,
    );
  }
  const { oid: cutoverCommit, baseline } = found;
  if (tip === null) {
    throw new Error(`nothing to undo — ${STATE_REF} does not exist`);
  }
  // The whole reversibility question, decided by one commit comparison: the
  // undo restores the worktree to what the baseline published, so any state the
  // ledger gained after it would be dropped. That is not a call a tool makes.
  if (tip !== baseline) {
    throw new Error(
      `the cutover is no longer reversible — ${STATE_REF} is at ${tip}, past the published baseline ${baseline}, so undoing would discard the ledger history written since the cut; the decision is yours`,
    );
  }
  const activation = observedActivation(repoRoot, run);
  const completedUndo = findCompletedUndo(repoRoot, cutoverCommit, run);
  const layout = ledgerLayout(repoRoot, changeledgerDir, config, run);
  // Before either direction, and before anything is written. The resume path
  // below writes no content of its own, but it finishes an undo whose restored
  // ledger `isInverseCommit` has already equated with THIS record's removals —
  // so a record that fails here is one whose resume would deactivate the repo
  // over content the ref never published. Same question, same answer, one call.
  assertRevertRestoresSnapshot(repoRoot, cutoverCommit, tip, layout, run);
  if (activation?.authority.state_ref === STATE_REF && completedUndo !== null) {
    if (!cleanupPathsUnchanged(repoRoot, completedUndo, layout, run)) {
      throw new Error(
        `the interrupted undo ${completedUndo} cannot be completed automatically — its restored ledger paths changed afterward; resolve that content by hand`,
      );
    }
    assertCleanLedger(repoRoot, layout, 'cutover --undo', run);
    deleteCutoverRefs(repoRoot, tip, activation.oid, run);
    output.log(`Undid the cutover — the ledger is back in the worktree, ${STATE_REF} deleted`);
    return 0;
  }
  assertCleanLedger(repoRoot, layout, 'cutover --undo', run);

  // Worktree first, refs after: an interrupted undo that has restored the
  // documents but not yet dropped the refs is still a consistent activated
  // repo, while the reverse order would leave a deactivated repo with no
  // documents anywhere.
  //
  // The revert is applied as a new commit on top of HEAD, never by rewinding
  // the branch: commits that landed after the cut are other people's work and
  // are not this command's to discard. When one of them touched a path the
  // cleanup removed, the revert cannot apply and there is no safe automatic
  // resolution — abort it so no half-applied merge is left behind, and hand the
  // conflict back with the paths named.
  try {
    mutatingRun(['revert', '-n', cutoverCommit], repoRoot);
  } catch (e) {
    abortRevert(repoRoot);
    throw new Error(
      `the cutover ${cutoverCommit} cannot be reverted automatically — a commit after the cut touched the paths it removed, so restoring them conflicts; resolve it by hand:\n${e.message}`,
      { cause: e },
    );
  }
  mutatingRun(['commit', '--no-verify', '-q', '-m', UNDO_SUBJECT, '-m', UNDO_BODY], repoRoot);

  // Deleted with its observed oid as the CAS old-value, never bare: a `-d` with
  // no old-value would also delete an activation someone else re-pointed
  // between this read and the write.
  const currentActivation = observedActivation(repoRoot, run);
  deleteCutoverRefs(repoRoot, baseline, currentActivation?.oid, run);

  output.log(`Undid the cutover — the ledger is back in the worktree, ${STATE_REF} deleted`);
  return 0;
}
