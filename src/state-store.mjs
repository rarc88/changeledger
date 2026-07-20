import { parseChange } from './change.mjs';
import { checkRepo } from './check.mjs';
import { isValidBranchName, objectRun } from './git.mjs';
import { parseLogEvent } from './lifecycle.mjs';
import { parseYaml, serializeScalar } from './yaml.mjs';

export const STATE_ROOT = '.changeledger-state';
export const STATE_MANIFEST = `${STATE_ROOT}/manifest.yml`;
export const STATE_CHANGES_DIR = `${STATE_ROOT}/changes`;
export const STATE_SCHEMA_VERSION = 1;

const ZERO_OID = '0'.repeat(40);

export class StateConflictError extends Error {
  constructor(id, expectedHead, currentHead) {
    super(
      `state conflict for change "${id}": expected ${expectedHead}, current ${currentHead}; reload before retrying`,
    );
    this.name = 'StateConflictError';
    this.id = id;
    this.expectedHead = expectedHead;
    this.currentHead = currentHead;
  }
}

function refName(branch) {
  if (!isValidBranchName(branch)) throw new Error(`invalid state branch: ${branch}`);
  return `refs/heads/${branch}`;
}

function run(repoRoot, args, gitEnv, input) {
  return objectRun(args, repoRoot, { env: gitEnv, input }).trim();
}

function runRaw(repoRoot, args, gitEnv) {
  return objectRun(args, repoRoot, { env: gitEnv });
}

function resolveHead(repoRoot, ref, gitEnv) {
  try {
    return run(repoRoot, ['rev-parse', '--verify', ref], gitEnv);
  } catch {
    return undefined;
  }
}

function pendingRef(branch) {
  return `refs/changeledger/pending/${branch}`;
}

function confirmedRef(branch) {
  return `refs/changeledger/confirmed/${branch}`;
}

function remoteAvailable(repoRoot, gitEnv) {
  try {
    run(repoRoot, ['remote', 'get-url', 'origin'], gitEnv);
    return true;
  } catch {
    return false;
  }
}

export function statePending(repoRoot, branch, { gitEnv = {} } = {}) {
  const head = resolveHead(repoRoot, pendingRef(branch), gitEnv);
  if (!head) return { pending: false, ids: [] };
  const remote = resolveHead(repoRoot, `refs/remotes/origin/${branch}`, gitEnv);
  let messages = '';
  try {
    messages = runRaw(
      repoRoot,
      ['log', '--format=%B', remote ? `${remote}..${head}` : head, '--', STATE_CHANGES_DIR],
      gitEnv,
    );
  } catch {
    // The marker itself remains enough to expose a pending condition.
  }
  const ids = [...messages.matchAll(/^Change-Id:\s*(\S+)/gm)].map((match) => match[1]);
  return { pending: true, head, ids: [...new Set(ids)] };
}

export function refreshStateStoreConfirmation(repoRoot, branch, { gitEnv = {} } = {}) {
  if (!remoteAvailable(repoRoot, gitEnv)) {
    throw new Error('state confirmation requires remote "origin"');
  }
  const ref = refName(branch);
  const fetched = `refs/changeledger/fetched/${branch}`;
  run(repoRoot, ['fetch', 'origin', `+${ref}:${fetched}`], gitEnv);
  const head = resolveHead(repoRoot, ref, gitEnv);
  const confirmedHead = resolveHead(repoRoot, confirmedRef(branch), gitEnv);
  const remoteHead = resolveHead(repoRoot, fetched, gitEnv);
  if (confirmedHead && remoteHead) {
    try {
      run(repoRoot, ['merge-base', '--is-ancestor', confirmedHead, remoteHead], gitEnv);
    } catch {
      throw new Error(
        `remote state head ${remoteHead} does not descend from last confirmed global head ${confirmedHead}`,
      );
    }
  }
  const pending = statePending(repoRoot, branch, { gitEnv });
  return {
    head,
    confirmedHead,
    remoteHead,
    confirmed: Boolean(head && confirmedHead === head && remoteHead === head && !pending.pending),
  };
}

