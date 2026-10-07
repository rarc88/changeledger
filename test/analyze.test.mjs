import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { sanitizedEnv } from './helpers/git-env.mjs';
import {
  changeText,
  logLine,
  usageRecord,
  usageRecordFileName,
  usageSession,
} from './helpers/usage-analysis.mjs';

const bin = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'bin',
  'changeledger.mjs',
);

const A = '20261001-000001';
const B = '20261001-000002';
const C = '20261001-000003';
const at = (minute) => `2026-10-01T00:${String(minute).padStart(2, '0')}:00Z`;
const s1 = (tokens) => usageSession('s1', { opus: { tokens, cost: tokens / 100 } });

// A worktree-layout ledger outside any git repository, removed after the test.
function ledger(t, { changes, records = [] }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-analyze-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, '.changeledger');
  fs.mkdirSync(path.join(dir, 'changes'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'config.yml'),
    'schema_version: 6\nmin_cli_version: 0.1.0\nchanges_dir: .changeledger/changes\nspecs_dir: .changeledger/specs\n',
  );
  for (const [id, options] of Object.entries(changes)) {
    fs.writeFileSync(path.join(dir, 'changes', `${id}-demo.md`), changeText(id, options));
  }
  if (records.length) fs.mkdirSync(path.join(dir, 'usage'));
  for (const record of records) {
    fs.writeFileSync(
      path.join(dir, 'usage', usageRecordFileName(record)),
      `${JSON.stringify(record, null, 2)}\n`,
    );
  }
  return (...args) => {
    const r = spawnSync(process.execPath, [bin, 'analyze', ...args], {
      cwd: root,
      env: sanitizedEnv(),
      encoding: 'utf8',
    });
    return { code: r.status, out: r.stdout, err: r.stderr };
  };
}

// The CR1/CR2 records: A goes created → in-review, then B is created.
function twoChanges(t) {
  return ledger(t, {
    changes: {
      [A]: { title: 'Alpha', log: [logLine(at(0), 'version', '0.18.0')] },
      [B]: { title: 'Beta', type: 'bug' },
    },
    records: [
      usageRecord({ change: A, at: at(1), event: 'created', to: 'draft', sessions: [s1(100)] }),
      usageRecord({ change: A, at: at(2), from: 'draft', to: 'approved', sessions: [s1(300)] }),
      usageRecord({
        change: A,
        at: at(3),
        from: 'approved',
        to: 'in-progress',
        sessions: [s1(350)],
      }),
      usageRecord({
        change: A,
        at: at(4),
        from: 'in-progress',
        to: 'in-review',
        sessions: [s1(1000)],
      }),
      usageRecord({ change: B, at: at(5), event: 'created', to: 'draft', sessions: [s1(1200)] }),
    ],
  });
}

test('CR1/CR2 through the CLI: analyze <id> --json reads the records from the ledger', (t) => {
  const analyze = twoChanges(t);
  const a = analyze(A, '--json');
  assert.equal(a.code, 0, a.err);
  const parsed = JSON.parse(a.out);
  assert.deepEqual(
    parsed.changes[0].segments.map((s) => [s.segment, s.total_tokens, s.version]),
    [
      ['draft', 200, '0.18.0'],
      ['approved', 50, '0.18.0'],
      ['in-progress', 650, '0.18.0'],
    ],
  );
  assert.ok(parsed.hints.includes(`baseline: first record of ana at ${at(1)} is not attributed`));
  const b = JSON.parse(analyze(B, '--json').out);
  assert.deepEqual(
    b.changes[0].segments.map((s) => [s.segment, s.total_tokens]),
    [['pre-draft', 200]],
  );
});

test('CR8: the table has one row per measured change, followed by the hints', (t) => {
  const { code, out, err } = twoChanges(t)();
  assert.equal(code, 0, err);
  const lines = out.split('\n');
  assert.match(lines[0], /^ID\s+TOKENS\s+COST\s+REWORK\s+TITLE$/);
  assert.equal(lines.filter((l) => l.startsWith(A)).length, 1);
  assert.equal(lines.filter((l) => l.startsWith(B)).length, 1);
  assert.match(out, new RegExp(`^${A}\\s+900\\s+\\$9\\.00\\s+0%\\s+Alpha$`, 'm'));
  assert.match(out, new RegExp(`^${B}\\s+200\\s+\\$2\\.00\\s+0%\\s+Beta$`, 'm'));
  assert.match(out, /^baseline: first record of ana at \S+ is not attributed$/m);
});

