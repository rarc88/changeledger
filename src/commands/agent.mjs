// Agent-facing commands: safe mutations (status/log/task) and queries
// (list/show). Files remain the source of truth; these are optional helpers
// that inject correct timestamps/markers and validate transitions.

import fs from 'node:fs';
import path from 'node:path';
import { mutateFileAtomic } from '../atomic-write.mjs';
import { assertChildrenResolved, parseChange } from '../change.mjs';
import { mutateLedgerFile, repoIsActivated, writeLedgerFiles } from '../change-store.mjs';
import {
  assertApprovable,
  assertChangeTextValid,
  assertReviewable,
  introducedErrors,
  recordedBranch,
} from '../check.mjs';
import {
  changeIntegrationBranch,
  DEFAULT_SPECS_DIR,
  findChangeledgerDir,
  integrationBranch,
  renderChangeBranch,
  resolveRepoPath,
} from '../config.mjs';
import { assertSupportedSchema } from '../config-migration.mjs';
import {
  attributedCommitsIn,
  branchWorktree,
  capturedRun,
  changedPathsInRange,
  currentBranch,
  defaultBaseBranch,
  checkoutBranch as defaultCheckoutBranch,
  defaultRun as defaultGitRun,
  ownerHandle as defaultOwnerHandle,
  deleteMergedBranch,
  gitPrefix,
  gitTopLevel,
  isAncestor,
  mergeBases,
  refExists,
  uncommittedPaths,
} from '../git.mjs';
import { assertTransition, LOG_EVENT_DEFINITIONS, parseLogEvent } from '../lifecycle.mjs';
import { nowUtc } from '../paths.mjs';
import { assertNotShipped } from '../release.mjs';
import { loadRepo, resolveChange, resolveChangeInRepo } from '../repo.mjs';
import { snapshotUsage } from '../usage-collector.mjs';
import {
  appendLogEvent,
  setArchived,
  setBranch,
  setOwner,
  setStatus,
  setTask,
} from '../writer.mjs';
import { resolveRemote } from './sync.mjs';

// Locates a change and the ledger it lives in. Inactive: unchanged —
// `resolveChange` scans the worktree, tolerant of unrelated unparseable
// siblings (150231 CR6). Active: the document may not exist on disk at all,
// so it is resolved from the loaded repo's snapshot (`resolveChangeInRepo`),
// and the mutation target carries the state-tree relative path plus the text
// already read at `repo.state.revision` instead of a worktree file.
function locate(cwd, id) {
  const changeledgerDir = findChangeledgerDir(cwd);
  if (!changeledgerDir) throw new Error('Not a ChangeLedger repo. Run `changeledger init` first.');
  const repoRoot = path.dirname(changeledgerDir);

  if (repoIsActivated(repoRoot)) {
    const repo = loadRepo(cwd);
    assertSupportedSchema(repo.config);
    const change = resolveChangeInRepo(repo, id);
    const relPath = `changes/${change.name}`;
    return {
      config: repo.config,
      repoRoot: repo.repoRoot,
      repo,
      // `file` here is the written path callers return (CR9), not a
      // worktree location — `mutateLedgerFile`'s active branch never reads
      // it, only `target.relPath`/`target.text`; it decides its branch by
      // `repo.state`, not by this field's shape.
      target: { relPath, text: change.text, file: relPath },
      gitCwd: repo.repoRoot,
      name: change.name,
    };
  }

  const { config, file, repoRoot: rr } = resolveChange(cwd, id);
  assertSupportedSchema(config);
  return {
    config,
    repoRoot: rr,
    repo: { state: null, repoRoot: rr },
    target: { file },
    gitCwd: path.dirname(file),
    name: path.basename(file),
  };
}

// A configured branch name as the ref git reads. A short name follows the
// lookup order of gitrevisions(7), where `refs/<name>` and `refs/tags/<name>`
// come before `refs/heads/<name>`: `git tag dev main` made `dev` read as `main`
// (20261012-175147). The full ref names the branch only while it exists: with
// the branch absent git falls back to refs such as `refs/tags/refs/heads/<name>`
// or `refs/heads/refs/heads/<name>`, so the guard checks that the branch exists
// (`refExists`) before handing its full ref to git.
const branchRef = (name) => `refs/heads/${name}`;

