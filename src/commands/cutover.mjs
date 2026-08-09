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
  const topLevel = gitTopLevel(repoRoot, run);
  const rel = (absolute) => toPosix(path.relative(topLevel, absolute));
  return {
    topLevel,
    configPath: rel(path.join(changeledgerDir, 'config.yml')),
    nestedSubject: 'the ledger',
    missingConfigSubject: 'the integration commit',
    collections: [
      {
        name: 'changes',
        extension: '.md',
        prefix: `${rel(resolveRepoPath(repoRoot, config.changes_dir, 'changes_dir'))}/`,
      },
      {
        name: 'specs',
        extension: '.md',
        prefix: `${rel(resolveSpecsDir(repoRoot, config))}/`,
      },
      {
        name: 'releases',
        extension: '.yml',
        prefix: `${rel(resolveReleasesDir(repoRoot))}/`,
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

// The baseline recorded by the cleanup commit at `revision`, or null when that
// commit is not a complete cutover record. A hand-written exact-subject commit
// is a decoy: warn with its identity, then keep searching for the real record.
function cutoverBaselineAt(repoRoot, revision, output, run) {
  const message = run(['log', '-1', '--format=%B', revision], repoRoot);
  if (message.split('\n')[0].trim() !== CUTOVER_SUBJECT) return null;
  const match = message.match(BASELINE_RE);
  if (!match) {
    output.warn(
      `Ignoring exact-subject cutover commit ${revision}: it has no ${BASELINE_TRAILER} trailer`,
    );
    return null;
  }
  return match[1];
}

// THE definition of "this repo's cutover commit", shared by the re-run
// detection and by the undo: the most recent commit reachable from HEAD whose
// SUBJECT is exactly CUTOVER_SUBJECT. Deliberately not "HEAD is the cutover
// commit" — the reversibility condition the Proposal states is the state ref
// still pointing at the published baseline, and nothing about where HEAD
// happens to be; tying it to HEAD killed the escape hatch on the first ordinary
// commit or merge that landed after the cut.
//
// `--grep` only prefilters (it matches anywhere in a message, so a commit that
// merely quotes the subject would match); `cutoverBaselineAt` is what decides,
// on the subject line alone. Most recent wins: after an undo-and-re-cut the
// live cut is the newest one. A cutover that was already undone does not need
// its own marker — its baseline no longer exists, so the state-ref check below
// rejects it.
function findCutover(repoRoot, output, run) {
  const out = run(
    [
      'log',
      '--topo-order',
      '--first-parent',
      '--format=%H',
      '-F',
      `--grep=${CUTOVER_SUBJECT}`,
      'HEAD',
    ],
    repoRoot,
  );
  let found = null;
  for (const oid of out.split('\n').map((line) => line.trim())) {
    if (oid === '') continue;
    const baseline = cutoverBaselineAt(repoRoot, oid, output, run);
    if (baseline !== null && found === null) found = { oid, baseline };
  }
  return found;
}

// Both directions rewrite tracked files on the integration branch and commit
// them, so both demand the same two guarantees: nothing already staged (a
// commit here must contain exactly what this command produced, never someone
// else's staged work) and a ledger with no uncommitted edit (the source of
// truth being published is the COMMIT, so an unstaged edit would be silently
// dropped by the cut and destroyed by the cleanup).
function ledgerPathspecs(changeledgerDir, layout) {
  return [
    toPosix(path.relative(layout.topLevel, changeledgerDir)),
    ...layout.collections.map((collection) => collection.prefix.slice(0, -1)),
  ].filter((value, index, paths) => value !== '' && paths.indexOf(value) === index);
}

function assertCleanLedger(repoRoot, changeledgerDir, layout, operation, run) {
  const staged = run(['diff', '--cached', '--name-only'], repoRoot).trim();
  if (staged !== '') {
    throw new Error(
      `${operation} requires an empty index; commit or reset the staged changes first:\n${staged}`,
    );
  }
  const dirty = run(
    ['status', '--porcelain', '--', ...ledgerPathspecs(changeledgerDir, layout)],
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

function exactStagedCleanup(repoRoot, changeledgerDir, layout, run) {
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

  const ledgerPaths = ledgerPathspecs(changeledgerDir, layout);
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
  const recorded = findCutover(repoRoot, output, run);
  let tip = readStateRef(repoRoot, run);
  const activation = readActivation(repoRoot, run);
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
  if (activation === null) assertCleanLedger(repoRoot, changeledgerDir, layout, 'cutover', run);
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
    if (!exactStagedCleanup(repoRoot, changeledgerDir, layout, run)) {
      assertCleanLedger(repoRoot, changeledgerDir, layout, 'cutover', run);
    }
    commitCleanup(ctx, layout, tip);
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
  commitCleanup(ctx, layout, baseline);

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

function commitCleanup({ repoRoot }, layout, baseline) {
  const paths = layout.collections.map((c) => c.prefix.slice(0, -1));
  mutatingRun(['rm', '-r', '-q', '--ignore-unmatch', '--', ...paths], layout.topLevel);
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

  const found = findCutover(repoRoot, output, run);
  if (found === null) {
    throw new Error(
      `nothing to undo — no commit with the subject "${CUTOVER_SUBJECT}" is reachable from HEAD`,
    );
  }
  const { oid: cutoverCommit, baseline } = found;
  const tip = readStateRef(repoRoot, run);
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
  if (activation?.authority.state_ref === STATE_REF && completedUndo !== null) {
    if (!cleanupPathsUnchanged(repoRoot, completedUndo, layout, run)) {
      throw new Error(
        `the interrupted undo ${completedUndo} cannot be completed automatically — its restored ledger paths changed afterward; resolve that content by hand`,
      );
    }
    assertCleanLedger(repoRoot, changeledgerDir, layout, 'cutover --undo', run);
    deleteCutoverRefs(repoRoot, tip, activation.oid, run);
    output.log(`Undid the cutover — the ledger is back in the worktree, ${STATE_REF} deleted`);
    return 0;
  }
  assertCleanLedger(repoRoot, changeledgerDir, layout, 'cutover --undo', run);

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
