import { loadRepo } from '../repo.mjs';
import { checkRepo } from '../check.mjs';

// Validates the repo. Prints findings and returns an exit code (1 if errors).
export function check(args = [], cwd = process.cwd()) {
  const repo = loadRepo(cwd);
  const { errors, warnings } = checkRepo(repo);

  if (args.includes('--json')) {
    console.log(JSON.stringify({ errors, warnings }, null, 2));
    return errors.length ? 1 : 0;
  }

  for (const w of warnings) console.warn(`  warn   ${w.file}: ${w.message}`);
  for (const e of errors) console.error(`  error  ${e.file}: ${e.message}`);

  const n = repo.changes.length;
  if (!errors.length && !warnings.length) {
    console.log(`✓ ${n} change(s) valid`);
  } else {
    console.log(`\n${errors.length} error(s), ${warnings.length} warning(s) across ${n} change(s)`);
  }
  return errors.length ? 1 : 0;
}
