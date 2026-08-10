// Agent-facing commands: safe mutations (status/log/task) and queries
// (list/show). Files remain the source of truth; these are optional helpers
// that inject correct timestamps/markers and validate transitions.

import fs from 'node:fs';
import path from 'node:path';
import { mutateFileAtomic, withFileLock } from '../atomic-write.mjs';
import { parseChange } from '../change.mjs';
import { mutateLedgerFile, repoIsActivated, writeLedgerFiles } from '../change-store.mjs';
import { assertChangeTextValid, assertStagesNotEmpty } from '../check.mjs';
import { findChangeledgerDir, integrationBranch, renderChangeBranch } from '../config.mjs';
import { assertSupportedSchema } from '../config-migration.mjs';
import {
  currentBranch,
  checkoutBranch as defaultCheckoutBranch,
  defaultRun as defaultGitRun,
  ownerHandle as defaultOwnerHandle,
  isAncestor,
} from '../git.mjs';
import { assertTransition, parseLogEvent } from '../lifecycle.mjs';
import { nowUtc } from '../paths.mjs';
import { resolveReleasesDir } from '../release.mjs';
import { loadRepo, resolveChange, resolveChangeInRepo } from '../repo.mjs';
import {
  appendLogEvent,
  setArchived,
  setBranch,
  setOwner,
  setStatus,
  setTask,
} from '../writer.mjs';

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

function assertImplementationBranch(config, change, repoRoot, gitRun) {
  const expected = renderChangeBranch(config, change);
  if (expected === undefined) return;

  const current = currentBranch(repoRoot, gitRun);
  if (current !== expected) {
    throw new Error(
      `change #${change.id} must start on branch "${expected}" (current: ${current})`,
    );
  }

  const baseline = integrationBranch(config);
  if (baseline && !isAncestor(repoRoot, baseline, 'HEAD', gitRun)) {
    throw new Error(`branch "${expected}" must descend from integration branch "${baseline}"`);
  }
}

