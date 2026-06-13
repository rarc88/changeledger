import { loadRepo } from '../repo.mjs';
import { checkRepo } from '../check.mjs';

// Validates the repo (or a single change with `sl check <id>`). Prints findings
// and returns an exit code (1 if errors).
export function check(args = [], cwd = process.cwd()) {
  const json = args.includes('--json');
  const id = args.find((a) => !a.startsWith('--'));

  let repo;
  try {
    repo = loadRepo(cwd);
  } catch (e) {
    if (json) console.log(JSON.stringify({ errors: [{ file: '(repo)', message: e.message }], warnings: [] }, null, 2));
    else console.error(`  error  (repo): ${e.message}`);
    return 1;
  }

  const { errors, warnings } = checkRepo(repo, { id });

  if (json) {
    console.log(JSON.stringify({ errors, warnings }, null, 2));
    return errors.length ? 1 : 0;
  }

  for (const w of warnings) console.warn(`  warn   ${w.file}: ${w.message}`);
  for (const e of errors) console.error(`  error  ${e.file}: ${e.message}`);

  const scope = id ? `change ${id}` : `${repo.changes.length} change(s)`;
  if (!errors.length && !warnings.length) {
    console.log(`✓ ${scope} valid`);
  } else {
    console.log(`\n${errors.length} error(s), ${warnings.length} warning(s) — ${scope}`);
  }
  return errors.length ? 1 : 0;
}
