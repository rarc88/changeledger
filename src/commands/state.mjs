import fs from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { writeFileAtomic } from '../atomic-write.mjs';
import { parseChange } from '../change.mjs';
import {
  findChangeledgerDir,
  integrationBranch,
  loadConfig,
  resolveRepoPath,
  stateConfig,
} from '../config.mjs';
import { getSchemaVersion, SUPPORTED_SCHEMA_VERSION } from '../config-migration.mjs';
import { objectRun } from '../git.mjs';
import { previewStateMigration } from '../state-migration.mjs';
import {
  initializeStateStore,
  publishStateStore,
  readStateStore,
  refreshStateStoreConfirmation,
  syncStateStore,
  validateStateRange,
} from '../state-store.mjs';

const DEFAULT_STATE_BRANCH = 'changeledger/state';

function project(cwd) {
  const changeledgerDir = findChangeledgerDir(cwd);
  if (!changeledgerDir) throw new Error('Not a ChangeLedger repo.');
  const repoRoot = path.dirname(changeledgerDir);
  const config = loadConfig(changeledgerDir);
  return { changeledgerDir, repoRoot, config };
}

function assertCurrentSchema(config) {
  const version = getSchemaVersion(config);
  if (version !== SUPPORTED_SCHEMA_VERSION) {
    throw new Error(
      `state commands require config schema ${SUPPORTED_SCHEMA_VERSION} (current: ${version}); run changeledger config migrate`,
    );
  }
}

function assertWritableStore(store) {
  if (store.readOnly) {
    throw new Error(
      `state manifest schema ${store.manifest.schema_version} is newer than supported; update ChangeLedger before mutating`,
    );
  }
}

export function previewState({ refs } = {}, cwd = process.cwd(), { gitEnv = {} } = {}) {
  const { repoRoot, config } = project(cwd);
  assertCurrentSchema(config);
  return previewStateMigration(repoRoot, { refs, gitEnv });
}

export function initState(
  { refs, branch = DEFAULT_STATE_BRANCH } = {},
  cwd = process.cwd(),
  { gitEnv = {} } = {},
) {
  const { repoRoot, config } = project(cwd);
  assertCurrentSchema(config);
  if (stateConfig(config)) throw new Error('state store is already active');
  const integration = integrationBranch(config);
  if (!integration) throw new Error('state init requires config "git.integration_branch"');
  const preview = previewStateMigration(repoRoot, { refs, gitEnv });
  if (preview.conflicts.length) {
    throw new Error(
      `state migration has ${preview.conflicts.length} conflict(s): ${preview.conflicts
        .map((item) => `${item.kind}${item.id ? ` #${item.id}` : ''}`)
        .join(', ')}`,
    );
  }
  return initializeStateStore({
    repoRoot,
    branch,
    projectId: config.project_id,
    integrationBranch: integration,
    changes: preview.changes,
    origins: preview.origins,
    legacyBranches: preview.legacyBranches,
    gitEnv,
  });
}

export function publishState(
  { branch = DEFAULT_STATE_BRANCH } = {},
  cwd = process.cwd(),
  { gitEnv = {} } = {},
) {
  const { repoRoot, config } = project(cwd);
  assertCurrentSchema(config);
  if (stateConfig(config)) throw new Error('state store is already active; use state sync');
  const integration = integrationBranch(config);
  if (!integration) throw new Error('state publish requires config "git.integration_branch"');
  const store = readStateStore(repoRoot, branch, { gitEnv });
  assertWritableStore(store);
  if (String(store.manifest.project_id) !== String(config.project_id)) {
    throw new Error('state store project_id does not match this repository');
  }
  if (String(store.manifest.integration_branch) !== integration) {
    throw new Error('state store integration branch does not match the configuration');
  }
  return publishStateStore(repoRoot, branch, { gitEnv, allowUnmarked: true });
}

function currentBranch(repoRoot, gitEnv) {
  return objectRun(['branch', '--show-current'], repoRoot, { env: gitEnv }).trim();
}

function verifyWorkingChanges(changesDir, store) {
  const expected = new Map(
    store.changes.map((change) => [String(change.frontmatter.id), change.text]),
  );
  const names = fs.existsSync(changesDir)
    ? fs
        .readdirSync(changesDir)
        .filter((name) => name.endsWith('.md'))
        .sort()
    : [];
  for (const name of names) {
    const text = fs.readFileSync(path.join(changesDir, name), 'utf8');
    const id = String(parseChange(text).frontmatter.id);
    if (expected.get(id) !== text) {
      throw new Error(
        `working change ${name} changed after the state baseline; run state preview again`,
      );
    }
  }
  return names;
}

