// Graduation is intentionally two-phase for a new spec. `scaffoldSpec` creates
// an editable seed without resolving the change; `graduate --into` links only
// after the durable wording has been reviewed.

import fs from 'node:fs';
import path from 'node:path';
import { mutateFileAtomic, withFileLock, writeFileAtomic } from '../atomic-write.mjs';
import { parseChange } from '../change.mjs';
import { assertChangeTextValid } from '../check.mjs';
import { resolveSpecsDir } from '../config.mjs';
import { assertSupportedSchema } from '../config-migration.mjs';
import { loadLedgerStore } from '../ledger-store.mjs';
import { nowUtc } from '../paths.mjs';
import { resolveChange } from '../repo.mjs';
import { slugify } from '../slug.mjs';
import { appendLogEvent, setReviewed, setSpecGraduatedFrom, setSpecUpdated } from '../writer.mjs';
import { serializeScalar } from '../yaml.mjs';

const SPEC_SCAFFOLD_MARKER = '<!-- changeledger:spec-scaffold -->';

function graduationTarget(id, slug, cwd) {
  const resolved = resolveChange(cwd, id);
  assertSupportedSchema(resolved.config);
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
  const change = requireGraduationReady(config, changeFile, fs.readFileSync(changeFile, 'utf8'));
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
export function graduate(id, slug, cwd = process.cwd(), { into = false, fsImpl = fs } = {}) {
  if (!into) {
    throw new Error('graduation mode required: use --new, --into, or --skip');
  }
  const store = loadLedgerStore(cwd);
  if (store.mode === 'state') {
    const snapshot = store.load();
    assertSupportedSchema(snapshot.config);
    const change = snapshot.changes.find(
      (candidate) => String(candidate.frontmatter.id) === String(id),
    );
    if (!change) throw new Error(`No change with id "${id}"`);
    const specName = `${slugify(slug)}.md`;
    const spec = snapshot.specs.find((candidate) => candidate.name === specName);
    if (!spec)
      throw new Error(`Spec "${specName}" does not exist — use --new to create a scaffold`);
    const after = store.mutate(
      { message: `changeledger: graduate ${id}` },
      ({ snapshot, write }) => {
        const currentChange = snapshot.changes.find(
          (candidate) => candidate.statePath === change.statePath,
        );
        const currentSpec = snapshot.specs.find(
          (candidate) => candidate.statePath === spec.statePath,
        );
        if (!currentChange || !currentSpec)
          throw new Error('graduation target changed concurrently; retry');
        requireGraduationReady(snapshot.config, currentChange.file, currentChange.text);
        if (currentSpec.text.includes(SPEC_SCAFFOLD_MARKER)) {
          throw new Error(
            `Spec "${specName}" still contains the scaffold marker — refine it and remove the marker before --into`,
          );
        }
        const timestamp = nowUtc();
        const updatedSpec = setSpecGraduatedFrom(setSpecUpdated(currentSpec.text, timestamp), id);
        let updatedChange = appendLogEvent(currentChange.text, {
          at: timestamp,
          type: 'graduation',
          outcome: 'spec',
          spec: specName,
        });
        updatedChange = setReviewed(updatedChange, true);
        write(currentSpec.statePath, updatedSpec);
        write(currentChange.statePath, updatedChange);
      },
    );
    return after.specs.find((candidate) => candidate.name === specName)?.file;
  }
  const { config, file: changeFile, specName, specFile } = graduationTarget(id, slug, cwd);
  requireGraduationReady(config, changeFile, fs.readFileSync(changeFile, 'utf8'));

  if (!fsImpl.existsSync(specFile)) {
    throw new Error(`Spec "${specName}" does not exist — use --new to create a scaffold`);
  }

  withFileLock(
    specFile,
    () => {
      let originalSpec;
      let wroteSpec = false;
      let changeCommitted = false;

      try {
        mutateFileAtomic(
          changeFile,
          (changeText) => {
            requireGraduationReady(config, changeFile, changeText);
            originalSpec = fsImpl.readFileSync(specFile, 'utf8');
            if (originalSpec.includes(SPEC_SCAFFOLD_MARKER)) {
              throw new Error(
                `Spec "${specName}" still contains the scaffold marker — refine it and remove the marker before --into`,
              );
            }
            const timestamp = nowUtc();
            const updatedSpec = setSpecGraduatedFrom(setSpecUpdated(originalSpec, timestamp), id);
            writeFileAtomic(specFile, updatedSpec, { fsImpl });
            wroteSpec = true;

            let updatedChange = appendLogEvent(changeText, {
              at: timestamp,
              type: 'graduation',
              outcome: 'spec',
              spec: specName,
            });
            updatedChange = setReviewed(updatedChange, true);
            return updatedChange;
          },
          { fsImpl, onCommit: () => (changeCommitted = true) },
        );
      } catch (error) {
        if (!wroteSpec) throw error;
        if (changeCommitted) throw error;
        try {
          writeFileAtomic(specFile, originalSpec, { fsImpl });
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            `graduation failed and spec rollback failed: ${specFile}`,
            { cause: error },
          );
        }
        throw error;
      }
    },
    { fsImpl },
  );
  return specFile;
}

// Marks a done change's graduation as reviewed without creating a spec (e.g. a
// bug/chore with no persistent truth). Records the reason in the Log.
export function skipGraduation(id, reason, cwd = process.cwd()) {
  const store = loadLedgerStore(cwd);
  if (store.mode === 'state') {
    const snapshot = store.load();
    const change = snapshot.changes.find(
      (candidate) => String(candidate.frontmatter.id) === String(id),
    );
    if (!change) throw new Error(`No change with id "${id}"`);
    assertSupportedSchema(snapshot.config);
    const after = store.mutate(
      { message: `changeledger: graduate skip ${id}` },
      ({ snapshot, write }) => {
        const current = snapshot.changes.find(
          (candidate) => candidate.statePath === change.statePath,
        );
        if (!current) throw new Error(`No change with id "${id}" in the state snapshot`);
        requireGraduationReady(snapshot.config, current.file, current.text);
        const text = appendLogEvent(current.text, {
          at: nowUtc(),
          type: 'graduation',
          outcome: 'skipped',
          reason,
        });
        write(current.statePath, setReviewed(text, true));
      },
    );
    return after.changes.find((candidate) => String(candidate.frontmatter.id) === String(id))?.file;
  }
  const { config, file: changeFile } = resolveChange(cwd, id);
  assertSupportedSchema(config);
  mutateFileAtomic(changeFile, (text) => {
    requireGraduationReady(config, changeFile, text);

    text = appendLogEvent(text, {
      at: nowUtc(),
      type: 'graduation',
      outcome: 'skipped',
      reason,
    });
    return setReviewed(text, true);
  });
  return changeFile;
}
