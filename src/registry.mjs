// Global project registry: maps a stable project_id to its absolute path on this
// machine. Identity lives in the repo's config (committed); the path is local,
// so moved/cloned repos just re-register. Override the home with
// CHANGELEDGER_HOME (used by tests).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withFileLock, writeFileAtomic } from './atomic-write.mjs';

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

export function listProjects() {
  return Object.entries(readRegistry()).map(([id, v]) => ({ id, name: v.name, path: v.path }));
}

export function remove(id) {
  fs.mkdirSync(registryDir(), { recursive: true });
  withFileLock(registryPath(), () => {
    const reg = readRegistry();
    delete reg[id];
    writeRegistry(reg);
  });
}

export function update(id, values) {
  fs.mkdirSync(registryDir(), { recursive: true });
  return withFileLock(registryPath(), () => {
    const reg = readRegistry();
    if (!reg[id]) throw new Error(`no registered project "${id}"`);
    reg[id] = { ...reg[id], ...values };
    writeRegistry(reg);
    return reg[id];
  });
}
