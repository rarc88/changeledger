import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseChange } from '../src/change.mjs';
import { checkRepo } from '../src/check.mjs';

const config = {
  changes_dir: '.sl/changes',
  statuses: ['draft', 'approved', 'in-progress', 'blocked', 'done'],
  stages: ['request', 'investigation', 'proposal', 'specification', 'plan', 'log'],
  types: {
    feature: { stages: ['request', 'plan', 'log'] },
    bug: { stages: ['request', 'plan'] },
  },
};

// Build a valid feature change; override pieces per test.
function change(over = {}) {
  const fm = {
    id: '20260613-120000',
    title: 'X',
    type: 'feature',
    status: 'draft',
    created: '2026-06-13T12:00:00Z',
    depends_on: [],
    ...over.frontmatter,
  };
  return {
    name: over.name ?? `${fm.id}-x.md`,
    text: over.text,
    frontmatter: fm,
    stages: over.stages ?? [{ key: 'request' }, { key: 'plan' }, { key: 'log' }],
    tasks: over.tasks ?? [],
    criteria: over.criteria ?? [],
  };
}

const run = (changes) => checkRepo({ config, changes });
const msgs = (list) => list.map((e) => e.message);

test('config changes_dir escaping the repo is an error', () => {
  for (const dir of ['../outside', '/abs/path', 'a/../../b']) {
    const { errors } = checkRepo({ config: { ...config, changes_dir: dir }, changes: [] });
    assert.ok(
      msgs(errors).some((m) => /changes_dir.*(escapes|relative)/.test(m)),
      `expected escape error for ${dir}`,
    );
  }
});

test('config specs_dir escaping the repo is an error', () => {
  const { errors } = checkRepo({ config: { ...config, specs_dir: '../x' }, changes: [] });
  assert.ok(msgs(errors).some((m) => /specs_dir.*escapes/.test(m)));
});

test('a valid repo has no errors', () => {
  const { errors } = run([change()]);
  assert.deepEqual(errors, []);
});

test('CR1: missing frontmatter key is an error', () => {
  const c = change();
  delete c.frontmatter.title;
  assert.ok(msgs(run([c]).errors).some((m) => /missing frontmatter "title"/.test(m)));
});

test('CR1: created not ISO UTC is an error', () => {
  const { errors } = run([change({ frontmatter: { created: '2026-06-13' } })]);
  assert.ok(msgs(errors).some((m) => /created not ISO/.test(m)));
});

test('CR2: unknown type and status are errors', () => {
  const { errors } = run([change({ frontmatter: { type: 'nope', status: 'weird' } })]);
  assert.ok(msgs(errors).some((m) => /unknown type/.test(m)));
  assert.ok(msgs(errors).some((m) => /unknown status/.test(m)));
});

test('CR3: missing active stage is an error', () => {
  const { errors } = run([change({ stages: [{ key: 'request' }, { key: 'plan' }] })]);
  assert.ok(msgs(errors).some((m) => /missing active stage "## log"/.test(m)));
});

test('CR4: unknown stage heading is an error', () => {
  const { errors } = run([
    change({ stages: [{ key: 'request' }, { key: 'plan' }, { key: 'log' }, { key: 'banana' }] }),
  ]);
  assert.ok(msgs(errors).some((m) => /unknown stage "## banana"/.test(m)));
});

test('CR4: stages out of canonical order is an error', () => {
  const { errors } = run([
    change({ stages: [{ key: 'plan' }, { key: 'request' }, { key: 'log' }] }),
  ]);
  assert.ok(msgs(errors).some((m) => /out of canonical order/.test(m)));
});

test('151221 CR1: stage headings must use canonical casing', () => {
  const { errors } = run([
    change({
      stages: [
        { key: 'request', heading: 'request' },
        { key: 'plan', heading: 'Plan' },
        { key: 'log', heading: 'Log' },
      ],
    }),
  ]);
  assert.ok(
    msgs(errors).some((m) => /stage heading must be canonical: expected "## Request"/.test(m)),
  );
});

test('CR5: dangling dependency is an error', () => {
  const { errors } = run([change({ frontmatter: { depends_on: ['99999999-000000'] } })]);
  assert.ok(msgs(errors).some((m) => /references missing change/.test(m)));
});

test('CR5: dependency cycle is an error', () => {
  const a = change({ frontmatter: { id: '20260613-120000', depends_on: ['20260613-130000'] } });
  const b = change({
    frontmatter: { id: '20260613-130000', depends_on: ['20260613-120000'] },
    name: '20260613-130000-y.md',
  });
  assert.ok(msgs(run([a, b]).errors).some((m) => /dependency cycle/.test(m)));
});

