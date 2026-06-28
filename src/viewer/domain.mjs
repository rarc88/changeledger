import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { mutateFileAtomic, writeFileAtomic } from '../atomic-write.mjs';
import { checkRepo } from '../check.mjs';
import { status as applyStatusCmd, validation as applyValidation } from '../commands/agent.mjs';
import { findChangeledgerDir, loadConfig, resolveRepoPath, resolveSpecsDir } from '../config.mjs';
import {
  buildMigration,
  getSchemaVersion,
  SUPPORTED_SCHEMA_VERSION,
} from '../config-migration.mjs';
import { computeMetrics } from '../metrics.mjs';
import { nowUtc } from '../paths.mjs';
import { listProjects, remove, update } from '../registry.mjs';
import { loadRepo, loadRepoWithConfig } from '../repo.mjs';
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

export function saveProjectConfig(projects, payload, { mutateConfig = mutateFileAtomic } = {}) {
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
  } catch {
    return { code: 400, body: { error: 'unable to load the current project configuration' } };
  }
  try {
    resolveRepoPath(repo.repoRoot, candidate.changes_dir, 'changes_dir');
    resolveSpecsDir(repo.repoRoot, candidate);
  } catch (error) {
    return { code: 400, body: { error: error.message } };
  }
  let candidateRepo;
  try {
    candidateRepo = loadRepoWithConfig(repo.repoRoot, repo.changeledgerDir, candidate);
  } catch {
    return { code: 400, body: { error: 'candidate configuration cannot load the repository' } };
  }
  let errors;
  try {
    ({ errors } = checkRepo(candidateRepo));
  } catch {
    return {
      code: 400,
      body: { error: 'candidate configuration violates the ChangeLedger contract' },
    };
  }
  if (errors.length) return { code: 400, body: { error: errors[0].message } };

  const file = path.join(repo.changeledgerDir, 'config.yml');
  const projectName =
    typeof candidate.project_name === 'string' && candidate.project_name.trim()
      ? candidate.project_name
      : found.project.name;
  try {
    mutateConfig(file, (before) => {
      if (revision(before) !== payload.revision) {
        throw new Error('configuration changed on disk; reload before saving');
      }
      return payload.content;
    });
  } catch (error) {
    if (error.message === 'configuration changed on disk; reload before saving') {
      return { code: 409, body: { error: error.message } };
    }
    return { code: 400, body: { error: 'unable to save project configuration' } };
  }
  return {
    code: 200,
    body: { ok: true, name: projectName, revision: revision(payload.content) },
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
  let config;
  try {
    config = loadConfig(path.join(root, '.changeledger'));
  } catch {
    return { code: 400, body: { error: 'project path is not a ChangeLedger repository' } };
  }
  if (String(config.project_id ?? '') !== String(project.id)) {
    return { code: 400, body: { error: 'project path belongs to a different project_id' } };
  }
  try {
    update(project.id, { name: config.project_name ?? project.name, path: root });
  } catch {
    return { code: 400, body: { error: 'unable to update project registry' } };
  }
  return { code: 200, body: { ok: true } };
}

export function unregisterProject(projects, payload, { localOnly = false } = {}) {
  if (localOnly)
    return { code: 403, body: { error: 'registry management is unavailable in local mode' } };
  const project = projects.find((item) => item.id === payload.project);
  if (!project) return { code: 404, body: { error: `no project "${payload.project}"` } };
  if (payload.confirm !== project.name) {
    return { code: 400, body: { error: `type "${project.name}" to confirm` } };
  }
  try {
    remove(project.id);
  } catch {
    return { code: 400, body: { error: 'unable to update project registry' } };
  }
  return { code: 200, body: { ok: true } };
}

// Returns config content + schema metadata without mutating anything.
export function readProjectConfigStructured(projects, id) {
  const found = projectFor(projects, id);
  if (!found.project) return found;
  const file = path.join(found.project.path, '.changeledger', 'config.yml');
  const content = fs.readFileSync(file, 'utf8');
  const config = parseYaml(content);
  const schemaVersion = getSchemaVersion(config);
  return {
    code: 200,
    body: {
      content,
      revision: revision(content),
      schemaVersion,
      supported: SUPPORTED_SCHEMA_VERSION,
      config,
    },
  };
}

