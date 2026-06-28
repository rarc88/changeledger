import fs from 'node:fs';
import { parseDocument } from 'yaml';
import { writeFileAtomic } from './atomic-write.mjs';

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

  // schema_version: 1 — prepend so it appears first
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
