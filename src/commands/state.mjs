import { randomBytes } from 'node:crypto';
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
import { objectRun, receiveGitEnv } from '../git.mjs';
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

// A strong-protection probe gets a unique ref and nonce. The receive validator
// echoes both the nonce and its configured branch only after it has recognized
// the deliberately invalid probe layout. This makes a generic hook rejection
// insufficient evidence and proves which configured state branch answered.
const PROTECTION_PROBE_PREFIX = 'refs/changeledger/protection-probe/';
const PROTECTION_PROBE_FILE_PREFIX = 'changeledger-protection-probe-';
const PROTECTION_ATTESTATION = 'CHANGELEDGER_PROTECTION_ATTESTATION';
const PROTECTION_PROTOCOL = 'v1';

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
  { branch = DEFAULT_STATE_BRANCH, advisoryReason, confirmStrong = false } = {},
  cwd = process.cwd(),
  { gitEnv = {} } = {},
) {
  const advisory = String(advisoryReason ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim();
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

  // Strong protection (an installed, working pre-receive validator) substitutes
  // for the explicit advisory acceptance. The probe pushes to the remote, so it
  // only runs when the human explicitly opts in with --confirm-strong; a probe
  // that is not clearly rejected keeps today's `--advisory`-required behavior
  // unchanged.
  if (!advisory && !confirmStrong) {
    throw new Error(
      'remote protection was not checked; pass --advisory <reason>, or --confirm-strong to empirically verify it (pushes a throwaway probe to origin)',
    );
  }
  const protection = advisory
    ? { enforced: false }
    : confirmRemoteProtection(repoRoot, { branch, gitEnv });
  const remoteProtected = protection.enforced;
  if (!advisory && !remoteProtected) {
    throw new Error(
      `remote protection could not be verified${protection.diagnostic ? `: ${protection.diagnostic}` : ''}; owner enforcement: ${protection.ownerEnforcement ?? 'unavailable'}${protection.probeRef ? `; inspect probe ${protection.probeRef} and remove it if present using authorized remote administration` : ''}; pass --advisory <reason> to record an explicit advisory cutover`,
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
        advisory
          ? `Advisory cutover: ${advisory}`
          : 'Remote-validated cutover: pre-receive protection confirmed',
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

  return {
    branch,
    baseline: store.head,
    advisory: Boolean(advisory),
    remoteProtected,
    remoteOwnerEnforcement: protection.ownerEnforcement ?? 'unavailable',
  };
}

export function doctorState(
  { branch, confirmStrong = false } = {},
  cwd = process.cwd(),
  { gitEnv = {} } = {},
) {
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
  // The probe pushes a throwaway commit to origin, so it only runs when the
  // human explicitly opts in with --confirm-strong; otherwise doctor stays a
  // read-only diagnostic.
  const protection = confirmStrong
    ? confirmRemoteProtection(repoRoot, { branch: selectedBranch, gitEnv })
    : undefined;
  const remoteProtection = !confirmStrong
    ? 'not-checked'
    : protection.enforced
      ? 'enforced'
      : 'unverified';
  return {
    branch: selectedBranch,
    head: store.head,
    baseline,
    active: Boolean(active),
    append_only: true,
    remote_state: remoteState,
    remote_protection: remoteProtection,
    ...(protection?.ownerEnforcement
      ? { remote_owner_enforcement: protection.ownerEnforcement }
      : {}),
    ...(protection?.diagnostic ? { protection_error: protection.diagnostic } : {}),
    ...(protection?.probeRef ? { protection_probe: protection.probeRef } : {}),
    instructions: [
      'Disable force-push and branch deletion.',
      'Allow only fast-forward updates from authorized writers.',
      'Install the ChangeLedger pre-receive validator (changeledger state validate-receive) when the server supports hooks.',
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

// Server-side `pre-receive` entry point. Parses old/new/ref lines from stdin
// and validates every update to the protected state branch (and the reserved
// protection probe) with the same engine the CLI uses. Unlike a client command,
// it defaults its git env to `receiveGitEnv()` so the push's quarantined objects
// are visible; tests may inject an explicit `gitEnv`. Throwing rejects the push.
export function validateReceive(
  input,
  cwd = process.cwd(),
  { actor, humanOverride = false, branch = DEFAULT_STATE_BRANCH, gitEnv } = {},
) {
  const repoRoot = path.resolve(cwd);
  const receiveEnv = gitEnv ?? receiveGitEnv();
  const results = [];
  for (const line of String(input).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [oldHead, newHead, ref] = trimmed.split(/\s+/);
    if (!oldHead || !newHead || !ref) throw new Error(`invalid pre-receive input: ${line}`);
    if (ref === `refs/heads/${branch}`) {
      results.push(
        validateStateRange(repoRoot, {
          oldHead,
          newHead,
          actor,
          humanOverride,
          gitEnv: receiveEnv,
        }),
      );
      continue;
    }
    if (ref.startsWith(PROTECTION_PROBE_PREFIX)) {
      const nonce = ref.slice(PROTECTION_PROBE_PREFIX.length);
      if (!/^[0-9a-f]{32}$/.test(nonce)) {
        throw new Error(`invalid ChangeLedger protection probe ref: ${ref}`);
      }
      results.push(
        validateProtectionProbe(repoRoot, {
          oldHead,
          newHead,
          nonce,
          branch,
          ownerEnforcement: actor ? 'authenticated' : 'unavailable',
          gitEnv: receiveEnv,
        }),
      );
    }
  }
  return results;
}

function validateProtectionProbe(
  repoRoot,
  { oldHead, newHead, nonce, branch, ownerEnforcement, gitEnv },
) {
  if (!/^0+$/.test(oldHead) || /^0+$/.test(newHead)) {
    throw new Error('ChangeLedger protection probes must create a new ref');
  }
  const expectedFile = `${PROTECTION_PROBE_FILE_PREFIX}${nonce}.txt`;
  try {
    validateStateRange(repoRoot, { oldHead, newHead, gitEnv });
  } catch (error) {
    if (String(error.message).includes(`contains file outside the state layout: ${expectedFile}`)) {
      throw new Error(
        `${PROTECTION_ATTESTATION} ${PROTECTION_PROTOCOL} nonce=${nonce} branch=${branch} commit=${newHead} owner=${ownerEnforcement}`,
      );
    }
    throw error;
  }
  throw new Error('ChangeLedger protection probe unexpectedly passed state validation');
}

function parseProtectionAttestations(message) {
  const prefix = `${PROTECTION_ATTESTATION} `;
  const lines = String(message)
    .split('\n')
    .map((line) =>
      line
        .trim()
        .replace(/^remote:\s*/, '')
        .replace(/^Error:\s*/, ''),
    )
    .filter((line) => line.startsWith(prefix));
  return lines.map((line) => {
    const match = line.match(
      /^CHANGELEDGER_PROTECTION_ATTESTATION (\S+) nonce=([0-9a-f]{32}) branch=(\S+) commit=([0-9a-f]{40,64}) owner=(authenticated|unavailable)$/,
    );
    if (!match) return { malformed: true, raw: line };
    return {
      protocol: match[1],
      nonce: match[2],
      branch: match[3],
      commit: match[4],
      ownerEnforcement: match[5],
    };
  });
}

function protectionFailure(attestations, { nonce, branch, commit, probeRef }) {
  if (attestations.length > 1) {
    return {
      enforced: false,
      ownerEnforcement: 'unavailable',
      probeRef,
      diagnostic: `ambiguous attestation response: expected exactly one, received ${attestations.length}`,
    };
  }
  const parsed = attestations.find((attestation) => !attestation.malformed);
  if (!parsed) {
    return {
      enforced: false,
      ownerEnforcement: 'unavailable',
      probeRef,
      diagnostic: attestations.length
        ? `unsupported or malformed attestation protocol; expected ${PROTECTION_PROTOCOL}`
        : `no valid ChangeLedger ${PROTECTION_PROTOCOL} attestation was received`,
    };
  }
  if (parsed.protocol !== PROTECTION_PROTOCOL) {
    return {
      enforced: false,
      ownerEnforcement: 'unavailable',
      probeRef,
      diagnostic: `protocol mismatch: expected ${PROTECTION_PROTOCOL}, received ${parsed.protocol}`,
    };
  }
  if (parsed.branch !== branch) {
    return {
      enforced: false,
      ownerEnforcement: 'unavailable',
      probeRef,
      diagnostic: `branch mismatch: expected ${branch}, received ${parsed.branch}`,
    };
  }
  const mismatches = [];
  if (parsed.nonce !== nonce) mismatches.push('nonce');
  if (parsed.commit !== commit) mismatches.push('commit');
  return {
    enforced: false,
    ownerEnforcement: 'unavailable',
    probeRef,
    diagnostic: mismatches.length
      ? `attestation mismatch: ${mismatches.join(', ')}`
      : 'attestation did not match the expected protection protocol',
  };
}

// Empirically confirms the remote runs this validator for exactly `branch`.
// A nonce-bound response from the receive hook is the only success condition;
// generic rejections remain unverified. The probe never force-pushes or deletes
// refs. If an unprotected remote accepts it, the retained unique ref is returned
// as an explicit recovery diagnostic for an authorized administrator.
export function confirmRemoteProtection(
  repoRoot,
  { branch = DEFAULT_STATE_BRANCH, gitEnv = {} } = {},
) {
  try {
    objectRun(['remote', 'get-url', 'origin'], repoRoot, { env: gitEnv });
  } catch {
    return {
      enforced: false,
      ownerEnforcement: 'unavailable',
      diagnostic: 'remote "origin" is not configured or reachable',
    };
  }
  const nonce = randomBytes(16).toString('hex');
  const probeRef = `${PROTECTION_PROBE_PREFIX}${nonce}`;
  let commit;
  try {
    const blob = objectRun(['hash-object', '-w', '--stdin'], repoRoot, {
      input: 'changeledger remote protection probe\n',
      env: gitEnv,
    }).trim();
    const tree = objectRun(['mktree'], repoRoot, {
      input: `100644 blob ${blob}\t${PROTECTION_PROBE_FILE_PREFIX}${nonce}.txt\n`,
      env: gitEnv,
    }).trim();
    commit = objectRun(['commit-tree', tree, '-m', 'changeledger protection probe'], repoRoot, {
      env: gitEnv,
    }).trim();
  } catch {
    return {
      enforced: false,
      ownerEnforcement: 'unavailable',
      probeRef,
      diagnostic: 'unable to construct the ChangeLedger protection probe commit',
    };
  }
  try {
    objectRun(['push', 'origin', `${commit}:${probeRef}`], repoRoot, {
      env: gitEnv,
    });
  } catch (error) {
    // objectRun includes stderr in both the native child-process message and
    // its appended diagnostic. Parse the native stderr directly so transport
    // wrapping is not mistaken for a second attestation, while two lines
    // actually emitted by the hook still fail the exact-cardinality check.
    const pushStderr =
      typeof error.cause?.stderr === 'string' ? error.cause.stderr : String(error.message);
    const attestations = parseProtectionAttestations(pushStderr);
    const exact = attestations.length === 1 ? attestations[0] : undefined;
    if (
      exact &&
      !exact.malformed &&
      exact.protocol === PROTECTION_PROTOCOL &&
      exact.nonce === nonce &&
      exact.branch === branch &&
      exact.commit === commit
    ) {
      return {
        enforced: true,
        protocol: PROTECTION_PROTOCOL,
        ownerEnforcement: exact.ownerEnforcement,
      };
    }
    return protectionFailure(attestations, { nonce, branch, commit, probeRef });
  }
  return {
    enforced: false,
    ownerEnforcement: 'unavailable',
    probeRef,
    diagnostic: 'probe ref was accepted; remote protection is not enforced',
  };
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
