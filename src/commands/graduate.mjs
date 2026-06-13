// Graduates a change to a spec: scaffolds the spec file (frontmatter + a body
// seeded from the change's Specification/Proposal) and links it back in the
// change's Log. The final wording stays a manual/agent task.

import fs from 'node:fs';
import path from 'node:path';
import { parseChange } from '../change.mjs';
import { findSpecDir, loadConfig } from '../config.mjs';
import { nowUtc } from '../paths.mjs';
import { appendLog } from '../writer.mjs';

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function graduate(id, slug, cwd = process.cwd()) {
  const specDir = findSpecDir(cwd);
  if (!specDir) throw new Error('Not a Spec Ledger repo. Run `sl init` first.');

  const config = loadConfig(specDir);
  const repoRoot = path.dirname(specDir);
  const changesDir = path.join(repoRoot, config.changes_dir);
  const name = fs.existsSync(changesDir)
    ? fs.readdirSync(changesDir).find((n) => n.startsWith(`${id}-`))
    : null;
  if (!name) throw new Error(`No change with id "${id}"`);

  const changeFile = path.join(changesDir, name);
  const change = parseChange(fs.readFileSync(changeFile, 'utf8'));

  const specsDir = path.join(repoRoot, config.specs_dir ?? '.sl/specs');
  const specName = `${slugify(slug)}.md`;
  const specFile = path.join(specsDir, specName);
  if (fs.existsSync(specFile)) throw new Error(`Spec "${specName}" already exists`);

  const seedStage =
    change.stages.find((s) => s.key === 'specification') ??
    change.stages.find((s) => s.key === 'proposal');
  const seed = seedStage ? seedStage.body : '';
  const title = change.frontmatter.title;

  const content = `---
title: ${title}
updated: ${nowUtc()}
tags: [${change.frontmatter.type}]
---

# ${title}

> Graduado del change ${id}.

${seed}
`;

  fs.mkdirSync(specsDir, { recursive: true });
  fs.writeFileSync(specFile, content);
  fs.writeFileSync(
    changeFile,
    appendLog(fs.readFileSync(changeFile, 'utf8'), nowUtc(), `graduado a spec \`${specName}\``),
  );
  return specFile;
}