export function publishStateStore(repoRoot, branch, { gitEnv = {} } = {}) {
  const ref = refName(branch);
  const head = resolveHead(repoRoot, ref, gitEnv);
  if (!head) throw new Error(`state branch "${branch}" does not exist`);
  if (!remoteAvailable(repoRoot, gitEnv)) {
    run(repoRoot, ['update-ref', pendingRef(branch), head], gitEnv);
    return { head, confirmed: false, pending: true, remote: 'unconfigured' };
  }
  const knownRemote = resolveHead(repoRoot, `refs/remotes/origin/${branch}`, gitEnv);
  try {
    run(repoRoot, ['push', 'origin', `${ref}:${ref}`], gitEnv);
    run(repoRoot, ['update-ref', confirmedRef(branch), head], gitEnv);
    try {
      run(repoRoot, ['update-ref', '-d', pendingRef(branch)], gitEnv);
    } catch {
      // An absent marker is already the desired state.
    }
    return { head, confirmed: true, pending: false, remote: 'origin' };
  } catch (error) {
    if (knownRemote) {
      try {
        const common = run(repoRoot, ['merge-base', head, knownRemote], gitEnv);
        run(repoRoot, ['update-ref', confirmedRef(branch), common], gitEnv);
      } catch {
        // An unrelated remote is still a pending conflict; sync will fail closed.
      }
    }
    run(repoRoot, ['update-ref', pendingRef(branch), head], gitEnv);
    return { head, confirmed: false, pending: true, remote: 'origin', error: error.message };
  }
}

