import fs from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { repoIsActivated } from './change-store.mjs';
import { isValidBranchName } from './git.mjs';
import { readStateConfigText } from './state-store.mjs';
import { parseYaml } from './yaml.mjs';

// Walk up from `start` looking for a project `.changeledger/config.yml`. The
// config file is the marker: `~/.changeledger/` may exist only as global state
// and must not be mistaken for a repository (notably when Windows temp dirs
// live below the user's home). Returns the project data directory or null.
export function findChangeledgerDir(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    const candidate = path.join(dir, '.changeledger');
    const config = path.join(candidate, 'config.yml');
    if (fs.existsSync(config) && fs.statSync(config).isFile()) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function loadConfig(changeledgerDir) {
  const file = path.join(changeledgerDir, 'config.yml');
  if (!fs.existsSync(file)) throw new Error(`Missing config: ${file}`);
  return parseYaml(fs.readFileSync(file, 'utf8'));
}

// The discovery marker remains in the worktree, but an activated repository's
// config content belongs to the state ref. `raw` keeps schema-preserving viewer
// reads on this same authority seam without loading the rest of the snapshot.
export function loadEffectiveConfig(repoRoot, changeledgerDir, { raw = false, run } = {}) {
  if (repoIsActivated(repoRoot, run)) {
    // The authority read comes first so a broken store of the activated repo
    // still fails closed before identity is even considered.
    const authority = readStateConfigText(repoRoot, {}, run);
    const configFile = path.join(changeledgerDir, 'config.yml');
    const marker = readMarkerText(configFile);
    if (marker === null || !claimsAnotherLedger(configFile, marker, authority)) {
      return raw ? authority : parseYaml(authority);
    }
  }
  if (!raw) return loadConfig(changeledgerDir);
  const file = path.join(changeledgerDir, 'config.yml');
  if (!fs.existsSync(file)) throw new Error(`Missing config: ${file}`);
  return fs.readFileSync(file, 'utf8');
}

// Activation lives on a git ref, so every directory under an activated repo —
// including a nested ChangeLedger project that owns its own `config.yml` and
// has no `.git` — probes as activated. Two questions decide whose ledger the
// discovered marker belongs to, and both routes (this read seam and `config
// migrate`'s write) ask them here so they can never diverge.
//
// Location first: a `.changeledger` whose parent directory is the git top-level
// is the repo's own ledger whatever the marker says. The worktree marker is
// discovery only, and on an activated repo it is routinely stale — a stale
// `project_id` must not make a repo disown its own state ref.
//
// Identity second, and only below the top-level, where a marker can genuinely
// belong to somebody else: a marker naming a `project_id` different from the
// snapshot's is a foreign ledger, read from (and migrated into) the worktree in
// place, never through the host's state ref. A marker that is unreadable,
// malformed or names no project cannot claim a distinct identity, so the host's
// ref route stands. That last shape stays silent by design: it is
// indistinguishable from an ordinary activated checkout with a partial marker,
// so warning on it would fire on every normal repo.
export function claimsAnotherLedger(configFile, markerText, authorityText) {
  if (isGitTopLevelMarker(configFile)) return false;
  const markerId = readProjectId(markerText);
  const authorityId = readProjectId(authorityText);
  if (markerId === undefined || authorityId === undefined) return false;
  return markerId !== authorityId;
}

// Whether `<configFile>`'s `.changeledger` sits directly under a git top-level.
// Checked on disk rather than through `git rev-parse --show-toplevel`: this runs
// on every activated config read, and `.git` (a directory, or a file in a linked
// worktree or submodule) marks the top-level exactly as `repoIsActivated`'s own
// walk already assumes — so the hot path pays no subprocess.
function isGitTopLevelMarker(configFile) {
  const markerRoot = path.dirname(path.dirname(path.resolve(configFile)));
  return fs.existsSync(path.join(markerRoot, '.git'));
}

function readProjectId(text) {
  let config;
  try {
    const doc = parseDocument(text, { merge: false });
    if (doc.errors.length) return undefined;
    config = doc.toJS();
  } catch {
    return undefined;
  }
  if (config === null || typeof config !== 'object') return undefined;
  return Object.hasOwn(config, 'project_id') ? String(config.project_id) : undefined;
}

export function readMarkerText(configFile) {
  try {
    return fs.readFileSync(configFile, 'utf8');
  } catch {
    return null;
  }
}

// Resolves a configured directory (changes_dir/specs_dir) against the repo root,
// refusing any value that escapes it. A cloned repo's config is untrusted input:
// running a command must not let it read or write outside the repo it discovered.
// Absolute paths and `..` traversal are rejected by shape; symlinks are rejected
// by comparing real paths. The target may not exist yet (a command is about to
// create it), so we realpath the nearest existing ancestor: an intermediate
// symlink leading outside is caught before any mkdir lands in the external
// target. Returns the absolute, contained path.
export function resolveRepoPath(repoRoot, configured, field) {
  if (typeof configured !== 'string' || configured === '') {
    throw new Error(`config "${field}" must be a non-empty relative path`);
  }
  if (path.isAbsolute(configured)) {
    throw new Error(`config "${field}" must be relative to the repo root: ${configured}`);
  }
  const root = path.resolve(repoRoot);
  const resolved = path.resolve(root, configured);
  if (!isInside(root, resolved)) {
    throw new Error(`config "${field}" escapes the repo root: ${configured}`);
  }
  const realRoot = fs.realpathSync(root);
  const realAncestor = fs.realpathSync(nearestExisting(resolved));
  if (!isInside(realRoot, realAncestor)) {
    throw new Error(`config "${field}" resolves outside the repo via a symlink: ${configured}`);
  }
  return resolved;
}

// Nearest path component of `p` that exists on disk. The gap between it and `p`
// is non-existent (so it cannot hide a symlink); the ancestor is what we realpath
// to detect an intermediate symlink escaping the repo.
function nearestExisting(p) {
  let cur = p;
  while (!fs.existsSync(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return cur;
}

function isInside(root, target) {
  return target === root || target.startsWith(root + path.sep);
}

// Optional declared integration branch: change branches start from it and
// merge back into it. Absent means the caller keeps its current auto-detection
// (`defaultBaseBranch`); a present but malformed value fails fast instead of
// silently falling back.
export function integrationBranch(config) {
  const git = config?.git;
  if (git === undefined || git === null) return undefined;
  if (!isMapping(git)) throw new Error('config "git" must be a mapping');
  const value = git.integration_branch;
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('config "git.integration_branch" must be a non-empty string');
  }
  return value.trim();
}

function isMapping(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Opt-in convention for implementation branches. Only immutable change fields
// are accepted, and the id is the required one-to-one link back to the change.
export function changeBranchFormat(config) {
  const value = config?.git?.change_branch_format;
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('config "git.change_branch_format" must be a non-empty string');
  }

  const format = value.trim();
  const placeholders = [...format.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]);
  const unknown = placeholders.find((name) => !['type', 'id'].includes(name));
  if (unknown) {
    throw new Error(`config "git.change_branch_format" has unknown placeholder "{${unknown}}"`);
  }
  if ((format.match(/\{id\}/g) ?? []).length !== 1) {
    throw new Error('config "git.change_branch_format" must contain "{id}" exactly once');
  }
  if (/[{}]/.test(format.replaceAll('{type}', '').replaceAll('{id}', ''))) {
    throw new Error('config "git.change_branch_format" contains malformed placeholders');
  }
  return format;
}

export function renderChangeBranch(config, { type, id }) {
  const format = changeBranchFormat(config);
  if (format === undefined) return undefined;
  const values = { type: String(type), id: String(id) };
  const branch = format.replace(/\{(type|id)\}/g, (_placeholder, name) => values[name]);
  if (!isValidBranchName(branch)) {
    throw new Error(`config "git.change_branch_format" renders an invalid Git branch: ${branch}`);
  }
  return branch;
}

// Single source of the specs directory: the configured `specs_dir` or the
// default, always resolved through the containment guard. Shared by `loadRepo`
// and `graduate` so a graduated spec lands where the repo will later read it.
export const DEFAULT_SPECS_DIR = '.changeledger/specs';

export function resolveSpecsDir(repoRoot, config) {
  return resolveRepoPath(repoRoot, config.specs_dir ?? DEFAULT_SPECS_DIR, 'specs_dir');
}
