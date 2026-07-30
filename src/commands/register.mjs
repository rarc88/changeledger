import fs from 'node:fs';
import path from 'node:path';
import { findChangeledgerDir, loadConfig } from '../config.mjs';
import { getSchemaVersion, SUPPORTED_SCHEMA_VERSION } from '../config-migration.mjs';
import {
  ensureReference,
  removeLegacyContract,
  removeLegacyGitignore,
  rootContract,
} from '../contract.mjs';
import { register } from '../registry.mjs';

// `ensureReference` writes the file for every state except `unchanged` and
// `equivalent` (those two are the only ones that leave it alone). One
// mechanism drives the warning for every writing state instead of a branch
// per state: a lookup supplies the cause, and any state absent from it (the
// two silent ones) is skipped by construction rather than enumerated.
const REWRITE_CAUSE = {
  updated: 'was outdated',
  replaced: 'content had drifted from the reference',
  inserted: 'reference was missing',
  migrated: 'used the retired legacy marker',
};

// Refreshes the repo bootstrap and registry path. Also migrates the per-machine
// contract artifact left by legacy versions.
export function registerRepo(cwd = process.cwd(), output = console) {
  const changeledgerDir = findChangeledgerDir(cwd);
  if (!changeledgerDir) throw new Error('Not a ChangeLedger repo. Run `changeledger init` first.');

  const config = loadConfig(changeledgerDir);
  if (!config.project_id) {
    throw new Error('config.yml has no project_id. Run `changeledger init` to create one.');
  }

  const schemaVersion = getSchemaVersion(config);
  if (schemaVersion < SUPPORTED_SCHEMA_VERSION) {
    output.warn(
      `warn  .changeledger/config.yml: config schema ${schemaVersion} is outdated; run \`changeledger config migrate --dry-run\``,
    );
  }

  const repoRoot = path.dirname(changeledgerDir);
  const name = config.project_name || path.basename(repoRoot);

  removeLegacyContract(changeledgerDir);
  removeLegacyGitignore(repoRoot);
  if (fs.existsSync(rootContract(repoRoot))) {
    for (const { name, status } of ensureReference(repoRoot)) {
      const cause = REWRITE_CAUSE[status];
      if (!cause) continue; // unchanged/equivalent: ensureReference left the file alone
      output.warn(
        `warn  ${name}: ChangeLedger bootstrap ${cause}; rewritten to the current version (${status})`,
      );
    }
  }

  register({ id: config.project_id, name, path: repoRoot });
  return { id: config.project_id, name, path: repoRoot };
}
