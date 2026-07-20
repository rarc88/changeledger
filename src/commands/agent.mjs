// Agent-facing commands: safe mutations (status/log/task) and queries
// (list/show). Files remain the source of truth; these are optional helpers
// that inject correct timestamps/markers and validate transitions.

import fs from 'node:fs';
import path from 'node:path';
import { withFileLock } from '../atomic-write.mjs';
import { parseChange } from '../change.mjs';
import { mutateResolvedChange } from '../change-store.mjs';
import { assertChangeTextValid } from '../check.mjs';
import { integrationBranch, renderChangeBranch, stateConfig } from '../config.mjs';
import { ownerHandle as defaultOwnerHandle, objectRun } from '../git.mjs';
import { assertTransition, parseLogEvent } from '../lifecycle.mjs';
import { nowUtc } from '../paths.mjs';
import { resolveReleasesDir } from '../release.mjs';
import { loadRepo, resolveChange } from '../repo.mjs';
import { appendLogEvent, setArchived, setOwner, setStatus, setTask } from '../writer.mjs';

function locate(cwd, id) {
  return resolveChange(cwd, id);
}

function isGlobal(located) {
  return Boolean(stateConfig(located.config));
}

function assertOwnedBy(located, handle) {
  if (!isGlobal(located)) return;
  const owner = located.change.frontmatter.owner;
  if (!owner) throw new Error(`change #${located.change.frontmatter.id} has no owner`);
  if (!handle || handle !== owner) {
    throw new Error(
      `change #${located.change.frontmatter.id} is owned by "${owner}"; transfer ownership explicitly before continuing`,
    );
  }
}

function assertNoPendingHumanDecision(located, actor) {
  if (!isGlobal(located) || actor !== 'human' || !located.state?.pending?.pending) return;
  const id = String(located.change.frontmatter.id);
  const pendingIds = located.state.pending.ids ?? [];
  if (!pendingIds.length || pendingIds.includes(id)) {
    throw new Error(
      `change #${id} has pending unpublished state; run \`changeledger state sync\` before another human decision`,
    );
  }
}

function assertImplementationBranch(located) {
  const expected = renderChangeBranch(located.config, located.change.frontmatter);
  const current = objectRun(['branch', '--show-current'], located.repoRoot).trim();
  if (current !== expected) {
    throw new Error(
      `change #${located.change.frontmatter.id} must start on branch "${expected}" (current: ${current})`,
    );
  }
  const baseline = integrationBranch(located.config);
  if (!baseline) throw new Error('starting global work requires config "git.integration_branch"');
  try {
    objectRun(['merge-base', '--is-ancestor', baseline, 'HEAD'], located.repoRoot);
  } catch {
    throw new Error(`branch "${expected}" must start from integration branch "${baseline}"`);
  }
}

export function status(
  id,
  newStatus,
  cwd = process.cwd(),
  {
    ownerHandle = defaultOwnerHandle,
    owner: approvalOwner,
    actor = 'human',
    channel = 'viewer',
  } = {},
) {
  const located = locate(cwd, id);
  const { config, file } = located;
  assertNoPendingHumanDecision(located, actor);
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
  const currentHandle = ownerHandle(located.repoRoot);
  const autoOwner = newStatus === 'in-progress' ? currentHandle : '';
  if (
    isGlobal(located) &&
    actor !== 'human' &&
    ['approved', 'in-progress', 'blocked'].includes(located.change.frontmatter.status)
  ) {
    assertOwnedBy(located, currentHandle);
  }
  if (
    isGlobal(located) &&
    located.change.frontmatter.status === 'approved' &&
    newStatus === 'in-progress'
  ) {
    assertOwnedBy(located, autoOwner);
    assertImplementationBranch(located);
  }
  mutateResolvedChange(
    located,
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
      if (isGlobal(located) && fm.status === 'draft' && newStatus === 'approved') {
        const selectedOwner = String(approvalOwner ?? fm.owner ?? '').trim();
        if (!selectedOwner) throw new Error('draft → approved requires an owner');
        if (selectedOwner !== fm.owner) {
          text = setOwner(text, selectedOwner);
          text = appendLogEvent(text, { at: nowUtc(), type: 'owner', owner: selectedOwner });
        }
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
      // set explicitly (see change 20260614-124047).
      if (!isGlobal(located) && newStatus === 'in-progress' && !fm.owner && autoOwner) {
        text = setOwner(text, autoOwner);
        text = appendLogEvent(text, {
          at: nowUtc(),
          type: 'owner',
          owner: autoOwner,
          automatic: true,
        });
      }
      return text;
    },
    { operation: `status:${newStatus}`, actor },
  );
  return file;
}

