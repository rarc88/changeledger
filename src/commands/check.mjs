import path from 'node:path';
import { checkRepo, checkUsageGitConfig, frozenReason } from '../check.mjs';
import {
  changeIntegrationBranch,
  findChangeledgerDir,
  integrationBranch,
  loadEffectiveConfig,
  renderChangeBranch,
} from '../config.mjs';
import { getSchemaVersion, SUPPORTED_SCHEMA_VERSION } from '../config-migration.mjs';
import { checkContract } from '../contract.mjs';
import { VERSION } from '../framing.mjs';
import { checkoutBranch, defaultBaseBranch, lintCommitRange } from '../git.mjs';
import { loadRepo } from '../repo.mjs';
import { STATE_ROOT, unknownCollectionsMessage } from '../state-store.mjs';

// Statuses whose changes do not decide a branch's base. Only `done` and
// `discarded` are listed: a custom terminal-like status such as `cancelled`
// still decides.
const TERMINAL_STATUSES = ['done', 'discarded'];

function hasReleaseType(config) {
  return Object.values(config?.types ?? {}).some((t) => t?.integrates_into === 'release');
}

// Non-terminal changes whose branch is the checked out one: the recorded
// `branch`, or, while none is recorded, the one `git.change_branch_format`
// renders for the change.
function changesOnBranch(repo, branch) {
  return repo.changes.filter(({ frontmatter: fm }) => {
    if (TERMINAL_STATUSES.includes(fm.status)) return false;
    return (fm.branch ?? renderChangeBranch(repo.config, fm)) === branch;
  });
}

// Base `check --commits` lints against when none is given: the effective
// integration branch of the change on the current branch, else the declared
// `git.integration_branch`, else the auto-detected default branch. Outside a
// ChangeLedger repo the lint still works on plain git. A malformed declared
// value fails fast in `integrationBranch`. The ledger is read only when some
// type declares `integrates_into: release`. Without one, and with valid roles,
// a change's base is `git.integration_branch` and reading the ledger would not
// change the answer; `changeledger check` reports an invalid role as a config
// error, but this lint does not detect it when no type integrates into release.
function defaultCommitsBase(cwd) {
  const changeledgerDir = findChangeledgerDir(cwd);
  if (!changeledgerDir) return defaultBaseBranch(cwd);
  const config = loadEffectiveConfig(path.dirname(changeledgerDir), changeledgerDir);
  const fallback = () => integrationBranch(config) ?? defaultBaseBranch(cwd);
  if (!hasReleaseType(config)) return fallback();

  const branch = checkoutBranch(cwd);
  if (!branch) return fallback();
  const repo = loadRepo(cwd);
  const decided = changesOnBranch(repo, branch).map((c) => ({
    id: c.frontmatter.id,
    base: changeIntegrationBranch(repo.config, c.frontmatter.type) ?? fallback(),
  }));
  if (decided.length === 0) return fallback();
  const bases = new Set(decided.map((d) => d.base));
  if (bases.size > 1) {
    const listed = decided.map((d) => `#${d.id} (integrates into ${d.base})`);
    const last = listed.pop();
    throw new Error(
      `branch "${branch}" is recorded by changes ${listed.join(', ')} and ${last}; pass <base> explicitly`,
    );
  }
  return decided[0].base;
}

// Lints `base..HEAD` for the canonical `[#id]` commit marker (merges and
// `chore(release)` prep are exempt) — no ChangeLedger repo required, just git.
function checkCommits(args, commitsIdx, cwd, output, json) {
  const provided = args[commitsIdx + 1];
  const base = provided && !provided.startsWith('--') ? provided : undefined;

  let resolvedBase;
  let violations;
  try {
    resolvedBase = base ?? defaultCommitsBase(cwd);
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
    message: `${v.sha} ${v.reason}: "${v.subject}"`,
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

  const { errors, warnings, validated, notValidated } = checkRepo(repo, { id });

  // Schema version detection — warn without mutating.
  const schemaVersion = getSchemaVersion(repo.config);
  if (!id && schemaVersion < SUPPORTED_SCHEMA_VERSION) {
    warnings.push({
      file: '.changeledger/config.yml',
      message: `config schema ${schemaVersion} is outdated; run \`changeledger config migrate --dry-run\``,
    });
  }

  // Collections this CLI does not know are not validated (20261002-161641);
  // the repo-wide report repeats the warning the bin prints on stderr.
  const unknownCollections = repo.state?.unknownCollections ?? [];
  if (!id && unknownCollections.length > 0) {
    warnings.push({
      file: STATE_ROOT,
      message: unknownCollectionsMessage(unknownCollections, VERSION),
    });
  }

  // Discovery validation needs the filesystem (root contract bootstrap), so it
  // lives here, not in the pure validator. Repo-wide only.
  if (!id) {
    for (const message of checkContract(repo.repoRoot, repo.changeledgerDir)) {
      errors.push({ file: 'AGENTS.md', message });
    }
    // The usage collector is switched on per clone in git config, not in the
    // ledger, so its value comes from a `git config` process run here too.
    errors.push(...checkUsageGitConfig(repo.repoRoot));
  }

  if (json) {
    output.log(JSON.stringify({ errors, warnings }, null, 2));
    return errors.length ? 1 : 0;
  }

  for (const w of warnings) output.warn(`  warn   ${w.file}: ${w.message}`);
  for (const e of errors) output.error(`  error  ${e.file}: ${e.message}`);

  // The counts come from the validator, which owns the frozen-history rule, so
  // the summary can never claim documents it did not actually validate.
  const scope = id ? `change ${id}` : `${validated} change(s)`;
  const exempt = id
    ? frozenReason(repo.changes.find((c) => String(c.frontmatter?.id) === String(id)))
    : null;
  // One phrase for the exempted count, so both summary branches say it the same
  // way and a finding never hides what the run skipped.
  const exempted = notValidated ? `${notValidated} not validated (archived or discarded)` : '';
  if (errors.length || warnings.length) {
    const tail = exempted ? `, ${exempted}` : '';
    output.log(`\n${errors.length} error(s), ${warnings.length} warning(s) — ${scope}${tail}`);
  } else if (exempt) {
    output.log(`✓ ${scope} not validated (${exempt})`);
  } else if (exempted) {
    output.log(`✓ ${scope} valid — ${exempted}`);
  } else {
    output.log(`✓ ${scope} valid`);
  }
  return errors.length ? 1 : 0;
}
