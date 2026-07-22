import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parseDocument } from 'yaml';
import { mutateFileAtomic } from '../atomic-write.mjs';
import { parseChange } from '../change.mjs';
import { checkRepo } from '../check.mjs';
import {
  reopen as applyReopen,
  status as applyStatusCmd,
  validation as applyValidation,
} from '../commands/agent.mjs';
import { findChangeledgerDir, resolveRepoPath, resolveSpecsDir } from '../config.mjs';
import {
  assertSupportedSchema,
  buildMigration,
  getSchemaVersion,
  SUPPORTED_SCHEMA_VERSION,
} from '../config-migration.mjs';
import {
  assertLedgerRevision,
  LedgerConflictError,
  ledgerReceipt,
  loadLedgerStore,
} from '../ledger-store.mjs';
import { computeMetrics } from '../metrics.mjs';
import { nowUtc } from '../paths.mjs';
import { listProjects, remove, update } from '../registry.mjs';
import { loadRepo, loadRepoWithConfig, resolveChange } from '../repo.mjs';
import { parseYaml } from '../yaml.mjs';

// Serializes a loaded repo into the flat shape the UI consumes.
export function serialize(repo) {
  return {
    ledger_mode: repo.ledgerReplica ? 'replica' : (repo.mode ?? 'worktree'),
    ...ledgerReceipt(repo),
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

const isAlive = (projectPath) => {
  try {
    const store = loadLedgerStore(projectPath);
    if (store.mode === 'state') store.load();
    return true;
  } catch {
    return false;
  }
};

function projectConfigSource(projectPath) {
  const store = loadLedgerStore(projectPath);
  const snapshot = store.load();
  return {
    store,
    snapshot,
    content: snapshot.configText,
    file: snapshot.configFile,
  };
}

function candidateRepoForValidation(source, candidate) {
  const repo = source.snapshot;
  resolveRepoPath(repo.repoRoot, candidate.changes_dir, 'changes_dir');
  resolveSpecsDir(repo.repoRoot, candidate);
  if (repo.mode === 'state') return { ...repo, config: candidate };
  return loadRepoWithConfig(repo.repoRoot, repo.changeledgerDir, candidate);
}

function mutateConfigSource(
  source,
  { configRevision, ledgerRevision, message, transform, mutateConfig, beforeMutation },
) {
  assertLedgerRevision(source.snapshot, ledgerRevision);
  const apply = (before, snapshot = source.snapshot) => {
    if (revision(before) !== configRevision) {
      throw new Error('configuration changed on disk; reload before saving');
    }
    const after = transform(before, snapshot);
    return after === before ? undefined : after;
  };
  if (source.store.mode === 'state') {
    let changed = false;
    beforeMutation?.();
    const after = source.store.mutate(
      { message, expectedRevision: source.snapshot.revision },
      ({ snapshot, write }) => {
        const next = apply(snapshot.configText, snapshot);
        if (next === undefined) return;
        write(snapshot.configStatePath, next);
        changed = true;
      },
    );
    return { ledgerRevision: after.revision, receipt: ledgerReceipt(after), changed };
  }
  const result = mutateConfig(source.file, apply);
  return { ledgerRevision: null, changed: result !== undefined };
}

// The project list and which one is "current" (the repo the command ran in).
export function resolveProjects(cwd, localOnly) {
  const changeledgerDir = findChangeledgerDir(cwd);
  const repoRoot = changeledgerDir ? path.dirname(changeledgerDir) : null;

  if (localOnly) {
    if (!repoRoot) throw new Error('Not a ChangeLedger repo. Run `changeledger init` first.');
    const repo = loadRepo(repoRoot);
    const config = repo.config;
    const id = config.project_id ?? 'local';
    const name = config.project_name ?? path.basename(repoRoot);
    return {
      projects: [
        {
          id,
          name,
          path: repoRoot,
          alive: true,
          ...ledgerReceipt(repo),
        },
      ],
      current: id,
    };
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
// to a loaded repo (loadRepo by default). Returns matching groups plus provenance
// for every state snapshot inspected, including no-match queries.
export function searchProjects(projects, q, load = loadRepo) {
  const needle = String(q ?? '')
    .trim()
    .toLowerCase();
  if (!needle) return { groups: [], ledgers: [] };
  const groups = [];
  const ledgers = [];
  for (const p of projects) {
    if (!p.alive) continue;
    let repo;
    try {
      repo = load(p.path);
    } catch {
      continue;
    }
    if (repo.revision) {
      ledgers.push({ project: p.id, ...ledgerReceipt(repo) });
    }
    const matches = repo.changes
      .filter((c) => `${c.text ?? ''} ${c.frontmatter?.title ?? ''}`.toLowerCase().includes(needle))
      .map((c) => ({
        id: c.frontmatter.id,
        title: c.frontmatter.title,
        type: c.frontmatter.type,
        status: c.frontmatter.status,
      }));
    if (matches.length) {
      groups.push({
        project: { id: p.id, name: p.name },
        matches,
        ...(repo.revision ? ledgerReceipt(repo) : {}),
      });
    }
  }
  return { groups, ledgers };
}

export function syncProjectState(projects, id) {
  const found = projectFor(projects, id);
  if (!found.project) return found;
  try {
    const store = loadLedgerStore(found.project.path);
    if (!store.replica) {
      return { code: 400, body: { error: 'project does not use state replica format_version 2' } };
    }
    const result = store.replica.sync();
    return { code: 200, body: { ...result, ...ledgerReceipt(store.load()) } };
  } catch (error) {
    return { code: 409, body: { error: error.message } };
  }
}

// Applies a status move requested from the viewer. Returns { code, body } so the
// HTTP handler stays thin and the logic is testable. Reuses the `status` command
// (enum validation + setStatus + appendLog).
export function changeStatus(
  projects,
  { project, id, status, reason, ledger_revision },
  { beforeMutation } = {},
) {
  // A write must target an exact project; never silently fall back to the first
  // registered one.
  const proj = projects.find((p) => p.id === project);
  if (!proj) return { code: 404, body: { error: `no project "${project}"` } };
  if (!proj.alive) return { code: 410, body: { error: 'project path is gone' } };
  if (!id || !status) return { code: 400, body: { error: 'id and status are required' } };

  // The viewer is the human's surface. Enforce the human/agent boundary here —
  // the UI is bypassable.
  let current;
  let observedRevision;
  let ledgerStore;
  try {
    ledgerStore = loadLedgerStore(proj.path);
    if (ledgerStore.mode === 'state') {
      const snapshot = ledgerStore.load();
      observedRevision = assertLedgerRevision(snapshot, ledger_revision);
      const change = snapshot.changes.find(
        (candidate) => String(candidate.frontmatter.id) === String(id),
      );
      if (!change) {
        throw new Error(
          `No change with id "${id}" (use the exact id; run \`changeledger check\` if a filename's id looks wrong)`,
        );
      }
      current = change.frontmatter.status;
    } else {
      const { file } = resolveChange(proj.path, id);
      current = parseChange(fs.readFileSync(file, 'utf8')).frontmatter.status;
    }
  } catch (e) {
    if (e instanceof LedgerConflictError) return { code: 409, body: { error: e.message } };
    if (/^No change with id /.test(e.message)) {
      return { code: 404, body: { error: `no change with id "${id}"` } };
    }
    return { code: 400, body: { error: e.message } };
  }
  try {
    beforeMutation?.();
    let mutationFile;
    if (current === 'draft' && status === 'approved') {
      mutationFile = applyStatusCmd(id, status, proj.path, {
        actor: 'human',
        expectedRevision: observedRevision,
      });
    } else if (current === 'in-validation' && status === 'done') {
      mutationFile = applyValidation(id, 'pass', { expectedRevision: observedRevision }, proj.path);
    } else if (current === 'in-validation' && status === 'in-progress') {
      mutationFile = applyValidation(
        id,
        'fail',
        { reason, expectedRevision: observedRevision },
        proj.path,
      );
    } else if (current === 'done' && status === 'in-progress') {
      mutationFile = applyReopen(id, reason, proj.path, {
        expectedRevision: observedRevision,
      });
    } else {
      return {
        code: 403,
        body: {
          error:
            'the viewer only allows draft → approved, in-validation → done|in-progress, and eligible done → in-progress',
        },
      };
    }
    const ledgerRevision = String(mutationFile ?? '').match(/^git:([^:]+):/)?.[1] ?? null;
    const replica = ledgerStore?.replica?.status();
    const receipt = {
      ledger_revision: ledgerRevision,
      ledger_freshness: ledgerRevision ? (replica?.condition ?? 'local') : null,
      ...(replica
        ? {
            ledger_confirmation: replica.pending ? 'pending publication' : 'confirmed',
            ...(replica.observedAt ? { ledger_observed_at: replica.observedAt } : {}),
          }
        : {}),
    };
    return {
      code: 200,
      body: {
        ok: true,
        id,
        status,
        ...receipt,
      },
    };
  } catch (e) {
    const code =
      e instanceof LedgerConflictError ||
      /changed concurrently; reload|changed concurrently; retry/.test(e.message)
        ? 409
        : 400;
    return { code, body: { error: e.message } };
  }
}

const revision = (text) => crypto.createHash('sha256').update(text).digest('hex');
const configRevisionFrom = (payload) => payload.config_revision ?? payload.revision;

function projectFor(projects, id) {
  const project = projects.find((item) => item.id === id);
  if (!project) return { code: 404, body: { error: `no project "${id}"` } };
  if (!project.alive) return { code: 410, body: { error: 'project path is gone' } };
  return { project };
}

export function readProjectConfig(projects, id) {
  const found = projectFor(projects, id);
  if (!found.project) return found;
  try {
    const source = projectConfigSource(found.project.path);
    return {
      code: 200,
      body: {
        content: source.content,
        revision: revision(source.content),
        config_revision: revision(source.content),
        ...ledgerReceipt(source.snapshot),
      },
    };
  } catch {
    return { code: 400, body: { error: 'unable to load the current project configuration' } };
  }
}

export function saveProjectConfig(
  projects,
  payload,
  { mutateConfig = mutateFileAtomic, beforeMutation } = {},
) {
  const found = projectFor(projects, payload.project);
  if (!found.project) return found;
  const configRevision = configRevisionFrom(payload);
  if (typeof payload.content !== 'string' || typeof configRevision !== 'string') {
    return { code: 400, body: { error: 'content and config_revision are required' } };
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

  let source;
  try {
    source = projectConfigSource(found.project.path);
  } catch {
    return { code: 400, body: { error: 'unable to load the current project configuration' } };
  }
  try {
    assertLedgerRevision(source.snapshot, payload.ledger_revision);
    assertSupportedSchema(source.snapshot.config);
  } catch (error) {
    if (error instanceof LedgerConflictError) {
      return { code: 409, body: { error: error.message } };
    }
    return { code: 400, body: { error: error.message } };
  }
  let candidateRepo;
  try {
    candidateRepo = candidateRepoForValidation(source, candidate);
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

  const projectName =
    typeof candidate.project_name === 'string' && candidate.project_name.trim()
      ? candidate.project_name
      : found.project.name;
  let mutation;
  try {
    mutation = mutateConfigSource(source, {
      configRevision,
      ledgerRevision: payload.ledger_revision,
      message: 'changeledger: save config',
      transform: (before, snapshot) => {
        assertSupportedSchema(parseYaml(before));
        const currentSource = { ...source, snapshot };
        const currentRepo = candidateRepoForValidation(currentSource, candidate);
        const { errors: currentErrors } = checkRepo(currentRepo);
        if (currentErrors.length) throw new Error(currentErrors[0].message);
        return payload.content;
      },
      mutateConfig,
      beforeMutation,
    });
  } catch (error) {
    if (
      error instanceof LedgerConflictError ||
      error.message === 'configuration changed on disk; reload before saving'
    ) {
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
    body: {
      ok: true,
      name: projectName,
      revision: revision(payload.content),
      config_revision: revision(payload.content),
      ...(mutation.receipt ?? {
        ledger_revision: mutation.ledgerRevision,
        ledger_freshness: mutation.ledgerRevision ? 'local' : null,
      }),
    },
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
    config = loadRepo(root).config;
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
  let source;
  try {
    source = projectConfigSource(found.project.path);
  } catch {
    return { code: 400, body: { error: 'unable to load the current project configuration' } };
  }
  const content = source.content;
  const config = parseYaml(content);
  const schemaVersion = getSchemaVersion(config);
  return {
    code: 200,
    body: {
      content,
      revision: revision(content),
      config_revision: revision(content),
      schemaVersion,
      supported: SUPPORTED_SCHEMA_VERSION,
      config,
      ...ledgerReceipt(source.snapshot),
    },
  };
}

// Applies a semantic patch (allowlisted fields only) to the YAML AST, preserving
// comments, unknown keys and fields the form does not represent.
export function patchProjectConfig(
  projects,
  payload,
  { mutateConfig = mutateFileAtomic, beforeMutation } = {},
) {
  const found = projectFor(projects, payload.project);
  if (!found.project) return found;
  if (!payload.patch || typeof payload.patch !== 'object' || Array.isArray(payload.patch)) {
    return { code: 400, body: { error: 'patch must be an object' } };
  }
  const configRevision = configRevisionFrom(payload);
  if (typeof configRevision !== 'string') {
    return { code: 400, body: { error: 'config_revision is required' } };
  }
  // Explicitly reject attempts to change identity fields via patch.
  if ('project_id' in payload.patch) {
    return { code: 400, body: { error: 'project_id cannot be changed from the viewer' } };
  }
  if ('schema_version' in payload.patch) {
    return { code: 400, body: { error: 'schema_version cannot be changed via patch' } };
  }

  let source;
  try {
    source = projectConfigSource(found.project.path);
    assertLedgerRevision(source.snapshot, payload.ledger_revision);
    assertSupportedSchema(source.snapshot.config);
  } catch (error) {
    if (error instanceof LedgerConflictError) {
      return { code: 409, body: { error: error.message } };
    }
    return { code: 400, body: { error: error.message } };
  }

  let result;
  let mutation;
  try {
    mutation = mutateConfigSource(source, {
      configRevision,
      ledgerRevision: payload.ledger_revision,
      message: 'changeledger: patch config',
      transform: (before, snapshot) => {
        const doc = parseDocument(before, { merge: false });
        const config = doc.toJS() ?? {};

        assertSupportedSchema(config);
        applyPatch(doc, payload.patch, config);

        const patched = doc.toString();
        const candidate = parseYaml(patched);
        if (String(candidate.project_id ?? '') !== String(found.project.id)) {
          throw new Error('project_id cannot be changed from the viewer');
        }

        const candidateRepo = candidateRepoForValidation({ ...source, snapshot }, candidate);
        const { errors } = checkRepo(candidateRepo);
        if (errors.length) throw new Error(errors[0].message);

        const next = isDeepStrictEqual(candidate, config) ? before : patched;
        result = { rev: revision(next) };
        return next;
      },
      mutateConfig,
      beforeMutation,
    });
  } catch (error) {
    if (
      error instanceof LedgerConflictError ||
      error.message === 'configuration changed on disk; reload before saving'
    ) {
      return { code: 409, body: { error: error.message } };
    }
    return { code: 400, body: { error: error.message } };
  }

  return {
    code: 200,
    body: {
      ok: true,
      revision: result.rev,
      config_revision: result.rev,
      ...(mutation.receipt ?? {
        ledger_revision: mutation.ledgerRevision,
        ledger_freshness: mutation.ledgerRevision ? 'local' : null,
      }),
    },
  };
}

// Preview the migration without writing. Returns summary + candidate YAML.
export function previewConfigMigration(projects, id, configRevision, ledgerRevision) {
  const found = projectFor(projects, id);
  if (!found.project) return found;
  if (typeof configRevision !== 'string' || configRevision === '') {
    return { code: 400, body: { error: 'config_revision is required' } };
  }
  let source;
  try {
    source = projectConfigSource(found.project.path);
  } catch {
    return { code: 400, body: { error: 'unable to load the current project configuration' } };
  }
  const content = source.content;
  try {
    assertLedgerRevision(source.snapshot, ledgerRevision);
  } catch (error) {
    if (error instanceof LedgerConflictError) {
      return { code: 409, body: { error: error.message } };
    }
    throw error;
  }
  if (revision(content) !== configRevision) {
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
        config_revision: revision(content),
        ...ledgerReceipt(source.snapshot),
      },
    };
  }
  return {
    code: 200,
    body: {
      summary: `Config migration ${migrationResult.fromVersion} → ${SUPPORTED_SCHEMA_VERSION} (dry run)`,
      changes: migrationResult.changes,
      yaml: migrationResult.yaml,
      config_revision: revision(content),
      ...ledgerReceipt(source.snapshot),
    },
  };
}

// Apply the migration atomically. Uses the same engine as `changeledger config migrate`.
// Revision check and write are inside mutateFileAtomic to avoid TOCTOU races.
export function applyConfigMigration(
  projects,
  payload,
  { mutateConfig = mutateFileAtomic, beforeMutation } = {},
) {
  const found = projectFor(projects, payload.project);
  if (!found.project) return found;
  const configRevision = configRevisionFrom(payload);
  if (typeof configRevision !== 'string') {
    return { code: 400, body: { error: 'config_revision is required' } };
  }
  let source;
  try {
    source = projectConfigSource(found.project.path);
    assertLedgerRevision(source.snapshot, payload.ledger_revision);
    buildMigration(source.content);
  } catch (error) {
    if (error instanceof LedgerConflictError) {
      return { code: 409, body: { error: error.message } };
    }
    return { code: 400, body: { error: error.message } };
  }

  let result;
  let mutation;
  try {
    mutation = mutateConfigSource(source, {
      configRevision,
      ledgerRevision: payload.ledger_revision,
      message: 'changeledger: migrate config',
      transform: (before) => {
        const migrationResult = buildMigration(before);
        if (!migrationResult) {
          result = { already_current: true, rev: configRevision };
          return undefined;
        }
        result = { ok: true, rev: revision(migrationResult.yaml) };
        return migrationResult.yaml;
      },
      mutateConfig,
      beforeMutation,
    });
  } catch (error) {
    if (
      error instanceof LedgerConflictError ||
      error.message === 'configuration changed on disk; reload before saving'
    ) {
      return { code: 409, body: { error: error.message } };
    }
    return { code: 400, body: { error: error.message } };
  }

  if (result.already_current) {
    return {
      code: 200,
      body: {
        already_current: true,
        revision: result.rev,
        config_revision: result.rev,
        ...(mutation.receipt ?? {
          ledger_revision: mutation.ledgerRevision,
          ledger_freshness: mutation.ledgerRevision ? 'local' : null,
        }),
      },
    };
  }
  return {
    code: 200,
    body: {
      ok: true,
      revision: result.rev,
      config_revision: result.rev,
      ...(mutation.receipt ?? {
        ledger_revision: mutation.ledgerRevision,
        ledger_freshness: mutation.ledgerRevision ? 'local' : null,
      }),
    },
  };
}

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
}