test('CR6: duplicate ids are an error', () => {
  const a = change();
  const b = change({ name: '20260613-120000-y.md' });
  assert.ok(msgs(run([a, b]).errors).some((m) => /duplicate id/.test(m)));
});

test('CR7: done with unfinished tasks is a warning, not an error', () => {
  const c = change({
    frontmatter: { status: 'done' },
    tasks: [{ state: 'done', resolvedAt: '2026-06-13T12:01:00Z' }, { state: 'todo' }],
  });
  const { errors, warnings } = run([c]);
  assert.deepEqual(errors, []);
  assert.ok(msgs(warnings).some((m) => /not done/.test(m)));
});

test('id not matching filename is an error', () => {
  const { errors } = run([change({ name: 'wrong-name.md' })]);
  assert.ok(msgs(errors).some((m) => /filename does not match id/.test(m)));
});

test('config missing a required key is an error', () => {
  const bad = { ...config, statuses: undefined };
  delete bad.statuses;
  const { errors } = checkRepo({ config: bad, changes: [change()] });
  assert.ok(msgs(errors).some((m) => /config missing "statuses"/.test(m)));
});

test('config type referencing an unknown stage is an error', () => {
  const bad = { ...config, types: { feature: { stages: ['request', 'banana'] } } };
  const { errors } = checkRepo({ config: bad, changes: [] });
  assert.ok(msgs(errors).some((m) => /references unknown stage "banana"/.test(m)));
});

test('CR2: a non-boolean review_required is an error', () => {
  const bad = { ...config, types: { feature: { stages: ['request'], review_required: 'yes' } } };
  const { errors } = checkRepo({ config: bad, changes: [] });
  assert.ok(msgs(errors).some((m) => /review_required must be a boolean/.test(m)));
});

test('scoped check validates only the requested change', () => {
  const good = change();
  const bad = change({
    frontmatter: { id: '20260613-130000', type: 'nope' },
    name: '20260613-130000-y.md',
  });
  const { errors } = checkRepo({ config, changes: [good, bad] }, { id: good.frontmatter.id });
  assert.deepEqual(errors, []);
});

test('scoped check on a missing id is an error', () => {
  const { errors } = checkRepo({ config, changes: [change()] }, { id: 'nope' });
  assert.ok(msgs(errors).some((m) => /no change with id "nope"/.test(m)));
});

test('CR1: a merge conflict marker is an error with its line', () => {
  const c = change({ text: '---\nid: x\n---\n<<<<<<< HEAD\nfoo\n=======\nbar\n>>>>>>> branch\n' });
  const { errors } = run([c]);
  assert.ok(msgs(errors).some((m) => /merge conflict marker .* at line 4/.test(m)));
  assert.ok(msgs(errors).some((m) => /at line 6/.test(m)));
  assert.ok(msgs(errors).some((m) => /at line 8/.test(m)));
});

test('CR2: clean text does not false-positive', () => {
  const c = change({ text: '---\nid: x\n---\n## Request\n\na == b and a < b\n' });
  assert.deepEqual(
    msgs(run([c]).errors).filter((m) => /conflict marker/.test(m)),
    [],
  );
});

test('CR1: an external cross-project dep is not a missing-change error', () => {
  const c = change({ frontmatter: { depends_on: ['other:20260101-000000'] } });
  assert.deepEqual(
    msgs(run([c]).errors).filter((m) => /missing change/.test(m)),
    [],
  );
});

test('CR1: a local dangling dep is still an error alongside an external one', () => {
  const c = change({ frontmatter: { depends_on: ['other:20260101-000000', '20990101-000000'] } });
  assert.ok(msgs(run([c]).errors).some((m) => /missing change "20990101-000000"/.test(m)));
});

test('CR2: cycle graph ignores external deps', () => {
  const a = change({ frontmatter: { id: '20260613-120000', depends_on: ['ext:20260101-000000'] } });
  assert.deepEqual(
    msgs(run([a]).errors).filter((m) => /cycle/.test(m)),
    [],
  );
});

test('CR3: a non-boolean archived flag is an error', () => {
  const c = change({ frontmatter: { archived: 1 } });
  assert.ok(msgs(run([c]).errors).some((m) => /archived must be a boolean/.test(m)));
});

test('CR3: a non-boolean reviewed flag is an error', () => {
  const c = change({ frontmatter: { reviewed: 1 } });
  assert.ok(msgs(run([c]).errors).some((m) => /reviewed must be a boolean/.test(m)));
});