function assertImplementationBranch(config, change, repoRoot, gitRun) {
  const expected = renderChangeBranch(config, change);
  if (expected === undefined) return;

  const current = currentBranch(repoRoot, gitRun);
  if (current !== expected) {
    throw new Error(
      `change #${change.id} must start on branch "${expected}" (current: ${current})`,
    );
  }

  // The base follows the change's role (`integrates_into`), so a release
  // change descends from `git.release_branch` (20261002-181346). An absent
  // base fails here too, before git can read its full ref through a ref such
  // as `refs/tags/refs/heads/<name>`.
  const baseline = changeIntegrationBranch(config, change);
  if (
    baseline &&
    !(
      refExists(repoRoot, branchRef(baseline), gitRun) &&
      isAncestor(repoRoot, branchRef(baseline), 'HEAD', gitRun)
    )
  ) {
    throw new Error(`branch "${expected}" must descend from integration branch "${baseline}"`);
  }

  // A change that integrates into another branch than `git.integration_branch`
  // (a release type) must not carry integration work that branch does not have
  // yet: when `dev` is ahead of `main`, a branch cut from `dev` still descends
  // from `main` and passes the check above (20261002-204623). The commits
  // reachable from both `HEAD` and a copy of the integration branch are exactly
  // the ancestors of their merge bases, so requiring each merge base (criss-cross
  // merges leave several) to be in `baseline` keeps the commits of that copy
  // shared with `HEAD` inside `baseline`. It does not inspect commits that are
  // only on `HEAD`, such as a cherry-picked copy of integration work. With no
  // merge base it fails closed, like the ancestry check above, and says the
  // branch shares no history with that copy: absent copies never reach it.
  const integration = integrationBranch(config);
  if (integration && integration !== baseline) {
    for (const { ref, name } of integrationCopies(integration, expected, repoRoot, gitRun)) {
      const bases = mergeBases(repoRoot, 'HEAD', ref, gitRun);
      if (bases.length === 0) {
        throw new Error(
          `branch "${expected}" cannot start: it shares no history with integration branch "${name}"`,
        );
      }
      if (!bases.every((base) => isAncestor(repoRoot, base, branchRef(baseline), gitRun))) {
        throw new Error(
          `branch "${expected}" contains commits of "${name}" that are not in "${baseline}"`,
        );
      }
    }
  }
}

// The copies of the integration branch the guard above compares, local first:
// the branch and, when the repo has a remote, its remote-tracking copy there,
// because a hotfix cut from `origin/dev` carried work the local `dev` lacked
// (20261012-175147). The remote is the one `sync` resolves; several remotes and
// none named `origin` fail closed rather than compare with the local copy
// alone. A copy counts as present only when a ref of exactly its full name
// exists, not when git resolves that name through another ref. A missing copy
// is skipped, since a remote need not publish the branch; with neither copy
// present it fails closed. It reads refs already in the repo and runs no fetch,
// so work pushed after the last fetch is not seen.
function integrationCopies(integration, expected, repoRoot, gitRun) {
  let remote;
  try {
    remote = resolveRemote(repoRoot, gitRun, `integration branch "${integration}"`);
  } catch (error) {
    throw new Error(`branch "${expected}" cannot start: ${error.message}`);
  }
  const copies = [{ ref: branchRef(integration), name: integration }];
  if (remote) {
    copies.push({ ref: `refs/remotes/${remote}/${integration}`, name: `${remote}/${integration}` });
  }
  const present = copies.filter(({ ref }) => refExists(repoRoot, ref, gitRun));
  if (present.length === 0) {
    throw new Error(
      `branch "${expected}" cannot start: integration branch "${integration}" does not exist locally — create it (e.g. from its remote-tracking copy) before starting`,
    );
  }
  return present;
}

// The pre-text guards of `status`: which destinations this actor may ask for at
// all, before any document is read. Each terminal or human-owned destination
// names the command that owns it, so a caller that is not a human — `apply`'s
// batch included — is told where the move actually belongs. `done` is not one
// of them: it means "delivered, pending human acceptance", which the agent
// owns — through `review pass` for a change whose branch touches code, and
// through this command for any other. Which of the two applies depends on the
// origin and on git, which no pre-text guard can read: `statusMutation`
// refuses the `in-review` one and the code-touching one.
export function assertStatusDestinationAllowed(config, newStatus, actor) {
  if (newStatus === 'discarded') {
    throw new Error(
      'to discard a change use `changeledger discard <id> "<reason>"` (a reason is required)',
    );
  }
  if (newStatus === 'approved' && actor !== 'human') {
    throw new Error(
      'only explicit human approval via the viewer or `changeledger approve` can approve',
    );
  }
  if (!(config.statuses ?? []).includes(newStatus)) {
    throw new Error(`Invalid status "${newStatus}". Valid: ${(config.statuses ?? []).join(', ')}`);
  }
}

