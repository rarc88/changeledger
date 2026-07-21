// Graduation is intentionally two-phase for a new spec. `scaffoldSpec` creates
// an editable seed without resolving the change; `graduate --into` links only
// after the durable wording has been reviewed.

import fs from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from '../atomic-write.mjs';
import { parseChange } from '../change.mjs';
import { assertResolvedOwner, mutateResolvedChange } from '../change-store.mjs';
import { assertChangeTextValid } from '../check.mjs';
import { resolveSpecsDir } from '../config.mjs';
import { assertSupportedSchema } from '../config-migration.mjs';
import { ownerHandle as defaultOwnerHandle, objectRun } from '../git.mjs';
import { nowUtc } from '../paths.mjs';
import { assertRepoStateWritable, integrationObservationRef, resolveChange } from '../repo.mjs';
import { slugify } from '../slug.mjs';
import { parseSpec } from '../spec.mjs';
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

function canonicalGraduation(resolved, specFile, id) {
  if (!resolved.state) return undefined;
  const integrationBranch = resolved.state.manifest.integration_branch;
  let integrationRef = resolved.state.integrationRef ?? `refs/heads/${integrationBranch}`;
  try {
    objectRun(['remote', 'get-url', 'origin'], resolved.repoRoot);
    // A remote-tracking ref is only a cache and may survive a remote rewind,
    // deletion, or URL change. Refresh the exact authoritative branch into a
    // ChangeLedger-owned observation ref before accepting graduation evidence.
    integrationRef = integrationObservationRef(integrationBranch);
    objectRun(
      ['fetch', '--no-tags', 'origin', `+refs/heads/${integrationBranch}:${integrationRef}`],
      resolved.repoRoot,
    );
  } catch {
    // A configured but unreachable/missing remote cannot be replaced by stale
    // local evidence. Without origin at all, the local integration branch is
    // the only available authority and the state mutation remains pending.
    try {
      objectRun(['remote', 'get-url', 'origin'], resolved.repoRoot);
      return undefined;
    } catch {
      // Keep the local integration ref selected above.
    }
  }
  const relative = path.relative(resolved.repoRoot, specFile).split(path.sep).join('/');
  if (!relative || relative.startsWith('../')) {
    throw new Error(`Spec "${specFile}" is outside the repository`);
  }
  try {
    const text = objectRun(['show', `${integrationRef}:${relative}`], resolved.repoRoot);
    const graduatedFrom = parseSpec(text).frontmatter.graduated_from ?? [];
    if (!Array.isArray(graduatedFrom) || !graduatedFrom.map(String).includes(String(id))) {
      return undefined;
    }
    return {
      revision: objectRun(['rev-parse', '--verify', integrationRef], resolved.repoRoot).trim(),
    };
  } catch {
    return undefined;
  }
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
export function graduate(
  id,
  slug,
  cwd = process.cwd(),
  { into = false, actorHandle = defaultOwnerHandle } = {},
) {
  if (!into) {
    throw new Error('graduation mode required: use --new, --into, or --skip');
  }
  const resolved = graduationTarget(id, slug, cwd);
  const { config, file: changeFile, specName, specFile } = resolved;
  requireGraduationReady(config, changeFile, resolved.change.text);
  const actor = actorHandle(resolved.repoRoot);
  assertResolvedOwner(resolved, actor);

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
  const canonical = canonicalGraduation(resolved, specFile, id);
  if (resolved.state && !canonical) {
    writeFileAtomic(specFile, updatedSpec);
    return { file: specFile, pending: true, reason: 'canonical-spec' };
  }

  if (!resolved.state) writeFileAtomic(specFile, updatedSpec);
  let mutation;
  try {
    mutation = mutateResolvedChange(
      resolved,
      (changeText) => {
        requireGraduationReady(config, changeFile, changeText);
        let text = appendLogEvent(changeText, {
          at: timestamp,
          type: 'graduation',
          outcome: 'spec',
          spec: specName,
          detail: canonical ? `canonical ${canonical.revision}` : undefined,
        });
        text = setReviewed(text, true);
        return text;
      },
      { operation: 'graduate', actor: actor || 'unknown' },
    );
  } catch (error) {
    // Legacy graduation writes the spec before its local change document. Keep
    // those two files aligned if that second write fails. Global graduation
    // finalizes only after the canonical spec already exists, so it never rolls
    // back a version the integration branch has published.
    if (!resolved.state) writeFileAtomic(specFile, originalSpec);
    throw error;
  }
  if (!canonical) return specFile;
  const pending = mutation.pending || mutation.confirmed === false;
  return {
    file: specFile,
    pending,
    confirmed: mutation.confirmed,
    reason: pending ? 'state-publication' : undefined,
    canonicalRevision: canonical.revision,
  };
}

// Marks a done change's graduation as reviewed without creating a spec (e.g. a
// bug/chore with no persistent truth). Records the reason in the Log.
export function skipGraduation(
  id,
  reason,
  cwd = process.cwd(),
  { actorHandle = defaultOwnerHandle } = {},
) {
  const resolved = resolveChange(cwd, id);
  const { config, file: changeFile } = resolved;
  const actor = actorHandle(resolved.repoRoot);
  assertResolvedOwner(resolved, actor);
  const mutation = mutateResolvedChange(
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
    { operation: 'graduate:skip', actor: actor || 'unknown' },
  );
  if (!resolved.state) return changeFile;
  const pending = mutation.pending || mutation.confirmed === false;
  return {
    file: changeFile,
    pending,
    confirmed: mutation.confirmed,
    reason: pending ? 'state-publication' : undefined,
  };
}
