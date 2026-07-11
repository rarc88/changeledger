import { checkRepo } from '../check.mjs';
import { findChangeledgerDir, integrationBranch, loadConfig } from '../config.mjs';
import { getSchemaVersion, SUPPORTED_SCHEMA_VERSION } from '../config-migration.mjs';
import { checkContract } from '../contract.mjs';
import { defaultBaseBranch, lintCommitRange } from '../git.mjs';
import { loadRepo } from '../repo.mjs';

// Declared integration branch, when a ChangeLedger repo (and the key) exists.
// Outside a repo the lint still works on plain git, so absence is undefined,
// not an error; a malformed declared value still fails fast in
// `integrationBranch`.
function configuredIntegrationBranch(cwd) {
  const changeledgerDir = findChangeledgerDir(cwd);
  if (!changeledgerDir) return undefined;
  return integrationBranch(loadConfig(changeledgerDir));
}

// Lints `base..HEAD` for the canonical `[#id]` commit marker (merges and
// `chore(release)` prep are exempt) — no ChangeLedger repo required, just git.
function checkCommits(args, commitsIdx, cwd, output, json) {
  const provided = args[commitsIdx + 1];
  const base = provided && !provided.startsWith('--') ? provided : undefined;

  let resolvedBase;
  let violations;
  try {
    resolvedBase = base ?? configuredIntegrationBranch(cwd) ?? defaultBaseBranch(cwd);
    violations = lintCommitRange(cwd, `${resolvedBase}..HEAD`);
  } catch (e) {
    if (json)
      output.log(
        JSON.stringify(
          { errors: [{ file: '(commits)', message: e.message }], warnings: [] },
          null,
          2,
        ),
      );
    else output.error(`  error  (commits): ${e.message}`);
    return 1;
  }

  const errors = violations.map((v) => ({
    file: '(commits)',
    message: `${v.sha} missing [#id] marker: "${v.subject}"`,
  }));

  if (json) {
    output.log(JSON.stringify({ errors, warnings: [] }, null, 2));
    return errors.length ? 1 : 0;
  }

  for (const e of errors) output.error(`  error  ${e.file}: ${e.message}`);
  const scope = `commits ${resolvedBase}..HEAD`;
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
        JSON.stringify({ errors: [{ file: '(repo)', message: e.message }], warnings: [] }, null, 2),
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
    output.log(JSON.stringify({ errors, warnings }, null, 2));
    return errors.length ? 1 : 0;
  }

  for (const w of warnings) output.warn(`  warn   ${w.file}: ${w.message}`);
  for (const e of errors) output.error(`  error  ${e.file}: ${e.message}`);

  const scope = id ? `change ${id}` : `${repo.changes.length} change(s)`;
  if (!errors.length && !warnings.length) {
    output.log(`✓ ${scope} valid`);
  } else {
    output.log(`\n${errors.length} error(s), ${warnings.length} warning(s) — ${scope}`);
  }
  return errors.length ? 1 : 0;
}
