import fs from 'node:fs';
import path from 'node:path';
import { parseChange } from './change.mjs';
import { findChangeledgerDir, loadConfig, resolveRepoPath, resolveSpecsDir } from './config.mjs';
import { loadReleases, loadReleasesAsync } from './release.mjs';
import { parseSpec } from './spec.mjs';

// Single authority for resolving a change id to its file. Matches by EXACT
// frontmatter.id equality — never by filename prefix — so a partial or ambiguous
// id (timestamp ids share prefixes) cannot silently target the first file that
// happens to share it, and a misleading filename cannot stand in for a change
// whose frontmatter id differs. A file that fails to parse cannot be the exact
// match, so it is skipped rather than aborting the search. Shared by every
// mutating and locating command.
export function resolveChange(start, id) {
  const changeledgerDir = findChangeledgerDir(start);
  if (!changeledgerDir) throw new Error('Not a ChangeLedger repo. Run `changeledger init` first.');
  const config = loadConfig(changeledgerDir);
  const repoRoot = path.dirname(changeledgerDir);
  const changesDir = resolveRepoPath(repoRoot, config.changes_dir, 'changes_dir');
  if (fs.existsSync(changesDir)) {
    for (const name of fs.readdirSync(changesDir).sort()) {
      if (!name.endsWith('.md')) continue;
      const file = path.join(changesDir, name);
      let frontmatter;
      try {
        ({ frontmatter } = parseChange(fs.readFileSync(file, 'utf8')));
      } catch {
        continue; // unparseable file can't be the exact match
      }
      if (String(frontmatter.id) === String(id)) return { config, repoRoot, changesDir, file };
    }
  }
  throw new Error(
    `No change with id "${id}" (use the exact id; run \`changeledger check\` if a filename's id looks wrong)`,
  );
}

// Loads a ChangeLedger repo: locates .changeledger/, reads config and every change file.
// Shared by `changeledger view` and `changeledger check`.
export function loadRepo(start = process.cwd()) {
  const changeledgerDir = findChangeledgerDir(start);
  if (!changeledgerDir) {
    throw new Error(
      'Not a ChangeLedger repo (no .changeledger/ found). Run `changeledger init` first.',
    );
  }
  const repoRoot = path.dirname(changeledgerDir);
  const config = loadConfig(changeledgerDir);
  const changesDir = resolveRepoPath(repoRoot, config.changes_dir, 'changes_dir');

  const changes = [];
  if (fs.existsSync(changesDir)) {
    for (const name of fs.readdirSync(changesDir).sort()) {
      if (!name.endsWith('.md')) continue;
      const file = path.join(changesDir, name);
      const text = fs.readFileSync(file, 'utf8');
      changes.push({ file, name, text, ...parseChange(text) });
    }
  }
  changes.sort((a, b) => String(a.frontmatter.id).localeCompare(String(b.frontmatter.id)));

  const specs = [];
  const specsDir = resolveSpecsDir(repoRoot, config);
  if (fs.existsSync(specsDir)) {
    for (const name of fs.readdirSync(specsDir).sort()) {
      if (!name.endsWith('.md')) continue;
      const file = path.join(specsDir, name);
      specs.push({ file, name, ...parseSpec(fs.readFileSync(file, 'utf8')) });
    }
  }

  const releases = loadReleases(repoRoot);

  return { changeledgerDir, repoRoot, config, changes, specs, releases };
}

// Async equivalent for HTTP paths that should not monopolize the Node event
// loop while reading large change/spec histories. The synchronous loader remains
// the command API for CLI code.
export async function loadRepoAsync(start = process.cwd()) {
  const changeledgerDir = findChangeledgerDir(start);
  if (!changeledgerDir) {
    throw new Error(
      'Not a ChangeLedger repo (no .changeledger/ found). Run `changeledger init` first.',
    );
  }
  const repoRoot = path.dirname(changeledgerDir);
  const config = loadConfig(changeledgerDir);
  const changesDir = resolveRepoPath(repoRoot, config.changes_dir, 'changes_dir');

  const changes = [];
  try {
    const names = (await fs.promises.readdir(changesDir)).sort();
    for (const name of names) {
      if (!name.endsWith('.md')) continue;
      const file = path.join(changesDir, name);
      const text = await fs.promises.readFile(file, 'utf8');
      changes.push({ file, name, text, ...parseChange(text) });
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  changes.sort((a, b) => String(a.frontmatter.id).localeCompare(String(b.frontmatter.id)));

  const specs = [];
  const specsDir = resolveSpecsDir(repoRoot, config);
  try {
    const names = (await fs.promises.readdir(specsDir)).sort();
    for (const name of names) {
      if (!name.endsWith('.md')) continue;
      const file = path.join(specsDir, name);
      specs.push({ file, name, ...parseSpec(await fs.promises.readFile(file, 'utf8')) });
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  const releases = await loadReleasesAsync(repoRoot);

  return { changeledgerDir, repoRoot, config, changes, specs, releases };
}
