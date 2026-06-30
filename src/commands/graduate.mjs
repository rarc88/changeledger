// Graduation is intentionally two-phase for a new spec. `scaffoldSpec` creates
// an editable seed without resolving the change; `graduate --into` links only
// after the durable wording has been reviewed.

import fs from 'node:fs';
import path from 'node:path';
import { mutateFileAtomic, writeFileAtomic } from '../atomic-write.mjs';
import { parseChange } from '../change.mjs';
import { findChangeledgerDir, loadConfig, resolveRepoPath, resolveSpecsDir } from '../config.mjs';
import { nowUtc } from '../paths.mjs';
import { resolveChange } from '../repo.mjs';
import { slugify } from '../slug.mjs';
import { appendLog, setReviewed, setSpecUpdated } from '../writer.mjs';
import { serializeScalar } from '../yaml.mjs';

const SPEC_SCAFFOLD_MARKER = '<!-- changeledger:spec-scaffold -->';

function graduationTarget(id, slug, cwd) {
  const resolved = resolveChange(cwd, id);
  const specsDir = resolveSpecsDir(resolved.repoRoot, resolved.config);
  const specName = `${slugify(slug)}.md`;
  return { ...resolved, specsDir, specName, specFile: path.join(specsDir, specName) };
}

function requireDone(changeText) {
  const change = parseChange(changeText);
  if (change.frontmatter.status !== 'done') {
    throw new Error('only done changes can be graduated/skipped');
  }
  return change;
}

export function scaffoldSpec(id, slug, cwd = process.cwd()) {
  const { file: changeFile, specsDir, specName, specFile } = graduationTarget(id, slug, cwd);
  if (fs.existsSync(specFile)) throw new Error(`Spec "${specName}" already exists`);

  const change = requireDone(fs.readFileSync(changeFile, 'utf8'));
  const seedStage =
    change.stages.find((stage) => stage.key === 'specification') ??
    change.stages.find((stage) => stage.key === 'proposal');
  const seed = seedStage ? seedStage.body : '';
  const content = `---
title: ${serializeScalar(change.frontmatter.title)}
updated: ${nowUtc()}
tags: [${change.frontmatter.type}]
---

# ${change.frontmatter.title}

${SPEC_SCAFFOLD_MARKER}

> Scaffold from change ${id}; replace this seed with durable current truth before --into.

${seed}
`;

  fs.mkdirSync(specsDir, { recursive: true });
  writeFileAtomic(specFile, content);
  return specFile;
}

// Finalizes graduation into an EXISTING, manually refined spec. The command
// refreshes `updated` and links it back, but never overwrites the body.
export function graduate(id, slug, cwd = process.cwd(), { into = false } = {}) {
  if (!into) {
    throw new Error('graduation mode required: use --new, --into, or --skip');
  }
  const { file: changeFile, specName, specFile } = graduationTarget(id, slug, cwd);

  if (!fs.existsSync(specFile)) {
    throw new Error(`Spec "${specName}" does not exist — use --new to create a scaffold`);
  }

  mutateFileAtomic(changeFile, (changeText) => {
    requireDone(changeText);
    const specText = fs.readFileSync(specFile, 'utf8');
    if (specText.includes(SPEC_SCAFFOLD_MARKER)) {
      throw new Error(
        `Spec "${specName}" still contains the scaffold marker — refine it and remove the marker before --into`,
      );
    }
    writeFileAtomic(specFile, setSpecUpdated(specText, nowUtc()));

    let text = appendLog(changeText, nowUtc(), `graduado a spec \`${specName}\``);
    text = setReviewed(text, true);
    return text;
  });
  return specFile;
}

// Marks a done change's graduation as reviewed without creating a spec (e.g. a
// bug/chore with no persistent truth). Records the reason in the Log.
export function skipGraduation(id, reason, cwd = process.cwd()) {
  const { file: changeFile } = resolveChange(cwd, id);
  const message = reason ? `graduation skipped: ${reason}` : 'graduation skipped';
  mutateFileAtomic(changeFile, (text) => {
    const change = parseChange(text);
    if (change.frontmatter.status !== 'done')
      throw new Error('only done changes can be graduated/skipped');

    text = appendLog(text, nowUtc(), message);
    return setReviewed(text, true);
  });
  return changeFile;
}

// Lists done changes whose graduation has not been reviewed yet.
export function pendingGraduation(cwd = process.cwd()) {
  const changeledgerDir = findChangeledgerDir(cwd);
  if (!changeledgerDir) throw new Error('Not a ChangeLedger repo. Run `changeledger init` first.');
  const config = loadConfig(changeledgerDir);
  const repoRoot = path.dirname(changeledgerDir);
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