// The whole text transform of `status`, lifted out of its `mutateLedgerFile`
// call so `apply` can run it against an accumulated candidate instead of a
// stored document. `warnings` is the caller's array — the branch-drift warning
// is collected, never thrown. `events`, when given, receives the transition
// this transform wrote, for the usage snapshot taken after the write lands.
// `reason` is the human's words when they send delivered work back; it is the
// only trace a rejection leaves now that acceptance is derived from the merge.
export function statusMutation(
  newStatus,
  {
    config,
    repoRoot,
    gitCwd,
    name,
    warnings,
    events,
    reason,
    changes,
    actor = 'human',
    channel = 'viewer',
  },
  {
    ownerHandle = defaultOwnerHandle,
    checkoutBranch = defaultCheckoutBranch,
    gitRun = capturedRun,
  } = {},
) {
  return (text) => {
    const fm = parseChange(text).frontmatter;
    // The only boundary of the return from `done`: a change already published
    // in a release cannot grow without making that version lie about what it
    // contains. Read through `loadRepo`, the ledger's own reader, so the answer
    // is the same in an activated repo and a worktree layout (CR21).
    if (fm.status === 'done' && newStatus === 'in-progress') {
      assertNotShipped(loadRepo(repoRoot).releases, fm.id);
    }
    // The exit from review belongs to the reviewer's verdict, never to the
    // generic seat. `in-review → done` is a legal edge of the graph — `review
    // pass` walks it — so the narrowing lives here, where the origin is known,
    // and covers every caller of this transform: the CLI, the viewer and
    // `apply`'s batch alike. Without it an agent delivers its own
    // code-touching work unreviewed and `check` sees nothing wrong
    // (20261018-131621 CR27).
    // An epic delivers when its children do. Checked before the transition so a
    // refusal leaves the document byte-for-byte unchanged, and read through
    // `loadRepo` for the same reason `assertNotShipped` is.
    // `changes` when the caller has a candidate in flight (`apply` resolves a
    // child and its epic in one manifest), the stored ledger otherwise. Reading
    // the store there would both refuse a batch that resolves the child first
    // and let one that creates a child in the same batch slip past.
    if (newStatus === 'done') {
      assertChildrenResolved(changes ?? siblingChanges(repoRoot), fm.id);
    }
    if (fm.status === 'in-review' && newStatus === 'done') {
      throw new Error(
        `the review verdict delivers a change in review: use \`changeledger review ${fm.id} pass\``,
      );
    }
    // Validate the move before any in-memory mutation, so an illegal transition
    // leaves the file byte-for-byte unchanged. A change reaches `done` from
    // `in-progress` only once git shows its branch touches nothing outside the
    // ledger (20261024-121022); an epic is never implemented and asks git
    // nothing.
    const kind = changeKind(fm);
    let touchesCode;
    if (kind === 'change' && fm.status === 'in-progress' && newStatus === 'done') {
      assertTouchesOnlyLedger(config, fm, repoRoot, gitRun);
      touchesCode = false;
    }
    assertTransition(fm.status, newStatus, { kind, touchesCode });

    // Enforceability guard (20260808-141944): the `branch` field is set once
    // and never rewritten (20260805-052741), so a later move to another branch
    // leaves it silently stale. Compare it against the real checkout on every
    // transition and surface a non-blocking warning — never rewrite, never
    // block: the move is legitimate, the invisibility is the defect. Only
    // meaningful when both values are known; checkoutBranch() returns '' for
    // detached HEAD, unborn branch or a failed subprocess, and there is
    // nothing to compare against an unset field.
    if (fm.branch) {
      const actualBranch = checkoutBranch(gitCwd);
      if (actualBranch && actualBranch !== fm.branch) {
        warnings.push(
          `change #${fm.id} records branch "${fm.branch}" but this checkout is on "${actualBranch}" — if the work moved, run: changeledger branch ${fm.id} ${actualBranch}`,
        );
      }
    }

    if (fm.status === 'approved' && newStatus === 'in-progress') {
      assertImplementationBranch(config, fm, repoRoot, gitRun);
    }
    // Entering review asserts a reviewable candidate exists: the implementer's
    // Specification and Plan, written in `in-progress` (20261023-181753 CR5).
    // Their own refusal comes first, so an empty Specification is named as
    // such instead of as the Plan's references to it.
    if (newStatus === 'in-review') {
      assertReviewable(text);
      assertChangeTextValid(config, name, text);
    }
    // Leaving draft asserts what the human approves exists: the objective and
    // the frontier (20261023-181753). `approved` is reachable only from
    // `draft`, so this is the single seat for the gate.
    if (newStatus === 'approved') {
      assertChangeTextValid(config, name, text);
      assertApprovable(text);
    }
    text = setStatus(text, newStatus);
    // The return from `done` is the only record a rejection leaves, and only a
    // human's counts as one: an agent sending its own delivery back is a second
    // pass, not a verdict. Stamp the actor so `rejectionCount` can tell them
    // apart instead of tallying both (20261018-131621 CR24).
    const detail =
      actor === 'human' &&
      channel === 'conversation' &&
      fm.status === 'draft' &&
      newStatus === 'approved'
        ? 'human via conversation'
        : fm.status === 'done' && newStatus === 'in-progress'
          ? actor
          : undefined;
    const at = nowUtc();
    text = appendLogEvent(text, {
      at,
      type: 'status',
      from: fm.status,
      to: newStatus,
      detail,
      reason,
    });

    // Work begins here: assign the owner from the local git identity unless one was
    // set explicitly (see change 20260614-124047). Resolution runs only when it is
    // actually needed — an assigned owner must never trigger the resolver's network
    // call just to discard the result (20260729-144812).
    if (newStatus === 'in-progress' && !fm.owner) {
      const autoOwner = ownerHandle(gitCwd);
      if (autoOwner) {
        text = setOwner(text, autoOwner);
        text = appendLogEvent(text, {
          at: nowUtc(),
          type: 'owner',
          owner: autoOwner,
          automatic: true,
        });
      }
    }

    // Same pattern as owner above (20260805-052741): record the real branch of
    // the checkout that starts the work, unless one is already set — manually
    // or from a previous in-progress entry. Resolution runs only when needed.
    if (newStatus === 'in-progress' && !fm.branch) {
      const autoBranch = checkoutBranch(gitCwd);
      if (autoBranch) {
        text = setBranch(text, autoBranch);
        text = appendLogEvent(text, {
          at: nowUtc(),
          type: 'branch',
          branch: autoBranch,
          automatic: true,
        });
      }
    }
    // Delivery gate for the types that never enter review, inherited verbatim
    // from the human-acceptance gate `done` used to sit behind: judge the
    // POST-flip text, because the rules that matter here (undone tasks, a Log
    // that does not reconstruct the frontmatter) only apply to a done change.
    if (newStatus === 'done') assertChangeTextValid(config, name, text);
    events?.push(transitionEvent(fm, 'status', fm.status, newStatus, at));
    return text;
  };
}

