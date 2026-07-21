// One immutable ledger snapshot per command. Legacy repositories read their
// worktree; activated repositories read only the committed state tree.

import fs from 'node:fs';
import path from 'node:path';
import { parseChange } from './change.mjs';
import { findChangeledgerDir, loadConfig, resolveRepoPath, resolveSpecsDir } from './config.mjs';
import { defaultRun } from './git.mjs';
import { DEFAULT_RELEASES_DIR } from './release.mjs';
import { parseSpec } from './spec.mjs';
import { parseYaml } from './yaml.mjs';

export const STATE_REF = 'refs/heads/changeledger/state';
const STATE_ROOT = '.changeledger-state';
const MANIFEST = `${STATE_ROOT}/manifest.yml`;
const CONFIG = `${STATE_ROOT}/config.yml`;

function listWorktreeFiles(dir, extension) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(extension))
    .sort();
}

function loadWorktreeSnapshot(repoRoot, changeledgerDir) {
  const config = loadConfig(changeledgerDir);
  const changesDir = resolveRepoPath(repoRoot, config.changes_dir, 'changes_dir');
  const changes = listWorktreeFiles(changesDir, '.md').map((name) => {
    const file = path.join(changesDir, name);
    const text = fs.readFileSync(file, 'utf8');
    return { file, name, text, ...parseChange(text) };
  });
  changes.sort((a, b) => String(a.frontmatter.id).localeCompare(String(b.frontmatter.id)));

  const specsDir = resolveSpecsDir(repoRoot, config);
  const specs = listWorktreeFiles(specsDir, '.md').map((name) => {
    const file = path.join(specsDir, name);
    return { file, name, ...parseSpec(fs.readFileSync(file, 'utf8')) };
  });
  const releasesDir = resolveRepoPath(repoRoot, DEFAULT_RELEASES_DIR, 'releases_dir');
  const releases = listWorktreeFiles(releasesDir, '.yml').map((name) => {
    const file = path.join(releasesDir, name);
    return { file, name, ...parseYaml(fs.readFileSync(file, 'utf8')) };
  });

  return {
    mode: 'worktree',
    revision: null,
    manifest: null,
    repoRoot,
    changeledgerDir,
    config,
    changes,
    specs,
    releases,
  };
}

function authorityFor(changeledgerDir) {
  const file = path.join(changeledgerDir, 'authority.yml');
  if (!fs.existsSync(file)) return null;
  let authority;
  try {
    authority = parseYaml(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid state authority: ${error.message}`);
  }
  if (!authority || typeof authority !== 'object') throw new Error('Invalid state authority');
  if (authority.format_version !== 1) throw new Error('Unsupported state authority format_version');
  if (authority.state_ref !== STATE_REF)
    throw new Error(`Unsupported state authority ref: ${authority.state_ref}`);
  if (typeof authority.baseline !== 'string' || authority.baseline === '') {
    throw new Error('Invalid state authority baseline');
  }
  if (typeof authority.project_id !== 'string' || authority.project_id === '') {
    throw new Error('Invalid state authority project_id');
  }
  return authority;
}

function gitStateRevision(repoRoot, authority, run) {
  let revision;
  try {
    revision = run(['rev-parse', '--verify', authority.state_ref], repoRoot).trim();
    const baseline = run(['rev-parse', '--verify', authority.baseline], repoRoot).trim();
    run(['merge-base', '--is-ancestor', baseline, revision], repoRoot);
  } catch {
    throw new Error('state authority is unavailable or does not descend from its baseline');
  }
  return revision;
}

function statePaths(repoRoot, revision, run) {
  let names;
  try {
    names = run(['ls-tree', '-r', '--name-only', revision, '--', STATE_ROOT], repoRoot)
      .split('\n')
      .filter(Boolean)
      .sort();
  } catch {
    throw new Error('state authority is unavailable or has no readable tree');
  }
  const valid = new RegExp(
    `^${STATE_ROOT}/(?:manifest\\.yml|config\\.yml|changes/[^/]+\\.md|specs/[^/]+\\.md|releases/[^/]+\\.yml)$`,
  );
  for (const name of names) {
    if (!valid.test(name)) throw new Error(`invalid state path: ${name}`);
  }
  for (const required of [MANIFEST, CONFIG]) {
    if (!names.includes(required)) throw new Error(`missing ${required}`);
  }
  return names;
}

function readStateFile(repoRoot, revision, file, run) {
  return run(['show', `${revision}:${file}`], repoRoot);
}

function loadStateSnapshot(repoRoot, changeledgerDir, authority, run) {
  const revision = gitStateRevision(repoRoot, authority, run);
  const names = statePaths(repoRoot, revision, run);
  const read = (file) => readStateFile(repoRoot, revision, file, run);
  const manifest = parseYaml(read(MANIFEST));
  const config = parseYaml(read(CONFIG));
  if (manifest?.format_version !== 1) throw new Error('Unsupported ledger state format_version');
  if (
    manifest?.project_id !== authority.project_id ||
    config?.project_id !== authority.project_id
  ) {
    throw new Error('state project_id does not match authority');
  }

  const entries = (dir, extension, parse) =>
    names
      .filter((name) => name.startsWith(`${STATE_ROOT}/${dir}/`) && name.endsWith(extension))
      .map((file) => {
        const name = path.posix.basename(file);
        const text = read(file);
        return { file: `git:${revision}:${file}`, name, text, ...parse(text) };
      });
  const changes = entries('changes', '.md', parseChange);
  changes.sort((a, b) => String(a.frontmatter.id).localeCompare(String(b.frontmatter.id)));
  const specs = entries('specs', '.md', parseSpec);
  const releases = entries('releases', '.yml', parseYaml);

  return {
    mode: 'state',
    revision,
    manifest,
    repoRoot,
    changeledgerDir,
    config,
    changes,
    specs,
    releases,
  };
}

export function loadLedgerStore(start = process.cwd(), { run = defaultRun } = {}) {
  const changeledgerDir = findChangeledgerDir(start);
  if (!changeledgerDir) {
    throw new Error(
      'Not a ChangeLedger repo (no .changeledger/ found). Run `changeledger init` first.',
    );
  }
  const repoRoot = path.dirname(changeledgerDir);
  const authority = authorityFor(changeledgerDir);
  if (!authority)
    return { mode: 'worktree', load: () => loadWorktreeSnapshot(repoRoot, changeledgerDir) };
  return {
    mode: 'state',
    load: () => loadStateSnapshot(repoRoot, changeledgerDir, authority, run),
  };
}
