// Agent-facing commands: safe mutations (status/log/task) and queries
// (list/show). Files remain the source of truth; these are optional helpers
// that inject correct timestamps/markers and validate transitions.

import fs from 'node:fs';
import path from 'node:path';
import { mutateFileAtomic, withFileLock } from '../atomic-write.mjs';
import { parseChange } from '../change.mjs';
import { assertChangeTextValid } from '../check.mjs';
import { assertSupportedSchema } from '../config-migration.mjs';
import { ownerHandle as defaultOwnerHandle } from '../git.mjs';
import { loadLedgerStore } from '../ledger-store.mjs';
import { assertTransition, parseLogEvent } from '../lifecycle.mjs';
import { nowUtc } from '../paths.mjs';
import { resolveReleasesDir } from '../release.mjs';
import { loadRepo, resolveChange } from '../repo.mjs';
import { appendLogEvent, setArchived, setOwner, setStatus, setTask } from '../writer.mjs';

function locate(cwd, id) {
  const store = loadLedgerStore(cwd);
  if (store.mode === 'state') {
    const snapshot = store.load();
    const change = snapshot.changes.find(
      (candidate) => String(candidate.frontmatter.id) === String(id),
    );
    if (!change) {
      throw new Error(
        `No change with id "${id}" (use the exact id; run \`changeledger check\` if a filename's id looks wrong)`,
      );
    }
    assertSupportedSchema(snapshot.config);
    return {
      config: snapshot.config,
      file: change.file,
      repoRoot: snapshot.repoRoot,
      statePath: change.statePath,
      store,
    };
  }
  const { config, file, repoRoot } = resolveChange(cwd, id);
  assertSupportedSchema(config);
  return { config, file, repoRoot };
}

function mutateChange(located, id, action, mutate) {
  if (!located.store) {
    mutateFileAtomic(located.file, mutate);
    return located.file;
  }
  const after = located.store.mutate(
    { message: `changeledger: ${action} ${id}` },
    ({ snapshot, write }) => {
      const change = snapshot.changes.find(
        (candidate) => candidate.statePath === located.statePath,
      );
      if (!change) throw new Error(`No change with id "${id}" in the state snapshot`);
      const text = mutate(change.text, snapshot);
      if (text !== undefined) write(change.statePath, text);
    },
  );
  return after.changes.find((change) => String(change.frontmatter.id) === String(id))?.file;
}

export function status(
  id,
  newStatus,
  cwd = process.cwd(),
  { ownerHandle = defaultOwnerHandle, actor = 'human', channel = 'viewer' } = {},
) {
  const located = locate(cwd, id);
  const { config, repoRoot } = located;
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
  const autoOwner = newStatus === 'in-progress' ? ownerHandle(repoRoot) : '';
  return mutateChange(located, id, 'status', (text) => {
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
    if (newStatus === 'in-progress' && !fm.owner && autoOwner) {
      text = setOwner(text, autoOwner);
      text = appendLogEvent(text, {
        at: nowUtc(),
        type: 'owner',
        owner: autoOwner,
        automatic: true,
      });
    }
    return text;
  });
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
  const located = locate(cwd, id);
  return mutateChange(located, id, 'review', (text) => {
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
  });
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
  return mutateChange(located, id, 'validation', (text) => {
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
  });
}

// Correction path while `done` is still provisional. Graduation,
// skip, archive and release membership are durable boundaries and fail closed.
export function reopen(id, reason, cwd = process.cwd(), { actor = 'human' } = {}) {
  if (!String(reason ?? '').trim()) throw new Error('reopen requires a reason');
  const located = locate(cwd, id);
  const { config, file, repoRoot } = located;
  const apply = (text, snapshot) => {
    const released = snapshot.releases.some((release) =>
      (release.changes ?? []).some((changeId) => String(changeId) === String(id)),
    );
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
  if (located.store) return mutateChange(located, id, 'reopen', apply);
  const releasesDir = resolveReleasesDir(repoRoot);
  fs.mkdirSync(releasesDir, { recursive: true });
  return withFileLock(path.join(releasesDir, '.history'), () => {
    mutateFileAtomic(file, (text) => {
      return apply(text, loadRepo(cwd));
    });
    return file;
  });
}

// name '-' clears the owner.
export function owner(id, name, cwd = process.cwd()) {
  const located = locate(cwd, id);
  const next = name === '-' ? null : name;
  return mutateChange(located, id, 'owner', (text) => {
    text = setOwner(text, next);
    return appendLogEvent(text, { at: nowUtc(), type: 'owner', owner: next });
  });
}

// Discards a change: a terminal lifecycle move that keeps the file and its
// reasoning instead of deleting it. The reason is mandatory and recorded in the
// Log; the transition graph rejects discarding a done or in-review change.
export function discard(id, reason, cwd = process.cwd()) {
  if (!reason) {
    throw new Error('discard requires a reason — changeledger discard <id> "<reason>"');
  }
  const located = locate(cwd, id);
  const { config } = located;
  return mutateChange(located, id, 'discard', (text) => {
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
  });
}

export function archive(id, cwd = process.cwd()) {
  const located = locate(cwd, id);
  return mutateChange(located, id, 'archive', (text) => {
    text = setArchived(text, true);
    return appendLogEvent(text, { at: nowUtc(), type: 'archive' });
  });
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
  const store = loadLedgerStore(cwd);
  const { config, changes } = store.load();
  assertSupportedSchema(config);
  const selected = selectArchivableGraduated(changes, filters);
  if (store.mode === 'state' && selected.length) {
    const selectedPaths = new Set(selected.map((change) => change.statePath));
    const after = store.mutate(
      { message: 'changeledger: archive graduated' },
      ({ snapshot, write }) => {
        for (const change of snapshot.changes) {
          if (!selectedPaths.has(change.statePath)) continue;
          const current = { ...parseChange(change.text), text: change.text };
          if (!isArchivableGraduated(current) || !matchesOwner(current, filters)) {
            throw new Error('archivable state changed concurrently; retry the operation');
          }
          let text = setArchived(change.text, true);
          text = appendLogEvent(text, { at: nowUtc(), type: 'archive' });
          write(change.statePath, text);
        }
      },
    );
    return selected.map((change) => ({
      id: change.frontmatter.id,
      title: change.frontmatter.title,
      file: after.changes.find((current) => current.statePath === change.statePath)?.file,
    }));
  }
  for (const c of selected) {
    mutateFileAtomic(c.file, (text) => {
      const current = { ...parseChange(text), text };
      if (!isArchivableGraduated(current) || !matchesOwner(current, filters)) return undefined;
      text = setArchived(text, true);
      return appendLogEvent(text, { at: nowUtc(), type: 'archive' });
    });
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

export function log(id, message, cwd = process.cwd()) {
  const located = locate(cwd, id);
  return mutateChange(located, id, 'log', (text) =>
    appendLogEvent(text, { at: nowUtc(), type: 'note', message }),
  );
}

export function task(id, action, n, reason, cwd = process.cwd()) {
  const located = locate(cwd, id);
  return mutateChange(located, id, 'task', (text) => {
    if (action === 'done') return setTask(text, n, 'done', { iso: nowUtc() });
    if (action === 'block') return setTask(text, n, 'blocked', { reason });
    throw new Error(`Unknown task action "${action}" (use done|block)`);
  });
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
