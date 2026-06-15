// Agent-facing commands: safe mutations (status/log/task) and queries
// (list/show). Files remain the source of truth; these are optional helpers
// that inject correct timestamps/markers and validate transitions.

import fs from 'node:fs';
import path from 'node:path';
import { parseChange } from '../change.mjs';
import { findSpecDir, loadConfig, resolveRepoPath } from '../config.mjs';
import { ownerHandle as defaultOwnerHandle } from '../git.mjs';
import { assertTransition } from '../lifecycle.mjs';
import { nowUtc } from '../paths.mjs';
import { loadRepo } from '../repo.mjs';
import { appendLog, setArchived, setOwner, setStatus, setTask } from '../writer.mjs';

function locate(cwd, id) {
  const specDir = findSpecDir(cwd);
  if (!specDir) throw new Error('Not a Spec Ledger repo. Run `sl init` first.');
  const config = loadConfig(specDir);
  const dir = resolveRepoPath(path.dirname(specDir), config.changes_dir, 'changes_dir');
  const name = fs.existsSync(dir) ? fs.readdirSync(dir).find((n) => n.startsWith(`${id}-`)) : null;
  if (!name) throw new Error(`No change with id "${id}"`);
  return { config, file: path.join(dir, name) };
}

export function status(
  id,
  newStatus,
  cwd = process.cwd(),
  { ownerHandle = defaultOwnerHandle } = {},
) {
  const { config, file } = locate(cwd, id);
  if (!(config.statuses ?? []).includes(newStatus)) {
    throw new Error(`Invalid status "${newStatus}". Valid: ${(config.statuses ?? []).join(', ')}`);
  }
  let text = fs.readFileSync(file, 'utf8');
  const fm = parseChange(text).frontmatter;
  // Validate the move before any in-memory mutation, so an illegal transition
  // leaves the file byte-for-byte unchanged.
  assertTransition(fm.status, newStatus);
  text = setStatus(text, newStatus);
  text = appendLog(text, nowUtc(), `status: ${fm.status} → ${newStatus}`);

  // Work begins here: assign the owner from the local git identity unless one was
  // set explicitly (see change 20260614-124047).
  if (newStatus === 'in-progress' && !fm.owner) {
    const user = ownerHandle(path.dirname(file));
    if (user) {
      text = setOwner(text, user);
      text = appendLog(text, nowUtc(), `owner → ${user} (auto)`);
    }
  }

  fs.writeFileSync(file, text);
  return file;
}

// name '-' clears the owner.
export function owner(id, name, cwd = process.cwd()) {
  const { file } = locate(cwd, id);
  const next = name === '-' ? null : name;
  let text = setOwner(fs.readFileSync(file, 'utf8'), next);
  text = appendLog(text, nowUtc(), next ? `owner → ${next}` : 'owner cleared');
  fs.writeFileSync(file, text);
  return file;
}

export function archive(id, on, cwd = process.cwd()) {
  const { file } = locate(cwd, id);
  let text = setArchived(fs.readFileSync(file, 'utf8'), on);
  text = appendLog(text, nowUtc(), on ? 'archived' : 'unarchived');
  fs.writeFileSync(file, text);
  return file;
}

export function log(id, message, cwd = process.cwd()) {
  const { file } = locate(cwd, id);
  fs.writeFileSync(file, appendLog(fs.readFileSync(file, 'utf8'), nowUtc(), message));
  return file;
}

export function task(id, action, n, reason, cwd = process.cwd()) {
  const { file } = locate(cwd, id);
  let text = fs.readFileSync(file, 'utf8');
  if (action === 'done') text = setTask(text, n, 'done', { iso: nowUtc() });
  else if (action === 'block') text = setTask(text, n, 'blocked', { reason });
  else throw new Error(`Unknown task action "${action}" (use done|block)`);
  fs.writeFileSync(file, text);
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
