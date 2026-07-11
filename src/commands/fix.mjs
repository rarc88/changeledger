import { writeFileAtomic } from '../atomic-write.mjs';
import { computeFixes } from '../fix.mjs';
import { loadRepo } from '../repo.mjs';

// Repairs mechanical, unambiguous format defects (`changeledger fix [id] [--dry-run]`).
// Ambiguous defects are never touched — they are listed under "requires manual fix".
export function fix(args = [], cwd = process.cwd(), output = console) {
  const dryRun = args.includes('--dry-run');
  const id = args.find((a) => !a.startsWith('--'));

  let repo;
  try {
    repo = loadRepo(cwd);
  } catch (e) {
    output.error(`  error  (repo): ${e.message}`);
    return 1;
  }

  let targets = repo.changes;
  if (id) {
    targets = repo.changes.filter((c) => String(c.frontmatter?.id) === String(id));
    if (!targets.length) {
      output.error(`  error  no change with id "${id}"`);
      return 1;
    }
  }

  let anyChanged = false;
  let anyManual = false;

  for (const c of targets) {
    const { text: fixedText, applied, manual, changed } = computeFixes(c.text);

    if (manual.length) {
      anyManual = true;
      output.log(`requires manual fix — ${c.name}:`);
      for (const m of manual) output.log(`  - ${m}`);
    }

    if (!changed) {
      output.log(id ? 'nothing to fix' : `${c.name}: nothing to fix`);
      continue;
    }

    anyChanged = true;
    if (dryRun) {
      output.log(`--- ${c.name} (dry run)`);
      for (const line of diffLines(c.text, fixedText)) output.log(line);
      continue;
    }

    writeFileAtomic(c.file, fixedText);
    output.log(`fixed — ${c.name}:`);
    for (const a of applied) output.log(`  - ${a}`);
  }

  if (!anyChanged && !anyManual) output.log('nothing to fix');
  return 0;
}

function diffLines(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  const out = [];
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] === b[i]) continue;
    if (a[i] !== undefined) out.push(`- ${a[i]}`);
    if (b[i] !== undefined) out.push(`+ ${b[i]}`);
  }
  return out;
}
