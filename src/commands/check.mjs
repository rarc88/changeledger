import path from 'node:path';
import { checkRepo } from '../check.mjs';
import { findChangeledgerDir, integrationBranch, loadConfig } from '../config.mjs';
import { getSchemaVersion, SUPPORTED_SCHEMA_VERSION } from '../config-migration.mjs';
import { checkContract } from '../contract.mjs';
import { defaultBaseBranch, lintCommitRange } from '../git.mjs';
import { loadLedgerStore, repoProvenance } from '../ledger-store.mjs';
import { loadRepo } from '../repo.mjs';

// Receipt provenance must never replace the check's own findings: degrade to a
// null project with the resolved directory instead of throwing (CR2).
function safeProvenance(cwd) {
  try {
    return repoProvenance(cwd);
  } catch {
    return { project_id: null, repository_path: path.resolve(cwd) };
  }
}

// Human-format provenance suffix, mirroring formatLedgerReceipt's rendering.
function provenanceSuffix(provenance) {
  return ` (project: ${provenance.project_id ?? 'unknown'}) (repo: ${provenance.repository_path ?? 'unknown'})`;
}

// Declared integration branch, when a ChangeLedger repo (and the key) exists.
// Outside a repo the lint still works on plain git, so absence is undefined,
// not an error; a malformed declared value still fails fast in
// `integrationBranch`.
function configuredCommitContext(cwd) {
  const changeledgerDir = findChangeledgerDir(cwd);
  if (!changeledgerDir) return {};
  const store = loadLedgerStore(cwd);
  if (store.mode === 'worktree') {
    return { base: integrationBranch(loadConfig(changeledgerDir)) };
  }
  const repo = store.load();
  return {
    base: integrationBranch(repo.config),
    revision: repo.revision ?? null,
    freshness: repo.revision ? (repo.ledgerFreshness ?? 'local') : null,
    confirmation: repo.revision ? (repo.ledgerConfirmation ?? 'local') : null,
    observedAt: repo.revision ? (repo.ledgerObservedAt ?? null) : null,
  };
}

// Lints `base..HEAD` for the canonical `[#id]` commit marker (merges and
// `chore(release)` prep are exempt) — no ChangeLedger repo required, just git.
function checkCommits(args, commitsIdx, cwd, output, json) {
  const provided = args[commitsIdx + 1];
  const base = provided && !provided.startsWith('--') ? provided : undefined;

  let resolvedBase;
  let violations;
  let ledger = {};
  try {
    ledger = configuredCommitContext(cwd);
    resolvedBase = base ?? ledger.base ?? defaultBaseBranch(cwd);
    violations = lintCommitRange(cwd, `${resolvedBase}..HEAD`);
  } catch (e) {
    if (json)
      output.log(
        JSON.stringify(
          {
            errors: [{ file: '(commits)', message: e.message }],
            warnings: [],
            revision: ledger.revision ?? null,
            freshness: ledger.freshness ?? null,
            confirmation: ledger.confirmation ?? null,
            observed_at: ledger.observedAt ?? null,
            ...safeProvenance(cwd),
          },
          null,
          2,
        ),
      );
    else output.error(`  error  (commits): ${e.message}`);
    return 1;
  }

  const errors = violations.map((v) => ({
    file: '(commits)',
    message: `${v.sha} ${v.reason}: "${v.subject}"`,
  }));

  if (json) {
    output.log(
      JSON.stringify(
        {
          errors,
          warnings: [],
          revision: ledger.revision ?? null,
          freshness: ledger.freshness ?? null,
          confirmation: ledger.confirmation ?? null,
          observed_at: ledger.observedAt ?? null,
          ...safeProvenance(cwd),
        },
        null,
        2,
      ),
    );
    return errors.length ? 1 : 0;
  }

  for (const e of errors) output.error(`  error  ${e.file}: ${e.message}`);
  const scope = `commits ${resolvedBase}..HEAD${
    ledger.revision
      ? ` @ ${ledger.revision} (freshness: ${ledger.freshness}) (confirmation: ${ledger.confirmation}) (observed at: ${ledger.observedAt ?? 'unknown'})${provenanceSuffix(safeProvenance(cwd))}`
      : ''
  }`;
  if (!errors.length) output.log(`✓ ${scope} valid`);
  else output.log(`\n${errors.length} error(s) — ${scope}`);
  return errors.length ? 1 : 0;
}

// Validates the repo (or a single change with `changeledger check <id>`). Prints findings
// and returns an exit code (1 if errors).
export function check(args = [], cwd = process.cwd(), output = console) {
  const json = args.includes('--json');
  const commitsIdx = args.indexOf('--commits');
  if (commitsIdx !== -1) return checkCommits(args, commitsIdx, cwd, output, json);
  const id = args.find((a) => !a.startsWith('--'));

  let repo;
  try {
    repo = loadRepo(cwd);
  } catch (e) {
    if (json)
      output.log(
        JSON.stringify(
          {
            errors: [{ file: '(repo)', message: e.message }],
            warnings: [],
            ...safeProvenance(cwd),
          },
          null,
          2,
        ),
      );
    else output.error(`  error  (repo): ${e.message}`);
    return 1;
  }

  const { errors, warnings } = checkRepo(repo, { id });

  // Schema version detection — warn without mutating.
  const schemaVersion = getSchemaVersion(repo.config);
  if (!id && schemaVersion < SUPPORTED_SCHEMA_VERSION) {
    warnings.push({
      file: '.changeledger/config.yml',
      message: `config schema ${schemaVersion} is outdated; run \`changeledger config migrate --dry-run\``,
    });
  }

  // Discovery validation needs the filesystem (root contract bootstrap), so it
  // lives here, not in the pure validator. Repo-wide only.
  if (!id) {
    for (const message of checkContract(repo.repoRoot, repo.changeledgerDir)) {
      errors.push({ file: 'AGENTS.md', message });
    }
  }

  if (json) {
    output.log(
      JSON.stringify(
        {
          errors,
          warnings,
          revision: repo.revision ?? null,
          freshness: repo.revision ? (repo.ledgerFreshness ?? 'local') : null,
          confirmation: repo.revision ? (repo.ledgerConfirmation ?? 'local') : null,
          observed_at: repo.revision ? (repo.ledgerObservedAt ?? null) : null,
          ...safeProvenance(cwd),
        },
        null,
        2,
      ),
    );
    return errors.length ? 1 : 0;
  }

  for (const w of warnings) output.warn(`  warn   ${w.file}: ${w.message}`);
  for (const e of errors) output.error(`  error  ${e.file}: ${e.message}`);

  const scope = `${id ? `change ${id}` : `${repo.changes.length} change(s)`}${
    repo.revision
      ? ` @ ${repo.revision} (freshness: ${repo.ledgerFreshness ?? 'local'}) (confirmation: ${repo.ledgerConfirmation ?? 'local'}) (observed at: ${repo.ledgerObservedAt ?? 'unknown'})${provenanceSuffix(safeProvenance(cwd))}`
      : ''
  }`;
  if (!errors.length && !warnings.length) {
    output.log(`✓ ${scope} valid`);
  } else {
    output.log(`\n${errors.length} error(s), ${warnings.length} warning(s) — ${scope}`);
  }
  return errors.length ? 1 : 0;
}
