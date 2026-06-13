// Global project registry: maps a stable project_id to its absolute path on this
// machine. Identity lives in the repo's config (committed); the path is local,
// so moved/cloned repos just re-register. Override the home with
// SPEC_LEDGER_HOME (used by tests).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function registryDir() {
  return path.join(process.env.SPEC_LEDGER_HOME || os.homedir(), '.spec-ledger');
}

export function registryPath() {
  return path.join(registryDir(), 'registry.json');
}

export function readRegistry() {
  const file = registryPath();
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

export function writeRegistry(reg) {
  fs.mkdirSync(registryDir(), { recursive: true });
  fs.writeFileSync(registryPath(), `${JSON.stringify(reg, null, 2)}\n`);
}

export function register({ id, name, path: repoPath }) {
  const reg = readRegistry();
  reg[id] = { name, path: repoPath };
  writeRegistry(reg);
  return reg;
}

export function listProjects() {
  return Object.entries(readRegistry()).map(([id, v]) => ({ id, name: v.name, path: v.path }));
}

export function remove(id) {
  const reg = readRegistry();
  delete reg[id];
  writeRegistry(reg);
}