const changeKind = (fm) => (fm.type === 'epic' ? 'epic' : 'change');

// Throws unless git shows that the change touches only the ledger:
// `changes_dir`, `specs_dir` and `.changeledger/`. Two reads answer it: the
// range the branch introduced over its integration branch
// (`changedPathsInRange`), and the uncommitted paths of the worktree that has
// the branch checked out, wherever it is (`branchWorktree`, `uncommittedPaths`).
// Every doubt — no branch, a branch git does not have, the change's own commits
// already merged (the range left says nothing about what they carried), a
// failing git — refuses with its cause, because the direct route skips the
// independent review and a question git cannot answer must not read as
// "no code".
function assertTouchesOnlyLedger(config, fm, repoRoot, gitRun) {
  const verdictRoute = 'move it to in-review and record a verdict';
  const undecided = (cause) =>
    new Error(`cannot decide whether change ${fm.id} touches code: ${cause} — ${verdictRoute}`);
  const touching = (where, paths, route) => {
    const count = `${paths.length} ${paths.length === 1 ? 'path' : 'paths'}`;
    return new Error(
      `change ${fm.id} touches code outside the ledger${where} (${count}, e.g. ${paths[0]}): ${route}`,
    );
  };
  const head = fm.branch ?? renderChangeBranch(config, fm);
  if (!head) throw undecided('no branch recorded for it');
  let ledger;
  let committed;
  let uncommitted;
  try {
    const base = changeIntegrationBranch(config, fm) ?? detectedBaseBranch(repoRoot, gitRun);
    if (head === base) throw new Error(`branch "${head}" is the integration branch`);
    ledger = ledgerPrefixes(config, repoRoot, gitRun);
    const outsideLedger = (entry) => !ledger.some((prefix) => entry.startsWith(prefix));
    committed = changedPathsInRange(repoRoot, base, head, gitRun).filter(outsideLedger);
    if (committed.length === 0) {
      // The change's own commits, not ancestry: a branch with no commits of
      // its own is an ancestor of the integration branch too, and in the
      // activated layout that is a ledger-only change. Unmarked merged
      // history stays a residual the range alone judges.
      if (attributedCommitsIn(repoRoot, base, fm.id, gitRun).length > 0) {
        throw new Error(`its commits are already merged into "${base}"`);
      }
      // Uncommitted work is the change's only in the worktree holding its
      // branch, which need not be this checkout; checked out nowhere, the
      // branch has none.
      const worktree = branchWorktree(repoRoot, head, gitRun);
      uncommitted = worktree ? uncommittedPaths(worktree, gitRun).filter(outsideLedger) : [];
    }
  } catch (error) {
    throw undecided(error.message);
  }
  if (committed.length > 0) throw touching('', committed, verdictRoute);
  if (uncommitted.length > 0) {
    throw touching(' in uncommitted paths', uncommitted, `commit them, ${verdictRoute}`);
  }
}

// Without a declared `git.integration_branch` the base is the one
// `check --commits` detects; its own refusal names a flag of that command, so
// it is restated here.
function detectedBaseBranch(repoRoot, gitRun) {
  try {
    return defaultBaseBranch(repoRoot, gitRun);
  } catch {
    throw new Error(
      'git.integration_branch is not declared and no default branch (origin/HEAD, main or master) exists',
    );
  }
}

// The ledger directories as git reports paths: relative to its top-level and
// slash-separated, each ending in `/` so a sibling sharing the name as a string
// prefix (`specs-old/` beside `specs/`) is not taken for it. The configured
// dirs pass the containment guard and are normalised in the filesystem's own
// coordinates; only the repo root's prefix comes from git (`gitPrefix`), so
// Windows separators never meet git's.
function ledgerPrefixes(config, repoRoot, gitRun) {
  const prefix = gitPrefix(fs.realpathSync(repoRoot), gitTopLevel(repoRoot, gitRun), gitRun);
  const dirs = [
    ['changes_dir', config.changes_dir],
    ['specs_dir', config.specs_dir ?? DEFAULT_SPECS_DIR],
    ['ledger', '.changeledger'],
  ];
  return dirs.map(([field, configured]) => {
    const relative = path
      .relative(repoRoot, resolveRepoPath(repoRoot, configured, field))
      .split(path.sep)
      .join('/');
    if (relative === '') throw new Error(`${field} "${configured}" resolves to the repo root`);
    return `${prefix}${relative}/`;
  });
}

// The usage snapshot's view of one written Log transition (20261001-155612).
function transitionEvent(fm, event, from, to, at) {
  return { change: String(fm.id), event, from, to, at };
}

export function status(
  id,
  newStatus,
  cwd = process.cwd(),
  {
    ownerHandle = defaultOwnerHandle,
    checkoutBranch = defaultCheckoutBranch,
    gitRun = capturedRun,
    actor = 'human',
    channel = 'viewer',
    reason,
    usage,
  } = {},
) {
  const { config, repo, target, repoRoot, gitCwd, name } = locate(cwd, id);
  const warnings = [];
  const events = [];
  assertStatusDestinationAllowed(config, newStatus, actor);
  mutateLedgerFile(
    repo,
    target,
    statusMutation(
      newStatus,
      { config, repoRoot, gitCwd, name, warnings, events, reason, actor, channel },
      { ownerHandle, checkoutBranch, gitRun },
    ),
    { message: `status: ${id} → ${newStatus}` },
  );
  snapshotUsage({ repoRoot, events, usage });
  return { file: target.file, warnings };
}

