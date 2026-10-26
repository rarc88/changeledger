// Global project registry: maps a stable project_id to its absolute path on this
// machine. Identity lives in the repo's config (committed); the path is local,
// so moved/cloned repos just re-register. Override the home with
// CHANGELEDGER_HOME (used by tests).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withFileLock, writeFileAtomic } from './atomic-write.mjs';
import { repoIsActivated } from './change-store.mjs';
import { loadEffectiveConfig } from './config.mjs';

export function registryDir() {
  return path.join(process.env.CHANGELEDGER_HOME || os.homedir(), '.changeledger');
}

export function registryPath() {
  return path.join(registryDir(), '.registry.json');
}

export function readRegistry() {
  const file = registryPath();
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error('.registry.json is not valid JSON');
  }
}

export function writeRegistry(reg) {
  fs.mkdirSync(registryDir(), { recursive: true });
  writeFileAtomic(registryPath(), `${JSON.stringify(reg, null, 2)}\n`);
}

export function register({ id, name, path: repoPath }) {
  fs.mkdirSync(registryDir(), { recursive: true });
  return withFileLock(registryPath(), () => {
    const reg = readRegistry();
    reg[id] = { name, path: repoPath };
    writeRegistry(reg);
    return reg;
  });
}

export function cleanMissingProjects(
  candidates,
  {
    statSync = fs.statSync,
    withFileLock: lock = withFileLock,
    writeRegistry: persistRegistry = writeRegistry,
  } = {},
) {
  const observedPaths = new Map(candidates.map((candidate) => [candidate.id, candidate.path]));
  fs.mkdirSync(registryDir(), { recursive: true });
  return lock(registryPath(), () => {
    const registry = readRegistry();
    const removedIds = [];
    let skipped = 0;

    for (const [id, project] of Object.entries(registry)) {
      const observedPath = observedPaths.get(id);
      const bindingIsCurrent = observedPaths.has(id) && project.path === observedPath;
      try {
        statSync(path.join(project.path, '.changeledger', 'config.yml'));
      } catch (error) {
        if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
          if (bindingIsCurrent) {
            delete registry[id];
            removedIds.push(id);
          }
        } else {
          skipped += 1;
        }
      }
    }

    if (removedIds.length > 0) persistRegistry(registry);
    return { removedIds, removed: removedIds.length, skipped };
  });
}

// Sorted by display name, then id: the registry object enumerates an all-digit
// key before the others, so its own order depends on the shape of the key.
// The one probe that decides a registered path's health: the viewer's Projects
// panel, its cleanup and the CLI all read it, so the ENOENT/ENOTDIR rule that
// makes an absence "confirmed" lives here and not in each seat.
export function probeProject(projectPath) {
  try {
    fs.statSync(path.join(projectPath, '.changeledger', 'config.yml'));
    return { alive: true, missing: false };
  } catch (error) {
    return {
      alive: false,
      missing: error?.code === 'ENOENT' || error?.code === 'ENOTDIR',
    };
  }
}

// `tolerant` is for a seat that must keep working on the rest of the registry
// when one entry cannot be inspected: a broken repo is exactly why someone
// reaches the CLI, so there it reports the reason instead of failing closed.
export function listProjects({ tolerant = false } = {}) {
  const projects = Object.entries(readRegistry()).map(([id, value]) => {
    let name = value.name;
    // Only an entry we managed to probe as activated owes a fail-closed error;
    // every probe (`statSync` included) runs inside the guard, because a path we
    // are not allowed to look at — an unreadable ancestor makes both the stat
    // and the activation probe throw EACCES — must not take the whole listing
    // down with it.
    let activated = false;
    try {
      const stats = fs.statSync(value.path, { throwIfNoEntry: false });
      if (!stats?.isDirectory()) return { id, name, path: value.path };
      // Past this point the path itself is a usable directory: any error the
      // activation probe raises now is about the activation, not the path, so
      // it must not fold into the "unusable path" tolerance below. A legacy
      // activation (no `ledger_dir`) is the case that motivates this — it is
      // neither "not activated" nor an unreadable path, so it gets its own
      // diagnostic instead of silently reading as inactive.
      try {
        activated = repoIsActivated(value.path);
      } catch (error) {
        return { id, name, path: value.path, activationError: error.message };
      }
      const config = loadEffectiveConfig(value.path, path.join(value.path, '.changeledger'));
      if (String(config.project_id) === id && typeof config.project_name === 'string') {
        name = config.project_name;
      }
    } catch (error) {
      if (activated) {
        if (!tolerant) throw error;
        return { id, name, path: value.path, listingError: error.message };
      }
      // Missing or unreadable projects keep their last registered display name.
    }
    return { id, name, path: value.path };
  });
  return projects.sort(
    (a, b) => String(a.name).localeCompare(String(b.name)) || a.id.localeCompare(b.id),
  );
}

export function remove(id, { expectedPath } = {}) {
  fs.mkdirSync(registryDir(), { recursive: true });
  withFileLock(registryPath(), () => {
    const reg = readRegistry();
    if (
      expectedPath !== undefined &&
      reg[id] &&
      path.resolve(reg[id].path) !== path.resolve(expectedPath)
    ) {
      throw new Error('project registry changed; reload before writing');
    }
    delete reg[id];
    writeRegistry(reg);
  });
}

export function update(id, values, { expectedPath } = {}) {
  fs.mkdirSync(registryDir(), { recursive: true });
  return withFileLock(registryPath(), () => {
    const reg = readRegistry();
    if (!reg[id]) throw new Error(`no registered project "${id}"`);
    if (expectedPath !== undefined && path.resolve(reg[id].path) !== path.resolve(expectedPath)) {
      throw new Error('project registry changed; reload before writing');
    }
    reg[id] = { ...reg[id], ...values };
    writeRegistry(reg);
    return reg[id];
  });
}
