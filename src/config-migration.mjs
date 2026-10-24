import fs from 'node:fs';
import { isMap, isPair, isScalar, isSeq, parseDocument } from 'yaml';
import { writeFileAtomic } from './atomic-write.mjs';
import { repoIsActivated } from './change-store.mjs';
import { DEFAULT_RELEASE_IMPACT } from './config.mjs';
import { VERSION } from './framing.mjs';
import { mutateState, readStateConfigText, readStateRef } from './state-store.mjs';

export const SUPPORTED_SCHEMA_VERSION = 7;

// The only schema this release migrates from. The v0 → v6 chain was retired
// (20261024-121022): ChangeLedger 0.19 is the last release that carries it.
const MIGRATABLE_SCHEMA_VERSION = 6;
const RETIRED_STATUSES = ['in-validation', 'blocked'];

// What `check` and `register` warn about a schema older than this release
// writes, or null when it is current: the migrating command when there is one,
// and otherwise the release that migrates it, in `buildMigration`'s refusal.
export function outdatedSchemaWarning(schemaVersion) {
  if (schemaVersion >= SUPPORTED_SCHEMA_VERSION) return null;
  if (schemaVersion < MIGRATABLE_SCHEMA_VERSION) return tooOldForThisRelease(schemaVersion);
  return `config schema ${schemaVersion} is outdated; run \`changeledger config migrate\``;
}

const tooOldForThisRelease = (schemaVersion) =>
  `config schema ${schemaVersion} is older than ${MIGRATABLE_SCHEMA_VERSION}: migrate it with ChangeLedger 0.19 before upgrading`;

export function getSchemaVersion(config) {
  const v = config.schema_version;
  return typeof v === 'number' ? v : 0;
}

export function assertSupportedSchema(config) {
  const current = getSchemaVersion(config);
  if (current > SUPPORTED_SCHEMA_VERSION) {
    throw new Error(
      `config schema ${current} is newer than supported schema ${SUPPORTED_SCHEMA_VERSION}; update ChangeLedger before writing`,
    );
  }
  return current;
}

// Returns null when no migration is needed; throws on invalid YAML or on a
// schema this release cannot migrate. Otherwise returns
// { yaml, changes, fromVersion }. `runningVersion` is the CLI version to
// declare in `min_cli_version`: an explicit parameter, not an environment
// override, so unit tests can inject one while every real caller defaults to
// the installed version.
export function buildMigration(originalText, runningVersion = VERSION) {
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
  const current = assertSupportedSchema(config);
  if (current === SUPPORTED_SCHEMA_VERSION) {
    return null;
  }
  if (current < MIGRATABLE_SCHEMA_VERSION) throw new Error(tooOldForThisRelease(current));

  const changes = [];
  migrateSixToSeven(doc, changes, runningVersion);
  relocateNullValueComments(doc);

  // No line wrapping and no flow padding: keeps untouched flow sequences
  // (statuses) byte-identical to their common written form.
  const yaml = doc.toString({ lineWidth: 0, flowCollectionPadding: false });
  return { yaml, changes, fromVersion: current };
}

// 6 → 7: the type matrix, the configurable stages, the per-type impacts and
// readiness have no reader any more; deleting a key takes the comment that
// introduces it along. Each change line is reported only for a key that was
// present. `min_cli_version` declares the CLI that wrote the file, as `init`
// does.
function migrateSixToSeven(doc, changes, runningVersion) {
  doc.set('schema_version', SUPPORTED_SCHEMA_VERSION);
  changes.push(
    `updated schema_version: ${MIGRATABLE_SCHEMA_VERSION} → ${SUPPORTED_SCHEMA_VERSION}`,
  );

  for (const key of ['types', 'stages']) {
    if (doc.delete(key)) changes.push(`removed ${key}`);
  }

  const release = doc.get('release', true);
  if (isMap(release) && release.has('impacts')) {
    const index = release.items.findIndex((pair) => scalarKey(pair) === 'impacts');
    if (release.has('default_impact')) {
      release.items.splice(index, 1);
    } else {
      release.items.splice(index, 1, doc.createPair('default_impact', DEFAULT_RELEASE_IMPACT));
    }
    changes.push(
      `replaced release.impacts with release.default_impact: ${release.get('default_impact')}`,
    );
  }

  if (doc.delete('readiness')) changes.push('removed readiness');

  const statuses = doc.get('statuses', true);
  if (isSeq(statuses)) {
    const isRetired = (node) => RETIRED_STATUSES.includes(String(node.value));
    const removed = statuses.items.filter(isRetired).map((node) => String(node.value));
    statuses.items = statuses.items.filter((node) => !isRetired(node));
    if (removed.length) changes.push(`removed retired statuses: ${removed.join(', ')}`);
  }

  if (doc.has('min_cli_version')) {
    doc.set('min_cli_version', runningVersion);
  } else {
    const items = doc.contents.items;
    const schemaIndex = items.findIndex((pair) => scalarKey(pair) === 'schema_version');
    items.splice(schemaIndex + 1, 0, doc.createPair('min_cli_version', runningVersion));
  }
}