const spec = (over = {}) => ({
  name: over.name ?? 'arch.md',
  frontmatter: { title: 'T', updated: '2026-06-13T12:00:00Z', tags: [], ...over.frontmatter },
  body: over.body ?? '',
});
const runS = (changes, specs) => checkRepo({ config, changes, specs });

test('CR1: a change graduating to a missing spec is an error', () => {
  const c = change({ text: '## Log\n- **2026-06-13T12:00:00Z** — graduado a spec `ghost.md`\n' });
  assert.ok(msgs(runS([c], []).errors).some((m) => /missing spec "ghost.md"/.test(m)));
});

test('CR1: a spec referencing a missing change is an error', () => {
  const s = spec({ body: 'Graduado del change 20990101-000000' });
  assert.ok(
    msgs(runS([change()], [s]).errors).some((m) => /missing change "20990101-000000"/.test(m)),
  );
});

test('CR2: a spec with no link is an orphan warning, not an error', () => {
  const { errors, warnings } = runS([change()], [spec()]);
  assert.deepEqual(errors, []);
  assert.ok(msgs(warnings).some((m) => /orphan spec/.test(m)));
});

test('CR2: a spec backlinked to an existing change is not orphan', () => {
  const c = change({ frontmatter: { id: '20260613-120000' } });
  const s = spec({ body: 'Graduado del change 20260613-120000' });
  assert.deepEqual(
    msgs(runS([c], [s]).warnings).filter((m) => /orphan/.test(m)),
    [],
  );
});

test('CR3: a stale updated is a warning', () => {
  const c = change({
    frontmatter: { id: '20260613-120000', created: '2026-06-13T10:00:00Z' },
    text: '---\n---\n## Log\n- **2026-06-20T10:00:00Z** — graduado a spec `arch.md`\n',
  });
  const s = spec({ frontmatter: { updated: '2026-06-14T10:00:00Z' } });
  assert.ok(msgs(runS([c], [s]).warnings).some((m) => /older than linked change activity/.test(m)));
});

test('CR3: a non-ISO updated is an error', () => {
  const s = spec({ frontmatter: { updated: '2026-06-13' } });
  assert.ok(msgs(runS([change()], [s]).errors).some((m) => /updated not ISO/.test(m)));
});

test('CR1: a duplicate stage is an error', () => {
  const c = change({
    stages: [
      { key: 'request' },
      { key: 'proposal' },
      { key: 'proposal' },
      { key: 'plan' },
      { key: 'log' },
    ],
  });
  assert.ok(msgs(run([c]).errors).some((m) => /duplicate stage "## proposal"/.test(m)));
});

test('CR1: no duplicates does not false-positive', () => {
  assert.deepEqual(
    msgs(run([change()]).errors).filter((m) => /duplicate stage/.test(m)),
    [],
  );
});

test('151221 CR2: done tasks require an ISO resolution timestamp', () => {
  const { errors } = run([
    change({
      tasks: [{ state: 'done', text: 'Finish it', criteria: ['CR1'] }],
    }),
  ]);
  assert.ok(
    msgs(errors).some((m) => /done task is missing an ISO 8601 UTC resolution timestamp/.test(m)),
  );
});

test('151221 CR2: done task descriptions may contain an em dash before the timestamp', () => {
  const text = `---
id: "20260613-120000"
title: X
type: feature
status: done
created: 2026-06-13T12:00:00Z
depends_on: []
---

## Request

X

## Plan

- [x] Keep the phrase — do not truncate it (CR1) — 2026-06-13T12:01:00Z

## Log
`;
  const parsed = parseChange(text);
  const { errors } = run([change({ text, ...parsed })]);
  assert.deepEqual(
    msgs(errors).filter((m) => /done task is missing/.test(m)),
    [],
  );
});

test('151221 CR3: blocked tasks require a reason', () => {
  const { errors } = run([
    change({
      tasks: [{ state: 'blocked', text: 'Wait', criteria: ['CR1'] }],
    }),
  ]);
  assert.ok(msgs(errors).some((m) => /blocked task is missing a reason/.test(m)));
});

test('151221 CR4: duplicate criteria are an error', () => {
  const { errors } = run([change({ criteria: ['CR1', 'CR1'] })]);
  assert.ok(msgs(errors).some((m) => /duplicate criterion "CR1"/.test(m)));
});

// --- Definition of Ready coverage (tdd) ---

const tddConfig = {
  changes_dir: '.sl/changes',
  statuses: ['draft', 'approved', 'in-progress', 'blocked', 'done'],
  stages: ['request', 'specification', 'plan', 'log'],
  types: {
    feature: { stages: ['request', 'specification', 'plan', 'log'] },
    chore: { stages: ['request', 'plan'] },
  },
  tdd: true,
};

