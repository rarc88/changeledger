import fs from 'node:fs';
import { writeFileAtomic } from '../atomic-write.mjs';
import { writeLedgerFiles } from '../change-store.mjs';
import { assertSupportedSchema } from '../config-migration.mjs';
import { computeFixes, migratePlanTags, migrateStructuredSections } from '../fix.mjs';
import { parseLogEvent } from '../lifecycle.mjs';
import { loadRepo } from '../repo.mjs';
import { readSnapshot } from '../state-store.mjs';
import { setSpecGraduatedFromList } from '../writer.mjs';

// Writes every entry as one CAS commit when active (one invocation = one
// commit); inactive keeps the original per-file `writeFileAtomic` loop,
// unchanged.
function writeFixedFiles(repo, entries, message) {
  if (!repo.state) {
    for (const entry of entries) writeFileAtomic(entry.file, entry.text);
    return;
  }
  if (entries.length) writeLedgerFiles(repo, entries, { message });
}

// Repairs mechanical, unambiguous format defects (`changeledger fix [id] [--dry-run]`).
// Ambiguous defects are never touched — they are listed under "requires manual fix".
export function fix(args = [], cwd = process.cwd(), output = console) {
  const dryRun = args.includes('--dry-run');
  const graduationLinks = args.includes('--graduation-links');
  const structuredSections = args.includes('--structured-sections');
  const planTags = args.includes('--plan-tags');
  const id = args.find((a) => !a.startsWith('--'));

  let repo;
  try {
    repo = loadRepo(cwd);
    if (!dryRun) assertSupportedSchema(repo.config);
  } catch (e) {
    output.error(`  error  (repo): ${e.message}`);
    return 1;
  }

  if (graduationLinks) {
    if (id) {
      output.error('  error  --graduation-links cannot be combined with a change id');
      return 1;
    }
    return fixGraduationLinks(repo, { dryRun, output });
  }

  if (structuredSections) {
    if (id) {
      output.error('  error  --structured-sections cannot be combined with a change id');
      return 1;
    }
    return fixStructuredSections(repo, { dryRun, output });
  }

  if (planTags) {
    if (id) {
      output.error('  error  --plan-tags cannot be combined with a change id');
      return 1;
    }
    return fixPlanTags(repo, { dryRun, output });
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

    entries.push({ file: c.file, relPath: `changes/${c.name}`, text: fixedText });
    output.log(`fixed — ${c.name}:`);
    for (const a of applied) output.log(`  - ${a}`);
  }

  writeFixedFiles(repo, entries, id ? `fix: ${id}` : 'fix: all changes');
  if (!anyChanged && !anyManual) output.log('nothing to fix');
  return 0;
}

// Unlike `--structured-sections`, a `manual` note here never blocks the write:
// the deterministic part of a task (its criteria and support marker) migrates
// even when its verification cannot be placed by machine. The note names what a
// human still owes; leaving the file behind would only hide the trace instead.
function fixPlanTags(repo, { dryRun, output }) {
  let anyChanged = false;
  let anyManual = false;
  const entries = [];
  for (const change of repo.changes) {
    const result = migratePlanTags(change.text);
    if (result.manual.length) {
      anyManual = true;
      output.log(`requires manual fix — ${change.name}:`);
      for (const message of result.manual) output.log(`  - ${message}`);
    }
    if (!result.changed) continue;
    anyChanged = true;
    if (dryRun) {
      output.log(`--- ${change.name} (dry run)`);
      for (const line of diffLines(change.text, result.text)) output.log(line);
    } else {
      entries.push({ file: change.file, relPath: `changes/${change.name}`, text: result.text });
      output.log(`fixed — ${change.name}:`);
      for (const message of result.applied) output.log(`  - ${message}`);
    }
  }
  writeFixedFiles(repo, entries, 'fix: --plan-tags');
  if (!anyChanged && !anyManual) output.log('nothing to fix');
  return 0;
}

function fixStructuredSections(repo, { dryRun, output }) {
  let anyChanged = false;
  let anyManual = false;
  const entries = [];
  for (const change of repo.changes) {
    const result = migrateStructuredSections(change.text);
    if (result.manual.length) {
      anyManual = true;
      output.log(`requires manual fix — ${change.name}:`);
      for (const message of result.manual) output.log(`  - ${message}`);
      continue;
    }
    if (!result.changed) continue;
    anyChanged = true;
    if (dryRun) {
      output.log(`--- ${change.name} (dry run)`);
      for (const line of diffLines(change.text, result.text)) output.log(line);
    } else {
      entries.push({ file: change.file, relPath: `changes/${change.name}`, text: result.text });
      output.log(`fixed — ${change.name}:`);
      for (const message of result.applied) output.log(`  - ${message}`);
    }
  }
  writeFixedFiles(repo, entries, 'fix: --structured-sections');
  if (!anyChanged && !anyManual) output.log('nothing to fix');
  return 0;
}

