import { applyMigration, buildMigration, SUPPORTED_SCHEMA_VERSION } from '../config-migration.mjs';
import {
  formatLedgerReceipt,
  ledgerReceipt,
  loadLedgerStore,
  repoProvenance,
} from '../ledger-store.mjs';

function withLedgerReceipt(text, snapshot) {
  const receipt = formatLedgerReceipt({
    ...ledgerReceipt(snapshot),
    ...repoProvenance(snapshot.repoRoot),
  });
  return receipt ? `${text}\n${receipt}` : text;
}

function summary(result, dryRun) {
  const header = dryRun
    ? `Config migration ${result.fromVersion} → ${SUPPORTED_SCHEMA_VERSION} (dry run)`
    : `Config migration ${result.fromVersion} → ${SUPPORTED_SCHEMA_VERSION}`;
  const details = [header, ...result.changes.map((change) => `  - ${change}`)].join('\n');
  return dryRun ? `${details}\n\n--- candidate YAML ---\n${result.yaml}` : details;
}

export function migrateConfig(cwd = process.cwd(), { dryRun = false, offline = false } = {}) {
  const store = loadLedgerStore(cwd);
  const snapshot =
    store.mode === 'state' && !dryRun ? store.prepareMutation({ offline }) : store.load();
  if (store.mode === 'worktree') return applyMigration(snapshot.configFile, { dryRun });

  const migration = buildMigration(snapshot.configText);
  if (!migration) {
    const confirmed = dryRun
      ? snapshot
      : store.mutate(
          {
            message: 'changeledger: migrate config',
            expectedRevision: snapshot.revision,
            offline,
          },
          () => {},
        );
    return withLedgerReceipt(
      `Config is already at schema ${SUPPORTED_SCHEMA_VERSION}. No changes needed.`,
      confirmed,
    );
  }
  const text = summary(migration, dryRun);
  if (dryRun) return withLedgerReceipt(text, snapshot);

  const next = store.mutate(
    {
      message: 'changeledger: migrate config',
      expectedRevision: snapshot.revision,
      offline,
    },
    ({ snapshot, write }) => {
      const current = buildMigration(snapshot.configText);
      if (!current) return;
      write(snapshot.configStatePath, current.yaml);
    },
  );
  return withLedgerReceipt(text, next);
}
