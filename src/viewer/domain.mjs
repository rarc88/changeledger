import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { mutateFileAtomic } from '../atomic-write.mjs';
import { parseChange } from '../change.mjs';
import { checkRepo } from '../check.mjs';
import {
  reopen as applyReopen,
  status as applyStatusCmd,
  validation as applyValidation,
  isPendingGraduation,
} from '../commands/agent.mjs';
import { findChangeledgerDir, loadConfig, resolveRepoPath, resolveSpecsDir } from '../config.mjs';
import {
  assertSupportedSchema,
  buildMigration,
  getSchemaVersion,
  SUPPORTED_SCHEMA_VERSION,
} from '../config-migration.mjs';
import { computeMetrics } from '../metrics.mjs';
import { nowUtc, templatesDir } from '../paths.mjs';
import { listProjects, remove, update } from '../registry.mjs';
import { loadRepo, loadRepoWithConfig, resolveChange } from '../repo.mjs';
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
      pending_graduation: isPendingGraduation(c),
      created: c.frontmatter.created,
      depends_on: c.frontmatter.depends_on ?? [],
      related_to: c.frontmatter.related_to ?? [],
      stages: c.stages,
      tasks: c.tasks,
      progress: c.progress,
    })),
    specs: (repo.specs ?? []).map((s) => ({
      name: s.name,
      title: s.frontmatter.title,
      updated: s.frontmatter.updated,
      tags: s.frontmatter.tags ?? [],
      graduated_from: s.frontmatter.graduated_from ?? [],
      body: s.body,
    })),
  };
}

const isAlive = (p) => fs.existsSync(path.join(p, '.changeledger', 'config.yml'));

const LEDGER_CATEGORIES = ['project-docs', 'contract', 'templates'];
const PROJECT_DOCUMENTS = new Set(['README.md', 'AGENTS.md', 'INTENT.md']);
const LEDGER_FORMATS = new Map([
  ['.md', 'markdown'],
  ['.yml', 'source'],
  ['.yaml', 'source'],
]);
const MAX_LEDGER_DOCUMENT_SIZE = 1024 * 1024;

function ledgerProject(projects, id) {
  const project = projects.find((item) => item.id === id);
  if (!project) return { code: 404, body: { error: 'no project' } };
  if (!project.alive) return { code: 410, body: { error: 'project path is gone' } };
  return { project };
}

function ledgerRoot(project, category) {
  if (category === 'project-docs') return project.path;
  if (category === 'contract') return path.join(templatesDir, 'contract');
  if (category === 'templates') return templatesDir;
  return null;
}

function ledgerFormat(logicalPath) {
  return LEDGER_FORMATS.get(path.posix.extname(logicalPath)) ?? null;
}

function validLogicalPath(logicalPath) {
  if (typeof logicalPath !== 'string' || !logicalPath) return false;
  if (path.posix.isAbsolute(logicalPath) || path.isAbsolute(logicalPath)) return false;
  if (logicalPath.includes('\0') || logicalPath.includes('\\')) return false;
  const segments = logicalPath.split('/');
  return segments.every((segment) => segment && segment !== '.' && segment !== '..');
}

function isInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveLedgerDocument(project, category, logicalPath) {
  if (!LEDGER_CATEGORIES.includes(category) || !validLogicalPath(logicalPath)) return null;
  const format = ledgerFormat(logicalPath);
  if (!format) return null;
  if (category === 'project-docs' && !PROJECT_DOCUMENTS.has(logicalPath)) return null;
  if (category === 'templates' && logicalPath.split('/')[0] === 'contract') return null;

  const root = ledgerRoot(project, category);
  try {
    const candidate = path.resolve(root, ...logicalPath.split('/'));
    if (!isInside(root, candidate) || !fs.existsSync(candidate)) return null;
    const realRoot = fs.realpathSync(root);
    const realFile = fs.realpathSync(candidate);
    const stat = fs.statSync(realFile);
    if (!isInside(realRoot, realFile) || !stat.isFile()) return null;
    return { file: realFile, format, identity: { dev: stat.dev, ino: stat.ino } };
  } catch {
    return null;
  }
}