// Transmits an explicit human approval received through the host conversation.
// The lifecycle guard remains owned by status(); this only selects attribution.
export function approve(id, cwd = process.cwd(), { usage } = {}) {
  return status(id, 'approved', cwd, { actor: 'human', channel: 'conversation', usage });
}

// Records the verdict of the independent review (run by a delegated subagent
// with clean context — see `changeledger context review`). `pass` delivers the
// change to `done`; `fail` routes it back to `in-progress` with its reason.
// The failure class belongs in that reason, not in a flag. Requires the change
// to be in-review.
// The children lookup reads the whole ledger, so one unparseable document
// elsewhere must not cost a lifecycle move that has nothing to do with it
// (150231 CR6). `check` is the seat that reports the broken file.
function siblingChanges(repoRoot) {
  return loadRepo(repoRoot, { isolateChangeErrors: true }).changes;
}

export function review(id, verdict, { reason } = {}, cwd = process.cwd(), { usage } = {}) {
  const { config, repo, target, name, repoRoot } = locate(cwd, id);
  const events = [];
  mutateLedgerFile(
    repo,
    target,
    (text) => {
      const fm = parseChange(text).frontmatter;
      const current = fm.status;
      if (current !== 'in-review') {
        throw new Error(`review requires status in-review (current: ${current})`);
      }
      // Validate before any mutation, same contract as status()/discard():
      // assertTransition is the single lifecycle authority, even though both
      // in-review edges are legal today (the graph's two in-review
      // destinations mirror review()'s two verdicts by design).
      const opts = { kind: changeKind(fm) };

      const at = nowUtc();
      let to;
      if (verdict === 'pass') {
        // `review pass` is the second write seat for `done`, and the only one a
        // code-touching change can reach: `statusMutation`'s guard never runs
        // for it. The scoped validation below cannot stand in — it judges a
        // one-change repo, where a parent has no visible children
        // (20261020-172221 D1).
        assertChildrenResolved(siblingChanges(repoRoot), fm.id);
        assertTransition(current, 'done', opts);
        to = 'done';
        text = setStatus(text, 'done');
        text = appendLogEvent(text, {
          at,
          type: 'review',
          from: 'in-review',
          to: 'done',
          detail: 'delegated subagent, clean context',
        });
        // Same delivery gate `status` applies to the no-review route, and the
        // one human acceptance used to apply here: a `done` document cannot
        // carry defects the repo's own rules reject.
        assertChangeTextValid(config, name, text);
      } else if (verdict === 'fail') {
        if (!reason) {
          throw new Error('fail requires a reason — changeledger review <id> fail "<reason>"');
        }
        assertTransition(current, 'in-progress', opts);
        to = 'in-progress';
        text = setStatus(text, 'in-progress');
        text = appendLogEvent(text, {
          at,
          type: 'review',
          from: 'in-review',
          to: 'in-progress',
          reason,
        });
      } else {
        throw new Error(`Unknown review verdict "${verdict}" (use pass|fail)`);
      }

      events.push(transitionEvent(fm, 'review', 'in-review', to, at));
      return text;
    },
    { message: `review: ${id} ${verdict}` },
  );
  snapshotUsage({ repoRoot, events, usage });
  return target.file;
}

// Text transform of `owner`, lifted out for the same reason as
// `statusMutation`: `apply` runs it against an accumulated candidate.
export function ownerMutation(next) {
  return (text) => {
    text = setOwner(text, next);
    return appendLogEvent(text, { at: nowUtc(), type: 'owner', owner: next });
  };
}

// name '-' clears the owner.
export function owner(id, name, cwd = process.cwd()) {
  const { repo, target } = locate(cwd, id);
  const next = name === '-' ? null : name;
  mutateLedgerFile(repo, target, ownerMutation(next), {
    message: `owner: ${id} ${next ?? '-'}`,
  });
  return target.file;
}

// Explicit correction for the branch auto-assigned at in-progress (20260805-052741):
// covers a rename or a cherry-pick to another branch, which the auto-assignment
// never detects on its own. name '-' clears the branch.
export function branch(id, name, cwd = process.cwd()) {
  const { repo, target } = locate(cwd, id);
  const next = name === '-' ? null : name;
  mutateLedgerFile(
    repo,
    target,
    (text) => {
      text = setBranch(text, next);
      return appendLogEvent(text, { at: nowUtc(), type: 'branch', branch: next });
    },
    { message: `branch: ${id} ${next ?? '-'}` },
  );
  return target.file;
}