export function status(
  id,
  newStatus,
  cwd = process.cwd(),
  {
    ownerHandle = defaultOwnerHandle,
    checkoutBranch = defaultCheckoutBranch,
    gitRun = defaultGitRun,
    actor = 'human',
    channel = 'viewer',
  } = {},
) {
  const { config, repo, target, repoRoot, gitCwd, name } = locate(cwd, id);
  const warnings = [];
  if (newStatus === 'discarded') {
    throw new Error(
      'to discard a change use `changeledger discard <id> "<reason>"` (a reason is required)',
    );
  }
  if (newStatus === 'done') {
    throw new Error('to complete a change use human validation in the viewer or conversation');
  }
  if (newStatus === 'approved' && actor !== 'human') {
    throw new Error(
      'only explicit human approval via the viewer or `changeledger approve` can approve',
    );
  }
  if (!(config.statuses ?? []).includes(newStatus)) {
    throw new Error(`Invalid status "${newStatus}". Valid: ${(config.statuses ?? []).join(', ')}`);
  }
  mutateLedgerFile(
    repo,
    target,
    (text) => {
      const fm = parseChange(text).frontmatter;
      if (fm.status === 'done' && newStatus === 'in-progress') {
        throw new Error('to reopen a done change use `changeledger reopen <id> "<reason>"`');
      }
      // Validate the move before any in-memory mutation, so an illegal transition
      // leaves the file byte-for-byte unchanged. The review gate reads review_required
      // from the change's type.
      assertTransition(fm.status, newStatus, {
        type: fm.type,
        reviewRequired: Boolean(config.types?.[fm.type]?.review_required),
      });

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
      // Entering review asserts a reviewable candidate exists (20260722-124656 CR3).
      // Validate the document as it still stands, before the status flip: readiness
      // defects are errors only while the change is pre-review, so checking the
      // post-flip text would silently exempt the very candidate under judgment.
      if (newStatus === 'in-review') assertChangeTextValid(config, name, text);
      // Leaving draft asserts a ready candidate exists (20260729-185200 CR1). Same
      // shape as the in-review gate — validate the pre-flip text — but the severity
      // has to be projected: a draft's readiness and coverage diagnostics are
      // warnings precisely because it is a draft, so judging the text as it stands
      // would exempt every defect the approval is supposed to catch. `approved` is
      // reachable only from `draft`, so this is the single seat for the gate.
      if (newStatus === 'approved') {
        assertChangeTextValid(config, name, text, { asStatus: 'approved' });
        // Emptiness of an active stage's body is a defect coverage checks alone
        // cannot see — an empty Specification declares no criteria, so nothing
        // references an unknown one and nothing goes uncovered (real incident:
        // 20260810-181801). Transition-scoped on purpose; see assertStagesNotEmpty.
        assertStagesNotEmpty(config, text);
      }
      text = setStatus(text, newStatus);
      const detail =
        actor === 'human' &&
        channel === 'conversation' &&
        fm.status === 'draft' &&
        newStatus === 'approved'
          ? 'human via conversation'
          : undefined;
      text = appendLogEvent(text, {
        at: nowUtc(),
        type: 'status',
        from: fm.status,
        to: newStatus,
        detail,
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
      return text;
    },
    { message: `status: ${id} → ${newStatus}` },
  );
  return { file: target.file, warnings };
}

// Transmits an explicit human approval received through the host conversation.
// The lifecycle guard remains owned by status(); this only selects attribution.
export function approve(id, cwd = process.cwd()) {
  return status(id, 'approved', cwd, { actor: 'human', channel: 'conversation' });
}

// Records the verdict of the independent review (run by a delegated subagent
// with clean context — see `changeledger context review`). `pass` advances to human validation;
// `fail` routes it back: `retry` for a defect inside the contract (the
// implementer fixes), `block` for one that escalates to a human. Requires the
// change to be in-review.
export function review(id, verdict, { mode, reason } = {}, cwd = process.cwd()) {
  const { config, repo, target } = locate(cwd, id);
  mutateLedgerFile(
    repo,
    target,
    (text) => {
      const fm = parseChange(text).frontmatter;
      const current = fm.status;
      if (current !== 'in-review') {
        throw new Error(`review requires status in-review (current: ${current})`);
      }
      // Validate before any mutation, same contract as status()/validation()/
      // discard()/reopen(): assertTransition is the single lifecycle authority,
      // even though every in-review edge is legal today (the graph's three
      // in-review destinations mirror review()'s three outcomes by design).
      const opts = {
        type: fm.type,
        reviewRequired: Boolean(config.types?.[fm.type]?.review_required),
      };

      if (verdict === 'pass') {
        assertTransition(current, 'in-validation', opts);
        text = setStatus(text, 'in-validation');
        text = appendLogEvent(text, {
          at: nowUtc(),
          type: 'review',
          from: 'in-review',
          to: 'in-validation',
          detail: 'delegated subagent, clean context',
        });
      } else if (verdict === 'fail') {
        if (!reason) {
          throw new Error(
            'fail requires a reason — changeledger review <id> fail --retry|--block "<reason>"',
          );
        }
        if (mode === 'retry') {
          assertTransition(current, 'in-progress', opts);
          text = setStatus(text, 'in-progress');
          text = appendLogEvent(text, {
            at: nowUtc(),
            type: 'review',
            from: 'in-review',
            to: 'in-progress',
            detail: 'retry',
            reason,
          });
        } else if (mode === 'block') {
          assertTransition(current, 'blocked', opts);
          text = setStatus(text, 'blocked');
          text = appendLogEvent(text, {
            at: nowUtc(),
            type: 'review',
            from: 'in-review',
            to: 'blocked',
            reason,
          });
        } else {
          throw new Error('fail requires --retry or --block');
        }
      } else {
        throw new Error(`Unknown review verdict "${verdict}" (use pass|fail)`);
      }

      return text;
    },
    { message: `review: ${id} ${verdict}` },
  );
  return target.file;
}

// Records a validation verdict while keeping the deciding actor and interaction
// channel explicit. Viewer and conversation share every lifecycle/check guard.
export function validation(
  id,
  verdict,
  { reason, actor = 'human', channel = 'viewer' } = {},
  cwd = process.cwd(),
) {
  const { config, repo, target, name } = locate(cwd, id);
  mutateLedgerFile(
    repo,
    target,
    (text) => {
      const fm = parseChange(text).frontmatter;
      const current = fm.status;
      let to;
      if (verdict === 'pass') {
        to = 'done';
      } else if (verdict === 'fail') {
        if (!String(reason ?? '').trim()) throw new Error('validation fail requires a reason');
        to = 'in-progress';
      } else {
        throw new Error(`Unknown validation verdict "${verdict}" (use pass|fail)`);
      }
      if (current !== 'in-validation') {
        throw new Error(`validation requires status in-validation (current: ${current})`);
      }
      assertTransition(current, to, {
        type: fm.type,
        reviewRequired: Boolean(config.types?.[fm.type]?.review_required),
      });
      text = setStatus(text, to);
      const detail =
        verdict === 'pass'
          ? channel === 'conversation'
            ? 'human accepted via conversation'
            : 'human accepted'
          : channel === 'conversation' && actor === 'human'
            ? 'human rejected via conversation'
            : `${actor} rejected`;
      text = appendLogEvent(text, {
        at: nowUtc(),
        type: 'validation',
        from: 'in-validation',
        to,
        detail,
        reason: verdict === 'fail' ? reason : undefined,
      });
      if (verdict === 'pass') assertChangeTextValid(config, name, text);
      return text;
    },
    { message: `validation: ${id} ${verdict}` },
  );
  return target.file;
}

// Correction path while `done` is still provisional. Graduation,
// skip, archive and release membership are durable boundaries and fail closed.
function reopenMutation({ config, actor, reason, released }) {
  return (text) => {
    const change = { ...parseChange(text), text };
    const fm = change.frontmatter;
    if (fm.status !== 'done')
      throw new Error(`reopen requires status done (current: ${fm.status})`);
    if (fm.reviewed === true) throw new Error('cannot reopen: graduation is already reviewed');
    if (hasGraduationResolution(change))
      throw new Error('cannot reopen: graduation is already resolved');
    if (fm.archived === true) throw new Error('cannot reopen: change is archived');
    if (released) throw new Error('cannot reopen: change belongs to a recorded release');
    assertTransition('done', 'in-progress', {
      type: fm.type,
      reviewRequired: Boolean(config.types?.[fm.type]?.review_required),
    });
    text = setStatus(text, 'in-progress');
    return appendLogEvent(text, {
      at: nowUtc(),
      type: 'status',
      from: 'done',
      to: 'in-progress',
      detail: `${actor} reopened`,
      reason,
    });
  };
}

export function reopen(id, reason, cwd = process.cwd(), { actor = 'human' } = {}) {
  if (!String(reason ?? '').trim()) throw new Error('reopen requires a reason');
  const { config, repo, target, repoRoot } = locate(cwd, id);

  // Active: the released-check/write pair needs no worktree lock — any
  // concurrent write (a release included) advances the state ref, so the
  // write below's CAS on `repo.state.revision` (captured by `locate()`
  // before this check) conflicts on its own. A lock file here would touch
  // the worktree for no protection this repo doesn't already have.
  if (repo.state) {
    const released = loadRepo(cwd).releases.some((release) =>
      (release.changes ?? []).some((changeId) => String(changeId) === String(id)),
    );
    mutateLedgerFile(repo, target, reopenMutation({ config, actor, reason, released }), {
      message: `reopen: ${id}`,
    });
    return target.file;
  }

  const releasesDir = resolveReleasesDir(repoRoot);
  fs.mkdirSync(releasesDir, { recursive: true });
  return withFileLock(path.join(releasesDir, '.history'), () => {
    const released = loadRepo(cwd).releases.some((release) =>
      (release.changes ?? []).some((changeId) => String(changeId) === String(id)),
    );
    mutateLedgerFile(repo, target, reopenMutation({ config, actor, reason, released }), {
      message: `reopen: ${id}`,
    });
    return target.file;
  });
}

// name '-' clears the owner.
export function owner(id, name, cwd = process.cwd()) {
  const { repo, target } = locate(cwd, id);
  const next = name === '-' ? null : name;
  mutateLedgerFile(
    repo,
    target,
    (text) => {
      text = setOwner(text, next);
      return appendLogEvent(text, { at: nowUtc(), type: 'owner', owner: next });
    },
    { message: `owner: ${id} ${next ?? '-'}` },
  );
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
export function discard(id, reason, cwd = process.cwd()) {
  if (!reason) {
    throw new Error('discard requires a reason — changeledger discard <id> "<reason>"');
  }
  const { config, repo, target } = locate(cwd, id);
  mutateLedgerFile(
    repo,
    target,
    (text) => {
      const fm = parseChange(text).frontmatter;
      // Validate before any mutation so an illegal discard leaves the file untouched.
      assertTransition(fm.status, 'discarded', {
        type: fm.type,
        reviewRequired: Boolean(config.types?.[fm.type]?.review_required),
      });
      text = setStatus(text, 'discarded');
      return appendLogEvent(text, {
        at: nowUtc(),
        type: 'status',
        from: fm.status,
        to: 'discarded',
        reason,
      });
    },
    { message: `discard: ${id}` },
  );
  return target.file;
}

export function archive(id, cwd = process.cwd()) {
  const { repo, target } = locate(cwd, id);
  mutateLedgerFile(
    repo,
    target,
    (text) => {
      text = setArchived(text, true);
      return appendLogEvent(text, { at: nowUtc(), type: 'archive' });
    },
    { message: `archive: ${id}` },
  );
  return target.file;
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

export function log(id, message, cwd = process.cwd()) {
  const { repo, target } = locate(cwd, id);
  mutateLedgerFile(
    repo,
    target,
    (text) => appendLogEvent(text, { at: nowUtc(), type: 'note', message }),
    { message: `log: ${id}` },
  );
  return target.file;
}

export function task(id, action, n, reason, cwd = process.cwd()) {
  const { repo, target } = locate(cwd, id);
  mutateLedgerFile(
    repo,
    target,
    (text) => {
      if (action === 'done') return setTask(text, n, 'done', { iso: nowUtc() });
      if (action === 'block') return setTask(text, n, 'blocked', { reason });
      throw new Error(`Unknown task action "${action}" (use done|block)`);
    },
    { message: `task: ${id} ${n} ${action}` },
  );
  return target.file;
}

export function list(
  {
    status: byStatus,
    type: byType,
    owner: byOwner,
    unowned = false,
    pending,
    archived = false,
    all = false,
  } = {},
  cwd = process.cwd(),
) {
  assertOwnerFilter({ owner: byOwner, unowned });
  if (archived && all) throw new Error('--archived and --all are mutually exclusive');
  if (pending && !['graduation', 'archive'].includes(pending)) {
    throw new Error(`Invalid --pending "${pending}". Valid: graduation, archive`);
  }

  let candidates = loadRepo(cwd).changes;
  if (pending === 'archive') {
    candidates = selectArchivableGraduated(candidates, { owner: byOwner, unowned });
  }

  return candidates
    .filter((c) => {
      const fm = c.frontmatter;
      if (!all && archived !== (fm.archived === true)) return false;
      if (byStatus && fm.status !== byStatus) return false;
      if (byType && fm.type !== byType) return false;
      if (byOwner !== undefined && fm.owner !== byOwner) return false;
      if (unowned && fm.owner != null) return false;
      if (pending === 'graduation' && !isPendingGraduation(c)) return false;
      return true;
    })
    .map((c) => ({
      id: c.frontmatter.id,
      title: c.frontmatter.title,
      type: c.frontmatter.type,
      status: c.frontmatter.status,
      owner: c.frontmatter.owner ?? null,
      branch: c.frontmatter.branch ?? null,
      archived: c.frontmatter.archived === true,
      progress: c.progress,
    }));
}

export function show(id, cwd = process.cwd()) {
  const c = loadRepo(cwd).changes.find((x) => String(x.frontmatter.id) === String(id));
  if (!c) throw new Error(`No change with id "${id}"`);
  return {
    id: c.frontmatter.id,
    frontmatter: c.frontmatter,
    stages: c.stages,
    tasks: c.tasks,
    progress: c.progress,
  };
}