function scalarKey(pair) {
  return isScalar(pair.key) ? pair.key.value : pair.key;
}

// A blank scalar (e.g. `release_branch:` with nothing after the colon) leaves
// the parser no explicit end token to anchor from, so a comment that the
// source wrote before the *next* sibling key gets attached as a trailing
// `.comment` on that null scalar instead of `commentBefore` on the sibling.
// `doc.toString()` then renders it at the null scalar's own (deeper) nesting
// indent rather than the column the source actually used — the re-indent
// defect this corrects. Reassign it to `commentBefore` on whatever node
// follows, climbing through enclosing collections when the null scalar is the
// last item of its own map/seq; with no sibling anywhere above, it is
// genuinely the document's own trailing comment. The sibling found while
// climbing can land at an intermediate nesting level rather than the source's
// own column when the null scalar is not the last item of its enclosing map.
// That wider case is a known, unresolved gap.
function relocateNullValueComments(doc) {
  function relocate(scalarNode, chain) {
    for (let level = chain.length - 1; level >= 0; level--) {
      const { items, i } = chain[level];
      if (i + 1 < items.length) {
        const nextItem = items[i + 1];
        const target = isPair(nextItem) ? nextItem.key : nextItem;
        if (target && typeof target === 'object') {
          target.commentBefore = target.commentBefore
            ? `${scalarNode.comment}\n${target.commentBefore}`
            : scalarNode.comment;
          scalarNode.comment = null;
          return;
        }
      }
    }
    doc.comment = doc.comment ? `${doc.comment}\n${scalarNode.comment}` : scalarNode.comment;
    scalarNode.comment = null;
  }

  function walk(node, ancestors) {
    if (!isMap(node) && !isSeq(node)) return;
    const items = node.items;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const value = isPair(item) ? item.value : item;
      const chain = [...ancestors, { items, i }];
      if (isScalar(value) && value.value === null && value.comment) {
        relocate(value, chain);
      }
      walk(value, chain);
    }
  }

  walk(doc.contents, []);
}

// Apply migration to the effective config authority (or dry-run). Returns summary string.
export function applyMigration(
  configFile,
  { dryRun = false, repoRoot, run, runningVersion = VERSION } = {},
) {
  if (!repoRoot) {
    throw new Error('applyMigration requires an explicit repoRoot');
  }
  let original;
  let stateRevision;
  const active = repoIsActivated(repoRoot, run);
  if (active) {
    stateRevision = readStateRef(repoRoot, run);
    if (stateRevision === null) throw new Error('state is not initialized');
    original = readStateConfigText(repoRoot, { revision: stateRevision }, run);
  } else {
    try {
      original = fs.readFileSync(configFile, 'utf8');
    } catch (e) {
      throw new Error(`Cannot read config: ${e.message}`);
    }
  }

  const result = buildMigration(original, runningVersion);

  if (!result) {
    return `Config is already at schema ${SUPPORTED_SCHEMA_VERSION}. No changes needed.`;
  }

  const header = dryRun
    ? `Config migration ${result.fromVersion} → ${SUPPORTED_SCHEMA_VERSION} (dry run)`
    : `Config migration ${result.fromVersion} → ${SUPPORTED_SCHEMA_VERSION}`;

  const summary = [header, ...result.changes.map((c) => `  - ${c}`)].join('\n');

  if (!dryRun) {
    if (active) {
      mutateState(
        repoRoot,
        { expectedRevision: stateRevision, message: 'config: migrate' },
        (stage) => stage.write('config.yml', result.yaml),
        run,
      );
    } else {
      writeFileAtomic(configFile, result.yaml);
    }
    return summary;
  }

  return `${summary}\n\n--- candidate YAML ---\n${result.yaml}`;
}