test('CR8: analyze <id> lists the segments of that change', (t) => {
  const { code, out, err } = twoChanges(t)(A);
  assert.equal(code, 0, err);
  assert.match(out, new RegExp(`^#${A} Alpha$`, 'm'));
  assert.match(out, /^SEGMENT\s+CLOSED AT\s+VERSION\s+RECORDER\s+TOKENS\s+COST\s+MODELS$/m);
  for (const [segment, tokens] of [
    ['draft', 200],
    ['approved', 50],
    ['in-progress', 650],
  ]) {
    assert.match(
      out,
      new RegExp(`^${segment}\\s+\\S+Z\\s+0\\.18\\.0\\s+ana\\s+${tokens}\\s+\\$\\S+\\s+opus$`, 'm'),
    );
  }
});

test('CR8: --by model groups every measured change by model', (t) => {
  const { code, out, err } = twoChanges(t)('--by', 'model');
  assert.equal(code, 0, err);
  assert.match(out, /^MODEL\s+TOKENS\s+COST\s+UNPRICED\s+SEGMENTS$/m);
  assert.match(out, /^opus\s+1100\s+\$11\.00\s+0\s+4$/m);
});

test('CR8: --json prints the schema 1 object', (t) => {
  const { code, out, err } = twoChanges(t)('--json');
  assert.equal(code, 0, err);
  const parsed = JSON.parse(out);
  assert.equal(parsed.schema, 1);
  assert.deepEqual(Object.keys(parsed).sort(), ['changes', 'groups', 'hints', 'schema']);
  assert.deepEqual(
    parsed.changes.map((c) => c.id),
    [A, B],
  );
  assert.deepEqual(parsed.groups, []);
});

test('CR8: an unknown group or change id exits non-zero', (t) => {
  const analyze = twoChanges(t);
  const by = analyze('--by', 'foo');
  assert.notEqual(by.code, 0);
  assert.match(by.err, /Allowed choices are segment, model, version, type, recorder/);
  const unknown = analyze('20990101-000000');
  assert.notEqual(unknown.code, 0);
  assert.match(unknown.err, /No change with id "20990101-000000"/);
  assert.equal(unknown.out, '');
});

test('CR9: a ledger without usage records is not an error', (t) => {
  const analyze = ledger(t, { changes: { [A]: {}, [B]: {}, [C]: {} } });
  const { code, out, err } = analyze();
  assert.equal(code, 0, err);
  assert.match(out, /^no usage records$/m);
  assert.match(out, /^unmeasured: 3 change\(s\) have no attributed usage$/m);
});

test('20261007-135142 CR1: unmeasured changes are reported as without attributed usage, not without records', (t) => {
  const analyze = ledger(t, {
    changes: { [A]: { title: 'Alpha' }, [B]: { title: 'Beta' }, [C]: { title: 'Gamma' } },
    records: [
      usageRecord({ change: A, at: at(1), event: 'created', to: 'draft', sessions: [s1(100)] }),
      usageRecord({ change: C, at: at(2), event: 'created', to: 'draft', error: 'boom' }),
      usageRecord({ change: C, at: at(3), from: 'draft', to: 'approved', error: 'boom' }),
    ],
  });
  const { code, out, err } = analyze('--json');
  assert.equal(code, 0, err);
  const { hints } = JSON.parse(out);
  assert.ok(hints.includes('unmeasured: 3 change(s) have no attributed usage'), hints.join('\n'));
  assert.equal(
    hints.some((h) => h.includes('have no usage records')),
    false,
    hints.join('\n'),
  );
});

test('CR3: rework that rounds to 0% shows as <0.1% in the table, the change view and the hint', (t) => {
  const analyze = ledger(t, {
    changes: {
      [C]: { title: 'Gamma', log: [logLine(at(3), 'review', 'in-review → in-progress')] },
    },
    records: [
      usageRecord({ change: C, at: at(1), event: 'created', to: 'draft', sessions: [s1(0)] }),
      usageRecord({ change: C, at: at(2), from: 'draft', to: 'in-review', sessions: [s1(100000)] }),
      usageRecord({
        change: C,
        at: at(3),
        event: 'review',
        from: 'in-review',
        to: 'in-progress',
        sessions: [s1(100000)],
      }),
      usageRecord({
        change: C,
        at: at(4),
        from: 'in-progress',
        to: 'in-review',
        sessions: [s1(100004)],
      }),
    ],
  });
  const table = analyze();
  assert.equal(table.code, 0, table.err);
  assert.match(table.out, new RegExp(`^${C}\\s+100004\\s+\\S+\\s+<0\\.1%\\s+Gamma$`, 'm'));
  assert.match(
    table.out,
    new RegExp(
      `^rework: ${C} spent <0\\.1% of its tokens after a failed review or validation$`,
      'm',
    ),
  );
  const view = analyze(C);
  assert.equal(view.code, 0, view.err);
  assert.match(view.out, /^total: 100004 tokens, .*, rework <0\.1%$/m);
});