// Discards a change: a terminal lifecycle move that keeps the file and its
// reasoning instead of deleting it. The reason is mandatory and recorded in the
// Log; the transition graph rejects discarding a done or in-review change.
export function discard(id, reason, cwd = process.cwd(), { usage } = {}) {
  if (!reason) {
    throw new Error('discard requires a reason — changeledger discard <id> "<reason>"');
  }
  const { repo, target, repoRoot } = locate(cwd, id);
  const events = [];
  mutateLedgerFile(
    repo,
    target,
    (text) => {
      const fm = parseChange(text).frontmatter;
      // Validate before any mutation so an illegal discard leaves the file untouched.
      assertTransition(fm.status, 'discarded', { kind: changeKind(fm) });
      text = setStatus(text, 'discarded');
      const at = nowUtc();
      text = appendLogEvent(text, {
        at,
        type: 'status',
        from: fm.status,
        to: 'discarded',
        reason,
      });
      events.push(transitionEvent(fm, 'status', fm.status, 'discarded', at));
      return text;
    },
    { message: `discard: ${id}` },
  );
  snapshotUsage({ repoRoot, events, usage });
  return target.file;
}

// Everything the branch deletion needs, resolved inside one try: a change whose
// `integrates_into` names a retired `git.release_branch` makes
// `changeIntegrationBranch` throw, and that must never cost an archive that has
// already landed. Terminal changes are history (20261012-174310).
function pruneChangeBranch(repoRoot, config, change, gitRun) {
  // A live change still owns its branch. `archived` only hides a document in
  // the viewer and says nothing about the work being over, so archiving one
  // mid-flight must not delete the branch its next lifecycle command will
  // demand — a merge base proves nothing here, a branch with no commits of its
  // own is trivially merged (20261020-172221 D4).
  const status = change.frontmatter?.status;
  if (!['done', 'discarded'].includes(status)) {
    return `the change is ${status}, not done or discarded`;
  }
  try {
    return deleteMergedBranch(
      repoRoot,
      recordedBranch(change),
      changeIntegrationBranch(config, change.frontmatter),
      renderChangeBranch(config, change.frontmatter ?? {}),
      gitRun ?? defaultGitRun,
    );
  } catch (error) {
    return `the branch could not be resolved (${error.message})`;
  }
}

export function archive(id, cwd = process.cwd(), { keepBranch = false, gitRun } = {}) {
  const { repo, target, config, repoRoot } = locate(cwd, id);
  // Read through `locate`'s own target, the one seat that answers in both
  // layouts: an activated repo carries the text, a worktree one the path.
  const change = parseChange(target.text ?? fs.readFileSync(target.file, 'utf8'));
  mutateLedgerFile(
    repo,
    target,
    (text) => {
      text = setArchived(text, true);
      return appendLogEvent(text, { at: nowUtc(), type: 'archive' });
    },
    { message: `archive: ${id}` },
  );
  // After the ledger write, never before: the archive is the point of this
  // command and a branch that cannot be deleted must not cost it.
  const branch = recordedBranch(change);
  const branchOutcome = keepBranch
    ? 'kept on request'
    : pruneChangeBranch(repoRoot, config, change, gitRun);
  return { file: target.file, branch, branchOutcome };
}

function assertOwnerFilter({ owner: byOwner, unowned = false } = {}) {
  if (byOwner !== undefined && unowned) {
    throw new Error('--owner and --unowned are mutually exclusive');
  }
}

function matchesOwner(c, { owner: byOwner, unowned = false } = {}) {
  if (byOwner !== undefined && c.frontmatter.owner !== byOwner) return false;
  if (unowned && c.frontmatter.owner != null) return false;
  return true;
}

export function isPendingGraduation(c) {
  return c.frontmatter.status === 'done' && c.frontmatter.reviewed !== true;
}

export function selectArchivableGraduated(changes, filters = {}) {
  assertOwnerFilter(filters);
  return changes.filter((c) => isArchivableGraduated(c) && matchesOwner(c, filters));
}

// Archives every change the filters select. Inactive: one write per file,
// same as before — order and cross-file atomicity were never guaranteed
// here. Active: every write is staged first (each transform re-checked
// against the text it would actually see, exactly as the per-file loop
// would) and landed in exactly one CAS commit, since `repo.state.revision`
// is fixed at load time and a per-file `mutateLedgerFile` sequence would
// stale-conflict on its own second write.
export function archiveGraduated(filters = {}, cwd = process.cwd()) {
  const repo = loadRepo(cwd);
  assertSupportedSchema(repo.config);
  const selected = selectArchivableGraduated(repo.changes, filters);

  if (repo.state) {
    const entries = [];
    for (const c of selected) {
      const current = { ...parseChange(c.text), text: c.text };
      if (!isArchivableGraduated(current) || !matchesOwner(current, filters)) continue;
      let text = setArchived(c.text, true);
      text = appendLogEvent(text, { at: nowUtc(), type: 'archive' });
      entries.push({ relPath: `changes/${c.name}`, text });
    }
    if (entries.length) {
      writeLedgerFiles(repo, entries, {
        message: `archive: ${selected.map((c) => c.frontmatter.id).join(', ')}`,
      });
    }
  } else {
    for (const c of selected) {
      mutateFileAtomic(c.file, (text) => {
        const current = { ...parseChange(text), text };
        if (!isArchivableGraduated(current) || !matchesOwner(current, filters)) return undefined;
        text = setArchived(text, true);
        return appendLogEvent(text, { at: nowUtc(), type: 'archive' });
      });
    }
  }

  return selected.map((c) => ({
    id: c.frontmatter.id,
    title: c.frontmatter.title,
    // `c.file` is `null` in active mode (`repo.changes` never carries a
    // worktree path there, per `repo.mjs`'s `loadActiveContent`) — CR9
    // wants the written path in both modes, never `null`/`undefined`.
    file: c.file ?? `changes/${c.name}`,
  }));
}