// Transmits an explicit human approval received through the host conversation.
// The lifecycle guard remains owned by status(); this only selects attribution.
export function approve(id, cwd = process.cwd(), { owner } = {}) {
  return status(id, 'approved', cwd, {
    actor: 'human',
    channel: 'conversation',
    owner,
  });
}

// Records the verdict of the independent review (run by a delegated subagent
// with clean context — see `changeledger context review`). `pass` advances to human validation;
// `fail` routes it back: `retry` for a defect inside the contract (the
// implementer fixes), `block` for one that escalates to a human. Requires the
// change to be in-review.
export function review(id, verdict, { mode, reason } = {}, cwd = process.cwd()) {
  const located = locate(cwd, id);
  const { file } = located;
  if (isGlobal(located)) assertOwnedBy(located, defaultOwnerHandle(located.repoRoot));
  mutateResolvedChange(
    located,
    (text) => {
      const { status: current } = parseChange(text).frontmatter;
      if (current !== 'in-review') {
        throw new Error(`review requires status in-review (current: ${current})`);
      }

      if (verdict === 'pass') {
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
    { operation: `review:${verdict}`, actor: 'orchestrator' },
  );
  return file;
}

// Records a validation verdict while keeping the deciding actor and interaction
// channel explicit. Viewer and conversation share every lifecycle/check guard.
export function validation(
  id,
  verdict,
  { reason, actor = 'human', channel = 'viewer' } = {},
  cwd = process.cwd(),
) {
  const located = locate(cwd, id);
  const { config, file } = located;
  assertNoPendingHumanDecision(located, actor);
  if (isGlobal(located) && actor !== 'human') {
    assertOwnedBy(located, defaultOwnerHandle(located.repoRoot));
  }
  mutateResolvedChange(
    located,
    (text) => {
      const fm = parseChange(text).frontmatter;
      const current = fm.status;
      let target;
      if (verdict === 'pass') {
        target = 'done';
      } else if (verdict === 'fail') {
        if (!String(reason ?? '').trim()) throw new Error('validation fail requires a reason');
        target = 'in-progress';
      } else {
        throw new Error(`Unknown validation verdict "${verdict}" (use pass|fail)`);
      }
      if (current !== 'in-validation') {
        throw new Error(`validation requires status in-validation (current: ${current})`);
      }
      assertTransition(current, target, {
        type: fm.type,
        reviewRequired: Boolean(config.types?.[fm.type]?.review_required),
      });
      text = setStatus(text, target);
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
        to: target,
        detail,
        reason: verdict === 'fail' ? reason : undefined,
      });
      if (verdict === 'pass') assertChangeTextValid(config, path.basename(file), text);
      return text;
    },
    { operation: `validation:${verdict}`, actor },
  );
  return file;
}

// Correction path while `done` is still provisional. Graduation,
// skip, archive and release membership are durable boundaries and fail closed.
export function reopen(id, reason, cwd = process.cwd(), { actor = 'human' } = {}) {
  if (!String(reason ?? '').trim()) throw new Error('reopen requires a reason');
  const located = locate(cwd, id);
  assertNoPendingHumanDecision(located, actor);
  if (isGlobal(located) && actor !== 'human') {
    assertOwnedBy(located, defaultOwnerHandle(located.repoRoot));
  }
  const { config, file, repoRoot } = located;
  const releasesDir = resolveReleasesDir(repoRoot);
  fs.mkdirSync(releasesDir, { recursive: true });
  return withFileLock(path.join(releasesDir, '.history'), () => {
    const released = loadRepo(cwd).releases.some((release) =>
      (release.changes ?? []).some((changeId) => String(changeId) === String(id)),
    );
    mutateResolvedChange(
      located,
      (text) => {
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
      },
      { operation: 'reopen', actor },
    );
    return file;
  });
}

