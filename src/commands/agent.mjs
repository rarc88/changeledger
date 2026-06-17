// Agent-facing commands: safe mutations (status/log/task) and queries
// (list/show). Files remain the source of truth; these are optional helpers
// that inject correct timestamps/markers and validate transitions.

import path from 'node:path';
import { mutateFileAtomic } from '../atomic-write.mjs';
import { parseChange } from '../change.mjs';
import { ownerHandle as defaultOwnerHandle } from '../git.mjs';
import { assertTransition } from '../lifecycle.mjs';
import { nowUtc } from '../paths.mjs';
import { loadRepo, resolveChange } from '../repo.mjs';
import { appendLog, setArchived, setOwner, setStatus, setTask } from '../writer.mjs';

function locate(cwd, id) {
  const { config, file } = resolveChange(cwd, id);
  return { config, file };
}

export function status(
  id,
  newStatus,
  cwd = process.cwd(),
  { ownerHandle = defaultOwnerHandle } = {},
) {
  const { config, file } = locate(cwd, id);
  if (newStatus === 'discarded') {
    throw new Error('to discard a change use `sl discard <id> "<reason>"` (a reason is required)');
  }
  if (!(config.statuses ?? []).includes(newStatus)) {
    throw new Error(`Invalid status "${newStatus}". Valid: ${(config.statuses ?? []).join(', ')}`);
  }
  const autoOwner = newStatus === 'in-progress' ? ownerHandle(path.dirname(file)) : '';
  mutateFileAtomic(file, (text) => {
    const fm = parseChange(text).frontmatter;
    // Validate the move before any in-memory mutation, so an illegal transition
    // leaves the file byte-for-byte unchanged. The review gate reads review_required
    // from the change's type.
    assertTransition(fm.status, newStatus, {
      type: fm.type,
      reviewRequired: Boolean(config.types?.[fm.type]?.review_required),
    });
    text = setStatus(text, newStatus);
    text = appendLog(text, nowUtc(), `status: ${fm.status} → ${newStatus}`);

    // Work begins here: assign the owner from the local git identity unless one was
    // set explicitly (see change 20260614-124047).
    if (newStatus === 'in-progress' && !fm.owner && autoOwner) {
      text = setOwner(text, autoOwner);
      text = appendLog(text, nowUtc(), `owner → ${autoOwner} (auto)`);
    }
    return text;
  });
  return file;
}

// Records the verdict of the independent review (run by a delegated subagent
// with clean context — see AGENTS.md §6). `pass` graduates the change to done;
// `fail` routes it back: `retry` for a defect inside the contract (the
// implementer fixes), `block` for one that escalates to a human. Requires the
// change to be in-review.
export function review(id, verdict, { mode, reason } = {}, cwd = process.cwd()) {
  const { file } = locate(cwd, id);
  mutateFileAtomic(file, (text) => {
    const { status: current } = parseChange(text).frontmatter;
    if (current !== 'in-review') {
      throw new Error(`review requires status in-review (current: ${current})`);
    }

    if (verdict === 'pass') {
      text = setStatus(text, 'done');
      text = appendLog(text, nowUtc(), 'review → done (delegated subagent, clean context)');
    } else if (verdict === 'fail') {
      if (!reason) {
        throw new Error('fail requires a reason — sl review <id> fail --retry|--block "<reason>"');
      }
      if (mode === 'retry') {
        text = setStatus(text, 'in-progress');
        text = appendLog(text, nowUtc(), `review → in-progress (retry): ${reason}`);
      } else if (mode === 'block') {
        text = setStatus(text, 'blocked');
        text = appendLog(text, nowUtc(), `review → blocked: ${reason}`);
      } else {
        throw new Error('fail requires --retry or --block');
      }
    } else {
      throw new Error(`Unknown review verdict "${verdict}" (use pass|fail)`);
    }

    return text;
  });
  return file;
}

// name '-' clears the owner.
export function owner(id, name, cwd = process.cwd()) {
  const { file } = locate(cwd, id);
  const next = name === '-' ? null : name;
  mutateFileAtomic(file, (text) => {
    text = setOwner(text, next);
    return appendLog(text, nowUtc(), next ? `owner → ${next}` : 'owner cleared');
  });
  return file;
}

// Discards a change: a terminal lifecycle move that keeps the file and its
// reasoning instead of deleting it. The reason is mandatory and recorded in the
// Log; the transition graph rejects discarding a done or in-review change.
export function discard(id, reason, cwd = process.cwd()) {
  if (!reason) {
    throw new Error('discard requires a reason — sl discard <id> "<reason>"');
  }
  const { config, file } = locate(cwd, id);
  mutateFileAtomic(file, (text) => {
    const fm = parseChange(text).frontmatter;
    // Validate before any mutation so an illegal discard leaves the file untouched.
    assertTransition(fm.status, 'discarded', {
      type: fm.type,
      reviewRequired: Boolean(config.types?.[fm.type]?.review_required),
    });
    text = setStatus(text, 'discarded');
    return appendLog(text, nowUtc(), `status: ${fm.status} → discarded: ${reason}`);
  });
  return file;
}

export function archive(id, on, cwd = process.cwd()) {
  const { file } = locate(cwd, id);
  mutateFileAtomic(file, (text) => {
    text = setArchived(text, on);
    return appendLog(text, nowUtc(), on ? 'archived' : 'unarchived');
  });
  return file;
}

export function archiveGraduated({ dryRun = false } = {}, cwd = process.cwd()) {
  const { changes } = loadRepo(cwd);
  const selected = changes.filter((c) => isArchivableGraduated(c));
  if (!dryRun) {
    for (const c of selected) {
      mutateFileAtomic(c.file, (text) => {
        const current = { ...parseChange(text), text };
        if (!isArchivableGraduated(current)) return undefined;
        text = setArchived(text, true);
        return appendLog(text, nowUtc(), 'archived');
      });
    }
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
  return logBody
    .split('\n')
    .some((line) => /—\s*(graduado a spec `[^`]+`|graduation skipped\b)/i.test(line));
}

export function log(id, message, cwd = process.cwd()) {
  const { file } = locate(cwd, id);
  mutateFileAtomic(file, (text) => appendLog(text, nowUtc(), message));
  return file;
}

export function task(id, action, n, reason, cwd = process.cwd()) {
  const { file } = locate(cwd, id);
  mutateFileAtomic(file, (text) => {
    if (action === 'done') return setTask(text, n, 'done', { iso: nowUtc() });
    if (action === 'block') return setTask(text, n, 'blocked', { reason });
    throw new Error(`Unknown task action "${action}" (use done|block)`);
  });
  return file;
}

export function list({ status: byStatus, type: byType } = {}, cwd = process.cwd()) {
  return loadRepo(cwd)
    .changes.map((c) => ({
      id: c.frontmatter.id,
      title: c.frontmatter.title,
      type: c.frontmatter.type,
      status: c.frontmatter.status,
      owner: c.frontmatter.owner ?? null,
      progress: c.progress,
    }))
    .filter((c) => (!byStatus || c.status === byStatus) && (!byType || c.type === byType));
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
