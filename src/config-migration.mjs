import fs from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { writeFileAtomic } from './atomic-write.mjs';
import { templatesDir } from './paths.mjs';

export const SUPPORTED_SCHEMA_VERSION = 1;

const CANONICAL_STATUSES = [
  'draft',
  'approved',
  'in-progress',
  'in-review',
  'in-validation',
  'blocked',
  'done',
  'discarded',
];

const BUILTIN_TYPES = ['feature', 'bug', 'refactor'];

const BUILTIN_IMPACTS = {
  feature: 'minor',
  bug: 'patch',
  audit: 'none',
  refactor: 'none',
  chore: 'none',
};

export function getSchemaVersion(config) {
  const v = config.schema_version;
  return typeof v === 'number' ? v : 0;
}

// Returns null when no migration needed; throws on invalid/future schema.
// Otherwise returns { yaml: string, changes: string[] }.
export function buildMigration(originalText) {
  let doc;
  try {
    doc = parseDocument(originalText, { merge: false });
  } catch (e) {
    throw new Error(`Invalid YAML: ${e.message}`);
  }
  if (doc.errors.length) {
    throw new Error(`Invalid YAML: ${doc.errors[0].message}`);
  }

  const config = doc.toJS() ?? {};
  const current = getSchemaVersion(config);

  if (current > SUPPORTED_SCHEMA_VERSION) {
    throw new Error(
      `config schema ${current} is newer than supported schema ${SUPPORTED_SCHEMA_VERSION}`,
    );
  }
  if (current === SUPPORTED_SCHEMA_VERSION) {
    return null;
  }

  const changes = [];

  // schema_version: 1 — remove any existing value, then prepend to appear first
  if (Object.hasOwn(config, 'schema_version')) {
    doc.delete('schema_version');
  }
  doc.contents.items.unshift(doc.createPair('schema_version', 1));
  changes.push('added schema_version: 1');

  // tdd: true if absent
  if (!Object.hasOwn(config, 'tdd')) {
    doc.set('tdd', true);
    changes.push('added tdd: true');
  }

  // specs_dir if absent
  if (!Object.hasOwn(config, 'specs_dir')) {
    doc.set('specs_dir', '.changeledger/specs');
    changes.push('added specs_dir: .changeledger/specs');
  }

  // Canonical statuses — insert missing ones in canonical order
  const statusesNode = doc.get('statuses', true);
  if (statusesNode) {
    const current_statuses = statusesNode.items.map((n) => String(n.value));
    for (const status of CANONICAL_STATUSES) {
      if (current_statuses.includes(status)) continue;
      const insertBefore = findInsertBefore(current_statuses, CANONICAL_STATUSES, status);
      const newNode = doc.createNode(status);
      if (insertBefore === -1) {
        statusesNode.items.push(newNode);
        current_statuses.push(status);
      } else {
        statusesNode.items.splice(insertBefore, 0, newNode);
        current_statuses.splice(insertBefore, 0, status);
      }
      changes.push(`added status: ${status}`);
    }
  }

  // review_required: true for built-in types where key is absent
  const configTypes = config.types ?? {};
  for (const typeName of BUILTIN_TYPES) {
    if (!Object.hasOwn(configTypes, typeName)) continue;
    if (Object.hasOwn(configTypes[typeName], 'review_required')) continue;
    doc.setIn(['types', typeName, 'review_required'], true);
    changes.push(`added types.${typeName}.review_required: true`);
  }

  // release.impacts defaults for built-in types that exist in config.types
  const currentImpacts = config.release?.impacts ?? {};
  for (const [type, impact] of Object.entries(BUILTIN_IMPACTS)) {
    if (!Object.hasOwn(configTypes, type)) continue;
    if (Object.hasOwn(currentImpacts, type)) continue;
    doc.setIn(['release', 'impacts', type], impact);
    changes.push(`added release.impacts.${type}: ${impact}`);
  }

  // Remove legacy id_digits
  if (Object.hasOwn(config, 'id_digits')) {
    doc.delete('id_digits');
    changes.push('removed legacy id_digits');
  }

  // Refresh managed comments from the current template, preserving custom comments.
  const templateComments = loadTemplateComments();
  const commentChanges = refreshManagedComments(doc, templateComments);
  changes.push(...commentChanges);

  return { yaml: doc.toString(), changes };
}

// Apply migration to a file (or dry-run). Returns summary string.
export function applyMigration(configFile, { dryRun = false } = {}) {
  let original;
  try {
    original = fs.readFileSync(configFile, 'utf8');
  } catch (e) {
    throw new Error(`Cannot read config: ${e.message}`);
  }

  const result = buildMigration(original);

  if (!result) {
    return `Config is already at schema ${SUPPORTED_SCHEMA_VERSION}. No changes needed.`;
  }

  const header = dryRun
    ? `Config migration 0 → ${SUPPORTED_SCHEMA_VERSION} (dry run)`
    : `Config migration 0 → ${SUPPORTED_SCHEMA_VERSION}`;

  const summary = [header, ...result.changes.map((c) => `  - ${c}`)].join('\n');

  if (!dryRun) {
    writeFileAtomic(configFile, result.yaml);
    return summary;
  }

  return `${summary}\n\n--- candidate YAML ---\n${result.yaml}`;
}

// Find the index in currentList where `status` should be inserted, based on
// canonical order. Returns -1 to append at end.
function findInsertBefore(currentList, canonicalOrder, status) {
  const canonIdx = canonicalOrder.indexOf(status);
  for (let i = canonIdx + 1; i < canonicalOrder.length; i++) {
    const pos = currentList.indexOf(canonicalOrder[i]);
    if (pos !== -1) return pos;
  }
  return -1;
}

// Reads the current template and returns a map of top-level key → commentBefore string.
// Returns an empty map if the template is unreadable (comment refresh is optional).
function loadTemplateComments() {
  try {
    const templateText = fs.readFileSync(path.join(templatesDir, 'config.yml'), 'utf8');
    const templateDoc = parseDocument(templateText, { merge: false });
    const comments = new Map();
    for (const pair of templateDoc.contents.items) {
      const key = pair.key?.value;
      const comment = pair.key?.commentBefore;
      if (key && comment !== undefined) {
        comments.set(key, comment);
      }
    }
    return comments;
  } catch {
    return new Map();
  }
}

// Replace managed comments (those defined in the template) on existing keys,
// preserving comments on custom/unknown keys.
// doc.set() creates keys as plain strings (not Scalar nodes), so commentBefore
// cannot be set on them directly. Convert string keys to Scalar nodes first.
function refreshManagedComments(doc, templateComments) {
  const changes = [];
  for (const pair of doc.contents.items) {
    // Normalise string-primitive keys to Scalar nodes so commentBefore is writable.
    if (typeof pair.key === 'string') {
      pair.key = doc.createNode(pair.key);
    }
    const key = pair.key?.value;
    if (!key) continue;
    if (!templateComments.has(key)) continue; // custom key — preserve its comment
    const templateComment = templateComments.get(key);
    const currentComment = pair.key?.commentBefore;
    if (currentComment === templateComment) continue; // already matches
    pair.key.commentBefore = templateComment;
    changes.push(`refreshed comment for ${key}`);
  }
  return changes;
}
