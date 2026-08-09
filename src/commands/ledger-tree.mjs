import path from 'node:path';
import { assertRegularBlobEntry, batchBlobReader, treeEntries } from '../git-batch.mjs';

export function toPosix(relPath) {
  return relPath.split(path.sep).join('/');
}

// Reads the configured ledger collections from a commit without a checkout.
// `configPath` is optional because import deliberately ignores source config,
// while cutover requires and republishes it byte for byte.
export function readLedgerAt(repoRoot, revision, layout, run) {
  const entries = treeEntries(repoRoot, revision, run);
  const wanted = [];
  const documents = new Map();
  let configEntry = null;

  for (const entry of entries) {
    if (layout.configPath && entry.path === layout.configPath) {
      configEntry = entry;
      wanted.push(entry);
      continue;
    }
    const collection = layout.collections.find((candidate) =>
      entry.path.startsWith(candidate.prefix),
    );
    if (!collection) continue;
    const name = entry.path.slice(collection.prefix.length);
    if (!name.endsWith(collection.extension)) continue;
    if (name.includes('/')) {
      throw new Error(
        `${layout.nestedSubject} has a nested document the state layout cannot hold: ${entry.path}`,
      );
    }
    assertRegularBlobEntry(entry.mode, entry.path, entry.type);
    wanted.push(entry);
    documents.set(`${collection.name}/${name}`, entry);
  }

  if (layout.configPath && !configEntry) {
    throw new Error(`${layout.missingConfigSubject} ${revision} has no ${layout.configPath}`);
  }
  if (configEntry) assertRegularBlobEntry(configEntry.mode, configEntry.path, configEntry.type);

  const readBlob = batchBlobReader(repoRoot, wanted, run);
  const texts = new Map();
  for (const [name, entry] of documents) texts.set(name, readBlob(entry.oid));
  return {
    configText: configEntry ? readBlob(configEntry.oid) : null,
    documents: texts,
  };
}
