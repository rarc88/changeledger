import { checkRepo } from '../check.mjs';
import { checkContract } from '../contract.mjs';
import { loadRepo } from '../repo.mjs';

// Validates the repo (or a single change with `changeledger check <id>`). Prints findings
// and returns an exit code (1 if errors).
export function check(args = [], cwd = process.cwd(), output = console) {
  const json = args.includes('--json');
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
