// Graduates a change to a spec: scaffolds the spec file (frontmatter + a body
// seeded from the change's Specification/Proposal) and links it back in the
// change's Log. The final wording stays a manual/agent task.

import fs from 'node:fs';
import path from 'node:path';
import { parseChange } from '../change.mjs';
import { findSpecDir, loadConfig, resolveRepoPath, resolveSpecsDir } from '../config.mjs';
import { nowUtc } from '../paths.mjs';
import { appendLog, setReviewed, setSpecUpdated } from '../writer.mjs';
import { serializeScalar } from '../yaml.mjs';

// Resolves a change id to its file under changes_dir. Throws if absent.
function resolveChange(id, cwd) {
  const specDir = findSpecDir(cwd);
  if (!specDir) throw new Error('Not a Spec Ledger repo. Run `sl init` first.');
  const config = loadConfig(specDir);
  const repoRoot = path.dirname(specDir);
  const changesDir = resolveRepoPath(repoRoot, config.changes_dir, 'changes_dir');
  const name = fs.existsSync(changesDir)
    ? fs.readdirSync(changesDir).find((n) => n.startsWith(`${id}-`))
    : null;
  if (!name) throw new Error(`No change with id "${id}"`);
  return { config, repoRoot, changesDir, file: path.join(changesDir, name) };
}

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// `into: true` graduates into an EXISTING spec — it refreshes the spec's
// `updated` and links it back, but leaves the body to the agent (who knows what
// to refine). Without `into`, a new spec is scaffolded and an existing one is an
// error. Both routes share the same change-side record (marker + reviewed).
export function graduate(id, slug, cwd = process.cwd(), { into = false } = {}) {
  const { config, repoRoot, file: changeFile } = resolveChange(id, cwd);
  const change = parseChange(fs.readFileSync(changeFile, 'utf8'));
  if (change.frontmatter.status !== 'done') {
    throw new Error('only done changes can be graduated/skipped');
  }

  const specsDir = resolveSpecsDir(repoRoot, config);
  const specName = `${slugify(slug)}.md`;
  const specFile = path.join(specsDir, specName);
  const exists = fs.existsSync(specFile);

  if (into) {
    if (!exists) {
      throw new Error(`Spec "${specName}" does not exist — drop --into to create it`);
    }
    // Refresh the spec's updated; the body stays the agent's to edit.
    fs.writeFileSync(specFile, setSpecUpdated(fs.readFileSync(specFile, 'utf8'), nowUtc()));
  } else {
    if (exists) throw new Error(`Spec "${specName}" already exists`);

    const seedStage =
      change.stages.find((s) => s.key === 'specification') ??
      change.stages.find((s) => s.key === 'proposal');
    const seed = seedStage ? seedStage.body : '';
    const title = change.frontmatter.title;

    const content = `---
title: ${serializeScalar(title)}
updated: ${nowUtc()}
tags: [${change.frontmatter.type}]
---

# ${title}

> Graduado del change ${id}.

${seed}
`;
    fs.mkdirSync(specsDir, { recursive: true });
    fs.writeFileSync(specFile, content);
  }

  let text = appendLog(
    fs.readFileSync(changeFile, 'utf8'),
    nowUtc(),
    `graduado a spec \`${specName}\``,
  );
  text = setReviewed(text, true);
  fs.writeFileSync(changeFile, text);
  return specFile;
}

// Marks a done change's graduation as reviewed without creating a spec (e.g. a
// bug/chore with no persistent truth). Records the reason in the Log.
export function skipGraduation(id, reason, cwd = process.cwd()) {
  const { file: changeFile } = resolveChange(id, cwd);
  const change = parseChange(fs.readFileSync(changeFile, 'utf8'));
  if (change.frontmatter.status !== 'done')
    throw new Error('only done changes can be graduated/skipped');

  const message = reason ? `graduation skipped: ${reason}` : 'graduation skipped';
  let text = appendLog(fs.readFileSync(changeFile, 'utf8'), nowUtc(), message);
  text = setReviewed(text, true);
  fs.writeFileSync(changeFile, text);
  return changeFile;
}

// Lists done changes whose graduation has not been reviewed yet.
export function pendingGraduation(cwd = process.cwd()) {
  const specDir = findSpecDir(cwd);
  if (!specDir) throw new Error('Not a Spec Ledger repo. Run `sl init` first.');
  const config = loadConfig(specDir);
  const repoRoot = path.dirname(specDir);
  const changesDir = resolveRepoPath(repoRoot, config.changes_dir, 'changes_dir');
  if (!fs.existsSync(changesDir)) return [];

  return fs
    .readdirSync(changesDir)
    .filter((n) => n.endsWith('.md'))
    .sort()
    .map((n) => ({ name: n, ...parseChange(fs.readFileSync(path.join(changesDir, n), 'utf8')) }))
    .filter((c) => c.frontmatter.status === 'done' && c.frontmatter.reviewed !== true)
    .map((c) => ({ id: c.frontmatter.id, title: c.frontmatter.title, type: c.frontmatter.type }));
}