function isArchivableGraduated(c) {
  return (
    c.frontmatter.status === 'done' &&
    c.frontmatter.reviewed === true &&
    c.frontmatter.archived !== true &&
    hasGraduationResolution(c)
  );
}

function hasGraduationResolution(c) {
  const logBody = c.stages.find((s) => s.key === 'log')?.body ?? '';
  return logBody.split('\n').some((line) => parseLogEvent(line)?.type === 'graduation');
}

// Text transform of `log` — see `statusMutation` for why it is a seat.
export function logMutation(message) {
  return (text) => appendLogEvent(text, { at: nowUtc(), type: 'note', message });
}

export function log(id, message, cwd = process.cwd()) {
  const { repo, target } = locate(cwd, id);
  mutateLedgerFile(repo, target, logMutation(message), { message: `log: ${id}` });
  return target.file;
}

// The findings of one Log in order: an open line takes the next ordinal, and a
// later resolution naming an open ordinal resolves it. The ordinal is never
// written on the open line (20261024-202659), so it is derived here.
function findingsInLog(logBody) {
  const findings = [];
  for (const line of logBody.split('\n')) {
    const event = parseLogEvent(line);
    if (event?.type !== 'finding') continue;
    if (event.outcome === 'open') {
      findings.push({ n: findings.length + 1, text: event.text, at: event.at, resolution: null });
      continue;
    }
    const finding = findings[event.n - 1];
    if (finding && !finding.resolution) finding.resolution = event;
  }
  return findings;
}

const logBodyOf = (c) => c.stages.find((s) => s.key === 'log')?.body ?? '';

// Text transform of `finding <id> "<text>"` — see `statusMutation` for why it
// is a seat.
export function recordFindingMutation(text) {
  if (String(text ?? '').trim() === '') throw new Error('finding text must not be empty');
  if (LOG_EVENT_DEFINITIONS.finding.parse(text)?.outcome !== 'open') {
    throw new Error(
      `finding text "${text}" reads as a resolution; resolve a finding with changeledger finding <id> <n> promote|drop`,
    );
  }
  return (current) =>
    appendLogEvent(current, { at: nowUtc(), type: 'finding', outcome: 'open', text });
}

// Text transform of `finding <id> <n> promote|drop` over the change `id`.
// `assertTarget` resolves a promotion's target in the ledger the write lands in.
export function resolveFindingMutation(id, n, outcome, value, assertTarget = () => {}) {
  if (!/^[1-9]\d*$/.test(String(n))) {
    throw new Error(`finding ordinal must be a positive integer (got "${n}")`);
  }
  const ordinal = Number(n);
  if (outcome !== 'promote' && outcome !== 'drop') {
    throw new Error(`Unknown finding resolution "${outcome}" (use promote|drop)`);
  }
  if (String(value ?? '').trim() === '') {
    throw new Error(
      outcome === 'drop'
        ? 'drop requires a reason'
        : 'promote requires the id of the change it becomes',
    );
  }
  return (current) => {
    const finding = findingsInLog(logBodyOf(parseChange(current)))[ordinal - 1];
    if (!finding) throw new Error(`change #${id} has no finding F${ordinal}`);
    const { resolution } = finding;
    if (resolution?.outcome === 'promoted') {
      throw new Error(`finding F${ordinal} of #${id} is already promoted to #${resolution.target}`);
    }
    if (resolution?.outcome === 'dropped') {
      throw new Error(`finding F${ordinal} of #${id} is already dropped`);
    }
    const at = nowUtc();
    if (outcome === 'drop') {
      return appendLogEvent(current, {
        at,
        type: 'finding',
        outcome: 'dropped',
        n: ordinal,
        reason: value,
      });
    }
    if (String(value) === String(id)) {
      throw new Error(`finding F${ordinal} cannot be promoted to its own change #${id}`);
    }
    assertTarget(value);
    return appendLogEvent(current, {
      at,
      type: 'finding',
      outcome: 'promoted',
      n: ordinal,
      target: value,
    });
  };
}

export function recordFinding(id, text, cwd = process.cwd()) {
  const mutate = recordFindingMutation(text);
  const { repo, target } = locate(cwd, id);
  const after = mutateLedgerFile(repo, target, mutate, { message: `finding: ${id}` });
  return { file: target.file, n: findingsInLog(logBodyOf(parseChange(after))).length };
}

export function resolveFinding(id, n, outcome, value, cwd = process.cwd()) {
  const { repo, target, repoRoot } = locate(cwd, id);
  const assertTarget = (targetId) =>
    repo.state ? resolveChangeInRepo(repo, targetId) : resolveChange(repoRoot, targetId);
  mutateLedgerFile(repo, target, resolveFindingMutation(id, n, outcome, value, assertTarget), {
    message: `finding: ${id}`,
  });
  return target.file;
}

// Text transform of `task` — see `statusMutation` for why it is a seat.
export function taskMutation(action, n, reason) {
  return (text) => {
    if (action === 'done') return setTask(text, n, 'done', { iso: nowUtc() });
    if (action === 'block') return setTask(text, n, 'blocked', { reason });
    throw new Error(`Unknown task action "${action}" (use done|block)`);
  };
}