export function activateState(
  { branch = DEFAULT_STATE_BRANCH, advisoryReason } = {},
  cwd = process.cwd(),
  { gitEnv = {} } = {},
) {
  const advisory = String(advisoryReason ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim();
  if (!advisory) {
    throw new Error(
      'remote protection could not be verified; pass --advisory <reason> to record an explicit advisory cutover',
    );
  }
  const { changeledgerDir, repoRoot, config } = project(cwd);
  assertCurrentSchema(config);
  if (stateConfig(config)) throw new Error('state store is already active');
  const integration = integrationBranch(config);
  if (!integration) throw new Error('state activate requires config "git.integration_branch"');
  const current = currentBranch(repoRoot, gitEnv);
  if (current !== integration) {
    throw new Error(
      `state activate must run on integration branch "${integration}" (current: ${current})`,
    );
  }

  let confirmation;
  try {
    confirmation = refreshStateStoreConfirmation(repoRoot, branch, { gitEnv });
  } catch (error) {
    throw new Error(
      `state branch "${branch}" must be published and confirmed before activation: ${error.message}`,
    );
  }
  if (!confirmation.confirmed) {
    throw new Error(
      `state branch "${branch}" must be published and confirmed at ${confirmation.head ?? 'missing'} before activation; remote head is ${confirmation.remoteHead ?? 'missing'}`,
    );
  }
  const store = readStateStore(repoRoot, branch, { gitEnv });
  assertWritableStore(store);
  if (
    store.head !== confirmation.head ||
    store.head !== confirmation.confirmedHead ||
    store.head !== confirmation.remoteHead
  ) {
    throw new Error(
      `state candidate changed while activation was confirming it; reload and retry (snapshot ${store.head}, confirmed ${confirmation.confirmedHead ?? 'missing'}, remote ${confirmation.remoteHead ?? 'missing'})`,
    );
  }
  validateStateRange(repoRoot, {
    oldHead: '0'.repeat(store.head.length),
    newHead: store.head,
    humanOverride: true,
    gitEnv,
  });
  if (String(store.manifest.project_id) !== String(config.project_id)) {
    throw new Error('state store project_id does not match this repository');
  }
  if (String(store.manifest.integration_branch) !== integration) {
    throw new Error('state store integration branch does not match the configuration');
  }
  const changesDir = resolveRepoPath(repoRoot, config.changes_dir, 'changes_dir');
  const names = verifyWorkingChanges(changesDir, store);
  const configFile = path.join(changeledgerDir, 'config.yml');
  const originalConfig = fs.readFileSync(configFile, 'utf8');
  const originals = new Map(
    names.map((name) => [name, fs.readFileSync(path.join(changesDir, name), 'utf8')]),
  );
  const marker = path.join(changesDir, 'STATE_MOVED');

  try {
    const doc = parseDocument(originalConfig, { merge: false });
    doc.setIn(['git', 'state_branch'], branch);
    doc.setIn(['git', 'state_baseline'], store.head);
    for (const name of names) fs.rmSync(path.join(changesDir, name));
    writeFileAtomic(
      marker,
      [
        `Changes moved to refs/heads/${branch} at ${store.head}.`,
        `Advisory cutover: ${advisory}`,
        '',
      ].join('\n'),
    );
    writeFileAtomic(configFile, doc.toString({ lineWidth: 0, flowCollectionPadding: false }));
  } catch (error) {
    writeFileAtomic(configFile, originalConfig);
    fs.rmSync(marker, { force: true });
    fs.mkdirSync(changesDir, { recursive: true });
    for (const [name, text] of originals) writeFileAtomic(path.join(changesDir, name), text);
    throw error;
  }

  return { branch, baseline: store.head, advisory: true };
}

export function doctorState({ branch } = {}, cwd = process.cwd(), { gitEnv = {} } = {}) {
  const { repoRoot, config } = project(cwd);
  assertCurrentSchema(config);
  const active = stateConfig(config);
  const selectedBranch = branch ?? active?.branch ?? DEFAULT_STATE_BRANCH;
  const store = readStateStore(repoRoot, selectedBranch, { gitEnv });
  const baseline = active?.baseline ?? store.head;
  validateStateRange(repoRoot, {
    oldHead: '0'.repeat(store.head.length),
    newHead: store.head,
    humanOverride: true,
    gitEnv,
  });
  if (active) {
    try {
      objectRun(['merge-base', '--is-ancestor', baseline, store.head], repoRoot, { env: gitEnv });
    } catch {
      throw new Error(`state head ${store.head} does not descend from baseline ${baseline}`);
    }
  }
  let remoteState = 'unconfigured';
  try {
    const confirmation = refreshStateStoreConfirmation(repoRoot, selectedBranch, { gitEnv });
    remoteState = confirmation.confirmed ? 'confirmed' : 'diverged';
  } catch (error) {
    if (!/requires remote "origin"/.test(error.message)) throw error;
  }
  return {
    branch: selectedBranch,
    head: store.head,
    baseline,
    active: Boolean(active),
    append_only: true,
    remote_state: remoteState,
    remote_protection: 'unverified',
    instructions: [
      'Disable force-push and branch deletion.',
      'Allow only fast-forward updates from authorized writers.',
    ],
  };
}

export function syncState(cwd = process.cwd(), { gitEnv = {} } = {}) {
  const { repoRoot, config } = project(cwd);
  assertCurrentSchema(config);
  const active = stateConfig(config);
  if (!active) throw new Error('state sync requires an active state store');
  const store = readStateStore(repoRoot, active.branch, {
    baseline: active.baseline,
    gitEnv,
  });
  assertWritableStore(store);
  return syncStateStore(repoRoot, active.branch, { gitEnv });
}

export function abortState(cwd = process.cwd(), { gitEnv = {} } = {}) {
  const { changeledgerDir, repoRoot, config } = project(cwd);
  assertCurrentSchema(config);
  const active = stateConfig(config);
  if (!active) throw new Error('state abort requires an active state store');
  const integration = integrationBranch(config);
  const current = currentBranch(repoRoot, gitEnv);
  if (current !== integration) {
    throw new Error(
      `state abort must run on integration branch "${integration}" (current: ${current})`,
    );
  }
  const confirmation = refreshStateStoreConfirmation(repoRoot, active.branch, { gitEnv });
  const remoteHead = confirmation.remoteHead;
  if (!remoteHead) throw new Error(`state branch "${active.branch}" is missing from origin`);
  const store = readStateStore(repoRoot, active.branch, {
    baseline: active.baseline,
    sourceRef: `refs/changeledger/fetched/${active.branch}`,
    gitEnv,
  });
  assertWritableStore(store);
  if (store.head !== active.baseline) {
    throw new Error(
      `state has advanced from baseline ${active.baseline} to ${store.head}; export a recovery branch instead`,
    );
  }
  const changesDir = resolveRepoPath(repoRoot, config.changes_dir, 'changes_dir');
  const configFile = path.join(changeledgerDir, 'config.yml');
  const originalConfig = fs.readFileSync(configFile, 'utf8');
  try {
    const doc = parseDocument(originalConfig, { merge: false });
    doc.deleteIn(['git', 'state_branch']);
    doc.deleteIn(['git', 'state_baseline']);
    fs.mkdirSync(changesDir, { recursive: true });
    for (const change of store.changes)
      writeFileAtomic(path.join(changesDir, change.name), change.text);
    fs.rmSync(path.join(changesDir, 'STATE_MOVED'), { force: true });
    writeFileAtomic(configFile, doc.toString({ lineWidth: 0, flowCollectionPadding: false }));
  } catch (error) {
    writeFileAtomic(configFile, originalConfig);
    throw error;
  }
  return { branch: active.branch, baseline: active.baseline, candidate_preserved: true };
}

export function recoverState({ branch } = {}, cwd = process.cwd(), { gitEnv = {} } = {}) {
  if (!branch) throw new Error('state recover requires --branch <recovery-branch>');
  const { repoRoot, config } = project(cwd);
  assertCurrentSchema(config);
  const active = stateConfig(config);
  if (!active) throw new Error('state recover requires an active state store');
  const confirmation = refreshStateStoreConfirmation(repoRoot, active.branch, { gitEnv });
  if (!confirmation.remoteHead) {
    throw new Error(`state branch "${active.branch}" is missing from origin`);
  }
  const store = readStateStore(repoRoot, active.branch, {
    baseline: active.baseline,
    sourceRef: `refs/changeledger/fetched/${active.branch}`,
    gitEnv,
  });
  assertWritableStore(store);
  if (store.head === active.baseline) {
    throw new Error('state has not advanced; use state abort instead');
  }
  objectRun(['check-ref-format', '--branch', branch], repoRoot, { env: gitEnv });
  try {
    objectRun(
      ['update-ref', `refs/heads/${branch}`, store.head, '0'.repeat(store.head.length)],
      repoRoot,
      { env: gitEnv },
    );
  } catch (error) {
    throw new Error(
      `recovery branch "${branch}" already exists or cannot be created: ${error.message}`,
    );
  }
  return {
    branch,
    head: store.head,
    requires_cutover: true,
    source_branch: active.branch,
  };
}