function listInstalledDocuments(project, category) {
  const root = ledgerRoot(project, category);
  const documents = [];
  let realRoot;
  try {
    realRoot = fs.realpathSync(root);
    if (!fs.statSync(realRoot).isDirectory()) return documents;
  } catch {
    return documents;
  }

  function visit(directory, prefix, ancestors) {
    let realDirectory;
    try {
      realDirectory = fs.realpathSync(directory);
      if (!isInside(realRoot, realDirectory) || !fs.statSync(realDirectory).isDirectory()) return;
    } catch {
      return;
    }
    if (ancestors.has(realDirectory)) return;
    const nextAncestors = new Set(ancestors).add(realDirectory);

    let entries;
    try {
      entries = fs
        .readdirSync(directory, { withFileTypes: true })
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    } catch {
      return;
    }
    for (const entry of entries) {
      if (category === 'templates' && !prefix && entry.name === 'contract') continue;
      const logicalPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!validLogicalPath(logicalPath)) continue;
      const candidate = path.join(directory, entry.name);
      let realCandidate;
      let stat;
      try {
        realCandidate = fs.realpathSync(candidate);
        if (!isInside(realRoot, realCandidate)) continue;
        stat = fs.statSync(realCandidate);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        visit(candidate, logicalPath, nextAncestors);
      } else if (stat.isFile()) {
        const resolved = resolveLedgerDocument(project, category, logicalPath);
        if (resolved) documents.push({ path: logicalPath, format: resolved.format });
      }
    }
  }

  visit(root, '', new Set());
  return documents.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function listLedgerTree(projects, id) {
  const found = ledgerProject(projects, id);
  if (!found.project) return found;
  const projectDocuments = [...PROJECT_DOCUMENTS].sort().flatMap((logicalPath) => {
    const resolved = resolveLedgerDocument(found.project, 'project-docs', logicalPath);
    return resolved ? [{ path: logicalPath, format: resolved.format }] : [];
  });
  return {
    code: 200,
    body: {
      categories: [
        { category: 'project-docs', documents: projectDocuments },
        { category: 'contract', documents: listInstalledDocuments(found.project, 'contract') },
        { category: 'templates', documents: listInstalledDocuments(found.project, 'templates') },
      ],
    },
  };
}