function cov(over = {}) {
  return {
    name: '20260613-120000-x.md',
    frontmatter: {
      id: '20260613-120000',
      title: 'X',
      type: 'feature',
      status: 'approved',
      created: '2026-06-13T12:00:00Z',
      depends_on: [],
      ...over.frontmatter,
    },
    stages: over.stages ?? [
      { key: 'request' },
      { key: 'specification' },
      { key: 'plan' },
      { key: 'log' },
    ],
    criteria: over.criteria ?? [],
    tasks: over.tasks ?? [],
  };
}

const covWarn = (over, cfg = tddConfig) =>
  msgs(checkRepo({ config: cfg, changes: [cov(over)] }).warnings);

const covResult = (text, cfg = tddConfig) => {
  const parsed = parseChange(text);
  return checkRepo({
    config: cfg,
    changes: [{ name: '20260613-120000-x.md', text, ...parsed }],
  });
};

test('CR2: a criterion with no covering task warns', () => {
  const w = covWarn({
    criteria: ['CR1', 'CR2'],
    tasks: [{ state: 'todo', text: 'do', criteria: ['CR1'] }],
  });
  assert.ok(w.some((m) => /CR2 is not covered by any Plan task/.test(m)));
});

test('CR3: a task with no criterion warns', () => {
  const w = covWarn({
    criteria: ['CR1'],
    tasks: [
      { state: 'todo', text: 'orphan support task', criteria: [] },
      { state: 'todo', text: 'real', criteria: ['CR1'] },
    ],
  });
  assert.ok(w.some((m) => /Plan task "orphan support task" references no criterion/.test(m)));
});

test('162014 CR1: a task referencing an undeclared criterion is an error', () => {
  const { errors, warnings } = covResult(`---
id: "20260613-120000"
title: X
type: feature
status: approved
created: 2026-06-13T12:00:00Z
depends_on: []
---

## Request

X

## Specification

### CR1 — Real
- **Given** input
- **When** action
- **Then** output

## Plan

- [ ] Update src/check.mjs and test/check.test.mjs (CR999)

## Log
`);
  assert.ok(msgs(errors).some((m) => /Plan task references unknown criterion "CR999"/.test(m)));
  assert.ok(msgs(warnings).some((m) => /CR1 is not covered by any Plan task/.test(m)));
});

test('162014 CR2: a task referencing a declared criterion is valid', () => {
  const { errors } = covResult(`---
id: "20260613-120000"
title: X
type: feature
status: approved
created: 2026-06-13T12:00:00Z
depends_on: []
---

## Request

X

## Specification

### CR1 — Real
- **Given** input
- **When** action
- **Then** output

## Plan

- [ ] Update src/check.mjs and test/check.test.mjs (CR1)

## Log
`);
  assert.deepEqual(
    msgs(errors).filter((m) => /unknown criterion/.test(m)),
    [],
  );
});

test('162014 CR3: multiple undeclared criteria are each reported', () => {
  const { errors } = covResult(`---
id: "20260613-120000"
title: X
type: feature
status: approved
created: 2026-06-13T12:00:00Z
depends_on: []
---

## Request

X

## Specification

### CR1 — Real
- **Given** input
- **When** action
- **Then** output

## Plan

- [ ] Update src/check.mjs and test/check.test.mjs (CR1, CR2, CR404)

## Log
`);
  assert.ok(msgs(errors).some((m) => /Plan task references unknown criterion "CR2"/.test(m)));
  assert.ok(msgs(errors).some((m) => /Plan task references unknown criterion "CR404"/.test(m)));
});

test('CR4: tdd:false disables coverage warnings', () => {
  const w = covWarn(
    { criteria: ['CR1', 'CR2'], tasks: [{ state: 'todo', text: 'x', criteria: [] }] },
    { ...tddConfig, tdd: false },
  );
  assert.deepEqual(
    w.filter((m) => /covered|criterion/.test(m)),
    [],
  );
});

test('151216 CR1: approved criteria must be test-grade', () => {
  const { errors } = covResult(`---
id: "20260613-120000"
title: X
type: feature
status: approved
created: 2026-06-13T12:00:00Z
depends_on: []
---

## Request

X

## Specification

### CR1 — Missing structure
- **Given** input

## Plan

- [ ] Update src/check.mjs and test/check.test.mjs (CR1)

## Log
`);
  assert.ok(msgs(errors).some((m) => /CR1 is not test-grade: missing Given\/When\/Then/.test(m)));
});