// The transform does not consult the change's status, so the document it
// produces is judged here by the rule `apply` runs on its candidate: the
// `check` errors the write introduces refuse it, the ones the repo already
// carried do not (20261023-094931). Blocking the only task of a `done` change
// used to land here while the same manifest entry was refused. The worktree
// layout gets a loaded repo to diff against, isolated like `siblingChanges` so
// an unparseable sibling does not cost a mark on another change.
export function task(id, action, n, reason, cwd = process.cwd()) {
  const { repo, target, repoRoot } = locate(cwd, id);
  const loaded = repo.state ? repo : loadRepo(repoRoot, { isolateChangeErrors: true });
  const mutate = taskMutation(action, n, reason);
  mutateLedgerFile(
    repo,
    target,
    (text) => {
      const next = mutate(text);
      assertTaskCandidateClean(loaded, id, next, `task ${id} ${n} ${action}`);
      return next;
    },
    { message: `task: ${id} ${n} ${action}` },
  );
  return target.file;
}

// Shaped like `apply`'s `assertCandidateClean`, naming this seat instead.
function assertTaskCandidateClean(repo, id, text, subject) {
  const changes = repo.changes.map((c) =>
    String(c.frontmatter.id) === String(id) ? { ...c, text, ...parseChange(text) } : c,
  );
  const errors = introducedErrors(repo, { ...repo, changes });
  if (!errors.length) return;
  throw new Error(
    `${subject} refused, nothing was written — the resulting candidate carries ${errors.length} validation error(s):\n${errors
      .map((e) => `  ${e.file}: ${e.message}`)
      .join('\n')}`,
  );
}

const PENDING_KINDS = ['graduation', 'archive', 'findings'];

// The open findings of `changes` as rows, ordered by origin id then ordinal.
export function openFindings(changes) {
  return [...changes]
    .sort((a, b) => String(a.frontmatter.id).localeCompare(String(b.frontmatter.id)))
    .flatMap((c) =>
      findingsInLog(logBodyOf(c))
        .filter((f) => !f.resolution)
        .map((f) => ({ id: c.frontmatter.id, n: f.n, text: f.text, at: f.at })),
    );
}

export function list(
  {
    status: byStatus,
    type: byType,
    owner: byOwner,
    unowned = false,
    parent: byParent,
    pending,
    archived = false,
    all = false,
  } = {},
  cwd = process.cwd(),
) {
  assertOwnerFilter({ owner: byOwner, unowned });
  if (archived && all) throw new Error('--archived and --all are mutually exclusive');
  if (pending && !PENDING_KINDS.includes(pending)) {
    throw new Error(`Invalid --pending "${pending}". Valid: ${PENDING_KINDS.join(', ')}`);
  }

  let candidates = loadRepo(cwd).changes;
  if (pending === 'archive') {
    candidates = selectArchivableGraduated(candidates, { owner: byOwner, unowned });
  }

  // Findings live in closed changes too, so `--pending findings` sees archived
  // origins without --all (20261024-202659).
  const visible = (fm) => {
    if (archived) return fm.archived === true;
    return all || pending === 'findings' || fm.archived !== true;
  };
  const selected = candidates.filter((c) => {
    const fm = c.frontmatter;
    if (!visible(fm)) return false;
    if (byStatus && fm.status !== byStatus) return false;
    if (byType && fm.type !== byType) return false;
    if (byOwner !== undefined && fm.owner !== byOwner) return false;
    if (unowned && fm.owner != null) return false;
    if (byParent !== undefined && String(fm.parent ?? '') !== String(byParent)) return false;
    if (pending === 'graduation' && !isPendingGraduation(c)) return false;
    return true;
  });
  if (pending === 'findings') return openFindings(selected);

  return selected.map((c) => ({
    id: c.frontmatter.id,
    title: c.frontmatter.title,
    type: c.frontmatter.type,
    status: c.frontmatter.status,
    owner: c.frontmatter.owner ?? null,
    branch: c.frontmatter.branch ?? null,
    archived: c.frontmatter.archived === true,
    parent: c.frontmatter.parent ?? null,
    progress: c.progress,
  }));
}

export function show(id, cwd = process.cwd()) {
  const changes = loadRepo(cwd).changes;
  const c = changes.find((x) => String(x.frontmatter.id) === String(id));
  if (!c) throw new Error(`No change with id "${id}"`);
  // An epic's own document says nothing about its children — they name it, not
  // the other way round, which is what keeps the edge exclusive. So the only
  // place the grouping becomes visible is here, derived at read time.
  const children = changes
    .filter((x) => String(x.frontmatter.parent ?? '') === String(id))
    .map((x) => ({
      id: x.frontmatter.id,
      title: x.frontmatter.title,
      status: x.frontmatter.status,
      // `list --parent` hides an archived child by default, so a reader
      // comparing the two seats would see this one appear and vanish. Same
      // rule `childrenOpenError` already applies (20261020-172221 D3b).
      archived: x.frontmatter.archived === true,
    }));
  return {
    id: c.frontmatter.id,
    frontmatter: c.frontmatter,
    stages: c.stages,
    tasks: c.tasks,
    progress: c.progress,
    children,
  };
}