function safeField(value) {
  return String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

function renderManifest({ projectId, integrationBranch, legacyBranches = {} }) {
  const lines = [
    `schema_version: ${STATE_SCHEMA_VERSION}`,
    `project_id: ${serializeScalar(projectId)}`,
    `integration_branch: ${serializeScalar(integrationBranch)}`,
  ];
  const entries = Object.entries(legacyBranches).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length) {
    lines.push('legacy_branches:');
    for (const [id, branch] of entries) {
      lines.push(`  ${serializeScalar(id)}: ${serializeScalar(branch)}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function insertFile(root, file, text) {
  const parts = file.split('/');
  let node = root;
  for (const part of parts.slice(0, -1)) {
    if (!part || part === '.' || part === '..' || /[\t\n]/.test(part)) {
      throw new Error(`invalid state path: ${file}`);
    }
    if (!node.has(part)) node.set(part, new Map());
    const next = node.get(part);
    if (!(next instanceof Map)) throw new Error(`state path collision: ${file}`);
    node = next;
  }
  const name = parts.at(-1);
  if (!name || /[\t\n]/.test(name) || node.has(name))
    throw new Error(`invalid state path: ${file}`);
  node.set(name, text);
}

function writeTree(repoRoot, files, gitEnv) {
  const root = new Map();
  for (const [file, text] of files) insertFile(root, file, text);

  const writeNode = (node) => {
    const lines = [];
    for (const [name, value] of [...node.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (value instanceof Map) {
        const oid = writeNode(value);
        lines.push(`040000 tree ${oid}\t${name}`);
      } else {
        const oid = run(repoRoot, ['hash-object', '-w', '--stdin'], gitEnv, value);
        lines.push(`100644 blob ${oid}\t${name}`);
      }
    }
    return run(repoRoot, ['mktree'], gitEnv, `${lines.join('\n')}\n`);
  };

  return writeNode(root);
}

function createCommit(repoRoot, files, { parent, message, gitEnv }) {
  const tree = writeTree(repoRoot, files, gitEnv);
  const args = ['commit-tree', tree];
  if (parent) args.push('-p', parent);
  args.push('-m', message);
  return run(repoRoot, args, gitEnv);
}

function readFilesAt(repoRoot, revision, gitEnv) {
  const names = run(repoRoot, ['ls-tree', '-r', '--name-only', revision, '--', STATE_ROOT], gitEnv)
    .split('\n')
    .filter(Boolean);
  return new Map(
    names.map((name) => [name, runRaw(repoRoot, ['show', `${revision}:${name}`], gitEnv)]),
  );
}

function parseStore(repoRoot, head, gitEnv, { allowFutureRead = false } = {}) {
  const files = readFilesAt(repoRoot, head, gitEnv);
  const manifestText = files.get(STATE_MANIFEST);
  if (!manifestText) throw new Error(`state store ${head} is missing ${STATE_MANIFEST}`);
  const manifest = parseYaml(manifestText);
  const futureSchema = Number(manifest.schema_version) > STATE_SCHEMA_VERSION;
  if (manifest.schema_version !== STATE_SCHEMA_VERSION && !(allowFutureRead && futureSchema)) {
    throw new Error(
      `state schema ${manifest.schema_version} is newer than supported schema ${STATE_SCHEMA_VERSION}`,
    );
  }
  const changes = [];
  for (const [file, text] of files) {
    if (!file.startsWith(`${STATE_CHANGES_DIR}/`) || !file.endsWith('.md')) continue;
    const name = file.slice(STATE_CHANGES_DIR.length + 1);
    changes.push({ file, name, text, ...parseChange(text) });
  }
  changes.sort((a, b) => String(a.frontmatter.id).localeCompare(String(b.frontmatter.id)));
  return {
    head,
    manifest,
    changes,
    files,
    readOnly: futureSchema,
    minimumVersion: futureSchema ? manifest.schema_version : undefined,
  };
}

export function readStateStore(
  repoRoot,
  branch,
  { gitEnv = {}, baseline, sourceRef, allowFutureRead = true } = {},
) {
  const ref = sourceRef ?? refName(branch);
  const head = resolveHead(repoRoot, ref, gitEnv);
  if (!head) throw new Error(`state branch "${branch}" does not exist`);
  if (baseline) {
    try {
      run(repoRoot, ['merge-base', '--is-ancestor', baseline, head], gitEnv);
    } catch {
      throw new Error(`state head ${head} does not descend from baseline ${baseline}`);
    }
  }
  const pending = statePending(repoRoot, branch, { gitEnv });
  if (!sourceRef) {
    const confirmedHeads = [resolveHead(repoRoot, confirmedRef(branch), gitEnv)].filter(Boolean);
    const remoteHeads = [resolveHead(repoRoot, `refs/remotes/origin/${branch}`, gitEnv)].filter(
      Boolean,
    );
    const pendingAtHead = pending.pending && pending.head === head;
    if (pendingAtHead && remoteHeads.length && !confirmedHeads.length) {
      throw new Error(
        `pending state has no confirmed global base for known remote head ${remoteHeads[0]}`,
      );
    }
    for (const confirmed of confirmedHeads) {
      for (const remote of remoteHeads) {
        try {
          run(repoRoot, ['merge-base', '--is-ancestor', confirmed, remote], gitEnv);
        } catch {
          throw new Error(
            `remote state head ${remote} does not descend from last confirmed global head ${confirmed}`,
          );
        }
      }
    }
    const knownHeads = pendingAtHead ? confirmedHeads : [...confirmedHeads, ...remoteHeads];
    for (const confirmed of new Set(knownHeads)) {
      try {
        run(repoRoot, ['merge-base', '--is-ancestor', confirmed, head], gitEnv);
      } catch {
        throw new Error(
          `state head ${head} does not descend from last confirmed global head ${confirmed}`,
        );
      }
    }
  }
  return {
    ...parseStore(repoRoot, head, gitEnv, { allowFutureRead }),
    sourceRef: ref,
    pending,
  };
}

export function initializeStateStore({
  repoRoot,
  branch,
  projectId,
  integrationBranch,
  legacyBranches = {},
  changes,
  origins = [],
  gitEnv = {},
}) {
  const ref = refName(branch);
  if (resolveHead(repoRoot, ref, gitEnv))
    throw new Error(`state branch "${branch}" already exists`);
  const files = new Map([
    [STATE_MANIFEST, renderManifest({ projectId, integrationBranch, legacyBranches })],
  ]);
  for (const change of changes) {
    if (!change.name?.endsWith('.md')) throw new Error(`invalid change filename: ${change.name}`);
    files.set(`${STATE_CHANGES_DIR}/${change.name}`, change.text);
  }
  const trailers = origins.map(
    ({ id, ref: originRef, commit, blob }) =>
      `Change-Origin: ${safeField(id)} ${safeField(originRef)} ${safeField(commit)} ${safeField(blob)}`,
  );
  const message = ['ChangeLedger state baseline', '', ...trailers].join('\n').trim();
  const head = createCommit(repoRoot, files, { message, gitEnv });
  try {
    run(repoRoot, ['update-ref', ref, head, ZERO_OID], gitEnv);
  } catch (error) {
    throw new Error(`state branch "${branch}" changed during initialization: ${error.message}`);
  }
  return { head, branch, pending: true };
}

function changeById(store, id) {
  const matches = store.changes.filter((change) => String(change.frontmatter.id) === String(id));
  if (matches.length !== 1) {
    throw new Error(
      matches.length ? `duplicate state change id "${id}"` : `no state change with id "${id}"`,
    );
  }
  return matches[0];
}

export function addStateChange({
  repoRoot,
  branch,
  expectedHead,
  name,
  text,
  actor,
  codeRevision,
  codeBranch,
  gitEnv = {},
}) {
  if (!/^[^/]+\.md$/.test(name) || /[\t\r\n]/.test(name)) {
    throw new Error(`invalid change filename: ${name}`);
  }
  const parsed = parseChange(text);
  const id = String(parsed.frontmatter.id);
  const ref = refName(branch);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const currentHead = resolveHead(repoRoot, ref, gitEnv);
    if (!currentHead) throw new Error(`state branch "${branch}" does not exist`);
    const current = parseStore(repoRoot, currentHead, gitEnv);
    if (current.changes.some((change) => String(change.frontmatter.id) === id)) {
      throw new StateConflictError(id, expectedHead, currentHead);
    }
    const file = `${STATE_CHANGES_DIR}/${name}`;
    if (current.files.has(file)) throw new Error(`state change file already exists: ${name}`);
    const files = new Map(current.files);
    files.set(file, text);
    const message = [
      `ChangeLedger state: create #${safeField(id)}`,
      '',
      `Change-Id: ${safeField(id)}`,
      'Change-Operation: create',
      `Change-Actor: ${safeField(actor)}`,
      ...(codeRevision ? [`Code-Revision: ${safeField(codeRevision)}`] : []),
      ...(codeBranch ? [`Code-Branch: ${safeField(codeBranch)}`] : []),
    ].join('\n');
    const head = createCommit(repoRoot, files, { parent: currentHead, message, gitEnv });
    try {
      run(repoRoot, ['update-ref', ref, head, currentHead], gitEnv);
      const publication = publishStateStore(repoRoot, branch, { gitEnv });
      return {
        head,
        previousHead: currentHead,
        retried: currentHead !== expectedHead,
        ...publication,
      };
    } catch {
      // Retry only if another writer added a different id.
    }
  }
  throw new Error(`state branch "${branch}" kept changing; retry the operation`);
}

export function mutateStateChange({
  repoRoot,
  branch,
  id,
  expectedHead,
  operation,
  actor,
  codeRevision,
  codeBranch,
  mutate,
  gitEnv = {},
}) {
  const ref = refName(branch);
  const expected = parseStore(repoRoot, expectedHead, gitEnv);
  const expectedChange = changeById(expected, id);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const currentHead = resolveHead(repoRoot, ref, gitEnv);
    if (!currentHead) throw new Error(`state branch "${branch}" does not exist`);
    const current = parseStore(repoRoot, currentHead, gitEnv);
    const currentChange = changeById(current, id);
    if (currentHead !== expectedHead && currentChange.text !== expectedChange.text) {
      throw new StateConflictError(String(id), expectedHead, currentHead);
    }
    const nextText = mutate(currentChange.text);
    if (typeof nextText !== 'string') throw new Error('state mutation must return text');
    const files = new Map(current.files);
    files.set(currentChange.file, nextText);
    const message = [
      `ChangeLedger state: ${safeField(operation)} #${safeField(id)}`,
      '',
      `Change-Id: ${safeField(id)}`,
      `Change-Operation: ${safeField(operation)}`,
      `Change-Actor: ${safeField(actor)}`,
      ...(codeRevision ? [`Code-Revision: ${safeField(codeRevision)}`] : []),
      ...(codeBranch ? [`Code-Branch: ${safeField(codeBranch)}`] : []),
    ].join('\n');
    const head = createCommit(repoRoot, files, { parent: currentHead, message, gitEnv });
    try {
      run(repoRoot, ['update-ref', ref, head, currentHead], gitEnv);
      const publication = publishStateStore(repoRoot, branch, { gitEnv });
      return {
        head,
        previousHead: currentHead,
        retried: currentHead !== expectedHead,
        ...publication,
      };
    } catch {
      // Another local process won the ref race. Re-read and apply the same
      // document-level conflict rule before trying again.
    }
  }
  throw new Error(`state branch "${branch}" kept changing; retry the operation`);
}

