import fs from 'node:fs';
import path from 'node:path';
import { parseYaml } from './yaml.mjs';

// Walk up from `start` looking for a `.changeledger/` directory. Returns its absolute path
// or null if none is found.
export function findChangeledgerDir(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    const candidate = path.join(dir, '.changeledger');
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
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

// Single source of the specs directory: the configured `specs_dir` or the
// default, always resolved through the containment guard. Shared by `loadRepo`
// and `graduate` so a graduated spec lands where the repo will later read it.
export const DEFAULT_SPECS_DIR = '.changeledger/specs';

export function resolveSpecsDir(repoRoot, config) {
  return resolveRepoPath(repoRoot, config.specs_dir ?? DEFAULT_SPECS_DIR, 'specs_dir');
}