test('151216 CR2: approved implementation tasks must name target and test files', () => {
  const { errors } = covResult(`---
id: "20260613-120000"
title: X
type: feature
status: approved
created: 2026-06-13T12:00:00Z
depends_on: []
---

## Request

X

## Specification

### CR1 — Complete
- **Given** input
- **When** action
- **Then** output

## Plan

- [ ] Implement the behavior (CR1)

## Log
`);
  assert.ok(msgs(errors).some((m) => /Plan task for CR1 must name target and test files/.test(m)));
});

test('151216 CR3: draft readiness gaps are warnings', () => {
  const { errors, warnings } = covResult(`---
id: "20260613-120000"
title: X
type: feature
status: draft
created: 2026-06-13T12:00:00Z
depends_on: []
---

## Request

X

## Specification

### CR1 — Missing structure
- **Given** input

## Plan

- [ ] Implement the behavior (CR1)

## Log
`);
  assert.deepEqual(
    msgs(errors).filter((m) => /test-grade|target and test files/.test(m)),
    [],
  );
  assert.ok(msgs(warnings).some((m) => /CR1 is not test-grade/.test(m)));
  assert.ok(
    msgs(warnings).some((m) => /Plan task for CR1 must name target and test files/.test(m)),
  );
});

test('151216 CR4: tdd:false disables readiness checks', () => {
  const { errors, warnings } = covResult(
    `---
id: "20260613-120000"
title: X
type: feature
status: approved
created: 2026-06-13T12:00:00Z
depends_on: []
---

## Request

X

## Specification

### CR1 — Missing structure
- **Given** input

## Plan

- [ ] Implement the behavior (CR1)

## Log
`,
    { ...tddConfig, tdd: false },
  );
  assert.deepEqual(
    [...msgs(errors), ...msgs(warnings)].filter((m) => /test-grade|target and test files/.test(m)),
    [],
  );
});

test('CR5: a type without specification is not coverage-checked', () => {
  const w = covWarn({
    frontmatter: { type: 'chore', status: 'approved' },
    stages: [{ key: 'request' }, { key: 'plan' }],
    criteria: [],
    tasks: [{ state: 'todo', text: 'x', criteria: [] }],
  });
  assert.deepEqual(
    w.filter((m) => /covered|criterion/.test(m)),
    [],
  );
});

test('coverage warns in draft and applies to approved/in-progress; done is skipped', () => {
  const gap = { criteria: ['CR1', 'CR2'], tasks: [{ state: 'todo', text: 'x', criteria: [] }] };
  const draft = covWarn({ ...gap, frontmatter: { status: 'draft' } });
  assert.ok(draft.some((m) => /covered|criterion/.test(m)));

  const done = covWarn({ ...gap, frontmatter: { status: 'done' } });
  assert.deepEqual(
    done.filter((m) => /covered|criterion/.test(m)),
    [],
  );

  const w = covWarn({ ...gap, frontmatter: { status: 'in-progress' } });
  assert.ok(w.some((m) => /covered|criterion/.test(m)));
});

test('CR2: a Log section is allowed on a type that does not scaffold it (chore)', () => {
  const cfg = { ...config, types: { ...config.types, chore: { stages: ['request', 'plan'] } } };
  const c = {
    name: '20260613-120000-x.md',
    frontmatter: {
      id: '20260613-120000',
      title: 'X',
      type: 'chore',
      status: 'approved',
      created: '2026-06-13T12:00:00Z',
      depends_on: [],
    },
    stages: [{ key: 'request' }, { key: 'plan' }, { key: 'log' }],
    tasks: [],
  };
  const { errors } = checkRepo({ config: cfg, changes: [c] });
  assert.deepEqual(
    msgs(errors).filter((m) => /not active for type/.test(m)),
    [],
  );
});

// 20260615-210508 — a discarded change is valid and stays dependency-resolvable.
test('210508 CR5: a discarded change passes check', () => {
  const cfg = { ...config, statuses: [...config.statuses, 'discarded'] };
  const { errors } = checkRepo({
    config: cfg,
    changes: [change({ frontmatter: { status: 'discarded' } })],
  });
  assert.equal(errors.length, 0, msgs(errors).join('; '));
});

test('210508 CR7: a dependency on a discarded change is not flagged as missing', () => {
  const cfg = { ...config, statuses: [...config.statuses, 'discarded'] };
  const a = change({ frontmatter: { id: '20260613-120000', status: 'discarded' } });
  const b = change({
    name: '20260613-120001-b.md',
    frontmatter: { id: '20260613-120001', depends_on: ['20260613-120000'] },
  });
  const { errors } = checkRepo({ config: cfg, changes: [a, b] });
  assert.ok(!msgs(errors).some((m) => /dangling|missing|depend/i.test(m)), msgs(errors).join('; '));
});
