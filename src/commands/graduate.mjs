// Graduation is intentionally two-phase for a new spec. `scaffoldSpec` creates
// an editable seed without resolving the change; `graduate --into` links only
// after the durable wording has been reviewed.

import fs from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from '../atomic-write.mjs';
import { parseChange } from '../change.mjs';
import { mutateResolvedChange } from '../change-store.mjs';
import { assertChangeTextValid } from '../check.mjs';
import { resolveSpecsDir } from '../config.mjs';
import { assertSupportedSchema } from '../config-migration.mjs';
import { nowUtc } from '../paths.mjs';
import { assertRepoStateWritable, resolveChange } from '../repo.mjs';
import { slugify } from '../slug.mjs';
import { appendLogEvent, setReviewed, setSpecGraduatedFrom, setSpecUpdated } from '../writer.mjs';
import { serializeScalar } from '../yaml.mjs';

const SPEC_SCAFFOLD_MARKER = '<!-- changeledger:spec-scaffold -->';

function graduationTarget(id, slug, cwd) {
  const resolved = resolveChange(cwd, id);
  assertSupportedSchema(resolved.config);
  assertRepoStateWritable(resolved);
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

function requireGraduationReady(config, changeFile, changeText) {
  const change = requireDone(changeText);
  assertChangeTextValid(config, path.basename(changeFile), changeText);
  return change;
}

export function scaffoldSpec(id, slug, cwd = process.cwd()) {
  const {
    config,
    file: changeFile,
    specsDir,
    specName,
    specFile,
  } = graduationTarget(id, slug, cwd);
  const resolved = resolveChange(cwd, id);
  const change = requireGraduationReady(config, changeFile, resolved.change.text);
  if (fs.existsSync(specFile)) throw new Error(`Spec "${specName}" already exists`);

  const seedStage =
    change.stages.find((stage) => stage.key === 'specification') ??
    change.stages.find((stage) => stage.key === 'proposal');
  const seed = seedStage ? seedStage.body : '';
  const content = `---
title: ${serializeScalar(change.frontmatter.title)}
updated: ${nowUtc()}
tags: [${change.frontmatter.type}]
graduated_from: []
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
  const resolved = graduationTarget(id, slug, cwd);
  const { config, file: changeFile, specName, specFile } = resolved;
  requireGraduationReady(config, changeFile, resolved.change.text);

  if (!fs.existsSync(specFile)) {
    throw new Error(`Spec "${specName}" does not exist — use --new to create a scaffold`);
  }

  const originalSpec = fs.readFileSync(specFile, 'utf8');
  if (originalSpec.includes(SPEC_SCAFFOLD_MARKER)) {
    throw new Error(
      `Spec "${specName}" still contains the scaffold marker — refine it and remove the marker before --into`,
    );
  }
  const timestamp = nowUtc();
  const updatedSpec = setSpecGraduatedFrom(setSpecUpdated(originalSpec, timestamp), id);
  writeFileAtomic(specFile, updatedSpec);
  try {
    mutateResolvedChange(
      resolved,
      (changeText) => {
        requireGraduationReady(config, changeFile, changeText);
        let text = appendLogEvent(changeText, {
          at: timestamp,
          type: 'graduation',
          outcome: 'spec',
          spec: specName,
        });
        text = setReviewed(text, true);
        return text;
      },
      { operation: 'graduate', actor: resolved.change.frontmatter.owner ?? 'human' },
    );
  } catch (error) {
    // Keep the integration-branch spec and the state document from silently
    // disagreeing when the state CAS loses a race.
    writeFileAtomic(specFile, originalSpec);
    throw error;
  }
  return specFile;
}

// Marks a done change's graduation as reviewed without creating a spec (e.g. a
// bug/chore with no persistent truth). Records the reason in the Log.
export function skipGraduation(id, reason, cwd = process.cwd()) {
  const resolved = resolveChange(cwd, id);
  const { config, file: changeFile } = resolved;
  mutateResolvedChange(
    resolved,
    (text) => {
      requireGraduationReady(config, changeFile, text);

      text = appendLogEvent(text, {
        at: nowUtc(),
        type: 'graduation',
        outcome: 'skipped',
        reason,
      });
      return setReviewed(text, true);
    },
    { operation: 'graduate:skip', actor: resolved.change.frontmatter.owner ?? 'human' },
  );
  return changeFile;
}