export function readLedgerDocument(projects, { project: id, category, path: logicalPath }) {
  const found = ledgerProject(projects, id);
  if (!found.project) return found;
  const resolved = resolveLedgerDocument(found.project, category, logicalPath);
  if (!resolved) return { code: 404, body: { error: 'document not found' } };

  let descriptor;
  try {
    descriptor = fs.openSync(resolved.file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const stat = fs.fstatSync(descriptor);
    if (
      !stat.isFile() ||
      stat.dev !== resolved.identity.dev ||
      stat.ino !== resolved.identity.ino
    ) {
      return { code: 404, body: { error: 'document not found' } };
    }
    if (stat.size > MAX_LEDGER_DOCUMENT_SIZE) {
      return { code: 413, body: { error: 'document too large' } };
    }
    const buffer = Buffer.allocUnsafe(MAX_LEDGER_DOCUMENT_SIZE + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const count = fs.readSync(descriptor, buffer, bytesRead, buffer.length - bytesRead, null);
      if (count === 0) break;
      bytesRead += count;
    }
    if (bytesRead > MAX_LEDGER_DOCUMENT_SIZE) {
      return { code: 413, body: { error: 'document too large' } };
    }
    const content = buffer.subarray(0, bytesRead).toString('utf8');
    return {
      code: 200,
      body: { category, path: logicalPath, format: resolved.format, content },
    };
  } catch {
    return { code: 404, body: { error: 'document not found' } };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

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

const projectIdentity = (project) => ({
  project_id: project.id,
  repository_path: path.resolve(project.path),
});

function attributed(project, result) {
  if (!project) return result;
  return { ...result, body: { ...projectIdentity(project), ...result.body } };
}

function withProjectIdentity(selectProject, handler) {
  return (...args) => attributed(selectProject(...args), handler(...args));
}

// Applies a status move requested from the viewer. Returns { code, body } so the
// HTTP handler stays thin and the logic is testable. Reuses the `status` command
// (enum validation + setStatus + appendLog).
function changeStatusImpl(projects, { project, id, status, reason }) {
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
    const { file } = resolveChange(proj.path, id);
    current = parseChange(fs.readFileSync(file, 'utf8')).frontmatter.status;
  } catch (e) {
    if (/^No change with id /.test(e.message)) {
      return { code: 404, body: { error: `no change with id "${id}"` } };
    }
    return { code: 400, body: { error: e.message } };
  }
  try {
    if (current === 'draft' && status === 'approved') {
      applyStatusCmd(id, status, proj.path, { actor: 'human' });
    } else if (current === 'in-validation' && status === 'done') {
      applyValidation(id, 'pass', {}, proj.path);
    } else if (current === 'in-validation' && status === 'in-progress') {
      applyValidation(id, 'fail', { reason }, proj.path);
    } else if (current === 'done' && status === 'in-progress') {
      applyReopen(id, reason, proj.path);
    } else {
      return {
        code: 403,
        body: {
          error:
            'the viewer only allows draft → approved, in-validation → done|in-progress, and eligible done → in-progress',
        },
      };
    }
    return { code: 200, body: { ok: true, id, status } };
  } catch (e) {
    return { code: 400, body: { error: e.message } };
  }
}

export const changeStatus = withProjectIdentity(
  (projects, payload) => projects.find((item) => item.id === payload.project),
  changeStatusImpl,
);

const revision = (text) => crypto.createHash('sha256').update(text).digest('hex');

function projectFor(projects, id) {
  const project = projects.find((item) => item.id === id);
  if (!project) return { code: 404, body: { error: `no project "${id}"` } };
  if (!project.alive) return { code: 410, body: { error: 'project path is gone' } };
  return { project };
}

function readProjectConfigImpl(projects, id) {
  const found = projectFor(projects, id);
  if (!found.project) return found;
  const file = path.join(found.project.path, '.changeledger', 'config.yml');
  const content = fs.readFileSync(file, 'utf8');
  return { code: 200, body: { content, revision: revision(content) } };
}

export const readProjectConfig = withProjectIdentity(
  (projects, id) => projects.find((item) => item.id === id),
  readProjectConfigImpl,
);

function saveProjectConfigImpl(projects, payload, { mutateConfig = mutateFileAtomic } = {}) {
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
    assertSupportedSchema(repo.config);
  } catch (error) {
    return { code: 400, body: { error: error.message } };
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
      assertSupportedSchema(parseYaml(before));
      if (revision(before) !== payload.revision) {
        throw new Error('configuration changed on disk; reload before saving');
      }
      return payload.content;
    });
  } catch (error) {
    if (error.message === 'configuration changed on disk; reload before saving') {
      return { code: 409, body: { error: error.message } };
    }
    if (
      /^config schema \d+ is newer than supported schema \d+; update ChangeLedger before writing$/.test(
        error.message,
      )
    ) {
      return { code: 400, body: { error: error.message } };
    }
    return { code: 400, body: { error: 'unable to save project configuration' } };
  }
  return {
    code: 200,
    body: { ok: true, name: projectName, revision: revision(payload.content) },
  };
}

export const saveProjectConfig = withProjectIdentity(
  (projects, payload) => projects.find((item) => item.id === payload.project),
  saveProjectConfigImpl,
);

function repairProjectPathImpl(projects, payload, { localOnly = false } = {}) {
  if (localOnly)
    return { code: 403, body: { error: 'registry management is unavailable in local mode' } };
  const project = projects.find((item) => item.id === payload.project);
  if (!project) return { code: 404, body: { error: `no project "${payload.project}"` } };
  if (typeof payload.repository_path !== 'string') {
    return { code: 400, body: { error: 'repository_path is required' } };
  }
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
    update(
      project.id,
      { name: config.project_name ?? project.name, path: root },
      { expectedPath: payload.repository_path },
    );
  } catch (error) {
    if (error.message === 'project registry changed; reload before writing') {
      return { code: 409, body: { error: error.message } };
    }
    return { code: 400, body: { error: 'unable to update project registry' } };
  }
  return {
    code: 200,
    body: { ...projectIdentity({ id: project.id, path: root }), ok: true },
  };
}

export const repairProjectPath = withProjectIdentity(
  (projects, payload) => projects.find((item) => item.id === payload.project),
  repairProjectPathImpl,
);