// Applies a semantic patch (allowlisted fields only) to the YAML AST, preserving
// comments, unknown keys and fields the form does not represent.
export function patchProjectConfig(projects, payload, { mutateConfig = mutateFileAtomic } = {}) {
  const found = projectFor(projects, payload.project);
  if (!found.project) return found;
  if (!payload.patch || typeof payload.patch !== 'object' || Array.isArray(payload.patch)) {
    return { code: 400, body: { error: 'patch must be an object' } };
  }
  if (typeof payload.revision !== 'string') {
    return { code: 400, body: { error: 'revision is required' } };
  }

  const file = path.join(found.project.path, '.changeledger', 'config.yml');

  let result;
  try {
    mutateConfig(file, (before) => {
      if (revision(before) !== payload.revision) {
        throw new Error('configuration changed on disk; reload before saving');
      }

      const doc = parseDocument(before, { merge: false });
      const config = doc.toJS() ?? {};

      // Fail closed for future schema
      const schemaVersion = getSchemaVersion(config);
      if (schemaVersion > SUPPORTED_SCHEMA_VERSION) {
        throw new Error(
          `config schema ${schemaVersion} is newer than supported schema ${SUPPORTED_SCHEMA_VERSION}`,
        );
      }

      applyPatch(doc, payload.patch, config);

      const patched = doc.toString();
      const candidate = parseYaml(patched);

      // Identity guard
      if (String(candidate.project_id ?? '') !== String(found.project.id)) {
        throw new Error('project_id cannot be changed from the viewer');
      }

      // Structural validation
      const repo = loadRepo(found.project.path);
      resolveRepoPath(repo.repoRoot, candidate.changes_dir, 'changes_dir');
      resolveSpecsDir(repo.repoRoot, candidate);
      const candidateRepo = loadRepoWithConfig(repo.repoRoot, repo.changeledgerDir, candidate);
      const { errors } = checkRepo(candidateRepo);
      if (errors.length) throw new Error(errors[0].message);

      result = { content: patched, rev: revision(patched) };
      return patched;
    });
  } catch (error) {
    if (error.message === 'configuration changed on disk; reload before saving') {
      return { code: 409, body: { error: error.message } };
    }
    return { code: 400, body: { error: error.message } };
  }

  return { code: 200, body: { ok: true, revision: result.rev } };
}

// Preview the migration without writing. Returns summary + candidate YAML.
export function previewConfigMigration(projects, id, rev) {
  const found = projectFor(projects, id);
  if (!found.project) return found;
  const file = path.join(found.project.path, '.changeledger', 'config.yml');
  const content = fs.readFileSync(file, 'utf8');
  if (rev && revision(content) !== rev) {
    return { code: 409, body: { error: 'configuration changed on disk; reload before saving' } };
  }
  let migrationResult;
  try {
    migrationResult = buildMigration(content);
  } catch (e) {
    return { code: 400, body: { error: e.message } };
  }
  if (!migrationResult) {
    return {
      code: 200,
      body: {
        already_current: true,
        message: `Config is already at schema ${SUPPORTED_SCHEMA_VERSION}`,
      },
    };
  }
  return {
    code: 200,
    body: {
      summary: `Config migration 0 → ${SUPPORTED_SCHEMA_VERSION} (dry run)`,
      changes: migrationResult.changes,
      yaml: migrationResult.yaml,
    },
  };
}

// Apply the migration atomically. Uses the same engine as `changeledger config migrate`.
export function applyConfigMigration(projects, payload, { writeConfig = writeFileAtomic } = {}) {
  const found = projectFor(projects, payload.project);
  if (!found.project) return found;
  if (typeof payload.revision !== 'string') {
    return { code: 400, body: { error: 'revision is required' } };
  }
  const file = path.join(found.project.path, '.changeledger', 'config.yml');
  const content = fs.readFileSync(file, 'utf8');
  if (revision(content) !== payload.revision) {
    return { code: 409, body: { error: 'configuration changed on disk; reload before saving' } };
  }
  let migrationResult;
  try {
    migrationResult = buildMigration(content);
  } catch (e) {
    return { code: 400, body: { error: e.message } };
  }
  if (!migrationResult) {
    return {
      code: 200,
      body: { already_current: true, revision: payload.revision },
    };
  }
  writeConfig(file, migrationResult.yaml);
  return {
    code: 200,
    body: { ok: true, revision: revision(migrationResult.yaml) },
  };
}

// Allowlisted fields the form patch may update.
const PATCH_ALLOWED = new Set([
  'language',
  'tdd',
  'changes_dir',
  'specs_dir',
  'readiness',
  'types',
  'release',
]);

function applyPatch(doc, patch, currentConfig) {
  for (const [key, value] of Object.entries(patch)) {
    if (!PATCH_ALLOWED.has(key)) continue;

    if (key === 'types') {
      applyTypesPatch(doc, value, currentConfig.types ?? {});
    } else if (key === 'release') {
      applyReleasePatch(doc, value, currentConfig.release ?? {});
    } else if (key === 'readiness') {
      applyReadinessPatch(doc, value);
    } else {
      doc.set(key, value);
    }
  }
}

function applyTypesPatch(doc, typesPatch, currentTypes) {
  for (const [typeName, typeDef] of Object.entries(typesPatch)) {
    if (!Object.hasOwn(currentTypes, typeName)) continue; // don't add new types
    if (!typeDef || typeof typeDef !== 'object') continue;
    if (Array.isArray(typeDef.stages)) {
      doc.setIn(['types', typeName, 'stages'], typeDef.stages);
    }
    if (typeof typeDef.review_required === 'boolean') {
      doc.setIn(['types', typeName, 'review_required'], typeDef.review_required);
    }
  }
}

function applyReleasePatch(doc, releasePatch, currentRelease) {
  if (releasePatch.impacts && typeof releasePatch.impacts === 'object') {
    for (const [type, impact] of Object.entries(releasePatch.impacts)) {
      doc.setIn(['release', 'impacts', type], impact);
    }
  }
}

function applyReadinessPatch(doc, readinessPatch) {
  if (!readinessPatch || typeof readinessPatch !== 'object') return;
  if (Array.isArray(readinessPatch.target_patterns)) {
    doc.setIn(['readiness', 'target_patterns'], readinessPatch.target_patterns);
  }
  if (Array.isArray(readinessPatch.verification_patterns)) {
    doc.setIn(['readiness', 'verification_patterns'], readinessPatch.verification_patterns);
  }
}