test('CR13/CR14 through the CLI: a change with only failed records has no row; failed and gap hints are printed', (t) => {
  const analyze = ledger(t, {
    changes: {
      [A]: { title: 'Alpha' },
      [B]: { title: 'Beta', log: [logLine(at(3), 'status', 'draft → approved')] },
      [C]: { title: 'Gamma' },
    },
    records: [
      usageRecord({ change: A, at: at(1), event: 'created', to: 'draft', sessions: [s1(100)] }),
      usageRecord({ change: C, at: at(2), event: 'created', to: 'draft', error: 'boom' }),
      usageRecord({ change: A, at: at(4), from: 'draft', to: 'approved', sessions: [s1(400)] }),
    ],
  });
  const { code, out, err } = analyze();
  assert.equal(code, 0, err);
  assert.match(out, new RegExp(`^${A}\\s+300\\s`, 'm'));
  assert.doesNotMatch(out, new RegExp(`^${C}`, 'm'));
  assert.match(out, new RegExp(`^failed: 1 record\\(s\\) of ${C} have no data$`, 'm'));
  assert.match(out, /^unmeasured: 2 change\(s\) have no attributed usage$/m);
  assert.match(
    out,
    new RegExp(
      `^gap: 1 transition\\(s\\) between ${at(1)} and ${at(4)} have no usage record; their consumption is in ${A} draft$`,
      'm',
    ),
  );
});

test('CR13 through the CLI: analyze <id> without usage data prints no zero total', (t) => {
  const analyze = ledger(t, {
    changes: { [A]: { title: 'Alpha' }, [B]: { title: 'Beta' }, [C]: { title: 'Gamma' } },
    records: [
      usageRecord({ change: A, at: at(1), event: 'created', to: 'draft', sessions: [s1(100)] }),
      usageRecord({ change: C, at: at(2), event: 'created', to: 'draft', error: 'boom' }),
    ],
  });
  const failedOnly = analyze(C);
  assert.equal(failedOnly.code, 0, failedOnly.err);
  assert.deepEqual(failedOnly.out.split('\n'), [
    `#${C} Gamma`,
    'no usage data',
    '',
    `failed: 1 record(s) of ${C} have no data`,
    '',
  ]);
  const unrecorded = analyze(B);
  assert.equal(unrecorded.code, 0, unrecorded.err);
  assert.deepEqual(unrecorded.out.split('\n'), [`#${B} Beta`, 'no usage records', '']);
  for (const [id, records] of [
    [C, 1],
    [B, 0],
  ]) {
    const [change] = JSON.parse(analyze(id, '--json').out).changes;
    assert.deepEqual(
      [
        change.records,
        change.total_tokens,
        change.cost_usd,
        change.unpriced_tokens,
        change.rework_pct,
      ],
      [records, null, null, null, null],
    );
  }
});

test('CR13 through the CLI: records that attribute no segment print no usage data, never no usage records', (t) => {
  const analyze = ledger(t, {
    changes: { [A]: { title: 'Alpha' }, [C]: { title: 'Gamma' } },
    records: [
      usageRecord({ change: A, at: at(1), event: 'created', to: 'draft', sessions: [s1(100)] }),
      usageRecord({ change: C, at: at(2), event: 'created', to: 'draft', error: 'boom' }),
    ],
  });
  for (const args of [[], ['--by', 'model']]) {
    const { code, out, err } = analyze(...args);
    assert.equal(code, 0, err);
    assert.equal(out.split('\n')[0], 'no usage data', out);
    assert.doesNotMatch(out, /^no usage records$/m);
    assert.match(out, /^unmeasured: 2 change\(s\) have no attributed usage$/m);
  }
  const baselineOnly = analyze(A);
  assert.equal(baselineOnly.code, 0, baselineOnly.err);
  assert.deepEqual(baselineOnly.out.split('\n'), [
    `#${A} Alpha`,
    'no usage data',
    '',
    `baseline: first record of ana at ${at(1)} is not attributed`,
    '',
  ]);
  const [change] = JSON.parse(analyze(A, '--json').out).changes;
  assert.deepEqual([change.records, change.total_tokens, change.cost_usd], [1, null, null]);
});
