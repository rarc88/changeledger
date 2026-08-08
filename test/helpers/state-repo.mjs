// Plumbing-only fixtures for state-store.mjs tests: a real temporary git repo
// (SHA-1 or SHA-256) seeded via raw `git` calls (hash-object, temp-index
// read-tree/update-index/write-tree, commit-tree, update-ref) — never via the
// module under test — so a bug in state-store.mjs's own tree construction
// cannot cancel out against a matching bug in these fixtures.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { STATE_REF } from '../../src/state-store.mjs';

const GIT_LOCATION_ENV_VARS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_CEILING_DIRECTORIES',
];

function sanitizedEnv(extra) {
  const env = { ...process.env, LC_ALL: 'C' };
  for (const key of GIT_LOCATION_ENV_VARS) delete env[key];
  return extra ? { ...env, ...extra } : env;
}

// Raw `git` invocation for fixture setup: trimmed utf8 stdout, stderr surfaced
// on failure (a broken fixture must fail loudly, not silently).
export function git(root, args, { input, indexFile } = {}) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      env: indexFile ? sanitizedEnv({ GIT_INDEX_FILE: indexFile }) : sanitizedEnv(),
      input,
      encoding: 'utf8',
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (e) {
    const detail = typeof e.stderr === 'string' ? e.stderr.trim() : '';
    throw new Error(detail ? `${e.message}\n${detail}` : e.message, { cause: e });
  }
}

export function initStateRepo({ objectFormat = 'sha1' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-state-repo-'));
  const initArgs = ['init', '-q'];
  if (objectFormat !== 'sha1') initArgs.push(`--object-format=${objectFormat}`);
  git(root, initArgs);
  git(root, ['config', 'user.name', 'Test User']);
  git(root, ['config', 'user.email', 'test@example.com']);
  return root;
}

function withTempIndex(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-state-fixture-index-'));
  const indexFile = path.join(dir, 'index');
  try {
    return fn(indexFile);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Builds a tree from `files` (a `{ [relPath]: text }` map) via a fresh temp
// index — never the repo's own index, so this never risks touching the
// working tree. Nested paths (e.g. `.changeledger-state/changes/x.md`)
// materialize their intermediate trees automatically.
export function buildTree(root, files) {
  return buildTreeEntries(
    root,
    Object.entries(files).map(([path, text]) => ({ path, text })),
  );
}

// Like `buildTree`, but each entry may set its own git mode (e.g. `120000`
// for a symlink) and either `text` (hashed into a new blob) or a precomputed
// `oid` (e.g. deliberately non-UTF-8 binary content) — for fixtures that need
// a non-regular or invalid-content tree entry (CR7, CR8).
export function buildTreeEntries(root, entries) {
  return withTempIndex((indexFile) => {
    for (const { path: relPath, text, oid, mode = '100644' } of entries) {
      const blob = oid ?? git(root, ['hash-object', '-w', '--stdin'], { input: text, indexFile });
      git(root, ['update-index', '--add', '--cacheinfo', `${mode},${blob},${relPath}`], {
        indexFile,
      });
    }
    return git(root, ['write-tree'], { indexFile });
  });
}

// Writes a ref's target directly as a loose ref file, bypassing
// `update-ref`'s own guard against writing a non-commit object under
// `refs/heads/` — needed to fabricate a state ref that resolves to a tag
// (CR5), a scenario `update-ref` itself would refuse to create.
export function writeLooseRef(root, ref, oid) {
  const gitDir = git(root, ['rev-parse', '--git-dir']);
  const refPath = path.join(root, gitDir, ref);
  fs.mkdirSync(path.dirname(refPath), { recursive: true });
  fs.writeFileSync(refPath, `${oid}\n`);
}

export function commitTree(root, treeOid, { parents = [], message = 'chore: state' } = {}) {
  const args = ['commit-tree', treeOid];
  for (const parent of parents) args.push('-p', parent);
  args.push('-m', message);
  return git(root, args);
}

export function updateRef(root, ref, oid, oldValue) {
  const args = ['update-ref', ref, oid];
  if (oldValue !== undefined) args.push(oldValue);
  git(root, args);
}

export const manifestText = ({ projectId = 'demo' } = {}) =>
  `format_version: 1\nproject_id: ${projectId}\n`;

export const configText = ({ projectId = 'demo' } = {}) => `project_id: ${projectId}\n`;

// Multibyte content (á, ñ, emoji) so byte-fidelity assertions (CR2) are not
// vacuously true on ASCII-only text.
export const changeText = ({ id = '20260808-000001', title = 'Añadir soporté ☂' } = {}) =>
  `---\nid: "${id}"\ntitle: ${title}\ntype: feature\nstatus: draft\ncreated: 2026-08-08T00:00:00Z\ndepends_on: []\n---\n\n## Request\n\nDemo multibyte: café, mañana, 東京.\n`;

export const specText = ({ name = 'Demo spec' } = {}) => `# ${name}\n\nContrato de ejemplo.\n`;

export const releaseText = ({ version = '0.1.0' } = {}) =>
  `version: ${version}\ndate: 2026-08-08\n`;

// Full valid `.changeledger-state` layout as a `{ path: text }` map, ready for
// `buildTree`. `extra` merges/overrides individual paths (e.g. to inject a
// non-UTF-8 or non-regular entry via a caller that post-processes the tree).
export function defaultStateFiles({ projectId = 'demo', extra = {} } = {}) {
  return {
    '.changeledger-state/manifest.yml': manifestText({ projectId }),
    '.changeledger-state/config.yml': configText({ projectId }),
    '.changeledger-state/changes/20260808-000001-change.md': changeText(),
    '.changeledger-state/specs/demo-spec.md': specText(),
    '.changeledger-state/releases/0.1.0.yml': releaseText(),
    ...extra,
  };
}

// Seeds `refs/heads/changeledger/state` (or `ref`, for CR5's non-standard
// tips) at a root commit over `defaultStateFiles()` (or caller-supplied
// `files`). Returns the repo root and the resulting revision.
export function seedStateRepo({
  objectFormat = 'sha1',
  projectId = 'demo',
  files = defaultStateFiles({ projectId }),
  ref = STATE_REF,
} = {}) {
  const root = initStateRepo({ objectFormat });
  const tree = buildTree(root, files);
  const revision = commitTree(root, tree, { message: 'chore: state' });
  updateRef(root, ref, revision);
  return { root, revision, tree };
}
