import fs from 'node:fs';
import path from 'node:path';
import { status as applyStatusCmd, validation as applyValidation } from '../commands/agent.mjs';
import { findChangeledgerDir, loadConfig } from '../config.mjs';
import { computeMetrics } from '../metrics.mjs';
import { nowUtc } from '../paths.mjs';
import { listProjects } from '../registry.mjs';
import { loadRepo } from '../repo.mjs';

// Serializes a loaded repo into the flat shape the UI consumes.
export function serialize(repo) {
  return {
    language: repo.config.language ?? 'en',
    statuses: repo.config.statuses ?? [],
    types: Object.keys(repo.config.types ?? {}),
    metrics: computeMetrics(repo.changes, { now: nowUtc() }),
    changes: repo.changes.map((c) => ({
      id: c.frontmatter.id,
      title: c.frontmatter.title,
      type: c.frontmatter.type,
      status: c.frontmatter.status,
      owner: c.frontmatter.owner ?? null,
      archived: c.frontmatter.archived === true,
      created: c.frontmatter.created,
      depends_on: c.frontmatter.depends_on ?? [],
      stages: c.stages,
      tasks: c.tasks,
      progress: c.progress,
    })),
    specs: (repo.specs ?? []).map((s) => ({
      name: s.name,
      title: s.frontmatter.title,
      updated: s.frontmatter.updated,
      tags: s.frontmatter.tags ?? [],
      body: s.body,
    })),
  };
}

const isAlive = (p) => fs.existsSync(path.join(p, '.changeledger', 'config.yml'));

// The project list and which one is "current" (the repo the command ran in).
export function resolveProjects(cwd, localOnly) {
  const changeledgerDir = findChangeledgerDir(cwd);
  const repoRoot = changeledgerDir ? path.dirname(changeledgerDir) : null;

  if (localOnly) {
    if (!repoRoot) throw new Error('Not a ChangeLedger repo. Run `changeledger init` first.');
    const config = loadConfig(changeledgerDir);
    const id = config.project_id ?? 'local';
    const name = config.project_name ?? path.basename(repoRoot);
    return { projects: [{ id, name, path: repoRoot, alive: true }], current: id };
  }

  const projects = listProjects().map((p) => ({ ...p, alive: isAlive(p.path) }));
  let current = null;
  if (repoRoot) {
    const match = projects.find((p) => path.resolve(p.path) === repoRoot);
    if (match) current = match.id;
  }
  return { projects, current };
}

// Full-text search across the given (alive) projects. `load` maps a project path
// to a loaded repo (loadRepo by default). Returns groups with at least one match.
export function searchProjects(projects, q, load = loadRepo) {
  const needle = String(q ?? '')
    .trim()
    .toLowerCase();
  if (!needle) return [];
  const groups = [];
  for (const p of projects) {
    if (!p.alive) continue;
    let repo;
    try {
      repo = load(p.path);
    } catch {
      continue;
    }
    const matches = repo.changes
      .filter((c) => `${c.text ?? ''} ${c.frontmatter?.title ?? ''}`.toLowerCase().includes(needle))
      .map((c) => ({
        id: c.frontmatter.id,
        title: c.frontmatter.title,
        type: c.frontmatter.type,
        status: c.frontmatter.status,
      }));
    if (matches.length) groups.push({ project: { id: p.id, name: p.name }, matches });
  }
  return groups;
}

// Applies a status move requested from the viewer. Returns { code, body } so the
// HTTP handler stays thin and the logic is testable. Reuses the `status` command
// (enum validation + setStatus + appendLog).
export function changeStatus(projects, { project, id, status, reason }) {
  // A write must target an exact project; never silently fall back to the first
  // registered one.
  const proj = projects.find((p) => p.id === project);
  if (!proj) return { code: 404, body: { error: `no project "${project}"` } };
  if (!proj.alive) return { code: 410, body: { error: 'project path is gone' } };
  if (!id || !status) return { code: 400, body: { error: 'id and status are required' } };

  // The viewer is the human's surface. Enforce the human/agent boundary here —
  // the UI is bypassable.
  let current;
  try {
    const change = loadRepo(proj.path).changes.find((c) => String(c.frontmatter.id) === String(id));
    if (!change) return { code: 404, body: { error: `no change with id "${id}"` } };
    current = change.frontmatter.status;
  } catch (e) {
    return { code: 400, body: { error: e.message } };
  }
  try {
    if (current === 'draft' && status === 'approved') {
      applyStatusCmd(id, status, proj.path);
    } else if (current === 'in-validation' && status === 'done') {
      applyValidation(id, 'pass', {}, proj.path);
    } else if (current === 'in-validation' && status === 'in-progress') {
      applyValidation(id, 'fail', { reason }, proj.path);
    } else {
      return {
        code: 403,
        body: {
          error: 'the viewer only allows draft → approved and in-validation → done|in-progress',
        },
      };
    }
    return { code: 200, body: { ok: true, id, status } };
  } catch (e) {
    return { code: 400, body: { error: e.message } };
  }
}
