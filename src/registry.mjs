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

export function cleanMissingProjects({
  statSync = fs.statSync,
  withFileLock: lock = withFileLock,
  writeRegistry: persistRegistry = writeRegistry,
} = {}) {
  fs.mkdirSync(registryDir(), { recursive: true });
  return lock(registryPath(), () => {
    const registry = readRegistry();
    const removedIds = [];
    let skipped = 0;

    for (const [id, project] of Object.entries(registry)) {
      try {
        statSync(path.join(project.path, '.changeledger', 'config.yml'));
      } catch (error) {
        if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
          delete registry[id];
          removedIds.push(id);
        } else {
          skipped += 1;
        }
      }
    }

    if (removedIds.length > 0) persistRegistry(registry);
    return { removedIds, removed: removedIds.length, skipped };
  });
}

export function listProjects() {
  return Object.entries(readRegistry()).map(([id, value]) => {
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
      if (activated) throw error;
      // Missing or unreadable projects keep their last registered display name.
    }
    return { id, name, path: value.path };
  });
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