function fileAt(repoRoot, revision, file, gitEnv) {
  try {
    return runRaw(repoRoot, ['show', `${revision}:${file}`], gitEnv);
  } catch {
    return undefined;
  }
}

function duplicateChangeId(files) {
  const seen = new Set();
  for (const [file, text] of files) {
    if (!file.startsWith(`${STATE_CHANGES_DIR}/`) || !file.endsWith('.md')) continue;
    const id = String(parseChange(text).frontmatter.id);
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return undefined;
}

export function syncStateStore(repoRoot, branch, { gitEnv = {} } = {}) {
  if (!remoteAvailable(repoRoot, gitEnv)) throw new Error('state sync requires remote "origin"');
  const ref = refName(branch);
  const beforeFetch = resolveHead(repoRoot, ref, gitEnv);
  if (!beforeFetch) throw new Error(`state branch "${branch}" does not exist`);
  parseStore(repoRoot, beforeFetch, gitEnv);
  const fetched = `refs/changeledger/fetched/${branch}`;
  run(repoRoot, ['fetch', 'origin', `${ref}:${fetched}`], gitEnv);
  const localHead = resolveHead(repoRoot, ref, gitEnv);
  const remoteHead = resolveHead(repoRoot, fetched, gitEnv);
  if (!localHead || !remoteHead) throw new Error(`unable to resolve local and remote state heads`);
  parseStore(repoRoot, remoteHead, gitEnv);
  const confirmedHead = resolveHead(repoRoot, confirmedRef(branch), gitEnv);
  if (confirmedHead) {
    try {
      run(repoRoot, ['merge-base', '--is-ancestor', confirmedHead, remoteHead], gitEnv);
    } catch {
      throw new Error(
        `remote state head ${remoteHead} does not descend from last confirmed global head ${confirmedHead}`,
      );
    }
  }
  if (localHead === remoteHead) {
    run(repoRoot, ['update-ref', confirmedRef(branch), remoteHead], gitEnv);
    run(repoRoot, ['update-ref', '-d', pendingRef(branch)], gitEnv);
    return { head: localHead, confirmed: true, pending: false, replayed: 0 };
  }
  try {
    run(repoRoot, ['merge-base', '--is-ancestor', remoteHead, localHead], gitEnv);
    return { ...publishStateStore(repoRoot, branch, { gitEnv }), replayed: 0 };
  } catch {
    // The remote advanced independently; replay local state commits below.
  }
  const base = run(repoRoot, ['merge-base', localHead, remoteHead], gitEnv);
  const commits = run(repoRoot, ['rev-list', '--reverse', `${base}..${localHead}`], gitEnv)
    .split('\n')
    .filter(Boolean);
  let target = remoteHead;
  let priorLocal = base;
  for (const commit of commits) {
    const changed = run(
      repoRoot,
      ['diff-tree', '--no-commit-id', '--name-only', '-r', priorLocal, commit, '--', STATE_ROOT],
      gitEnv,
    )
      .split('\n')
      .filter(Boolean);
    const files = new Map(readFilesAt(repoRoot, target, gitEnv));
    for (const file of changed) {
      const before = fileAt(repoRoot, priorLocal, file, gitEnv);
      const remote = fileAt(repoRoot, target, file, gitEnv);
      const local = fileAt(repoRoot, commit, file, gitEnv);
      if (remote !== before && remote !== local) {
        const parsed = local ? parseChange(local) : undefined;
        const id = parsed?.frontmatter.id ?? pathId(file);
        throw new StateConflictError(String(id), priorLocal, target);
      }
      if (local === undefined) files.delete(file);
      else files.set(file, local);
    }
    const duplicateId = duplicateChangeId(files);
    if (duplicateId) throw new StateConflictError(duplicateId, priorLocal, target);
    const message = runRaw(repoRoot, ['show', '-s', '--format=%B', commit], gitEnv).trimEnd();
    target = createCommit(repoRoot, files, { parent: target, message, gitEnv });
    priorLocal = commit;
  }
  validateStateRange(repoRoot, { oldHead: remoteHead, newHead: target, gitEnv });
  run(repoRoot, ['update-ref', ref, target, localHead], gitEnv);
  const publication = publishStateStore(repoRoot, branch, { gitEnv });
  return { ...publication, replayed: commits.length };
}

function pathId(file) {
  return file.slice(file.lastIndexOf('/') + 1).match(/^(\d{8}-\d{6})-/)?.[1] ?? file;
}

function canonicalConfigText(repoRoot, integrationBranch, gitEnv) {
  const candidates = [
    `refs/heads/${integrationBranch}`,
    `refs/remotes/origin/${integrationBranch}`,
  ];
  const ref = candidates.find((candidate) => resolveHead(repoRoot, candidate, gitEnv));
  if (!ref) throw new Error(`integration branch "${integrationBranch}" does not exist`);
  return runRaw(repoRoot, ['show', `${ref}:.changeledger/config.yml`], gitEnv);
}

const OWNED_STATUSES = new Set([
  'approved',
  'in-progress',
  'in-review',
  'in-validation',
  'blocked',
]);

function parsedLogEvents(text) {
  const log = parseChange(text).stages.find((stage) => stage.key === 'log');
  return (log?.body ?? '')
    .split('\n')
    .map((line) => parseLogEvent(line))
    .filter(Boolean);
}

function addedLogEvents(beforeText, afterText) {
  const counts = new Map();
  for (const event of parsedLogEvents(beforeText)) {
    const key = JSON.stringify(event);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const added = [];
  for (const event of parsedLogEvents(afterText)) {
    const key = JSON.stringify(event);
    const remaining = counts.get(key) ?? 0;
    if (remaining) counts.set(key, remaining - 1);
    else added.push(event);
  }
  return added;
}

function validateStateOwnershipForCommit(repoRoot, commit, store, message, gitEnv) {
  for (const change of store.changes) {
    if (OWNED_STATUSES.has(change.frontmatter.status) && !change.frontmatter.owner) {
      throw new Error(
        `state commit ${commit} active change #${change.frontmatter.id} requires an owner`,
      );
    }
  }

  const parent = resolveHead(repoRoot, `${commit}^`, gitEnv);
  if (!parent) return;
  const previous = parseStore(repoRoot, parent, gitEnv);
  const previousById = new Map(
    previous.changes.map((change) => [String(change.frontmatter.id), change]),
  );
  const actor = message.match(/^Change-Actor:[\t ]*(.*)$/m)?.[1].trim() ?? 'unknown';
  for (const change of store.changes) {
    const before = previousById.get(String(change.frontmatter.id));
    if (!before) continue;
    const added = addedLogEvents(before.text, change.text);
    const approval =
      before.frontmatter.status === 'draft' && change.frontmatter.status === 'approved';
    if (
      approval &&
      !added.some(
        (event) => event.type === 'status' && event.from === 'draft' && event.to === 'approved',
      )
    ) {
      throw new Error(
        `state commit ${commit} approval for change #${change.frontmatter.id} is missing its draft → approved Log event`,
      );
    }
    if (before.frontmatter.owner === change.frontmatter.owner) continue;
    const oldOwner = before.frontmatter.owner ?? 'unassigned';
    const newOwner = change.frontmatter.owner ?? 'unassigned';
    const approvalAssignment = !before.frontmatter.owner && approval && change.frontmatter.owner;
    const ownerEvent = added.some(
      (event) => event.type === 'owner' && event.owner === (change.frontmatter.owner ?? null),
    );
    if (!ownerEvent) {
      throw new Error(
        `state commit ${commit} ownership transfer for change #${change.frontmatter.id} is missing its audited Log event`,
      );
    }
    if (approvalAssignment) {
      continue;
    }
    const auditPrefix = `ownership transferred: ${oldOwner} → ${newOwner} by ${actor} via `;
    if (
      !added.some((event) => {
        if (event.type !== 'note' || !event.message.startsWith(auditPrefix)) return false;
        return /^\S+$/.test(event.message.slice(auditPrefix.length));
      })
    ) {
      throw new Error(
        `state commit ${commit} ownership transfer for change #${change.frontmatter.id} is missing its audited Log event`,
      );
    }
  }
}

function validateBaselineOrigins(repoRoot, commit, store, message, gitEnv) {
  if (resolveHead(repoRoot, `${commit}^`, gitEnv)) return;
  const values = [...message.matchAll(/^Change-Origin:[\t ]*(.*)$/gm)].map((match) =>
    match[1].trim(),
  );
  if (!values.length) {
    if (!store.changes.length) return;
    throw new Error(`state baseline ${commit} requires Change-Origin provenance for every change`);
  }
  const origins = values.map((value) => {
    const match = value.match(/^(\S+) (\S+) ([0-9a-f]{40,64}) ([0-9a-f]{40,64})$/);
    if (!match) throw new Error(`state baseline ${commit} has malformed Change-Origin: ${value}`);
    return { id: match[1], ref: match[2], commit: match[3], blob: match[4] };
  });
  const stateBlobs = new Map(
    store.changes.map((change) => [
      String(change.frontmatter.id),
      run(repoRoot, ['rev-parse', `${commit}:${change.file}`], gitEnv),
    ]),
  );
  for (const origin of origins) {
    const stateBlob = stateBlobs.get(origin.id);
    if (!stateBlob || stateBlob !== origin.blob) {
      throw new Error(
        `state baseline ${commit} Change-Origin #${origin.id} does not match a baseline change`,
      );
    }
    let commitType;
    let blobType;
    try {
      commitType = run(repoRoot, ['cat-file', '-t', origin.commit], gitEnv);
      blobType = run(repoRoot, ['cat-file', '-t', origin.blob], gitEnv);
    } catch {
      throw new Error(`state baseline ${commit} has unverifiable Change-Origin for #${origin.id}`);
    }
    if (commitType !== 'commit' || blobType !== 'blob') {
      throw new Error(
        `state baseline ${commit} has invalid Change-Origin objects for #${origin.id}`,
      );
    }
    const originHead = resolveHead(repoRoot, origin.ref, gitEnv);
    if (!originHead) {
      throw new Error(
        `state baseline ${commit} Change-Origin ref ${origin.ref} does not exist for #${origin.id}`,
      );
    }
    try {
      run(repoRoot, ['merge-base', '--is-ancestor', origin.commit, originHead], gitEnv);
    } catch {
      throw new Error(
        `state baseline ${commit} Change-Origin ref ${origin.ref} does not reach commit ${origin.commit}`,
      );
    }
    const tree = runRaw(repoRoot, ['ls-tree', '-r', origin.commit], gitEnv);
    if (!tree.split('\n').some((line) => line.includes(` blob ${origin.blob}\t`))) {
      throw new Error(
        `state baseline ${commit} Change-Origin blob for #${origin.id} is not present in its source commit`,
      );
    }
  }
  for (const change of store.changes) {
    const stateBlob = stateBlobs.get(String(change.frontmatter.id));
    if (
      !origins.some(
        (origin) => origin.id === String(change.frontmatter.id) && origin.blob === stateBlob,
      )
    ) {
      throw new Error(
        `state baseline ${commit} requires a matching Change-Origin for change #${change.frontmatter.id}`,
      );
    }
  }
}

export function validateStateRange(
  repoRoot,
  { oldHead, newHead, actor, humanOverride = false, gitEnv = {} },
) {
  if (!oldHead || !newHead || /^0+$/.test(newHead)) {
    throw new Error('state branch deletion is not allowed');
  }
  if (!/^0+$/.test(oldHead)) {
    try {
      run(repoRoot, ['merge-base', '--is-ancestor', oldHead, newHead], gitEnv);
    } catch {
      throw new Error(`state update ${oldHead} → ${newHead} is not a fast-forward`);
    }
  }
  const range = /^0+$/.test(oldHead) ? newHead : `${oldHead}..${newHead}`;
  const commits = run(repoRoot, ['rev-list', '--reverse', range], gitEnv)
    .split('\n')
    .filter(Boolean);
  if (!commits.length) commits.push(newHead);
  for (const commit of commits) {
    const names = run(repoRoot, ['ls-tree', '-r', '--name-only', commit], gitEnv)
      .split('\n')
      .filter(Boolean);
    const invalid = names.find(
      (name) =>
        name !== STATE_MANIFEST &&
        !(
          name.startsWith(`${STATE_CHANGES_DIR}/`) &&
          !name.slice(STATE_CHANGES_DIR.length + 1).includes('/') &&
          name.endsWith('.md')
        ),
    );
    if (invalid)
      throw new Error(`state commit ${commit} contains file outside the state layout: ${invalid}`);
    const store = parseStore(repoRoot, commit, gitEnv);
    let config;
    try {
      config = parseYaml(canonicalConfigText(repoRoot, store.manifest.integration_branch, gitEnv));
    } catch (error) {
      throw new Error(
        `state commit ${commit} cannot load canonical integration config: ${error.message}`,
      );
    }
    const { errors } = checkRepo({ config, changes: store.changes });
    if (errors.length) {
      throw new Error(
        `invalid state document at ${commit}: ${errors[0].file}: ${errors[0].message}`,
      );
    }
    const message = runRaw(repoRoot, ['show', '-s', '--format=%B', commit], gitEnv);
    validateStateOwnershipForCommit(repoRoot, commit, store, message, gitEnv);
    validateBaselineOrigins(repoRoot, commit, store, message, gitEnv);
    const traceErrors = traceabilityErrorsForCommit(repoRoot, commit, message, gitEnv);
    if (traceErrors.length) {
      throw new Error(`state commit ${commit} has invalid traceability: ${traceErrors[0].message}`);
    }
  }
  if (actor && !humanOverride && !/^0+$/.test(oldHead)) {
    validateAuthenticatedOwner(repoRoot, commits, actor, gitEnv);
  }
  return {
    ok: true,
    oldHead,
    newHead,
    commits: commits.length,
    owner_enforcement: humanOverride ? 'human-override' : actor ? 'enforced' : 'unavailable',
  };
}

export function stateTraceabilityErrors(repoRoot, head, { gitEnv = {} } = {}) {
  const errors = [];
  const commits = run(repoRoot, ['rev-list', head], gitEnv).split('\n').filter(Boolean);
  for (const commit of commits) {
    const message = runRaw(repoRoot, ['show', '-s', '--format=%B', commit], gitEnv);
    errors.push(...traceabilityErrorsForCommit(repoRoot, commit, message, gitEnv));
  }
  return errors;
}

function traceabilityErrorsForCommit(repoRoot, commit, message, gitEnv) {
  const errors = [];
  const values = (name) =>
    [...message.matchAll(new RegExp(`^${name}:[\\t ]*(.*)$`, 'gm'))].map((match) =>
      match[1].trim(),
    );
  const ids = values('Change-Id');
  const operations = values('Change-Operation');
  const actors = values('Change-Actor');
  const revisions = values('Code-Revision');
  const branches = values('Code-Branch');
  const parent = resolveHead(repoRoot, `${commit}^`, gitEnv);
  const changedFiles = parent
    ? run(repoRoot, ['diff', '--name-only', parent, commit, '--', STATE_CHANGES_DIR], gitEnv)
        .split('\n')
        .filter((file) => file.endsWith('.md'))
    : [];
  if (changedFiles.length) {
    if (ids.length !== 1 || !ids[0]) {
      errors.push({ commit, message: 'state mutation requires exactly one non-empty Change-Id' });
    }
    if (operations.length !== 1 || !operations[0]) {
      errors.push({
        commit,
        message: 'state mutation requires exactly one non-empty Change-Operation',
      });
    }
    if (actors.length !== 1 || !actors[0]) {
      errors.push({
        commit,
        message: 'state mutation requires exactly one non-empty Change-Actor',
      });
    }
    const traceCode =
      /^(status:in-progress|status:in-review|status:in-validation|review:|validation:|graduate|fix)/.test(
        operations[0] ?? '',
      );
    if (
      traceCode &&
      (revisions.length !== 1 || !revisions[0] || branches.length !== 1 || !branches[0])
    ) {
      errors.push({
        commit,
        message: 'code traceability requires exactly one Code-Revision and Code-Branch',
      });
    }
    const affectedIds = new Set();
    for (const file of changedFiles) {
      for (const revision of [parent, commit]) {
        const text = fileAt(repoRoot, revision, file, gitEnv);
        if (text) affectedIds.add(String(parseChange(text).frontmatter.id));
      }
    }
    if (ids.length === 1 && ids[0] && (affectedIds.size !== 1 || !affectedIds.has(ids[0]))) {
      errors.push({
        commit,
        message: `Change-Id ${ids[0]} does not match the changed state document`,
      });
    }
  }
  if (revisions.length > 1) {
    errors.push({ commit, message: 'multiple Code-Revision trailers are not allowed' });
  }
  if (branches.length > 1) {
    errors.push({ commit, message: 'multiple Code-Branch trailers are not allowed' });
  }
  if (ids.length > 1) {
    errors.push({ commit, message: 'multiple Change-Id trailers are not allowed' });
  }
  if (operations.length > 1) {
    errors.push({ commit, message: 'multiple Change-Operation trailers are not allowed' });
  }
  if (actors.length > 1) {
    errors.push({ commit, message: 'multiple Change-Actor trailers are not allowed' });
  }
  for (const revision of revisions) {
    if (!/^[0-9a-f]{40,64}$/.test(revision)) {
      errors.push({ commit, revision, message: `invalid Code-Revision trailer: ${revision}` });
    }
  }
  for (const branch of branches) {
    if (!branch) errors.push({ commit, branch, message: 'Code-Branch trailer cannot be empty' });
  }
  if (revisions.length && (branches.length !== 1 || !branches[0])) {
    errors.push({
      commit,
      message: 'code traceability requires exactly one non-empty Code-Branch trailer',
    });
  }
  if (revisions.length && (ids.length !== 1 || !ids[0])) {
    errors.push({
      commit,
      message: 'code traceability requires exactly one non-empty Change-Id trailer',
    });
  }
  if (errors.length || revisions.length !== 1 || branches.length > 1 || ids.length !== 1) {
    return errors;
  }
  const [id] = ids;
  const [operation] = operations;
  const [revision] = revisions;
  const [branch] = branches;
  if (!revision) return errors;
  try {
    run(repoRoot, ['cat-file', '-e', `${revision}^{commit}`], gitEnv);
  } catch {
    return [{ commit, revision, message: 'referenced code revision does not exist' }];
  }
  if (id && operation !== 'status:in-progress') {
    const codeMessage = runRaw(repoRoot, ['show', '-s', '--format=%B', revision], gitEnv);
    if (!codeMessage.includes(`[#${id}]`)) {
      errors.push({
        commit,
        revision,
        message: `referenced code revision lacks change marker [#${id}]`,
      });
    }
  }
  if (branch) {
    const candidates = [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`];
    const branchHead = candidates.map((ref) => resolveHead(repoRoot, ref, gitEnv)).find(Boolean);
    if (!branchHead) {
      errors.push({
        commit,
        revision,
        branch,
        message: `referenced code branch ${branch} is missing`,
      });
    } else {
      try {
        run(repoRoot, ['merge-base', '--is-ancestor', revision, branchHead], gitEnv);
      } catch {
        errors.push({
          commit,
          revision,
          branch,
          message: `referenced code revision is not reachable from branch ${branch}`,
        });
      }
    }
  }
  return errors;
}

function validateAuthenticatedOwner(repoRoot, commits, actor, gitEnv) {
  for (const commit of commits) {
    const parent = resolveHead(repoRoot, `${commit}^`, gitEnv);
    if (!parent) continue;
    const changed = run(
      repoRoot,
      ['diff', '--name-only', parent, commit, '--', STATE_CHANGES_DIR],
      gitEnv,
    )
      .split('\n')
      .filter((name) => name.endsWith('.md'));
    for (const file of changed) {
      const beforeText = fileAt(repoRoot, parent, file, gitEnv);
      if (!beforeText) continue;
      const before = parseChange(beforeText).frontmatter;
      if (before.owner && before.owner !== actor) {
        throw new Error(
          `authenticated actor "${actor}" cannot update change #${before.id}; current owner is "${before.owner}"`,
        );
      }
    }
  }
}
