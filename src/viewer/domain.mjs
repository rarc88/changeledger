import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { mutateFileAtomic } from '../atomic-write.mjs';
import { checkRepo } from '../check.mjs';
import { status as applyStatusCmd, validation as applyValidation } from '../commands/agent.mjs';
import { findChangeledgerDir, loadConfig, resolveRepoPath, resolveSpecsDir } from '../config.mjs';
import { computeMetrics } from '../metrics.mjs';
import { nowUtc } from '../paths.mjs';
import { listProjects, register, remove, update } from '../registry.mjs';
import { loadRepo } from '../repo.mjs';
import { parseYaml } from '../yaml.mjs';

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

const revision = (text) => crypto.createHash('sha256').update(text).digest('hex');

function projectFor(projects, id) {
  const project = projects.find((item) => item.id === id);
  if (!project) return { code: 404, body: { error: `no project "${id}"` } };
  if (!project.alive) return { code: 410, body: { error: 'project path is gone' } };
  return { project };
}

export function readProjectConfig(projects, id) {
  const found = projectFor(projects, id);
  if (!found.project) return found;
  const file = path.join(found.project.path, '.changeledger', 'config.yml');
  const content = fs.readFileSync(file, 'utf8');
  return { code: 200, body: { content, revision: revision(content) } };
}

export function saveProjectConfig(projects, payload, { localOnly = false } = {}) {
  const found = projectFor(projects, payload.project);
  if (!found.project) return found;
  if (typeof payload.content !== 'string' || typeof payload.revision !== 'string') {
    return { code: 400, body: { error: 'content and revision are required' } };
  }

  let candidate;
  try {
    candidate = parseYaml(payload.content);
  } catch (error) {
    return { code: 400, body: { error: error.message } };
  }
  if (String(candidate.project_id ?? '') !== String(found.project.id)) {
    return { code: 400, body: { error: 'project_id cannot be changed from the viewer' } };
  }

  let repo;
  try {
    repo = loadRepo(found.project.path);
    resolveRepoPath(repo.repoRoot, candidate.changes_dir, 'changes_dir');
    resolveSpecsDir(repo.repoRoot, candidate);
  } catch (error) {
    return { code: 400, body: { error: error.message } };
  }
  const { errors } = checkRepo({ ...repo, config: candidate });
  if (errors.length) return { code: 400, body: { error: errors[0].message } };

  const file = path.join(repo.changeledgerDir, 'config.yml');
  try {
    mutateFileAtomic(file, (before) => {
      if (revision(before) !== payload.revision) {
        throw new Error('configuration changed on disk; reload before saving');
      }
      return payload.content;
    });
    if (!localOnly)
      register({ id: found.project.id, name: candidate.project_name, path: repo.repoRoot });
  } catch (error) {
    return {
      code: error.message.startsWith('configuration changed') ? 409 : 400,
      body: { error: error.message },
    };
  }
  return {
    code: 200,
    body: { ok: true, name: candidate.project_name, revision: revision(payload.content) },
  };
}

export function repairProjectPath(projects, payload, { localOnly = false } = {}) {
  if (localOnly)
    return { code: 403, body: { error: 'registry management is unavailable in local mode' } };
  const project = projects.find((item) => item.id === payload.project);
  if (!project) return { code: 404, body: { error: `no project "${payload.project}"` } };
  if (typeof payload.path !== 'string' || !path.isAbsolute(payload.path)) {
    return { code: 400, body: { error: 'project path must be absolute' } };
  }
  const root = path.resolve(payload.path);
  try {
    const config = loadConfig(path.join(root, '.changeledger'));
    if (String(config.project_id ?? '') !== String(project.id)) {
      return { code: 400, body: { error: 'project path belongs to a different project_id' } };
    }
    update(project.id, { name: config.project_name ?? project.name, path: root });
    return { code: 200, body: { ok: true } };
  } catch (error) {
    return { code: 400, body: { error: error.message } };
  }
}

export function unregisterProject(projects, payload, { localOnly = false } = {}) {
  if (localOnly)
    return { code: 403, body: { error: 'registry management is unavailable in local mode' } };
  const project = projects.find((item) => item.id === payload.project);
  if (!project) return { code: 404, body: { error: `no project "${payload.project}"` } };
  if (payload.confirm !== project.name) {
    return { code: 400, body: { error: `type "${project.name}" to confirm` } };
  }
  remove(project.id);
  return { code: 200, body: { ok: true } };
}
