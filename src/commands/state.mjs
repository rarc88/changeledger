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
      'Install the ChangeLedger pre-receive validator when the server supports hooks.',
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

function configAtRevision(repoRoot, revision, gitEnv) {
  if (!revision || /^0+$/.test(revision)) return undefined;
  try {
    return parseDocument(
      objectRun(['show', `${revision}:.changeledger/config.yml`], repoRoot, { env: gitEnv }),
      { merge: false },
    ).toJS();
  } catch {
    return undefined;
  }
}

function receiveChangesDir(config) {
  const value = String(config?.changes_dir ?? '.changeledger/changes');
  const normalized = path.posix.normalize(value).replace(/^\.\//, '').replace(/\/$/, '');
  if (
    !normalized ||
    /[\0\r\n\t]/.test(value) ||
    path.posix.isAbsolute(value) ||
    normalized === '..' ||
    normalized.startsWith('../')
  ) {
    throw new Error('canonical changes_dir must be a repository-relative Git tree path');
  }
  return normalized;
}

function markdownTree(repoRoot, revision, changesDir, gitEnv) {
  return objectRun(['ls-tree', '-r', '--name-only', revision, '--', changesDir], repoRoot, {
    env: gitEnv,
  })
    .trim()
    .split('\n')
    .filter((name) => name.endsWith('.md'))
    .sort();
}

function revisionFile(repoRoot, revision, file, gitEnv) {
  try {
    return objectRun(['show', `${revision}:${file}`], repoRoot, { env: gitEnv });
  } catch {
    return undefined;
  }
}

function changedTreeEntries(repoRoot, oldHead, newHead, changesDir, gitEnv) {
  return objectRun(['diff', '--name-status', oldHead, newHead, '--', changesDir], repoRoot, {
    env: gitEnv,
  })
    .trim()
    .split('\n')
    .filter(Boolean);
}

function validateCutover(repoRoot, oldHead, newHead, changesDir, branch, store, gitEnv) {
  const markerPath = `${changesDir}/STATE_MOVED`;
  const marker = revisionFile(repoRoot, newHead, markerPath, gitEnv);
  const lines = marker?.split('\n');
  if (
    lines?.length !== 3 ||
    lines[0] !== `Changes moved to refs/heads/${branch} at ${store.head}.` ||
    !lines[1].startsWith('Advisory cutover: ') ||
    !lines[1].slice('Advisory cutover: '.length).trim() ||
    lines[2] !== ''
  ) {
    throw new Error(`cutover requires a canonical ${markerPath} advisory marker`);
  }
  const remaining = markdownTree(repoRoot, newHead, changesDir, gitEnv);
  if (remaining.length) {
    throw new Error(`cutover left legacy change document ${remaining[0]}`);
  }
  const expectedById = new Map(
    store.changes.map((change) => [String(change.frontmatter.id), change.text]),
  );
  const oldNames = markdownTree(repoRoot, oldHead, changesDir, gitEnv);
  for (const name of oldNames) {
    const relative = name.slice(changesDir.length + 1);
    const text = revisionFile(repoRoot, oldHead, name, gitEnv);
    const id = String(parseChange(text).frontmatter.id);
    if (relative.includes('/') || expectedById.get(id) !== text) {
      throw new Error(`cutover legacy document ${name} does not match the state candidate`);
    }
  }
  const expectedChanges = new Set([`A\t${markerPath}`, ...oldNames.map((name) => `D\t${name}`)]);
  const changed = changedTreeEntries(repoRoot, oldHead, newHead, changesDir, gitEnv);
  if (
    changed.length !== expectedChanges.size ||
    changed.some((entry) => !expectedChanges.has(entry))
  ) {
    throw new Error('cutover changed files other than the canonical legacy documents and marker');
  }
}

function validateLegacyRollback(
  repoRoot,
  oldRevision,
  revision,
  changesDir,
  store,
  baseline,
  gitEnv,
) {
  if (store.head !== baseline) {
    throw new Error('legacy authority cannot be restored after the global state has advanced');
  }
  const expected = new Map(
    store.changes.map((change) => [
      `${changesDir}/${path.posix.basename(change.file)}`,
      change.text,
    ]),
  );
  const names = markdownTree(repoRoot, revision, changesDir, gitEnv);
  if (
    names.length !== expected.size ||
    names.some((name) => revisionFile(repoRoot, revision, name, gitEnv) !== expected.get(name))
  ) {
    throw new Error('legacy authority rollback does not exactly restore the state baseline');
  }
  const markerPath = `${changesDir}/STATE_MOVED`;
  if (revisionFile(repoRoot, revision, markerPath, gitEnv) !== undefined) {
    throw new Error('legacy authority rollback must remove STATE_MOVED');
  }
  const expectedChanges = new Set([`D\t${markerPath}`, ...names.map((name) => `A\t${name}`)]);
  const changed = changedTreeEntries(repoRoot, oldRevision, revision, changesDir, gitEnv);
  if (
    changed.length !== expectedChanges.size ||
    changed.some((entry) => !expectedChanges.has(entry))
  ) {
    throw new Error(
      'legacy authority rollback changed files outside the exact baseline restoration',
    );
  }
}

export function validateReceive(
  input,
  cwd = process.cwd(),
  {
    actor,
    humanOverride = false,
    branch = DEFAULT_STATE_BRANCH,
    integrationBranch: protectedIntegration,
    gitEnv = {},
  } = {},
) {
  const repoRoot = path.resolve(cwd);
  const expectedRef = `refs/heads/${branch}`;
  const updates = String(input)
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [oldHead, newHead, ref] = line.trim().split(/\s+/);
      if (!oldHead || !newHead || !ref) throw new Error(`invalid pre-receive input: ${line}`);
      return { oldHead, newHead, ref };
    });
  const results = [];
  for (const { oldHead, newHead, ref } of updates) {
    if (ref === expectedRef) {
      results.push(
        validateStateRange(repoRoot, { oldHead, newHead, actor, humanOverride, gitEnv }),
      );
    }
  }

  let integration = protectedIntegration;
  if (!integration) {
    const stateUpdate = updates.find(
      (item) => item.ref === expectedRef && !/^0+$/.test(item.newHead),
    );
    const stateRevision = stateUpdate?.newHead ?? expectedRef;
    try {
      integration = readStateStore(repoRoot, branch, {
        sourceRef: stateRevision,
        gitEnv,
      }).manifest.integration_branch;
    } catch {
      // An inactive or absent state branch has no legacy authority to enforce.
    }
  }
  if (!integration) return results;

  const integrationRef = `refs/heads/${integration}`;
  const integrationUpdate = updates.find((item) => item.ref === integrationRef);
  const newCanonicalConfig = configAtRevision(
    repoRoot,
    integrationUpdate?.newHead ?? integrationRef,
    gitEnv,
  );
  const oldCanonicalConfig = integrationUpdate
    ? configAtRevision(repoRoot, integrationUpdate.oldHead, gitEnv)
    : newCanonicalConfig;
  const oldCanonicalState = oldCanonicalConfig ? stateConfig(oldCanonicalConfig) : undefined;
  const newCanonicalState = newCanonicalConfig ? stateConfig(newCanonicalConfig) : undefined;
  const oldActive = oldCanonicalState?.branch === branch;
  const newActive = newCanonicalState?.branch === branch;
  if (!oldActive && !newActive) return results;
  if ((oldCanonicalState && !oldActive) || (newCanonicalState && !newActive)) {
    throw new Error(`canonical state branch cannot change away from ${branch}`);
  }
  const oldChangesDir = oldCanonicalConfig ? receiveChangesDir(oldCanonicalConfig) : undefined;
  const newChangesDir = newCanonicalConfig ? receiveChangesDir(newCanonicalConfig) : undefined;
  if (oldActive && newActive && oldChangesDir !== newChangesDir) {
    throw new Error('canonical changes_dir cannot change while global state is active');
  }
  const changesDir = newChangesDir ?? oldChangesDir;
  if (!changesDir) throw new Error('active global state requires a canonical changes_dir');
  if (newActive) {
    if (integrationBranch(newCanonicalConfig) !== integration) {
      throw new Error(`canonical integration branch cannot change away from ${integration}`);
    }
    if (oldActive && oldCanonicalState.baseline !== newCanonicalState.baseline) {
      throw new Error('canonical state baseline cannot change after activation');
    }
    const stateUpdate = updates.find(
      (item) => item.ref === expectedRef && !/^0+$/.test(item.newHead),
    );
    const canonicalStore = readStateStore(repoRoot, branch, {
      baseline: newCanonicalState.baseline,
      sourceRef: stateUpdate?.newHead ?? expectedRef,
      gitEnv,
    });
    if (oldActive && stateUpdate && /^0+$/.test(stateUpdate.oldHead)) {
      throw new Error('active global state branch cannot be recreated');
    }
    if (!oldActive) {
      validateStateRange(repoRoot, {
        oldHead: '0'.repeat(canonicalStore.head.length),
        newHead: canonicalStore.head,
        humanOverride: true,
        gitEnv,
      });
      if (newCanonicalState.baseline !== canonicalStore.head) {
        throw new Error('initial cutover baseline must equal the complete state candidate head');
      }
      if (!integrationUpdate) throw new Error('initial cutover requires an integration update');
      validateCutover(
        repoRoot,
        integrationUpdate.oldHead,
        integrationUpdate.newHead,
        changesDir,
        branch,
        canonicalStore,
        gitEnv,
      );
    }
    if (
      String(canonicalStore.manifest.project_id) !== String(newCanonicalConfig.project_id) ||
      String(canonicalStore.manifest.integration_branch) !== integration
    ) {
      throw new Error('canonical integration config does not match the global state manifest');
    }
  }

  if (oldActive && !newActive) {
    if (!integrationUpdate || /^0+$/.test(integrationUpdate.newHead)) {
      throw new Error('active global state authority cannot be deleted');
    }
    const store = readStateStore(repoRoot, branch, {
      baseline: oldCanonicalState.baseline,
      sourceRef: expectedRef,
      gitEnv,
    });
    validateLegacyRollback(
      repoRoot,
      integrationUpdate.oldHead,
      integrationUpdate.newHead,
      changesDir,
      store,
      oldCanonicalState.baseline,
      gitEnv,
    );
    results.push({ ok: true, ref: integrationRef, legacy_rollback: 'verified' });
  }

  for (const update of updates) {
    if (update.ref === expectedRef || /^0+$/.test(update.newHead)) continue;
    const args = /^0+$/.test(update.oldHead)
      ? [
          'diff-tree',
          '--root',
          '--no-commit-id',
          '--name-status',
          '-r',
          update.newHead,
          '--',
          changesDir,
        ]
      : ['diff', '--name-status', update.oldHead, update.newHead, '--', changesDir];
    const changed = objectRun(args, repoRoot, { env: gitEnv }).trim().split('\n').filter(Boolean);
    if (!changed.length) continue;
    const isCutover =
      !oldActive && newActive && update.ref === integrationRef && integrationUpdate === update;
    const isRollback = oldActive && !newActive && update.ref === integrationRef;
    if (!isCutover && !isRollback) {
      throw new Error(
        `legacy change state under ${changesDir} is read-only after activation on ${integration}; update ${expectedRef} instead (${update.ref})`,
      );
    }
    if (isCutover) results.push({ ok: true, ref: update.ref, legacy_cutover: 'verified' });
  }
  return results;
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
