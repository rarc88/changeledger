import { parseChange } from './change.mjs';
import { checkRepo } from './check.mjs';
import { isValidBranchName, objectRun } from './git.mjs';
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

export function publishStateStore(repoRoot, branch, { gitEnv = {} } = {}) {
  const ref = refName(branch);
  const head = resolveHead(repoRoot, ref, gitEnv);
  if (!head) throw new Error(`state branch "${branch}" does not exist`);
  if (!remoteAvailable(repoRoot, gitEnv)) {
    return { head, confirmed: false, pending: false, remote: 'unconfigured' };
  }
  try {
    run(repoRoot, ['push', 'origin', `${ref}:${ref}`], gitEnv);
    try {
      run(repoRoot, ['update-ref', '-d', pendingRef(branch)], gitEnv);
    } catch {
      // An absent marker is already the desired state.
    }
    return { head, confirmed: true, pending: false, remote: 'origin' };
  } catch (error) {
    run(repoRoot, ['update-ref', pendingRef(branch), head], gitEnv);
    return { head, confirmed: false, pending: true, remote: 'origin', error: error.message };
  }
}

function safeField(value) {
  return String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

function renderManifest({ projectId, integrationBranch }) {
  return [
    `schema_version: ${STATE_SCHEMA_VERSION}`,
    `project_id: ${serializeScalar(projectId)}`,
    `integration_branch: ${serializeScalar(integrationBranch)}`,
    '',
  ].join('\n');
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

function parseStore(repoRoot, head, gitEnv) {
  const files = readFilesAt(repoRoot, head, gitEnv);
  const manifestText = files.get(STATE_MANIFEST);
  if (!manifestText) throw new Error(`state store ${head} is missing ${STATE_MANIFEST}`);
  const manifest = parseYaml(manifestText);
  if (manifest.schema_version !== STATE_SCHEMA_VERSION) {
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
  return { head, manifest, changes, files };
}

export function readStateStore(repoRoot, branch, { gitEnv = {}, baseline } = {}) {
  const ref = refName(branch);
  const head = resolveHead(repoRoot, ref, gitEnv);
  if (!head) throw new Error(`state branch "${branch}" does not exist`);
  if (baseline) {
    try {
      run(repoRoot, ['merge-base', '--is-ancestor', baseline, head], gitEnv);
    } catch {
      throw new Error(`state head ${head} does not descend from baseline ${baseline}`);
    }
  }
  return {
    ...parseStore(repoRoot, head, gitEnv),
    pending: statePending(repoRoot, branch, { gitEnv }),
  };
}

export function initializeStateStore({
  repoRoot,
  branch,
  projectId,
  integrationBranch,
  changes,
  origins = [],
  gitEnv = {},
}) {
  const ref = refName(branch);
  if (resolveHead(repoRoot, ref, gitEnv))
    throw new Error(`state branch "${branch}" already exists`);
  const files = new Map([[STATE_MANIFEST, renderManifest({ projectId, integrationBranch })]]);
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

export function syncStateStore(repoRoot, branch, { gitEnv = {} } = {}) {
  if (!remoteAvailable(repoRoot, gitEnv)) throw new Error('state sync requires remote "origin"');
  const ref = refName(branch);
  const fetched = `refs/changeledger/fetched/${branch}`;
  run(repoRoot, ['fetch', 'origin', `${ref}:${fetched}`], gitEnv);
  const localHead = resolveHead(repoRoot, ref, gitEnv);
  const remoteHead = resolveHead(repoRoot, fetched, gitEnv);
  if (!localHead || !remoteHead) throw new Error(`unable to resolve local and remote state heads`);
  if (localHead === remoteHead) {
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
    const message = runRaw(repoRoot, ['show', '-s', '--format=%B', commit], gitEnv).trimEnd();
    target = createCommit(repoRoot, files, { parent: target, message, gitEnv });
    priorLocal = commit;
  }
  run(repoRoot, ['update-ref', ref, target, localHead], gitEnv);
  const publication = publishStateStore(repoRoot, branch, { gitEnv });
  return { ...publication, replayed: commits.length };
}

function pathId(file) {
  return file.slice(file.lastIndexOf('/') + 1).match(/^(\d{8}-\d{6})-/)?.[1] ?? file;
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
        name !== STATE_MANIFEST && !new RegExp(`^${STATE_CHANGES_DIR}/[^/]+\\.md$`).test(name),
    );
    if (invalid)
      throw new Error(`state commit ${commit} contains file outside the state layout: ${invalid}`);
    const store = parseStore(repoRoot, commit, gitEnv);
    let config;
    try {
      config = parseYaml(
        runRaw(
          repoRoot,
          ['show', `refs/heads/${store.manifest.integration_branch}:.changeledger/config.yml`],
          gitEnv,
        ),
      );
    } catch {
      config = undefined;
    }
    if (config) {
      const { errors } = checkRepo({ config, changes: store.changes });
      if (errors.length) {
        throw new Error(
          `invalid state document at ${commit}: ${errors[0].file}: ${errors[0].message}`,
        );
      }
    }
    const message = runRaw(repoRoot, ['show', '-s', '--format=%B', commit], gitEnv);
    for (const match of message.matchAll(/^Code-Revision:\s*([0-9a-f]+)$/gm)) {
      try {
        run(repoRoot, ['cat-file', '-e', `${match[1]}^{commit}`], gitEnv);
      } catch {
        throw new Error(`state commit ${commit} references missing code revision ${match[1]}`);
      }
    }
  }
  if (actor && !humanOverride && !/^0+$/.test(oldHead)) {
    validateAuthenticatedOwner(repoRoot, oldHead, newHead, actor, gitEnv);
  }
  return { ok: true, oldHead, newHead, commits: commits.length };
}

export function stateTraceabilityErrors(repoRoot, head, { gitEnv = {} } = {}) {
  const errors = [];
  const commits = run(repoRoot, ['rev-list', head], gitEnv).split('\n').filter(Boolean);
  for (const commit of commits) {
    const message = runRaw(repoRoot, ['show', '-s', '--format=%B', commit], gitEnv);
    for (const match of message.matchAll(/^Code-Revision:\s*([0-9a-f]+)$/gm)) {
      try {
        run(repoRoot, ['cat-file', '-e', `${match[1]}^{commit}`], gitEnv);
      } catch {
        errors.push({
          commit,
          revision: match[1],
          message: 'referenced code revision does not exist',
        });
      }
    }
  }
  return errors;
}

function validateAuthenticatedOwner(repoRoot, oldHead, newHead, actor, gitEnv) {
  const changed = run(
    repoRoot,
    ['diff', '--name-only', oldHead, newHead, '--', STATE_CHANGES_DIR],
    gitEnv,
  )
    .split('\n')
    .filter((name) => name.endsWith('.md'));
  for (const file of changed) {
    const beforeText = fileAt(repoRoot, oldHead, file, gitEnv);
    if (!beforeText) continue;
    const before = parseChange(beforeText).frontmatter;
    if (before.owner && before.owner !== actor) {
      throw new Error(
        `authenticated actor "${actor}" cannot update change #${before.id}; current owner is "${before.owner}"`,
      );
    }
  }
}
