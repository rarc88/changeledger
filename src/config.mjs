import fs from 'node:fs';
import path from 'node:path';
import { parseYaml } from './yaml.mjs';

// Walk up from `start` looking for a `.sl/` directory. Returns its absolute path
// or null if none is found.
export function findSpecDir(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    const candidate = path.join(dir, '.sl');
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function loadConfig(specDir) {
  const file = path.join(specDir, 'config.yml');
  if (!fs.existsSync(file)) throw new Error(`Missing config: ${file}`);
  return parseYaml(fs.readFileSync(file, 'utf8'));
}

// Resolves a configured directory (changes_dir/specs_dir) against the repo root,
// refusing any value that escapes it. A cloned repo's config is untrusted input:
// running a command must not let it read or write outside the repo it discovered.
// Absolute paths and `..` traversal are rejected by shape; an existing target
// that symlinks outside is rejected by comparing real paths. Returns the
// absolute, contained path.
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
  if (fs.existsSync(resolved)) {
    const realRoot = fs.realpathSync(root);
    const real = fs.realpathSync(resolved);
    if (!isInside(realRoot, real)) {
      throw new Error(`config "${field}" resolves outside the repo via a symlink: ${configured}`);
    }
  }
  return resolved;
}

function isInside(root, target) {
  return target === root || target.startsWith(root + path.sep);
}

// Single source of the specs directory: the configured `specs_dir` or the
// default, always resolved through the containment guard. Shared by `loadRepo`
// and `graduate` so a graduated spec lands where the repo will later read it.
export const DEFAULT_SPECS_DIR = '.sl/specs';

export function resolveSpecsDir(repoRoot, config) {
  return resolveRepoPath(repoRoot, config.specs_dir ?? DEFAULT_SPECS_DIR, 'specs_dir');
}
