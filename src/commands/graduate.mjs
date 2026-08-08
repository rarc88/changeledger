// Graduation is intentionally two-phase for a new spec. `scaffoldSpec` creates
// an editable seed without resolving the change; `graduate --into` links only
// after the durable wording has been reviewed.

import fs from 'node:fs';
import path from 'node:path';
import { mutateFileAtomic, withFileLock, writeFileAtomic } from '../atomic-write.mjs';
import { parseChange } from '../change.mjs';
import { mutateLedgerFile, repoIsActivated, writeLedgerFiles } from '../change-store.mjs';
import { assertChangeTextValid, specDurabilityIssue } from '../check.mjs';
import { findChangeledgerDir, resolveSpecsDir } from '../config.mjs';
import { assertSupportedSchema } from '../config-migration.mjs';
import { nowUtc } from '../paths.mjs';
import { loadRepo, resolveChange, resolveChangeInRepo } from '../repo.mjs';
import { slugify } from '../slug.mjs';
import { parseSpec } from '../spec.mjs';
import { readSnapshot } from '../state-store.mjs';
import { appendLogEvent, setReviewed, setSpecGraduatedFrom, setSpecUpdated } from '../writer.mjs';
import { serializeScalar } from '../yaml.mjs';

const SPEC_SCAFFOLD_MARKER = '<!-- changeledger:spec-scaffold -->';

// Locates the change and the target spec name for graduation. Inactive:
// unchanged, worktree files via `resolveChange`. Active: resolves the change
// from the loaded repo's snapshot and reads the spec's raw text directly
// from that same revision (`repo.specs` only carries the parsed
// frontmatter/body, not the original text the graduation writers operate
// on) — never falling back to the worktree.
function graduationTarget(id, slug, cwd) {
  const changeledgerDir = findChangeledgerDir(cwd);
  if (!changeledgerDir) throw new Error('Not a ChangeLedger repo. Run `changeledger init` first.');
  const repoRoot = path.dirname(changeledgerDir);
  const specName = `${slugify(slug)}.md`;

  if (repoIsActivated(repoRoot)) {
    const repo = loadRepo(cwd);
    assertSupportedSchema(repo.config);
    const change = resolveChangeInRepo(repo, id);
    const specRelPath = `specs/${specName}`;
    const snapshot = readSnapshot(repo.repoRoot, { revision: repo.state.revision });
    const specText = snapshot.documents[specRelPath];
    return {
      config: repo.config,
      repo,
      repoRoot: repo.repoRoot,
      specName,
      changeTarget: { relPath: `changes/${change.name}`, text: change.text },
      changeName: change.name,
      specTarget: specText === undefined ? null : { relPath: specRelPath, text: specText },
    };
  }

  const resolved = resolveChange(cwd, id);
  assertSupportedSchema(resolved.config);
  const specsDir = resolveSpecsDir(resolved.repoRoot, resolved.config);
  const specFile = path.join(specsDir, specName);
  return {
    config: resolved.config,
    repo: { state: null, repoRoot: resolved.repoRoot },
    repoRoot: resolved.repoRoot,
    specName,
    specsDir,
    changeTarget: { file: resolved.file },
    changeName: path.basename(resolved.file),
    specTarget: fs.existsSync(specFile) ? { file: specFile } : null,
  };
}

// Locates only the change, for `skipGraduation` (which never touches a
// spec). Same active/inactive split as `graduationTarget`, minus the spec
// half.
function locateChange(id, cwd) {
  const changeledgerDir = findChangeledgerDir(cwd);
  if (!changeledgerDir) throw new Error('Not a ChangeLedger repo. Run `changeledger init` first.');
  const repoRoot = path.dirname(changeledgerDir);

  if (repoIsActivated(repoRoot)) {
    const repo = loadRepo(cwd);
    assertSupportedSchema(repo.config);
    const change = resolveChangeInRepo(repo, id);
    return {
      config: repo.config,
      repo,
      target: { relPath: `changes/${change.name}`, text: change.text },
      name: change.name,
    };
  }

  const resolved = resolveChange(cwd, id);
  assertSupportedSchema(resolved.config);
  return {
    config: resolved.config,
    repo: { state: null, repoRoot: resolved.repoRoot },
    target: { file: resolved.file },
    name: path.basename(resolved.file),
  };
}

function requireDone(changeText) {
  const change = parseChange(changeText);
  if (change.frontmatter.status !== 'done') {
    throw new Error('only done changes can be graduated/skipped');
  }
  return change;
}

function requireGraduationReady(config, changeName, changeText) {
  const change = requireDone(changeText);
  assertChangeTextValid(config, changeName, changeText);
  return change;
}

