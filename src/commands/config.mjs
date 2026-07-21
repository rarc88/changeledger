import { applyMigration, buildMigration, SUPPORTED_SCHEMA_VERSION } from '../config-migration.mjs';
import { loadLedgerStore } from '../ledger-store.mjs';

function summary(result, dryRun) {
  const header = dryRun
    ? `Config migration ${result.fromVersion} → ${SUPPORTED_SCHEMA_VERSION} (dry run)`
    : `Config migration ${result.fromVersion} → ${SUPPORTED_SCHEMA_VERSION}`;
  const details = [header, ...result.changes.map((change) => `  - ${change}`)].join('\n');
  return dryRun ? `${details}\n\n--- candidate YAML ---\n${result.yaml}` : details;
}

export function migrateConfig(cwd = process.cwd(), { dryRun = false } = {}) {
  const store = loadLedgerStore(cwd);
  const snapshot = store.load();
  if (store.mode === 'worktree') return applyMigration(snapshot.configFile, { dryRun });

  const migration = buildMigration(snapshot.configText);
  if (!migration) {
    return `Config is already at schema ${SUPPORTED_SCHEMA_VERSION}. No changes needed.\nLedger revision: ${snapshot.revision}`;
  }
  const text = summary(migration, dryRun);
  if (dryRun) return `${text}\nLedger revision: ${snapshot.revision}`;

  const next = store.mutate({ message: 'changeledger: migrate config' }, ({ snapshot, write }) => {
    const current = buildMigration(snapshot.configText);
    if (!current) return;
    write(snapshot.configStatePath, current.yaml);
  });
  return `${text}\nLedger revision: ${next.revision}`;
}