// Active mode needs each spec's raw text (`repo.specs` only carries the
// parsed frontmatter/body, the same gap `graduate.mjs` has), so it is read
// directly from the same snapshot `loadRepo` already resolved instead of a
// second full read.
function specRawTexts(repo) {
  if (!repo.state) return null;
  return readSnapshot(repo.repoRoot, { revision: repo.state.revision }).documents;
}

function fixGraduationLinks(repo, { dryRun, output }) {
  const eventsBySpec = graduationEventsBySpec(repo.changes);
  const candidates = [];
  const errors = [];
  const rawTexts = specRawTexts(repo);

  for (const spec of repo.specs) {
    const before = rawTexts ? rawTexts[`specs/${spec.name}`] : fs.readFileSync(spec.file, 'utf8');
    const existing = spec.frontmatter?.graduated_from;
    if (existing !== undefined && !Array.isArray(existing)) {
      errors.push(`${spec.name}: graduated_from must be a list`);
      continue;
    }

    const legacy = stripLegacyGraduationHistory(before);
    const events = eventsBySpec.get(spec.name) ?? [];
    const destinations = new Set(events.map((event) => event.changeId));
    const unverified = [...(existing ?? []).map(String), ...legacy.changeIds].filter(
      (changeId) => !destinations.has(changeId),
    );
    if (unverified.length) {
      for (const changeId of new Set(unverified)) {
        errors.push(
          `${spec.name}: legacy graduation "${changeId}" has no matching change Log for this spec`,
        );
      }
      continue;
    }

    const desired = [...new Set(events.map((event) => event.changeId))];
    let after = legacy.text;
    if (desired.length || existing !== undefined) {
      const current = (existing ?? []).map(String);
      if (legacy.changed || current.join('\0') !== desired.join('\0')) {
        after = setSpecGraduatedFromList(after, desired);
      }
    }
    if (after !== before) candidates.push({ spec, before, after });
  }

  if (errors.length) {
    for (const message of errors) output.error(`  error  ${message}`);
    return 1;
  }
  if (!candidates.length) {
    output.log('nothing to fix');
    return 0;
  }
  const entries = [];
  for (const { spec, before, after } of candidates) {
    if (dryRun) {
      output.log(`--- ${spec.name} (dry run)`);
      for (const line of diffLines(before, after)) output.log(line);
    } else {
      entries.push({ file: spec.file, relPath: `specs/${spec.name}`, text: after });
      output.log(`fixed — ${spec.name}:`);
      output.log('  - migrated graduation provenance to graduated_from');
    }
  }
  writeFixedFiles(repo, entries, 'fix: --graduation-links');
  return 0;
}

function graduationEventsBySpec(changes) {
  const bySpec = new Map();
  for (const change of changes) {
    const changeId = String(change.frontmatter?.id);
    const logBody = String(change.stages?.find((stage) => stage.key === 'log')?.body ?? '');
    for (const line of logBody.split('\n')) {
      const parsed = parseLogEvent(line);
      if (parsed?.type !== 'graduation' || parsed.outcome !== 'spec') continue;
      const event = { changeId, timestamp: parsed.at };
      if (!bySpec.has(parsed.spec)) bySpec.set(parsed.spec, []);
      bySpec.get(parsed.spec).push(event);
    }
  }
  for (const events of bySpec.values()) {
    events.sort(
      (a, b) => a.timestamp.localeCompare(b.timestamp) || a.changeId.localeCompare(b.changeId),
    );
  }
  return bySpec;
}

function stripLegacyGraduationHistory(text) {
  const frontmatter = text.match(/^---\n[\s\S]*?\n---\n?/);
  if (!frontmatter) return { text, changeIds: [], changed: false };
  const prefix = frontmatter[0];
  const lines = text.slice(prefix.length).split('\n');
  let cursor = 0;
  while (cursor < lines.length && !lines[cursor].trim()) cursor += 1;
  if (/^#{1,6}\s+/.test(lines[cursor] ?? '')) {
    cursor += 1;
    while (cursor < lines.length && !lines[cursor].trim()) cursor += 1;
  }
  const start = cursor;
  const changeIds = [];
  while (true) {
    const match = (lines[cursor] ?? '').match(
      /^>\s+(?:Graduado del|Actualizado por el) change\s+(\d{8}-\d{6})\b/i,
    );
    if (!match) break;
    changeIds.push(match[1]);
    cursor += 1;
  }
  if (!changeIds.length) return { text, changeIds, changed: false };
  while (cursor < lines.length && !lines[cursor].trim()) cursor += 1;
  const body = [...lines.slice(0, start), ...lines.slice(cursor)].join('\n');
  return { text: `${prefix}${body}`, changeIds, changed: true };
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
