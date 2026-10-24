import { writeLedgerFiles } from '../change-store.mjs';
import { frozenReason } from '../check.mjs';
import { assertSupportedSchema } from '../config-migration.mjs';
import { computeFixes, repairLiveDocument } from '../fix.mjs';
import { loadRepo } from '../repo.mjs';

// Delegates unconditionally to `writeLedgerFiles` — the single seam decides
// the worktree-vs-ref branch by `repo.state` (one invocation = one CAS
// commit when active; the original per-file loop, unchanged, when
// inactive). The empty-entries guard stays: a no-op call must not force a
// CAS check against a possibly-stale `repo.state.revision` when there is
// truly nothing to write, mirroring `mutateLedgerFile`'s own
// skip-on-`undefined` contract.
function writeFixedFiles(repo, entries, message) {
  if (!entries.length) return;
  writeLedgerFiles(repo, entries, { message });
}

// Repairs mechanical, unambiguous format defects (`changeledger fix [id] [--dry-run]`)
// and brings each live document to the two-type, four-stage form; frozen
// history (`frozenReason`) only ever receives the Plan repairs.
// Ambiguous defects are never touched — they are listed under "requires manual fix".
export function fix(args = [], cwd = process.cwd(), output = console) {
  const dryRun = args.includes('--dry-run');
  const id = args.find((a) => !a.startsWith('--'));

  let repo;
  try {
    repo = loadRepo(cwd);
    if (!dryRun) assertSupportedSchema(repo.config);
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
  const entries = [];

  for (const c of targets) {
    const live =
      frozenReason(c) === null
        ? repairLiveDocument(c.text)
        : { text: c.text, applied: [], manual: [] };
    const plan = computeFixes(live.text);
    const fixedText = plan.text;
    const applied = [...live.applied, ...plan.applied];
    const manual = [...live.manual, ...plan.manual];

    if (manual.length) {
      anyManual = true;
      output.log(`requires manual fix — ${c.name}:`);
      for (const m of manual) output.log(`  - ${m}`);
    }

    if (fixedText === c.text) {
      output.log(id ? 'nothing to fix' : `${c.name}: nothing to fix`);
      continue;
    }

    anyChanged = true;
    if (dryRun) {
      output.log(`--- ${c.name} (dry run)`);
      for (const a of applied) output.log(`  - ${a}`);
      for (const line of diffLines(c.text, fixedText)) output.log(line);
      continue;
    }

    entries.push({ file: c.file, relPath: `changes/${c.name}`, text: fixedText });
    output.log(`fixed — ${c.name}:`);
    for (const a of applied) output.log(`  - ${a}`);
  }

  writeFixedFiles(repo, entries, id ? `fix: ${id}` : 'fix: all changes');
  if (!anyChanged && !anyManual) output.log('nothing to fix');
  return 0;
}

function diffLines(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      i += 1;
      j += 1;
    } else if (j < b.length && (i === a.length || lcs[i][j + 1] > lcs[i + 1][j])) {
      out.push(`+ ${b[j++]}`);
    } else if (i < a.length) {
      out.push(`- ${a[i++]}`);
    }
  }
  return out;
}