function unregisterProjectImpl(projects, payload, { localOnly = false } = {}) {
  if (localOnly)
    return { code: 403, body: { error: 'registry management is unavailable in local mode' } };
  const project = projects.find((item) => item.id === payload.project);
  if (!project) return { code: 404, body: { error: `no project "${payload.project}"` } };
  if (typeof payload.repository_path !== 'string') {
    return { code: 400, body: { error: 'repository_path is required' } };
  }
  if (payload.confirm !== project.name) {
    return { code: 400, body: { error: `type "${project.name}" to confirm` } };
  }
  try {
    remove(project.id, { expectedPath: payload.repository_path });
  } catch (error) {
    if (error.message === 'project registry changed; reload before writing') {
      return { code: 409, body: { error: error.message } };
    }
    return { code: 400, body: { error: 'unable to update project registry' } };
  }
  return { code: 200, body: { ok: true } };
}

export const unregisterProject = withProjectIdentity(
  (projects, payload) => projects.find((item) => item.id === payload.project),
  unregisterProjectImpl,
);

// Returns config content + schema metadata without mutating anything.
function readProjectConfigStructuredImpl(projects, id) {
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

export const readProjectConfigStructured = withProjectIdentity(
  (projects, id) => projects.find((item) => item.id === id),
  readProjectConfigStructuredImpl,
);

// Applies a semantic patch (allowlisted fields only) to the YAML AST, preserving
// comments, unknown keys and fields the form does not represent.
function patchProjectConfigImpl(projects, payload, { mutateConfig = mutateFileAtomic } = {}) {
  const found = projectFor(projects, payload.project);
  if (!found.project) return found;
  if (!payload.patch || typeof payload.patch !== 'object' || Array.isArray(payload.patch)) {
    return { code: 400, body: { error: 'patch must be an object' } };
  }
  if (typeof payload.revision !== 'string') {
    return { code: 400, body: { error: 'revision is required' } };
  }
  // Explicitly reject attempts to change identity fields via patch.
  if ('project_id' in payload.patch) {
    return { code: 400, body: { error: 'project_id cannot be changed from the viewer' } };
  }
  if ('schema_version' in payload.patch) {
    return { code: 400, body: { error: 'schema_version cannot be changed via patch' } };
  }

  const file = path.join(found.project.path, '.changeledger', 'config.yml');

  let result;
  try {
    assertSupportedSchema(parseYaml(fs.readFileSync(file, 'utf8')));
    mutateConfig(file, (before) => {
      if (revision(before) !== payload.revision) {
        throw new Error('configuration changed on disk; reload before saving');
      }

      const doc = parseDocument(before, { merge: false });
      const config = doc.toJS() ?? {};
      assertSupportedSchema(config);

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

export const patchProjectConfig = withProjectIdentity(
  (projects, payload) => projects.find((item) => item.id === payload.project),
  patchProjectConfigImpl,
);

// Preview the migration without writing. Returns summary + candidate YAML.
function previewConfigMigrationImpl(projects, id, rev) {
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
      summary: `Config migration ${migrationResult.fromVersion} → ${SUPPORTED_SCHEMA_VERSION} (dry run)`,
      changes: migrationResult.changes,
      yaml: migrationResult.yaml,
    },
  };
}

export const previewConfigMigration = withProjectIdentity(
  (projects, id) => projects.find((item) => item.id === id),
  previewConfigMigrationImpl,
);

// Apply the migration atomically. Uses the same engine as `changeledger config migrate`.
// Revision check and write are inside mutateFileAtomic to avoid TOCTOU races.
function applyConfigMigrationImpl(projects, payload, { mutateConfig = mutateFileAtomic } = {}) {
  const found = projectFor(projects, payload.project);
  if (!found.project) return found;
  if (typeof payload.revision !== 'string') {
    return { code: 400, body: { error: 'revision is required' } };
  }
  const file = path.join(found.project.path, '.changeledger', 'config.yml');

  let result;
  try {
    assertSupportedSchema(parseYaml(fs.readFileSync(file, 'utf8')));
    mutateConfig(file, (before) => {
      if (revision(before) !== payload.revision) {
        throw new Error('configuration changed on disk; reload before saving');
      }
      let migrationResult;
      try {
        migrationResult = buildMigration(before);
      } catch (e) {
        throw new Error(e.message);
      }
      if (!migrationResult) {
        result = { already_current: true, rev: payload.revision };
        return undefined; // no write needed
      }
      result = { ok: true, rev: revision(migrationResult.yaml) };
      return migrationResult.yaml;
    });
  } catch (error) {
    if (error.message === 'configuration changed on disk; reload before saving') {
      return { code: 409, body: { error: error.message } };
    }
    return { code: 400, body: { error: error.message } };
  }

  if (result.already_current) {
    return { code: 200, body: { already_current: true, revision: result.rev } };
  }
  return { code: 200, body: { ok: true, revision: result.rev } };
}

export const applyConfigMigration = withProjectIdentity(
  (projects, payload) => projects.find((item) => item.id === payload.project),
  applyConfigMigrationImpl,
);

// Allowlisted fields the form patch may update.
const PATCH_ALLOWED = new Set([
  'project_name',
  'language',
  'tdd',
  'changes_dir',
  'specs_dir',
  'statuses',
  'stages',
  'readiness',
  'types',
  'release',
  'git',
]);

const CANONICAL_STATUSES_REQUIRED = new Set([
  'draft',
  'approved',
  'in-progress',
  'in-review',
  'in-validation',
  'blocked',
  'done',
  'discarded',
]);

const CANONICAL_STAGES_REQUIRED = new Set([
  'request',
  'investigation',
  'proposal',
  'specification',
  'plan',
  'log',
]);

function applyPatch(doc, patch, currentConfig) {
  for (const [key, value] of Object.entries(patch)) {
    if (!PATCH_ALLOWED.has(key)) continue;

    if (key === 'types') {
      applyTypesPatch(doc, value, currentConfig.types ?? {});
    } else if (key === 'release') {
      applyReleasePatch(doc, value);
    } else if (key === 'readiness') {
      applyReadinessPatch(doc, value);
    } else if (key === 'git') {
      applyGitPatch(doc, value);
    } else if (key === 'statuses') {
      applyRequiredListPatch(doc, 'statuses', value, CANONICAL_STATUSES_REQUIRED);
    } else if (key === 'stages') {
      applyRequiredListPatch(doc, 'stages', value, CANONICAL_STAGES_REQUIRED);
    } else {
      doc.set(key, value);
    }
  }
}

function applyRequiredListPatch(doc, key, proposed, required) {
  if (!Array.isArray(proposed) || proposed.some((value) => typeof value !== 'string')) {
    throw new Error(`${key} must be a list of strings`);
  }
  const duplicate = proposed.find((value, index) => proposed.indexOf(value) !== index);
  if (duplicate) throw new Error(`${key} contains duplicate value "${duplicate}"`);
  const missing = [...required].find((value) => !proposed.includes(value));
  if (missing) throw new Error(`${key} cannot remove required value "${missing}"`);
  doc.set(key, proposed);
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
    } else if (typeDef.review_required === null) {
      doc.deleteIn(['types', typeName, 'review_required']);
    }
  }
}

function applyReleasePatch(doc, releasePatch) {
  if (releasePatch.impacts && typeof releasePatch.impacts === 'object') {
    for (const [type, impact] of Object.entries(releasePatch.impacts)) {
      if (impact === null) doc.deleteIn(['release', 'impacts', type]);
      else doc.setIn(['release', 'impacts', type], impact);
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

function applyGitPatch(doc, gitPatch) {
  if (!gitPatch || typeof gitPatch !== 'object') return;
  if (typeof gitPatch.integration_branch === 'string' && gitPatch.integration_branch.trim()) {
    doc.setIn(['git', 'integration_branch'], gitPatch.integration_branch.trim());
  } else if (gitPatch.integration_branch === null) {
    doc.deleteIn(['git', 'integration_branch']);
  }
  if (typeof gitPatch.change_branch_format === 'string' && gitPatch.change_branch_format.trim()) {
    doc.setIn(['git', 'change_branch_format'], gitPatch.change_branch_format.trim());
  } else if (gitPatch.change_branch_format === null) {
    doc.deleteIn(['git', 'change_branch_format']);
  }
}