// name '-' clears the owner.
export function owner(
  id,
  name,
  cwd = process.cwd(),
  { actorHandle = defaultOwnerHandle, actor = 'agent', channel = 'cli' } = {},
) {
  const located = locate(cwd, id);
  const { file } = located;
  const next = name === '-' ? null : name;
  const previous = located.change.frontmatter.owner ?? null;
  const handle = actorHandle(located.repoRoot);
  assertNoPendingHumanDecision(located, actor);
  if (isGlobal(located) && previous && actor !== 'human') assertOwnedBy(located, handle);
  mutateResolvedChange(
    located,
    (text) => {
      text = setOwner(text, next);
      text = appendLogEvent(text, { at: nowUtc(), type: 'owner', owner: next });
      if (isGlobal(located) && previous !== next) {
        text = appendLogEvent(text, {
          at: nowUtc(),
          type: 'note',
          message: `ownership transferred: ${previous ?? 'unassigned'} → ${next ?? 'unassigned'} by ${actor === 'human' ? 'human' : handle || 'unknown'} via ${channel}`,
        });
      }
      return text;
    },
    { operation: 'owner', actor: actor === 'human' ? 'human' : handle || 'unknown' },
  );
  return file;
}

// Discards a change: a terminal lifecycle move that keeps the file and its
// reasoning instead of deleting it. The reason is mandatory and recorded in the
// Log; the transition graph rejects discarding a done or in-review change.
export function discard(id, reason, cwd = process.cwd()) {
  if (!reason) {
    throw new Error('discard requires a reason — changeledger discard <id> "<reason>"');
  }
  const located = locate(cwd, id);
  const { config, file } = located;
  if (isGlobal(located)) assertOwnedBy(located, defaultOwnerHandle(located.repoRoot));
  mutateResolvedChange(
    located,
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
    { operation: 'discard', actor: defaultOwnerHandle(cwd) || 'unknown' },
  );
  return file;
}

export function archive(id, cwd = process.cwd()) {
  const located = locate(cwd, id);
  const { file } = located;
  mutateResolvedChange(
    located,
    (text) => {
      text = setArchived(text, true);
      return appendLogEvent(text, { at: nowUtc(), type: 'archive' });
    },
    { operation: 'archive', actor: defaultOwnerHandle(cwd) || 'unknown' },
  );
  return file;
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

export function selectArchivableGraduated(changes, filters = {}) {
  assertOwnerFilter(filters);
  return changes.filter((c) => isArchivableGraduated(c) && matchesOwner(c, filters));
}

export function archiveGraduated(filters = {}, cwd = process.cwd()) {
  const { changes } = loadRepo(cwd);
  const selected = selectArchivableGraduated(changes, filters);
  for (const c of selected) {
    const located = locate(cwd, c.frontmatter.id);
    mutateResolvedChange(
      located,
      (text) => {
        const current = { ...parseChange(text), text };
        if (!isArchivableGraduated(current) || !matchesOwner(current, filters)) return undefined;
        text = setArchived(text, true);
        return appendLogEvent(text, { at: nowUtc(), type: 'archive' });
      },
      { operation: 'archive', actor: defaultOwnerHandle(cwd) || 'unknown' },
    );
  }
  return selected.map((c) => ({
    id: c.frontmatter.id,
    title: c.frontmatter.title,
    file: c.file,
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

export function log(id, message, cwd = process.cwd(), { actorHandle = defaultOwnerHandle } = {}) {
  const located = locate(cwd, id);
  const { file } = located;
  const handle = actorHandle(located.repoRoot);
  if (
    isGlobal(located) &&
    ['approved', 'in-progress', 'blocked'].includes(located.change.frontmatter.status)
  ) {
    assertOwnedBy(located, handle);
  }
  mutateResolvedChange(
    located,
    (text) => appendLogEvent(text, { at: nowUtc(), type: 'note', message }),
    { operation: 'log', actor: handle || 'unknown' },
  );
  return file;
}

export function task(
  id,
  action,
  n,
  reason,
  cwd = process.cwd(),
  { actorHandle = defaultOwnerHandle } = {},
) {
  const located = locate(cwd, id);
  const { file } = located;
  const handle = actorHandle(located.repoRoot);
  if (isGlobal(located)) assertOwnedBy(located, handle);
  mutateResolvedChange(
    located,
    (text) => {
      if (action === 'done') return setTask(text, n, 'done', { iso: nowUtc() });
      if (action === 'block') return setTask(text, n, 'blocked', { reason });
      throw new Error(`Unknown task action "${action}" (use done|block)`);
    },
    { operation: `task:${action}`, actor: handle || 'unknown' },
  );
  return file;
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
      if (pending === 'graduation' && !(fm.status === 'done' && fm.reviewed !== true)) return false;
      return true;
    })
    .map((c) => ({
      id: c.frontmatter.id,
      title: c.frontmatter.title,
      type: c.frontmatter.type,
      status: c.frontmatter.status,
      owner: c.frontmatter.owner ?? null,
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