export function scaffoldSpec(id, slug, cwd = process.cwd()) {
  const { config, repo, specName, changeTarget, changeName, specTarget } = graduationTarget(
    id,
    slug,
    cwd,
  );
  const changeText = changeTarget.file
    ? fs.readFileSync(changeTarget.file, 'utf8')
    : changeTarget.text;
  const change = requireGraduationReady(config, changeName, changeText);
  if (specTarget) throw new Error(`Spec "${specName}" already exists`);

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

  if (!repo.state) {
    fs.mkdirSync(path.dirname(changeTarget.file), { recursive: true }); // no-op if it already exists
    const specsDir = resolveSpecsDir(repo.repoRoot, config);
    fs.mkdirSync(specsDir, { recursive: true });
    const specFile = path.join(specsDir, specName);
    writeFileAtomic(specFile, content);
    return specFile;
  }
  writeLedgerFiles(repo, [{ relPath: `specs/${specName}`, text: content }], {
    message: `graduate-scaffold: ${id}`,
  });
  return `specs/${specName}`;
}

// Finalizes graduation into an EXISTING, manually refined spec. The command
// refreshes `updated` and links it back, but never overwrites the body.
// Active mode: the change's `[graduation]` Log event and the spec's
// `graduated_from` link land in exactly one CAS commit — no intermediate
// state where only one of the two documents advanced, closing the gap the
// inactive path still carries as a manual write + rollback pair.
export function graduate(id, slug, cwd = process.cwd(), { into = false, fsImpl = fs } = {}) {
  if (!into) {
    throw new Error('graduation mode required: use --new, --into, or --skip');
  }
  const { config, repo, specName, changeTarget, changeName, specTarget } = graduationTarget(
    id,
    slug,
    cwd,
  );

  if (repo.state) {
    requireGraduationReady(config, changeName, changeTarget.text);
    if (!specTarget) {
      throw new Error(`Spec "${specName}" does not exist — use --new to create a scaffold`);
    }
    if (specTarget.text.includes(SPEC_SCAFFOLD_MARKER)) {
      throw new Error(
        `Spec "${specName}" still contains the scaffold marker — refine it and remove the marker before --into`,
      );
    }
    const durabilityIssue = specDurabilityIssue(parseSpec(specTarget.text).body);
    if (durabilityIssue) throw new Error(durabilityIssue);
    const timestamp = nowUtc();
    const updatedSpec = setSpecGraduatedFrom(setSpecUpdated(specTarget.text, timestamp), id);
    let updatedChange = appendLogEvent(changeTarget.text, {
      at: timestamp,
      type: 'graduation',
      outcome: 'spec',
      spec: specName,
    });
    updatedChange = setReviewed(updatedChange, true);
    writeLedgerFiles(
      repo,
      [
        { relPath: specTarget.relPath, text: updatedSpec },
        { relPath: changeTarget.relPath, text: updatedChange },
      ],
      { message: `graduate: ${id}` },
    );
    return specTarget.relPath;
  }

  const changeFile = changeTarget.file;
  requireGraduationReady(config, path.basename(changeFile), fs.readFileSync(changeFile, 'utf8'));

  if (!specTarget) {
    throw new Error(`Spec "${specName}" does not exist — use --new to create a scaffold`);
  }
  const specFile = specTarget.file;

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
            requireGraduationReady(config, path.basename(changeFile), changeText);
            originalSpec = fsImpl.readFileSync(specFile, 'utf8');
            if (originalSpec.includes(SPEC_SCAFFOLD_MARKER)) {
              throw new Error(
                `Spec "${specName}" still contains the scaffold marker — refine it and remove the marker before --into`,
              );
            }
            const durabilityIssue = specDurabilityIssue(parseSpec(originalSpec).body);
            if (durabilityIssue) throw new Error(durabilityIssue);
            const timestamp = nowUtc();
            const updatedSpec = setSpecGraduatedFrom(setSpecUpdated(originalSpec, timestamp), id);
            writeFileAtomic(specFile, updatedSpec, { fsImpl });
            wroteSpec = true;

            let text = appendLogEvent(changeText, {
              at: timestamp,
              type: 'graduation',
              outcome: 'spec',
              spec: specName,
            });
            text = setReviewed(text, true);
            return text;
          },
          { fsImpl, onCommit: () => (changeCommitted = true) },
        );
      } catch (error) {
        if (!wroteSpec || changeCommitted) throw error;
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
  const { config, repo, target, name } = locateChange(id, cwd);
  mutateLedgerFile(
    repo,
    target,
    (text) => {
      requireGraduationReady(config, name, text);

      text = appendLogEvent(text, {
        at: nowUtc(),
        type: 'graduation',
        outcome: 'skipped',
        reason,
      });
      return setReviewed(text, true);
    },
    { message: `graduate-skip: ${id}` },
  );
  return target.file;
}
