import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parse as parseYaml } from 'yaml';
import { CANONICAL_STAGES, CHANGE_TYPES, parseChange } from '../src/change.mjs';
import {
  assertApprovable,
  assertReviewable,
  checkRepo,
  checkUsageGitConfig,
  effectiveTdd,
  LEGACY_EDGES,
} from '../src/check.mjs';
import { approve } from '../src/commands/agent.mjs';
import { check } from '../src/commands/check.mjs';
import { init as initializeRepo } from '../src/commands/init.mjs';
import {
  BRANCH_FORMAT_PLACEHOLDERS,
  integrationBranch,
  renderChangeBranch,
  usageCollector,
} from '../src/config.mjs';
import { ensureReference } from '../src/contract.mjs';
import { VERSION } from '../src/framing.mjs';
import {
  CANONICAL_STATUSES,
  CHANGE_ID_FORM,
  canTransition,
  LOG_EVENT_TYPES,
} from '../src/lifecycle.mjs';
import { templatesDir } from '../src/paths.mjs';
import { RELEASE_IMPACTS } from '../src/release.mjs';
import { loadRepo } from '../src/repo.mjs';
import { STATE_REF, writeActivation } from '../src/state-store.mjs';
import { usageRecordText } from './helpers/ccusage.mjs';
import { initGitFixture, sanitizedEnv } from './helpers/git-env.mjs';
import { buildTree, commitTree, updateRef } from './helpers/state-repo.mjs';

// Isolate the global registry: the usage CLI case below runs `init`, which
// registers the repo it creates.
process.env.CHANGELEDGER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));

const config = {
  changes_dir: '.changeledger/changes',
  statuses: ['draft', 'approved', 'in-progress', 'in-review', 'done'],
};

test('161655 CR3: check reports branch format defects without throwing', () => {
  const subject = change();
  const fields = subject.frontmatter;
  const formats = ['{type}', '{id}/{id}', '{owner}/{id}', '{type/{id}', 'bad..{id}'];

  for (const format of formats) {
    let expected;
    assert.throws(
      () => renderChangeBranch({ git: { change_branch_format: format } }, fields),
      (e) => {
        expected = e.message;
        return true;
      },
    );

    let result;
    assert.doesNotThrow(() => {
      result = checkRepo({
        config: { ...config, git: { change_branch_format: format } },
        changes: [subject],
      });
    });
    assert.ok(
      msgs(result.errors).some(
        (message) => message === expected || message.includes('renders an invalid Git branch'),
      ),
      `${format}: ${msgs(result.errors).join('\n')}`,
    );
  }
});

// Build a valid change; override pieces per test.
function change(over = {}) {
  const fm = {
    id: '20260613-120000',
    title: 'X',
    type: 'change',
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

test('20260824-134716 CR2: configurable and fixed check domains enumerate their authority', () => {
  const subject = change({
    frontmatter: { type: 'unknown', status: 'unknown', release_impact: 'unknown' },
    stages: [{ key: 'unknown', heading: 'Unknown' }],
  });
  const { errors } = run([subject]);
  const all = msgs(errors).join('\n');
  assert.match(all, new RegExp(`unknown type "unknown"; valid types: ${CHANGE_TYPES.join(', ')}`));
  assert.match(
    all,
    new RegExp(`unknown status "unknown"; valid statuses: ${config.statuses.join(', ')}`),
  );
  assert.match(
    all,
    new RegExp(`unknown stage "## unknown"; valid stages: ${CANONICAL_STAGES.join(', ')}`),
  );
  assert.match(all, new RegExp(`must be one of: ${RELEASE_IMPACTS.join(', ')}`));
  assert.deepEqual(BRANCH_FORMAT_PLACEHOLDERS, ['type', 'id']);
});

test('20260824-134716 CR6: an invalid Log entry gives the complete canonical grammar only', () => {
  const text = [
    '---',
    'id: "20260613-120000"',
    'title: X',
    'type: change',
    'status: draft',
    'created: 2026-06-13T12:00:00Z',
    'depends_on: []',
    '---',
    '',
    '## Log',
    '',
    '- **2026-06-13T12:00:00Z** `[bogus]` payload',
    '',
  ].join('\n');
  const subject = change({ text, stages: [{ key: 'log', heading: 'Log', body: '- invalid' }] });
  const { errors, warnings } = run([subject]);
  assert.ok(
    msgs(errors).includes(
      `Log line 12: invalid typed event; valid types: ${LOG_EVENT_TYPES.join(', ')}; expected: - **YYYY-MM-DDTHH:MM:SSZ** \`[type]\` payload`,
    ),
    msgs(errors).join('\n'),
  );
  assert.doesNotMatch([...msgs(errors), ...msgs(warnings)].join('\n'), /fix --structured-sections/);
});

function versionLogChange(status, logLines) {
  const text = [
    '---',
    'id: "20260613-120000"',
    'title: X',
    'type: change',
    `status: ${status}`,
    'created: 2026-06-13T12:00:00Z',
    'depends_on: []',
    '---',
    '',
    '## Log',
    '',
    ...logLines,
    '',
  ].join('\n');
  return change({
    text,
    frontmatter: { status },
    stages: [{ key: 'request' }, { key: 'plan' }, { key: 'log', heading: 'Log', body: '- log' }],
  });
}

test('20261001-155216 CR8: SemVer version events are valid and leave the reconstructed status alone', () => {
  const subject = versionLogChange('in-progress', [
    '- **2026-06-13T12:00:00Z** `[version]` 0.18.0-dev',
    '- **2026-06-13T12:01:00Z** `[status]` draft → approved',
    '- **2026-06-13T12:02:00Z** `[version]` 0.17.0 → 0.18.0-dev+abc.1',
    '- **2026-06-13T12:02:00Z** `[status]` approved → in-progress',
  ]);
  const { errors } = run([subject]);
  assert.deepEqual(msgs(errors), []);
  // The same Log without the stamps reconstructs the same status, so the
  // frontmatter comparison is the proof the version lines were skipped.
  const wrong = versionLogChange('approved', [
    '- **2026-06-13T12:00:00Z** `[version]` 0.18.0-dev',
    '- **2026-06-13T12:01:00Z** `[status]` draft → approved',
    '- **2026-06-13T12:02:00Z** `[version]` 0.17.0 → 0.18.0-dev+abc.1',
    '- **2026-06-13T12:02:00Z** `[status]` approved → in-progress',
  ]);
  assert.match(
    msgs(run([wrong]).errors).join('\n'),
    /Log reconstructs status "in-progress" but frontmatter says "approved"/,
  );
});

test('20261001-155216 CR8: non-SemVer version payloads get the invalid-event error naming version', () => {
  for (const payload of ['latest', '0.17 → 0.18.0']) {
    const subject = versionLogChange('draft', [
      `- **2026-06-13T12:00:00Z** \`[version]\` ${payload}`,
    ]);
    const errors = msgs(run([subject]).errors);
    const expected = `Log line 12: invalid typed event; valid types: ${LOG_EVENT_TYPES.join(', ')}; expected: - **YYYY-MM-DDTHH:MM:SSZ** \`[type]\` payload`;
    assert.ok(errors.includes(expected), `${payload}: ${errors.join('\n')}`);
    assert.match(expected, /\bversion\b/);
  }
});

// Confirm-only (20260726-124836 CR5): src/check.mjs never validated `owner`,
// so a change without it already passed cleanly — no production change needed.
test('20260726-124836 CR5: a change with no owner in frontmatter reports no error or warning', () => {
  const c = change();
  assert.equal('owner' in c.frontmatter, false);
  const { errors, warnings } = run([c]);
  assert.deepEqual(errors, []);
  assert.deepEqual(
    [...msgs(errors), ...msgs(warnings)].filter((m) => /owner/i.test(m)),
    [],
  );
});

// Confirm-only (20260805-052741 CR6): src/check.mjs never validates `branch`,
// so a change without it already passes cleanly — no production change needed.
test('20260805-052741 CR6: a change with no branch in frontmatter reports no error or warning', () => {
  const c = change();
  assert.equal('branch' in c.frontmatter, false);
  const { errors, warnings } = run([c]);
  assert.deepEqual(errors, []);
  assert.deepEqual(
    [...msgs(errors), ...msgs(warnings)].filter((m) => /\bbranch\b/i.test(m)),
    [],
  );
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

test('105456 CR1/CR3: related_to is non-blocking and permits external references and cycles', () => {
  const a = change({
    frontmatter: {
      id: '20260613-120000',
      related_to: ['20260613-130000', 'other:20260101-000000'],
    },
  });
  const b = change({
    frontmatter: { id: '20260613-130000', related_to: ['20260613-120000'] },
  });
  assert.deepEqual(run([a, b]).errors, []);
});

// --- 20261020-172221: the grouping edge ---------------------------------
//
// `parent` exists because `depends_on` + `related_to` collapse a real repo into
// one component — 739 of 994 changes in one consuming repo — so asking what
// belongs to an epic has no answer. These tests hold the two properties that
// keep it from becoming a third way to build that same blob: it is validated
// outside the relation graph, and the hierarchy is two levels deep.

const epic = (id, over = {}) => change({ frontmatter: { id, type: 'change', ...over } });

test('20261020-172221 CR1: parent must be a single existing id, never the change itself', () => {
  assert.ok(
    msgs(run([epic('20260613-120000', { parent: ['20260613-130000'] })]).errors).includes(
      'parent must be a single change id, not a list',
    ),
  );
  assert.ok(
    msgs(run([epic('20260613-120000', { parent: '20260613-130000' })]).errors).includes(
      'parent references missing change "20260613-130000"',
    ),
  );
  assert.ok(
    msgs(run([epic('20260613-120000', { parent: '20260613-120000' })]).errors).includes(
      'parent cannot reference its own change "20260613-120000"',
    ),
  );
  const parent = epic('20260613-130000');
  const child = epic('20260613-120000', { parent: '20260613-130000' });
  assert.deepEqual(run([parent, child]).errors, []);
});

test('20261020-172221 CR2: a third level and a cycle are rejected, and told apart', () => {
  const third = run([
    epic('20260613-110000'),
    epic('20260613-120000', { parent: '20260613-110000' }),
    epic('20260613-130000', { parent: '20260613-120000' }),
  ]).errors;
  assert.ok(
    msgs(third).some((m) => /declares a parent of its own: the hierarchy is two levels/.test(m)),
    `expected the third-level message, got: ${msgs(third).join(' | ')}`,
  );

  const cycle = run([
    epic('20260613-120000', { parent: '20260613-130000' }),
    epic('20260613-130000', { parent: '20260613-120000' }),
  ]).errors;
  assert.ok(
    msgs(cycle).some((m) => /^parent cycle: /.test(m)),
    `expected a parent-cycle message, got: ${msgs(cycle).join(' | ')}`,
  );
  // Told apart: the cycle must not be reported as a third level, which would
  // send the human to split a hierarchy that is actually contradictory.
  assert.ok(!msgs(cycle).some((m) => /two levels/.test(m)));

  // Any length, not just two: a three-link cycle is still a cycle. The first
  // implementation reported it as three third-level errors, because its depth
  // counter had already passed the threshold before it could look.
  const long = run([
    epic('20260613-110000', { parent: '20260613-130000' }),
    epic('20260613-120000', { parent: '20260613-110000' }),
    epic('20260613-130000', { parent: '20260613-120000' }),
  ]).errors;
  assert.ok(
    msgs(long).some((m) => /^parent cycle: /.test(m)),
    `expected a parent-cycle message for a 3-cycle, got: ${msgs(long).join(' | ')}`,
  );
  assert.ok(!msgs(long).some((m) => /two levels/.test(m)));
});

test('20261020-172221 CR1: a malformed parent is named as such, not called a list', () => {
  for (const malformed of ['not-an-id', '']) {
    const errors = msgs(run([epic('20260613-120000', { parent: malformed })]).errors);
    assert.ok(errors.includes(`parent "${malformed}" is not a change id`), errors.join(' | '));
    assert.ok(!errors.some((m) => /not a list/.test(m)));
    // One defect, one diagnostic: reading a malformed value as a reference too
    // reported the same field twice with two different fixes.
    assert.ok(!errors.some((m) => /references missing change/.test(m)), errors.join(' | '));
  }
});

// Archiving hides a document; it does not resolve the work its children carry.
// The first cut put this clause in the per-document subject loop, where it
// inherited the frozen-history exemption, so `archive <epic>` turned a red
// repo green and every creation seat then accepted new children under it
// (20261020-172221 D1 of round 5).
test('20261020-172221 CR6: archiving the parent does not retire the closure rule', () => {
  const open = epic('20260613-120000', { parent: '20260613-110000', status: 'in-progress' });
  const reported = (parentOverrides) =>
    msgs(run([epic('20260613-110000', parentOverrides), open]).errors).some((m) =>
      /unresolved children/.test(m),
    );

  assert.ok(reported({ status: 'done' }), 'a done parent with a live child is an error');
  assert.ok(
    reported({ status: 'done', archived: true }),
    'archiving the parent must not silence it: the fix is on the child, which is live',
  );
});

// The closure invariant is a repo rule, not only a write-seat guard. `apply`
// validates its accumulated candidate through `checkRepo`, so this is what
// catches an entry order that closes the parent before the child exists, and
// it is what a new route to `done` inherits for free (20261020-172221 D1/D2).
test('20261020-172221 CR6: check reports a done parent whose children are still open', () => {
  const parent = epic('20260613-110000', { status: 'done' });
  const open = epic('20260613-120000', { parent: '20260613-110000', status: 'in-progress' });
  const errors = msgs(run([parent, open]).errors);
  assert.ok(
    errors.some((m) => /still has unresolved children: 20260613-120000 \(in-progress\)/.test(m)),
    errors.join(' | '),
  );

  for (const resolved of ['done', 'discarded']) {
    const closed = epic('20260613-120000', { parent: '20260613-110000', status: resolved });
    assert.ok(
      !msgs(run([parent, closed]).errors).some((m) => /unresolved children/.test(m)),
      `a ${resolved} child does not hold its parent open`,
    );
  }

  // A live parent is not the subject: the rule is about closing, not about
  // having children.
  assert.ok(
    !msgs(run([epic('20260613-110000', { status: 'in-progress' }), open]).errors).some((m) =>
      /unresolved children/.test(m),
    ),
  );
});

test('20261020-172221 CR3: sharing a parent connects nothing and needs no backlink', () => {
  const parent = epic('20260613-110000');
  const a = epic('20260613-120000', { parent: '20260613-110000' });
  const b = epic('20260613-130000', { parent: '20260613-110000' });
  // No backlink obligation on the parent, no relation inferred between siblings,
  // and no dependency cycle from a hierarchy that is legal.
  assert.deepEqual(run([parent, a, b]).errors, []);

  // An empty error list stays empty whether or not `parent` is an edge, so it
  // proves nothing on its own. This does: the parent depends on its own child,
  // which is legal — the hierarchy is not a dependency — and becomes a cycle
  // the moment `parent` joins the graph `check` walks.
  const dependsOnItsChild = epic('20260613-110000', { depends_on: ['20260613-120000'] });
  assert.deepEqual(
    msgs(run([dependsOnItsChild, a]).errors),
    [],
    'a parent that depends on its child is not a cycle: `parent` is not an edge of that graph',
  );

  // Both ends, like `related_to`: an epic naming its own child used to warn,
  // and the remedy the warning names is `depends_on` or `related_to` — the
  // transitive edge this grouping exists to avoid (20261020-172221 D3a).
  const epicNamingItsChild = change({
    frontmatter: { id: '20260613-110000' },
    stages: [{ key: 'request', body: 'Incluye 20260613-120000.' }, { key: 'log' }],
  });
  assert.ok(
    !msgs(run([epicNamingItsChild, a]).warnings).some((m) => /mentions change/.test(m)),
    'a declared child must not warn on the parent end either',
  );

  // The parent is a declared link, so naming it in prose is not an undeclared
  // mention — the warning exists to catch ids that escape the model, and a
  // parent has not escaped it.
  const naming = change({
    frontmatter: { id: '20260613-120000', parent: '20260613-110000' },
    stages: [{ key: 'request', body: 'Hijo de 20260613-110000.' }, { key: 'log' }],
  });
  const { warnings } = run([parent, naming]);
  assert.ok(
    !msgs(warnings).some((m) => /mentions change "20260613-110000"/.test(m)),
    `a declared parent must not warn as an undeclared mention: ${msgs(warnings).join(' | ')}`,
  );
});

test('105456 CR2: related_to validates list, local destination and self-reference', () => {
  const invalidList = change({ frontmatter: { related_to: '20260613-130000' } });
  assert.ok(msgs(run([invalidList]).errors).includes('related_to must be a list'));

  const missing = change({ frontmatter: { related_to: ['20260613-130000'] } });
  assert.ok(
    msgs(run([missing]).errors).includes('related_to references missing change "20260613-130000"'),
  );

  const self = change({ frontmatter: { related_to: ['20260613-120000'] } });
  assert.ok(
    msgs(run([self]).errors).includes(
      'related_to cannot reference its own change "20260613-120000"',
    ),
  );
});

test('105456 CR9: active semantic mention without a structural link warns but does not error', () => {
  const target = change({
    frontmatter: { id: '20260613-130000' },
    name: '20260613-130000-target.md',
  });
  const source = change({
    stages: [
      { key: 'request', body: 'Discovered #20260613-130000 by reading another change.' },
      { key: 'plan', body: '' },
      { key: 'log', body: '' },
    ],
  });

  const { errors, warnings } = run([source, target]);
  assert.deepEqual(errors, []);
  assert.ok(
    msgs(warnings).includes(
      'mentions change "20260613-130000" without declaring it in depends_on or related_to',
    ),
  );
});

test('105456 CR9: classified, derived and non-semantic mentions do not warn', () => {
  const source = change({
    frontmatter: {
      depends_on: ['20260613-130001'],
      related_to: ['20260613-130002'],
    },
    stages: [
      {
        key: 'request',
        body: `Self 20260613-120000, dependency 20260613-130001, outgoing 20260613-130002,
incoming 20260613-130003, and unknown 20990101-000000.

\`\`\`
example 20260613-130004
\`\`\``,
      },
      { key: 'plan', body: '' },
      { key: 'log', body: 'Historical 20260613-130004.' },
    ],
  });
  const sibling = (id, over = {}) =>
    change({ frontmatter: { id, ...over }, name: `${id}-sibling.md` });
  // A `done`-but-unarchived and an archived-under-an-open-status source used to
  // sit in this same fixture as further exempt cases, via the function's own
  // (pre-162616) broader inline predicate. 162616 CR7 unifies on `frozenReason`,
  // which does not consider either shape frozen — see the dedicated test below.
  const changes = [
    source,
    sibling('20260613-130001'),
    sibling('20260613-130002'),
    sibling('20260613-130003', { related_to: ['20260613-120000'] }),
    sibling('20260613-130004'),
  ];

  const unclassified = run(changes).warnings.filter((warning) =>
    warning.message.startsWith('mentions change'),
  );
  assert.deepEqual(unclassified, []);
});

// 20260729-162616 CR7: `checkUnclassifiedMentions` used to exempt via its own
// inline `CLOSED_STATUSES.has(status) || archived === true`, broader than
// `frozenReason` (only `discarded`, or `done` AND `archived`). Unifying on
// `frozenReason` narrows the skip for exactly two shapes that the inline
// predicate treated as frozen but `frozenReason` does not: a `done` change
// that is not archived (still live work pending graduation/archive, per the
// comment on `frozenReason` itself), and an `archived: true` change under an
// open status (the comment on `frozenReason` already calls that combination an
// anomaly that "stays validated instead of hiding"). Both are now checked like
// any other change — this is a deliberate, documented behavioral consequence
// of CR7, not a regression.
test('162616 CR7: a done-unarchived change and an open-status-archived change are no longer exempt', () => {
  const closedSource = change({
    frontmatter: { id: '20260613-130005', status: 'done' },
    name: '20260613-130005-closed.md',
    stages: [
      { key: 'request', body: 'Legacy mention 20260613-130004.' },
      { key: 'plan', body: '' },
      { key: 'log', body: '' },
    ],
  });
  const archivedSource = change({
    frontmatter: { id: '20260613-130006', archived: true },
    name: '20260613-130006-archived.md',
    stages: [
      { key: 'request', body: 'Archived mention 20260613-130004.' },
      { key: 'plan', body: '' },
      { key: 'log', body: '' },
    ],
  });
  const target = change({
    frontmatter: { id: '20260613-130004' },
    name: '20260613-130004-target.md',
  });
  const { warnings } = run([closedSource, archivedSource, target]);
  const unclassified = warnings
    .filter((w) => w.message.startsWith('mentions change'))
    .map((w) => w.file)
    .sort();
  assert.deepEqual(unclassified, ['20260613-130005-closed.md', '20260613-130006-archived.md']);
});

test('CR6: duplicate ids are an error', () => {
  const a = change();
  const b = change({ name: '20260613-120000-y.md' });
  assert.ok(msgs(run([a, b]).errors).some((m) => /duplicate id/.test(m)));
});

test('150231 CR1: done with unfinished tasks is an error', () => {
  const c = change({
    frontmatter: { status: 'done' },
    tasks: [{ state: 'done', resolvedAt: '2026-06-13T12:01:00Z' }, { state: 'todo' }],
  });
  const { errors, warnings } = run([c]);
  assert.ok(msgs(errors).some((m) => /1 task\(s\) are not done/.test(m)));
  assert.ok(!msgs(warnings).some((m) => /not done/.test(m)));
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

test('111218 CR4: wrong-shaped config collections report errors instead of throwing', () => {
  const bad = { ...config, statuses: { draft: true } };
  const { errors } = checkRepo({ config: bad, changes: [change()] });
  assert.ok(msgs(errors).some((message) => message.includes('config "statuses" must be a list')));
});

// 20260924-184354 CR5 (check half) — `min_cli_version` only matters from
// schema 6 onward: schemas ≤5 (including the shared `config` fixture, which
// has no `schema_version` at all) keep today's behavior with no new
// diagnostic.
test('184354 CR5: min_cli_version is irrelevant below schema 6', () => {
  assert.deepEqual(checkRepo({ config, changes: [] }).errors, []);
  const schema5 = { ...config, schema_version: 5 };
  assert.deepEqual(checkRepo({ config: schema5, changes: [] }).errors, []);
});

test('184354 CR5: a missing min_cli_version at schema 6 is a named error', () => {
  const schema6 = { ...config, schema_version: 6 };
  const { errors } = checkRepo({ config: schema6, changes: [] });
  assert.ok(
    msgs(errors).some((m) => m.includes('min_cli_version') && m.includes('missing')),
    msgs(errors).join('\n'),
  );
});

// The requirement is "from schema 6 onward", not "exactly schema 6" — a
// schema past 6 (however that comes to exist) still needs it.
test('184354 CR5: a missing min_cli_version past schema 6 is still a named error', () => {
  const schema7 = { ...config, schema_version: 7 };
  const { errors } = checkRepo({ config: schema7, changes: [] });
  assert.ok(
    msgs(errors).some((m) => m.includes('min_cli_version') && m.includes('missing')),
    msgs(errors).join('\n'),
  );
});

test('184354 CR5: an invalid min_cli_version at schema 6 is a named error naming the value', () => {
  for (const bad of ['latest', 'v1.2.3', '1.2', '', 7]) {
    const schema6 = { ...config, schema_version: 6, min_cli_version: bad };
    const { errors } = checkRepo({ config: schema6, changes: [] });
    assert.ok(
      msgs(errors).some((m) => m.includes('min_cli_version') && m.includes(JSON.stringify(bad))),
      `bad=${JSON.stringify(bad)}: ${msgs(errors).join('\n')}`,
    );
  }
});

test('184354 CR5: a concrete SemVer (prereleases included) min_cli_version at schema 6 is valid', () => {
  for (const good of ['0.17.0', '1.2.3', '0.17.0-dev', '2.0.0-rc.1+build.5']) {
    const schema6 = { ...config, schema_version: 6, min_cli_version: good };
    const { errors } = checkRepo({ config: schema6, changes: [] });
    assert.deepEqual(
      msgs(errors).filter((m) => m.includes('min_cli_version')),
      [],
      `good=${good}: ${msgs(errors).join('\n')}`,
    );
  }
});

// Real-repo, command-level evidence for CR5: `changeledger check` itself
// fails closed and names the key plus the invalid/absent value, per CR5's
// Given/When/Then (the `status` half of CR5 is a later selection's guard).
test('184354 CR5: changeledger check fails closed on schema 6 with an invalid or absent min_cli_version', () => {
  for (const configText of [
    `${FROZEN_FIXTURE_BASE}min_cli_version: latest\n`,
    FROZEN_FIXTURE_BASE,
  ]) {
    const root = frozenFixture({}, {}, {}, configText);
    const { code, text } = runCheck(root);
    assert.equal(code, 1, text);
    assert.match(text, /min_cli_version/);
  }
});

test('20260731-161654 CR1: git must be a mapping without throwing or mutating config', () => {
  for (const git of ['dev', [], true]) {
    const candidate = { ...config, git };
    const before = structuredClone(candidate);
    let result;

    assert.doesNotThrow(() => {
      result = checkRepo({ config: candidate, changes: [] });
    });
    assert.deepEqual(msgs(result.errors), ['config "git" must be a mapping']);
    assert.deepEqual(candidate, before);
  }
});

test('20260731-161654 CR2: git.integration_branch errors match integrationBranch', () => {
  for (const bad of [7, false, [], '']) {
    const candidate = { ...config, git: { integration_branch: bad } };
    let accessorMessage;

    assert.throws(
      () => integrationBranch(candidate),
      (error) => {
        accessorMessage = error.message;
        return true;
      },
    );
    const { errors } = checkRepo({ config: candidate, changes: [] });
    assert.deepEqual(msgs(errors), [accessorMessage]);
  }
});

test('20260731-161654 CR3/CR4: optional and unknown git configuration stays untouched', () => {
  for (const candidate of [
    { ...config },
    { ...config, git: {} },
    { ...config, git: { integration_branch: null } },
    { ...config, git: { integration_branch: 'dev', provider_option: 'keep' } },
  ]) {
    const before = structuredClone(candidate);
    const { errors } = checkRepo({ config: candidate, changes: [] });

    assert.deepEqual(errors, []);
    assert.equal(integrationBranch(candidate), candidate.git?.integration_branch ?? undefined);
    assert.deepEqual(candidate, before);
  }
});

test('181346 CR1: check reports a malformed git.release_branch', () => {
  for (const bad of ['', '  ', 7, false, []]) {
    const candidate = { ...config, git: { integration_branch: 'dev', release_branch: bad } };
    const { errors } = checkRepo({ config: candidate, changes: [] });
    assert.deepEqual(msgs(errors), ['config "git.release_branch" must be a non-empty string']);
  }
  // A non-mapping `git` is reported once, not once per declared branch.
  const { errors } = checkRepo({ config: { ...config, git: 'main' }, changes: [] });
  assert.deepEqual(msgs(errors), ['config "git" must be a mapping']);
});

test('181346 CR2: check reports an integrates_into outside integration and release', () => {
  for (const bad of ['prod', '', null, true, ['release']]) {
    const subject = change({ frontmatter: { integrates_into: bad } });
    const { errors } = checkRepo({ config, changes: [subject] });
    assert.deepEqual(msgs(errors), ['integrates_into must be "integration" or "release"']);
  }
});

// 20261012-174310: a change integrating into the release branch is stuck while
// no release branch is declared, so `check` reports it on the change itself.
// Since 20261024-121022 the role is the change's own `integrates_into`.
const REQUIREMENT =
  'change 20260613-120000 integrates into git.release_branch, which is not declared — set git.release_branch in .changeledger/config.yml, for example "main"';
const hotfixConfig = (git) => ({
  ...config,
  statuses: [...config.statuses, 'discarded'],
  ...(git === undefined ? {} : { git }),
});
const hotfix = (status, { frontmatter, ...rest } = {}) =>
  change({ frontmatter: { integrates_into: 'release', status, ...frontmatter }, ...rest });

test('174310 CR2: a non-terminal release change without git.release_branch is one error on that change', () => {
  const open = hotfixConfig().statuses.filter((s) => s !== 'done' && s !== 'discarded');
  for (const git of [undefined, { release_branch: null }, { integration_branch: 'dev' }]) {
    for (const status of open) {
      const subject = hotfix(status);
      const { errors } = checkRepo({ config: hotfixConfig(git), changes: [subject] });
      assert.deepEqual(errors, [{ file: subject.name, message: REQUIREMENT }], `${status}`);
    }
  }
});

test('174310 CR3: done and discarded release changes are not reported', () => {
  const changes = [
    hotfix('done', { name: '20260613-120001-a.md', frontmatter: { id: '20260613-120001' } }),
    hotfix('discarded', { name: '20260613-120002-b.md', frontmatter: { id: '20260613-120002' } }),
  ];
  const { errors } = checkRepo({ config: hotfixConfig(), changes });
  assert.equal(
    errors.some((e) => e.message.includes('which is not declared')),
    false,
  );
});

test('174310 CR4: a declared release branch, no role or an integration role raise no error', () => {
  const cases = [
    [hotfixConfig({ release_branch: 'main' }), hotfix('draft')],
    [hotfixConfig(), change()],
    [hotfixConfig(), hotfix('draft', { frontmatter: { integrates_into: 'integration' } })],
  ];
  for (const [candidate, subject] of cases) {
    const { errors } = checkRepo({ config: candidate, changes: [subject] });
    assert.equal(
      errors.some((e) => e.message.includes('which is not declared')),
      false,
      msgs(errors).join('; '),
    );
  }
});

test('174310 CR2: a malformed git.release_branch is reported once, not once more per change', () => {
  const candidate = hotfixConfig({ release_branch: '' });
  const { errors } = checkRepo({ config: candidate, changes: [hotfix('draft')] });
  assert.deepEqual(msgs(errors), ['config "git.release_branch" must be a non-empty string']);
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

test('CR5: an auto-fixable defect hints at changeledger fix', () => {
  const text = [
    '---\nid: x\n---',
    '## Specification',
    '',
    '### CR1 — x',
    '',
    '- **Given** a',
    '- **When** b',
    '- **Then** c',
    '',
    '## Plan',
    '',
    '- [x] Update src/foo.mjs (CR1) - 2026-01-01T12:00:00Z',
    '',
  ].join('\n');
  const c = change({ text, frontmatter: { id: '20260613-120099' } });
  const { warnings } = run([c]);
  assert.ok(msgs(warnings).some((m) => /run: changeledger fix 20260613-120099/.test(m)));
});

test('CR5: a document with no auto-fixable defect gets no hint', () => {
  const text = [
    '---\nid: x\n---',
    '## Specification',
    '',
    '### CR1 — x',
    '',
    '- **Given** a',
    '- **When** b',
    '- **Then** c',
    '',
    '## Plan',
    '',
    '- [ ] Update src/foo.mjs; verify: pnpm test (CR1)',
    '',
  ].join('\n');
  const c = change({ text });
  const { warnings } = run([c]);
  assert.deepEqual(
    msgs(warnings).filter((m) => /run: changeledger fix/.test(m)),
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

test('103551 CR2: specs reject ATX CR headings at levels 1 through 6', () => {
  for (let level = 1; level <= 6; level += 1) {
    const heading = `${'#'.repeat(level)} CR${level} — Copied scenario`;
    const { errors } = runS([change()], [spec({ body: `# Arch\n\n${heading}\n` })]);
    assert.ok(
      msgs(errors).includes(
        `spec contains change-local criterion heading "CR${level}"; rewrite it as durable current truth`,
      ),
      heading,
    );
  }
});

test('103551 CR2 correction: specs reject Setext and nested CR headings', () => {
  const cases = [
    ['CR7 — Setext heading\n---', 'CR7'],
    ['> ### CR8 — Blockquoted heading', 'CR8'],
    ['- ### CR9 — List heading', 'CR9'],
    ['    ```\n### CR10 — Heading after indented code', 'CR10'],
  ];

  for (const [body, criterion] of cases) {
    const { errors } = runS([change()], [spec({ body })]);
    assert.ok(
      msgs(errors).includes(
        `spec contains change-local criterion heading "${criterion}"; rewrite it as durable current truth`,
      ),
      body,
    );
  }
});

test('103551 CR2 correction: prose and real code blocks remain valid', () => {
  const bodies = [
    'CR1 is mentioned as ordinary prose.',
    ['```markdown', '### CR2 — Fenced example', '```'].join('\n'),
    ['~~~markdown', '## CR3 — Tilde-fenced example', '~~~'].join('\n'),
    '    ### CR4 — Space-indented code',
    '\t### CR5 — Tab-indented code',
    ['````markdown', '### CR6 — Unclosed fence', '```` trailing', '### CR7 — Still code'].join(
      '\n',
    ),
  ];

  for (const body of bodies) {
    const { errors } = runS([change()], [spec({ body })]);
    assert.deepEqual(
      msgs(errors).filter((message) => /change-local criterion heading/.test(message)),
      [],
      body,
    );
  }
});

test('103551 CR2 correction: loaded specs preserve pseudo-fence indentation', () => {
  const root = frozenFixture(
    {},
    {
      'architecture.md': `---
title: Architecture
updated: 2026-08-06T00:00:00Z
tags: [architecture]
---
    \`\`\`
### CR33 — Visible after indented code
`,
    },
  );

  const { code, text } = runCheck(root);
  assert.equal(code, 1);
  assert.ok(
    text.includes(
      'spec contains change-local criterion heading "CR33"; rewrite it as durable current truth',
    ),
    text,
  );
});

// 20261023-094844: one error per visible criterion heading, each with its own
// stable text, so rewriting one heading removes exactly one error and leaves
// the others' text unchanged for the admission diff.
const TWO_CRITERIA_BODY =
  '# Verdad\n\n### CR1 — una verdad\n\nTexto.\n\n### CR2 — otra verdad\n\nMás.\n';
const TWO_CRITERIA_ERRORS = [
  'spec contains change-local criterion heading "CR1"; rewrite it as durable current truth',
  'spec contains change-local criterion heading "CR2"; rewrite it as durable current truth',
];

test('20261023-094844 CR1: a spec reports one error per criterion heading, in document order', () => {
  const { errors } = runS([change()], [spec({ name: 'verdad.md', body: TWO_CRITERIA_BODY })]);
  assert.deepEqual(msgs(errors.filter((e) => e.file === 'verdad.md')), TWO_CRITERIA_ERRORS);
});

test('20261023-094844 CR1: changeledger check prints both heading errors and fails', () => {
  const root = frozenFixture(
    {},
    {
      'verdad.md': `---\ntitle: Verdad\nupdated: 2026-08-06T00:00:00Z\ntags: [verdad]\n---\n${TWO_CRITERIA_BODY}`,
    },
  );

  const { code, text } = runCheck(root);
  assert.equal(code, 1);
  const printed = text.split('\n').filter((line) => /change-local criterion heading/.test(line));
  assert.equal(printed.length, 2, text);
  TWO_CRITERIA_ERRORS.forEach((message, index) => {
    assert.ok(printed[index].includes(message), text);
  });
});

// Round 1 found no test behind "one error per heading": a dedupe survived the
// suite and would have let an edit add a second `### CR1` to a spec that
// already has one. Two identical headings are two errors, and the admission
// diff is a multiset, so removing one of them leaves exactly one.
test('20261023-094844 CR1: a duplicated criterion heading is reported once per occurrence', () => {
  const { errors } = runS(
    [change()],
    [spec({ name: 'verdad.md', body: '# Verdad\n\n### CR1 — una\n\n### CR1 — otra vez\n' })],
  );
  assert.deepEqual(msgs(errors.filter((e) => e.file === 'verdad.md')), [
    TWO_CRITERIA_ERRORS[0],
    TWO_CRITERIA_ERRORS[0],
  ]);
});

test('20261023-094844 CR2: each heading form yields exactly one error, not only ATX level 3', () => {
  const forms = [
    '# CR1 — nivel 1',
    '###### CR1 — nivel 6',
    'CR1 — Setext\n---',
    '> ### CR1 — en cita',
    '- ### CR1 — en lista',
  ];
  for (const form of forms) {
    const { errors } = runS(
      [change()],
      [spec({ name: 'verdad.md', body: `# Verdad\n\n${form}\n` })],
    );
    assert.deepEqual(
      msgs(errors.filter((e) => e.file === 'verdad.md')),
      [TWO_CRITERIA_ERRORS[0]],
      form,
    );
  }
});

test('20261023-094844 CR2: a single criterion heading yields exactly one error with the same text', () => {
  const { errors } = runS(
    [change()],
    [spec({ name: 'verdad.md', body: '# Verdad\n\n### CR33 — algo\n' })],
  );
  assert.deepEqual(msgs(errors.filter((e) => e.file === 'verdad.md')), [
    'spec contains change-local criterion heading "CR33"; rewrite it as durable current truth',
  ]);
});

test('CR1: a change graduating to a missing spec is an error', () => {
  const c = change({
    stages: [
      { key: 'request' },
      { key: 'specification' },
      { key: 'plan' },
      {
        key: 'log',
        body: '- **2026-06-13T12:00:00Z** `[graduation]` spec: `ghost.md`\n',
      },
    ],
  });
  assert.ok(msgs(runS([c], []).errors).some((m) => /missing spec "ghost.md"/.test(m)));
});

test('212836 CR1/CR2: graduation marker examples outside Log do not create links', () => {
  const c = change({
    text: '## Request\n\nExample: graduado a spec `...`\n',
    stages: [
      { key: 'request', body: 'Example: graduado a spec `...`' },
      { key: 'specification' },
      { key: 'plan' },
      { key: 'log', body: '' },
    ],
  });
  assert.deepEqual(
    msgs(runS([c], []).errors).filter((m) => /graduated to a missing spec/.test(m)),
    [],
  );
});

test('212836 CR3: real graduation markers in Log are still validated', () => {
  const c = change({
    stages: [
      { key: 'request', body: 'Example: graduado a spec `...`' },
      { key: 'specification' },
      { key: 'plan' },
      { key: 'log', body: '- **2026-06-13T12:00:00Z** `[graduation]` spec: `ghost.md`' },
    ],
  });
  assert.ok(msgs(runS([c], []).errors).some((m) => /missing spec "ghost.md"/.test(m)));
});

test('CR1: a spec referencing a missing change is an error', () => {
  const s = spec({ frontmatter: { graduated_from: ['20990101-000000'] } });
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
  const c = change({
    frontmatter: { id: '20260613-120000' },
    stages: [
      { key: 'request' },
      { key: 'specification' },
      { key: 'plan' },
      { key: 'log', body: '- **2026-06-13T12:00:00Z** `[graduation]` spec: `arch.md`' },
    ],
  });
  const s = spec({ frontmatter: { graduated_from: ['20260613-120000'] } });
  assert.deepEqual(
    msgs(runS([c], [s]).warnings).filter((m) => /orphan/.test(m)),
    [],
  );
});

test('111457 CR9: one change can link bidirectionally to multiple curated specs', () => {
  const id = '20260613-120000';
  const c = change({
    frontmatter: { id },
    stages: [
      { key: 'request' },
      { key: 'plan' },
      {
        key: 'log',
        body: [
          '- **2026-06-13T12:00:00Z** `[graduation]` spec: `lifecycle.md`',
          '- **2026-06-13T12:00:00Z** `[graduation]` spec: `metrics.md`',
        ].join('\n'),
      },
    ],
  });
  const specs = [
    spec({ name: 'lifecycle.md', frontmatter: { graduated_from: [id] } }),
    spec({ name: 'metrics.md', frontmatter: { graduated_from: [id] } }),
  ];
  const { errors, warnings } = runS([c], specs);
  assert.deepEqual(errors, []);
  assert.deepEqual(
    msgs(warnings).filter((message) => /orphan/.test(message)),
    [],
  );
});

test('CR3: a stale updated is a warning', () => {
  const c = change({
    frontmatter: { id: '20260613-120000', created: '2026-06-13T10:00:00Z' },
    text: '---\n---\n## Log\n- **2026-06-20T10:00:00Z** `[graduation]` spec: `arch.md`\n',
    stages: [
      { key: 'request' },
      { key: 'specification' },
      { key: 'plan' },
      {
        key: 'log',
        body: '- **2026-06-20T10:00:00Z** `[graduation]` spec: `arch.md`\n',
      },
    ],
  });
  const s = spec({
    frontmatter: {
      updated: '2026-06-14T10:00:00Z',
      graduated_from: ['20260613-120000'],
    },
  });
  assert.ok(msgs(runS([c], [s]).warnings).some((m) => /older than linked change activity/.test(m)));
});

test('212319 CR1: archiving after graduation does not make the spec stale', () => {
  const c = change({
    frontmatter: { id: '20260613-120000', created: '2026-06-13T10:00:00Z' },
    text: `---\n---\n## Log
- **2026-06-13T12:00:00Z** \`[graduation]\` spec: \`arch.md\`
- **2026-06-20T10:00:00Z** \`[archive]\` archived
`,
    stages: [
      { key: 'request' },
      { key: 'specification' },
      { key: 'plan' },
      {
        key: 'log',
        body: `- **2026-06-13T12:00:00Z** \`[graduation]\` spec: \`arch.md\`
- **2026-06-20T10:00:00Z** \`[archive]\` archived`,
      },
    ],
  });
  const s = spec({
    frontmatter: {
      updated: '2026-06-14T10:00:00Z',
      graduated_from: ['20260613-120000'],
    },
  });
  assert.deepEqual(
    msgs(runS([c], [s]).warnings).filter((m) => /older than linked change activity/.test(m)),
    [],
  );
});

test('CR3: a non-ISO updated is an error', () => {
  const s = spec({ frontmatter: { updated: '2026-06-13' } });
  assert.ok(msgs(runS([change()], [s]).errors).some((m) => /updated not ISO/.test(m)));
});

test('111457 CR4: graduated_from must be a list', () => {
  const s = spec({ frontmatter: { graduated_from: '20260613-120000' } });
  assert.ok(msgs(runS([change()], [s]).errors).includes('graduated_from must be a list'));
});

test('111457 CR4: a spec must name every change whose Log graduates into it', () => {
  const c = change({
    frontmatter: { id: '20260613-120000' },
    stages: [
      { key: 'request' },
      { key: 'specification' },
      { key: 'plan' },
      { key: 'log', body: '- **2026-06-13T12:00:00Z** `[graduation]` spec: `arch.md`' },
    ],
  });
  assert.ok(
    msgs(runS([c], [spec({ frontmatter: { graduated_from: [] } })]).errors).includes(
      'spec "arch.md" missing graduated_from "20260613-120000"',
    ),
  );
});

test('111457 CR4: graduated_from must link back to the same spec', () => {
  const c = change({
    frontmatter: { id: '20260613-120000' },
    stages: [
      { key: 'request' },
      { key: 'specification' },
      { key: 'plan' },
      { key: 'log', body: '- **2026-06-13T12:00:00Z** `[graduation]` spec: `other.md`' },
    ],
  });
  const specs = [
    spec({ frontmatter: { graduated_from: ['20260613-120000'] } }),
    spec({ name: 'other.md', frontmatter: { graduated_from: ['20260613-120000'] } }),
  ];
  assert.ok(
    msgs(runS([c], specs).errors).includes(
      'graduated_from "20260613-120000" does not link back to spec "arch.md"',
    ),
  );
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

test('151221 CR2 / 125007 CR1: done task descriptions may contain an em dash', () => {
  const text = `---
id: "20260613-120000"
title: X
type: change
status: done
created: 2026-06-13T12:00:00Z
depends_on: []
---

## Request

X

## Plan

- [x] Keep the phrase — do not truncate it (CR1)
  - **Resolved:** \`2026-06-13T12:01:00Z\`

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

// --- Plan task references to Specification criteria ---

const tddConfig = {
  changes_dir: '.changeledger/changes',
  statuses: ['draft', 'approved', 'in-progress', 'in-review', 'done'],
  tdd: true,
};

function cov(over = {}) {
  return {
    name: '20260613-120000-x.md',
    frontmatter: {
      id: '20260613-120000',
      title: 'X',
      type: 'change',
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

const covResult = (text, cfg = tddConfig) => {
  const parsed = parseChange(text);
  return checkRepo({
    config: cfg,
    changes: [{ name: '20260613-120000-x.md', text, ...parsed }],
  });
};

test('162014 CR1: a task referencing an undeclared criterion is an error', () => {
  const { errors, warnings } = covResult(`---
id: "20260613-120000"
title: X
type: change
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

- [ ] Update src/check.mjs and test/check.test.mjs
  - **Target:** src/check.mjs
  - **Verify:** test/check.test.mjs
  - **Criteria:** CR999

## Log
`);
  assert.ok(msgs(errors).some((m) => /Plan task references unknown criterion "CR999"/.test(m)));
  assert.deepEqual(
    msgs(warnings).filter((m) => /unknown criterion/.test(m)),
    [],
  );
});

test('162014 CR2: a task referencing a declared criterion is valid', () => {
  const { errors } = covResult(`---
id: "20260613-120000"
title: X
type: change
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

- [ ] Update src/check.mjs and test/check.test.mjs
  - **Target:** src/check.mjs
  - **Verify:** test/check.test.mjs
  - **Criteria:** CR1

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
type: change
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

- [ ] Update src/check.mjs and test/check.test.mjs
  - **Target:** src/check.mjs
  - **Verify:** test/check.test.mjs
  - **Criteria:** CR1, CR2, CR404

## Log
`);
  assert.ok(msgs(errors).some((m) => /Plan task references unknown criterion "CR2"/.test(m)));
  assert.ok(msgs(errors).some((m) => /Plan task references unknown criterion "CR404"/.test(m)));
});

// 20260729-203257 CR2: an undecidable Plan line reaches the operator through the
// existing `taskIssues` channel — an error at any open status.
test('203257 CR2: an unrecognized Plan line is an error on an open change', () => {
  const { errors } = covResult(`---
id: "20260613-120000"
title: X
type: change
status: draft
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

- [ ] Implement the behavior
  - **Target:** src/check.mjs
  - **Verify:** test/check.test.mjs
  - **Criteria:** CR1
Prosa suelta que no es tarea

## Log
`);
  assert.ok(
    msgs(errors).includes('unrecognized Plan line: "Prosa suelta que no es tarea"'),
    `expected the named issue, got ${JSON.stringify(msgs(errors))}`,
  );
});

test('203257 CR2: a frozen change with the same line emits no diagnostic', () => {
  const text = `---
id: "20260613-120000"
title: X
type: change
status: done
archived: true
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

- [x] Implement the behavior
  - **Criteria:** CR1
  - **Resolved:** \`2026-06-13T13:00:00Z\`
Prosa suelta que no es tarea

## Log
`;
  const { errors, warnings } = covResult(text);
  assert.deepEqual(
    [...msgs(errors), ...msgs(warnings)].filter((m) => /unrecognized Plan line/.test(m)),
    [],
  );
});

// 20260711-103756 CR3: the `quick` lane scaffolds only request+log — check
// must accept it with no diagnostics for the deactivated stages.
test('103756 CR3: a valid change with only request and log passes clean', () => {
  const cfg = config;
  const c = {
    name: '20260613-120000-x.md',
    frontmatter: {
      id: '20260613-120000',
      title: 'X',
      type: 'change',
      status: 'in-progress',
      created: '2026-06-13T12:00:00Z',
      depends_on: [],
    },
    stages: [{ key: 'request' }, { key: 'log' }],
    tasks: [],
    criteria: [],
  };
  const { errors, warnings } = checkRepo({ config: cfg, changes: [c] });
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
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

// 20260630-225210 — lifecycle sequence validation over ## Log.
function seqChange(status, logLines) {
  return `---
id: "20260613-120000"
title: x
type: change
status: ${status}
created: 2026-06-13T12:00:00Z
depends_on: []
---

## Request

r

## Specification

### CR1 — c
- **Given** a
- **When** b
- **Then** c

## Plan

- [ ] Update \`src/a.mjs\`
  - **Target:** \`src/a.mjs\`
  - **Verify:** \`node --test test/a.test.mjs\`
  - **Criteria:** CR1

## Log

${logLines.join('\n')}
`;
}

test('225210 CR1: a repeated review verdict after delivery is an error with line and expectation', () => {
  const text = seqChange('done', [
    '- **2026-06-13T12:10:00Z** `[status]` draft → approved',
    '- **2026-06-13T12:20:00Z** `[status]` approved → in-progress',
    '- **2026-06-13T12:30:00Z** `[status]` in-progress → in-review',
    '- **2026-06-13T12:40:00Z** `[review]` in-review → done (delegated subagent, clean context)',
    '- **2026-06-13T12:50:00Z** `[review]` in-review → done (delegated subagent, clean context)',
  ]);
  const e = msgs(covResult(text).errors);
  assert.ok(
    e.some((m) =>
      /Log line \d+: transition "in-review → done" starts from "in-review" but the reconstructed status is "done"/.test(
        m,
      ),
    ),
    e.join('\n'),
  );
});

test('225210 CR2: canonical sequences pass; self-loops, skips and final mismatch fail', () => {
  const ok = seqChange('done', [
    '- **2026-06-13T12:10:00Z** `[status]` draft → approved',
    '- **2026-06-13T12:20:00Z** `[status]` approved → in-progress',
    '- **2026-06-13T12:30:00Z** `[status]` in-progress → in-review',
    '- **2026-06-13T12:40:00Z** `[review]` in-review → in-progress: reason',
    '- **2026-06-13T12:45:00Z** `[status]` in-progress → in-review',
    '- **2026-06-13T12:50:00Z** `[review]` in-review → done (delegated subagent, clean context)',
  ]);
  assert.deepEqual(
    msgs(covResult(ok).errors).filter((m) => /Log line/.test(m)),
    [],
  );

  const selfLoop = seqChange('in-progress', [
    '- **2026-06-13T12:10:00Z** `[status]` draft → approved',
    '- **2026-06-13T12:20:00Z** `[status]` approved → in-progress',
    '- **2026-06-13T12:30:00Z** `[status]` in-progress → in-progress',
  ]);
  assert.ok(
    msgs(covResult(selfLoop).errors).some((m) =>
      /Log line \d+: invalid lifecycle transition "in-progress → in-progress"/.test(m),
    ),
  );

  const skip = seqChange('done', ['- **2026-06-13T12:10:00Z** `[status]` draft → done']);
  assert.ok(
    msgs(covResult(skip).errors).some((m) =>
      /Log line \d+: invalid lifecycle transition "draft → done"/.test(m),
    ),
  );

  const mismatch = seqChange('done', ['- **2026-06-13T12:10:00Z** `[status]` draft → approved']);
  assert.ok(
    msgs(covResult(mismatch).errors).some((m) =>
      /Log reconstructs status "approved" but frontmatter says "done"/.test(m),
    ),
  );
});

test('150232 CR6: sequence validation accepts a return from done followed by normal gates', () => {
  const text = seqChange('done', [
    '- **2026-06-13T12:10:00Z** `[status]` draft → approved',
    '- **2026-06-13T12:20:00Z** `[status]` approved → in-progress',
    '- **2026-06-13T12:30:00Z** `[status]` in-progress → in-review',
    '- **2026-06-13T12:40:00Z** `[review]` in-review → done (delegated subagent, clean context)',
    '- **2026-06-13T13:00:00Z** `[status]` done → in-progress (human reopened): fix',
    '- **2026-06-13T13:10:00Z** `[status]` in-progress → in-review',
    '- **2026-06-13T13:20:00Z** `[review]` in-review → done (delegated subagent, clean context)',
  ]);
  assert.deepEqual(
    msgs(covResult(text).errors).filter((m) => /Log line|reconstructs status/.test(m)),
    [],
  );
});

// 20261018-131621 — the legacy-edge decision for the two retired statuses:
// `LEGACY_EDGES` was NOT widened for them. `checkLifecycleSequence` already
// abandons the replay at the first event naming a status the graph does not
// model, so a Log written under the old contract is tolerated by that same
// rule — the one the contract has always used for custom statuses — instead of
// by a second, parallel allowance that would have to be carried forever.
test('20261018-131621: a live Log naming a retired status is tolerated, not diagnosed', () => {
  const text = seqChange('done', [
    '- **2026-06-13T12:10:00Z** `[status]` draft → approved',
    '- **2026-06-13T12:20:00Z** `[status]` approved → in-progress',
    '- **2026-06-13T12:30:00Z** `[status]` in-progress → in-review',
    '- **2026-06-13T12:40:00Z** `[review]` in-review → in-validation (delegated subagent, clean context)',
    '- **2026-06-13T12:50:00Z** `[validation]` in-validation → done (human accepted)',
  ]);
  assert.deepEqual(
    msgs(covResult(text).errors).filter((m) => /Log line|reconstructs status/.test(m)),
    [],
  );
});

// The review close this used to admit is now the defect 20261019-184719 CR1
// names: `in-review → done` is canonical, so a `[status]` form is a delivery
// that skipped the verdict, not readable history. The direct close is still
// legal history — and canonical today, which is why it no longer needs
// `LEGACY_EDGES` either.
test('225210 CR3: the bounded legacy direct close stays readable, not an error', () => {
  const legacyDirectClose = seqChange('done', [
    '- **2026-06-13T12:10:00Z** `[status]` draft → approved',
    '- **2026-06-13T12:20:00Z** `[status]` approved → in-progress',
    '- **2026-06-13T12:30:00Z** `[status]` in-progress → done',
  ]);
  assert.deepEqual(
    msgs(covResult(legacyDirectClose).errors).filter((m) => /Log/.test(m)),
    [],
  );
});

// --- check --commits (20260711-103757): commit-message lint over a git range ---

// This suite may itself run inside this repo's own pre-commit hook, which
// exports GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE for the outer repo. Left
// inherited, every git call below would silently operate on the outer repo
// instead of the scratch fixture — strip them so tests are hook-safe.
const GIT_FIXTURE_ENV = sanitizedEnv();

function gitFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-check-commits-'));
  const git = (args) =>
    execFileSync('git', args, { cwd: root, env: GIT_FIXTURE_ENV, encoding: 'utf8' });
  initGitFixture(root, { args: ['-b', 'main'] });
  git(['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(root, 'README.md'), 'x\n');
  git(['add', 'README.md']);
  git(['commit', '-q', '-m', 'chore: base [#20260101-000000]']);
  return { root, git };
}

function captureOutput() {
  const calls = [];
  const diagnostics = [];
  return {
    calls,
    diagnostics,
    log: (m) => calls.push(m),
    warn: (m) => diagnostics.push(m),
    error: (m) => diagnostics.push(m),
  };
}

test('CR5: check --commits reports only the commit missing the marker', () => {
  const { root, git } = gitFixture();
  git(['checkout', '-q', '-b', 'feature']);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  git(['add', 'a.txt']);
  git(['commit', '-q', '-m', 'feat(x): with marker [#20260711-000001]']);
  fs.writeFileSync(path.join(root, 'b.txt'), 'b\n');
  git(['add', 'b.txt']);
  git(['commit', '-q', '-m', 'feat(x): missing marker']);
  const sha = git(['rev-parse', '--short', 'HEAD']).trim();

  const out = captureOutput();
  const code = check(['--commits', 'main', '--json'], root, out);

  assert.equal(code, 1);
  const parsed = JSON.parse(out.calls.at(-1));
  assert.equal(parsed.errors.length, 1);
  assert.match(parsed.errors[0].message, new RegExp(sha));
  assert.match(parsed.errors[0].message, /missing \[#id\] marker/);
});

test('CR6: merges and chore(release) prep are exempt from the lint', () => {
  const { root, git } = gitFixture();
  const base = git(['rev-parse', 'HEAD']).trim();

  git(['checkout', '-q', '-b', 'feature']);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  git(['add', 'a.txt']);
  git(['commit', '-q', '-m', 'feat(x): with marker [#20260711-000001]']);

  git(['checkout', '-q', 'main']);
  fs.writeFileSync(path.join(root, 'c.txt'), 'c\n');
  git(['add', 'c.txt']);
  git(['commit', '-q', '-m', 'chore(release): prepare ChangeLedger 1.0.0']);

  git(['merge', '-q', '--no-ff', '-m', 'Merge feature', 'feature']);

  const out = captureOutput();
  const code = check(['--commits', base, '--json'], root, out);

  assert.equal(code, 0);
  const parsed = JSON.parse(out.calls.at(-1));
  assert.deepEqual(parsed.errors, []);
});

test('225638 CR3: check --commits accepts canonical multi-change markers in the body', () => {
  const { root, git } = gitFixture();
  git(['checkout', '-q', '-b', 'feature']);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  git(['add', 'a.txt']);
  git(['commit', '-q', '-m', 'docs(context): checkpoint', '-m', 'ChangeLedger: [#A] [#B]']);

  const out = captureOutput();
  const code = check(['--commits', 'main', '--json'], root, out);
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(out.calls.at(-1)).errors, []);
});

test('225638 CR4: check --commits rejects multi-change subjects and malformed body lines', () => {
  const { root, git } = gitFixture();
  git(['checkout', '-q', '-b', 'feature']);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  git(['add', 'a.txt']);
  git(['commit', '-q', '-m', 'docs(context): old shape [#A] [#B]']);
  fs.writeFileSync(path.join(root, 'b.txt'), 'b\n');
  git(['add', 'b.txt']);
  git(['commit', '-q', '-m', 'docs(context): malformed body', '-m', 'ChangeLedger: [#A], [#B]']);

  const out = captureOutput();
  const code = check(['--commits', 'main', '--json'], root, out);
  assert.equal(code, 1);
  const errors = JSON.parse(out.calls.at(-1))
    .errors.map((error) => error.message)
    .join('\n');
  assert.match(errors, /multiple \[#id\] markers.*body/);
  assert.match(errors, /malformed ChangeLedger body/);
});

// --- ChangeLedger: none — <reason> operational commit exemption (20260728-151336 CR1-CR3) ---

test('151336 CR1: ChangeLedger: none with a reason exempts the commit', () => {
  const { root, git } = gitFixture();
  git(['checkout', '-q', '-b', 'feature']);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  git(['add', 'a.txt']);
  git([
    'commit',
    '-q',
    '-m',
    'docs(workflow): record the findings sieve',
    '-m',
    'ChangeLedger: none — acta de análisis, ningún change la cubre',
  ]);

  const out = captureOutput();
  const code = check(['--commits', 'main', '--json'], root, out);
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(out.calls.at(-1)).errors, []);
});

test('151336 CR1: an identical commit without the declaration still reports missing marker', () => {
  const { root, git } = gitFixture();
  git(['checkout', '-q', '-b', 'feature']);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  git(['add', 'a.txt']);
  git(['commit', '-q', '-m', 'docs(workflow): record the findings sieve']);
  const sha = git(['rev-parse', '--short', 'HEAD']).trim();

  const out = captureOutput();
  const code = check(['--commits', 'main', '--json'], root, out);
  assert.equal(code, 1);
  const parsed = JSON.parse(out.calls.at(-1));
  assert.equal(parsed.errors.length, 1);
  assert.equal(
    parsed.errors[0].message,
    `${sha} missing [#id] marker: "docs(workflow): record the findings sieve"`,
  );
});

test('151336 CR2: ChangeLedger: none without a reason is an error', () => {
  const { root, git } = gitFixture();
  git(['checkout', '-q', '-b', 'feature']);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  git(['add', 'a.txt']);
  git([
    'commit',
    '-q',
    '-m',
    'docs(workflow): record the findings sieve',
    '-m',
    'ChangeLedger: none',
  ]);
  const sha = git(['rev-parse', '--short', 'HEAD']).trim();

  const out = captureOutput();
  const code = check(['--commits', 'main', '--json'], root, out);
  assert.equal(code, 1);
  const parsed = JSON.parse(out.calls.at(-1));
  assert.equal(parsed.errors.length, 1);
  assert.equal(
    parsed.errors[0].message,
    `${sha} ChangeLedger: none requires a reason: "docs(workflow): record the findings sieve"`,
  );
});

test('151336 CR3: ChangeLedger: none cannot coexist with a subject marker', () => {
  const { root, git } = gitFixture();
  git(['checkout', '-q', '-b', 'feature']);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  git(['add', 'a.txt']);
  git([
    'commit',
    '-q',
    '-m',
    'docs(workflow): record the findings sieve [#20260728-151336]',
    '-m',
    'ChangeLedger: none — acta de análisis, ningún change la cubre',
  ]);
  const sha = git(['rev-parse', '--short', 'HEAD']).trim();

  const out = captureOutput();
  const code = check(['--commits', 'main', '--json'], root, out);
  assert.equal(code, 1);
  const parsed = JSON.parse(out.calls.at(-1));
  assert.equal(parsed.errors.length, 1);
  assert.equal(
    parsed.errors[0].message,
    `${sha} ChangeLedger: none cannot coexist with an [#id] marker: "docs(workflow): record the findings sieve [#20260728-151336]"`,
  );
});

// Ambiguous shapes near the grammar boundary — each is pinned deliberately,
// not left to fall through silently (see AGENTS.md on the defect class this
// repo keeps hitting: an exemption that activates on a form nobody intended).

test('151336: leading/trailing whitespace around the declaration line is still accepted', () => {
  const { root, git } = gitFixture();
  git(['checkout', '-q', '-b', 'feature']);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  git(['add', 'a.txt']);
  git([
    'commit',
    '-q',
    '-m',
    'docs(workflow): record the findings sieve',
    '-m',
    '   ChangeLedger: none — acta de análisis, ningún change la cubre   ',
  ]);

  const out = captureOutput();
  const code = check(['--commits', 'main', '--json'], root, out);
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(out.calls.at(-1)).errors, []);
});

test('151336: the declaration among other body lines is rejected, not silently matched', () => {
  const { root, git } = gitFixture();
  git(['checkout', '-q', '-b', 'feature']);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  git(['add', 'a.txt']);
  git([
    'commit',
    '-q',
    '-m',
    'docs(workflow): record the findings sieve',
    '-m',
    'Explanation paragraph unrelated to the declaration.',
    '-m',
    'ChangeLedger: none — acta de análisis',
  ]);

  const out = captureOutput();
  const code = check(['--commits', 'main', '--json'], root, out);
  assert.equal(code, 1);
  const parsed = JSON.parse(out.calls.at(-1));
  assert.equal(parsed.errors.length, 1);
  assert.match(parsed.errors[0].message, /malformed ChangeLedger body/);
});

test('151336: a reason that is only whitespace is rejected, not treated as present', () => {
  const { root, git } = gitFixture();
  git(['checkout', '-q', '-b', 'feature']);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  git(['add', 'a.txt']);
  git([
    'commit',
    '-q',
    '-m',
    'docs(workflow): record the findings sieve',
    '-m',
    'ChangeLedger: none —    ',
  ]);

  const out = captureOutput();
  const code = check(['--commits', 'main', '--json'], root, out);
  assert.equal(code, 1);
  const parsed = JSON.parse(out.calls.at(-1));
  assert.equal(parsed.errors.length, 1);
  assert.match(parsed.errors[0].message, /malformed ChangeLedger body/);
});

// Pins the `\S` in NONE_REASON_RE, which the review found to be a surviving
// mutant: `body.trim()` in commitsInRange already rejects a wholly blank reason,
// so `\S`'s only observable effect is refusing padding between the em dash and a
// real reason. Without this test, relaxing `(\S.*)` to `(.*)` leaves the suite
// green and the declaration's single-space grammar stops being enforced.
test('151336: extra whitespace between the em dash and the reason is rejected', () => {
  const { root, git } = gitFixture();
  git(['checkout', '-q', '-b', 'feature']);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  git(['add', 'a.txt']);
  git([
    'commit',
    '-q',
    '-m',
    'docs(workflow): record the findings sieve',
    '-m',
    'ChangeLedger: none —  padded reason',
  ]);

  const out = captureOutput();
  const code = check(['--commits', 'main', '--json'], root, out);
  assert.equal(code, 1);
  const parsed = JSON.parse(out.calls.at(-1));
  assert.equal(parsed.errors.length, 1);
  assert.match(parsed.errors[0].message, /malformed ChangeLedger body/);
});

test('151336: a plain hyphen instead of an em dash is rejected', () => {
  const { root, git } = gitFixture();
  git(['checkout', '-q', '-b', 'feature']);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  git(['add', 'a.txt']);
  git([
    'commit',
    '-q',
    '-m',
    'docs(workflow): record the findings sieve',
    '-m',
    'ChangeLedger: none - acta de análisis',
  ]);

  const out = captureOutput();
  const code = check(['--commits', 'main', '--json'], root, out);
  assert.equal(code, 1);
  const parsed = JSON.parse(out.calls.at(-1));
  assert.equal(parsed.errors.length, 1);
  assert.match(parsed.errors[0].message, /malformed ChangeLedger body/);
});

test('151336: ChangeLedger: none appearing inside a longer line is rejected', () => {
  const { root, git } = gitFixture();
  git(['checkout', '-q', '-b', 'feature']);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  git(['add', 'a.txt']);
  git([
    'commit',
    '-q',
    '-m',
    'docs(workflow): record the findings sieve',
    '-m',
    'See ChangeLedger: none for context, no reason needed',
  ]);

  const out = captureOutput();
  const code = check(['--commits', 'main', '--json'], root, out);
  assert.equal(code, 1);
  const parsed = JSON.parse(out.calls.at(-1));
  assert.equal(parsed.errors.length, 1);
  assert.match(parsed.errors[0].message, /malformed ChangeLedger body/);
});

test('151336: the declaration appearing twice in the body is rejected', () => {
  const { root, git } = gitFixture();
  git(['checkout', '-q', '-b', 'feature']);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  git(['add', 'a.txt']);
  git([
    'commit',
    '-q',
    '-m',
    'docs(workflow): record the findings sieve',
    '-m',
    'ChangeLedger: none — first reason',
    '-m',
    'ChangeLedger: none — second reason',
  ]);

  const out = captureOutput();
  const code = check(['--commits', 'main', '--json'], root, out);
  assert.equal(code, 1);
  const parsed = JSON.parse(out.calls.at(-1));
  assert.equal(parsed.errors.length, 1);
  assert.match(parsed.errors[0].message, /malformed ChangeLedger body/);
});

// --- the declaration is the first body line, the tail is free text
//     (20260730-002341 CR3-CR4) ---

test('002341 CR3: a multi-id declaration admits a why paragraph and a trailer below it', () => {
  const { root, git } = gitFixture();
  git(['checkout', '-q', '-b', 'feature']);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  git(['add', 'a.txt']);
  git([
    'commit',
    '-q',
    '-m',
    'docs(context): checkpoint',
    '-m',
    'ChangeLedger: [#A] [#B]',
    '-m',
    'Both changes needed the same edit, so one commit carries them.',
    '-m',
    'Co-Authored-By: Someone <someone@example.com>',
  ]);

  const out = captureOutput();
  const code = check(['--commits', 'main', '--json'], root, out);
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(out.calls.at(-1)).errors, []);
});

test('002341 CR3: a ChangeLedger: none declaration admits a why paragraph below it', () => {
  const { root, git } = gitFixture();
  git(['checkout', '-q', '-b', 'feature']);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  git(['add', 'a.txt']);
  git([
    'commit',
    '-q',
    '-m',
    'chore: tidy',
    '-m',
    'ChangeLedger: none — housekeeping, no change covers it',
    '-m',
    'Removed a stale fixture left behind by an earlier run.',
  ]);

  const out = captureOutput();
  const code = check(['--commits', 'main', '--json'], root, out);
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(out.calls.at(-1)).errors, []);
});

// The free tail must not become the escape route the whole-body anchor used to
// block: a declaration only counts in the head position, and a second one
// anywhere below is a conflict, not prose — even when prose separates the two.
test('002341 CR4: a multi-id declaration buried under another line is still malformed', () => {
  const { root, git } = gitFixture();
  git(['checkout', '-q', '-b', 'feature']);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  git(['add', 'a.txt']);
  git([
    'commit',
    '-q',
    '-m',
    'docs(context): checkpoint',
    '-m',
    'Explanation paragraph unrelated to the declaration.',
    '-m',
    'ChangeLedger: [#A] [#B]',
  ]);

  const out = captureOutput();
  const code = check(['--commits', 'main', '--json'], root, out);
  assert.equal(code, 1);
  const parsed = JSON.parse(out.calls.at(-1));
  assert.equal(parsed.errors.length, 1);
  assert.match(parsed.errors[0].message, /malformed ChangeLedger body/);
});

test('002341 CR4: a second declaration separated by prose is still malformed', () => {
  const { root, git } = gitFixture();
  git(['checkout', '-q', '-b', 'feature']);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  git(['add', 'a.txt']);
  git([
    'commit',
    '-q',
    '-m',
    'docs(context): checkpoint',
    '-m',
    'ChangeLedger: [#A] [#B]',
    '-m',
    'A why paragraph sitting between the two declarations.',
    '-m',
    'ChangeLedger: none — and now it claims no change covers it',
  ]);

  const out = captureOutput();
  const code = check(['--commits', 'main', '--json'], root, out);
  assert.equal(code, 1);
  const parsed = JSON.parse(out.calls.at(-1));
  assert.equal(parsed.errors.length, 1);
  assert.match(parsed.errors[0].message, /malformed ChangeLedger body/);
});

// Pins the `.trim()` on each tail line: without it an indented second
// declaration reads as prose and the first one still exempts the commit, so the
// conflicting-declaration route reopens with the suite green.
test('002341 CR4: an indented second declaration is still malformed', () => {
  const { root, git } = gitFixture();
  git(['checkout', '-q', '-b', 'feature']);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  git(['add', 'a.txt']);
  git([
    'commit',
    '-q',
    '-m',
    'docs(context): checkpoint',
    '-m',
    'ChangeLedger: [#A] [#B]',
    '-m',
    '  ChangeLedger: none — indented, so easily mistaken for prose',
  ]);

  const out = captureOutput();
  const code = check(['--commits', 'main', '--json'], root, out);
  assert.equal(code, 1);
  const parsed = JSON.parse(out.calls.at(-1));
  assert.equal(parsed.errors.length, 1);
  assert.match(parsed.errors[0].message, /malformed ChangeLedger body/);
});

// --- check --commits base from config (20260711-210115 CR1) ---

test('210115 CR1: configured git.integration_branch is the default lint base', () => {
  const { root, git } = gitFixture();
  // A marker-less commit below `dev` must stay outside the linted range.
  fs.writeFileSync(path.join(root, 'pre.txt'), 'pre\n');
  git(['add', 'pre.txt']);
  git(['commit', '-q', '-m', 'feat(x): historical commit without marker']);
  git(['branch', 'dev']);

  fs.mkdirSync(path.join(root, '.changeledger'));
  fs.writeFileSync(
    path.join(root, '.changeledger', 'config.yml'),
    'git:\n  integration_branch: dev\n',
  );

  git(['checkout', '-q', '-b', 'feature']);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  git(['add', 'a.txt']);
  git(['commit', '-q', '-m', 'feat(x): missing marker on branch']);
  const sha = git(['rev-parse', '--short', 'HEAD']).trim();

  const out = captureOutput();
  const code = check(['--commits'], root, out);

  assert.equal(code, 1);
  assert.ok(
    out.calls.some((line) => line.includes('commits dev..HEAD')),
    out.calls.join('\n'),
  );
  const errOut = captureOutput();
  const jsonCode = check(['--commits', '--json'], root, errOut);
  assert.equal(jsonCode, 1);
  const parsed = JSON.parse(errOut.calls.at(-1));
  assert.equal(parsed.errors.length, 1);
  assert.match(parsed.errors[0].message, new RegExp(sha));
});

test('20260809-113242 CR2: activated config supplies the default commit-lint base', () => {
  const { root, git } = gitFixture();
  git(['branch', 'dev']);
  fs.mkdirSync(path.join(root, '.changeledger'));
  fs.writeFileSync(
    path.join(root, '.changeledger', 'config.yml'),
    'project_id: demo\ngit:\n  integration_branch: main\n',
  );
  const tree = buildTree(root, {
    '.changeledger-state/manifest.yml': 'format_version: 1\nproject_id: demo\n',
    '.changeledger-state/config.yml': 'project_id: demo\ngit:\n  integration_branch: dev\n',
  });
  const revision = commitTree(root, tree);
  updateRef(root, STATE_REF, revision);
  writeActivation(root, { stateRef: STATE_REF });
  git(['checkout', '-q', '-b', 'feature']);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  git(['add', 'a.txt']);
  git(['commit', '-q', '-m', 'feat(x): with marker [#20260809-113242]']);

  const out = captureOutput();
  assert.equal(check(['--commits'], root, out), 0);
  assert.ok(
    out.calls.some((line) => line.includes('commits dev..HEAD')),
    out.calls.join('\n'),
  );
});

test('210115 CR1: without the key the base stays the current auto-detection', () => {
  const { root, git } = gitFixture();
  fs.mkdirSync(path.join(root, '.changeledger'));
  fs.writeFileSync(path.join(root, '.changeledger', 'config.yml'), 'language: en\n');

  git(['checkout', '-q', '-b', 'feature']);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  git(['add', 'a.txt']);
  git(['commit', '-q', '-m', 'feat(x): with marker [#20260711-000001]']);

  const out = captureOutput();
  const code = check(['--commits'], root, out);

  assert.equal(code, 0);
  assert.ok(
    out.calls.some((line) => line.includes('commits main..HEAD')),
    out.calls.join('\n'),
  );
});

// --- frozen history (20260726-194220): archived/discarded documents are not
// validated as subjects, but keep feeding every repo-wide invariant ---

const FROZEN_FIXTURE_BASE = `schema_version: 7
language: en
tdd: true
changes_dir: .changeledger/changes
specs_dir: .changeledger/specs
statuses: [draft, approved, in-progress, in-review, done, discarded]
`;
const FROZEN_FIXTURE_CONFIG = `${FROZEN_FIXTURE_BASE}min_cli_version: ${VERSION}\n`;

// Repo-wide `check` reads the contract bootstrap and the config from disk, so
// these criteria need a real repo instead of an in-memory one.
function frozenFixture(
  changeFiles,
  specFiles = {},
  releaseFiles = {},
  configText = FROZEN_FIXTURE_CONFIG,
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-frozen-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Project rules\n');
  ensureReference(root);
  fs.mkdirSync(path.join(root, '.changeledger', 'changes'), { recursive: true });
  fs.writeFileSync(path.join(root, '.changeledger', 'config.yml'), configText);
  for (const [name, text] of Object.entries(changeFiles)) {
    fs.writeFileSync(path.join(root, '.changeledger', 'changes', name), text);
  }
  if (Object.keys(specFiles).length) {
    fs.mkdirSync(path.join(root, '.changeledger', 'specs'), { recursive: true });
    for (const [name, text] of Object.entries(specFiles)) {
      fs.writeFileSync(path.join(root, '.changeledger', 'specs', name), text);
    }
  }
  if (Object.keys(releaseFiles).length) {
    fs.mkdirSync(path.join(root, '.changeledger', 'releases'), { recursive: true });
    for (const [name, text] of Object.entries(releaseFiles)) {
      fs.writeFileSync(path.join(root, '.changeledger', 'releases', name), text);
    }
  }
  return root;
}

function frontmatter(over = {}) {
  const fm = {
    id: '20260101-000000',
    title: 'X',
    type: 'change',
    status: 'done',
    created: '2026-01-01T00:00:00Z',
    depends_on: '[]',
    ...over,
  };
  return Object.entries(fm)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
}

// A body with a retired type and a `## Proposal` stage, the shape history
// written before 20261024-121022 carries — defects today's rules report on a
// live document and never on frozen history.
const RETIRED_SHAPE = 'type "refactor" is retired: set type to "change"';
function retiredShape(over) {
  return `---\n${frontmatter({ type: 'refactor', ...over })}\n---\n\n## Request\n\nX\n\n## Proposal\n\nX\n\n## Plan\n\nX\n\n## Log\n`;
}

// A well-formed body, used where the criterion is about repo-wide invariants
// rather than about per-document defects.
function validChore(over, logBody = '') {
  const fm = frontmatter(over);
  const log = logBody ? `\n## Log\n\n${logBody}\n` : '';
  return `---\n${fm}\n---\n\n## Request\n\nX\n\n## Plan\n\nX\n${log}`;
}

function runCheck(root, args = []) {
  const out = captureOutput();
  const code = check(args, root, out);
  return { code, out, text: [...out.diagnostics, ...out.calls].join('\n') };
}

test('161655 CR3: changeledger check reports an invalid rendered branch without throwing', () => {
  const root = frozenFixture(
    {},
    {},
    {},
    `${FROZEN_FIXTURE_CONFIG}git:\n  change_branch_format: bad..{id}\n`,
  );

  let result;
  assert.doesNotThrow(() => {
    result = runCheck(root);
  });
  assert.equal(result.code, 1);
  assert.match(result.text, /renders an invalid Git branch: bad\.\.id/);
});

test('194220 CR1: a done and archived change gets no diagnostics of its own', () => {
  const root = frozenFixture({
    '20260101-000000-frozen.md': retiredShape({ archived: 'true' }),
  });
  const { code, out } = runCheck(root);
  assert.deepEqual(
    out.diagnostics.filter((line) => line.includes('20260101-000000-frozen.md')),
    [],
  );
  assert.equal(code, 0);
});

test('194220 CR2: a done change that is not archived is still validated', () => {
  const root = frozenFixture({ '20260101-000000-frozen.md': retiredShape() });
  const { code, text } = runCheck(root);
  assert.ok(text.includes(RETIRED_SHAPE), text);
  assert.equal(code, 1);
});

test('194220 CR3: a discarded change gets no diagnostics of its own', () => {
  const root = frozenFixture({
    '20260101-000000-frozen.md': retiredShape({ status: 'discarded' }),
  });
  const { code, out } = runCheck(root);
  assert.deepEqual(
    out.diagnostics.filter((line) => line.includes('20260101-000000-frozen.md')),
    [],
  );
  assert.equal(code, 0);
});

test('194220 CR4: archived under an open status is validated like live work', () => {
  const root = frozenFixture({
    '20260101-000000-frozen.md': retiredShape({
      status: 'in-progress',
      archived: 'true',
    }),
  });
  const { code, text } = runCheck(root);
  assert.ok(text.includes(RETIRED_SHAPE), text);
  assert.equal(code, 1);
});

test('194220 CR5: an id duplicated between a live and an archived change is still detected', () => {
  const root = frozenFixture({
    '20260101-000000-live.md': validChore({ status: 'approved' }),
    '20260101-000000-frozen.md': validChore({ archived: 'true' }),
  });
  const { code, text } = runCheck(root);
  assert.ok(text.includes('duplicate id "20260101-000000" (also in '), text);
  assert.equal(code, 1);
});

test('194220 CR6: depends_on pointing at an archived change still resolves', () => {
  const root = frozenFixture({
    '20260101-000000-frozen.md': validChore({ archived: 'true' }),
    '20260102-000000-live.md': validChore({
      id: '20260102-000000',
      status: 'approved',
      depends_on: '["20260101-000000"]',
    }),
  });
  const { text } = runCheck(root);
  assert.ok(!text.includes('depends_on references missing change "20260101-000000"'), text);
});

test('194220 CR7: a graduation recorded by an archived change still backs checkSpecs', () => {
  const root = frozenFixture(
    {
      '20260101-000000-frozen.md': validChore(
        { archived: 'true' },
        '- **2026-01-01T00:00:00Z** `[graduation]` spec: `arch.md`',
      ),
    },
    {
      'arch.md':
        '---\ntitle: Arch\nupdated: 2026-01-02T00:00:00Z\ngraduated_from: ["20260101-000000"]\n---\n\nTruth.\n',
    },
  );
  const { code, text } = runCheck(root);
  assert.ok(!text.includes('orphan spec'), text);
  assert.ok(!text.includes('missing graduated_from "20260101-000000"'), text);
  assert.equal(code, 0);
});

test('194220 CR12: an archived flag that is not the boolean true does not freeze', () => {
  const root = frozenFixture({ 'mismatch.md': validChore({ archived: '"true"' }) });
  const { code, text } = runCheck(root);
  assert.ok(text.includes('archived must be a boolean'), text);
  assert.ok(text.includes('filename does not match id "20260101-000000"'), text);
  assert.equal(code, 1);
});

test('194220 CR13: the ids of frozen changes still feed mention detection', () => {
  const mentioning = `---\n${frontmatter({
    id: '20260102-000000',
    type: 'change',
    status: 'approved',
  })}\n---\n\n## Request\n\nThe groundwork landed in 20260101-000000 and is not declared here.\n\n## Plan\n\nX\n`;
  const root = frozenFixture({
    '20260101-000000-frozen.md': validChore({ archived: 'true' }),
    '20260102-000000-live.md': mentioning,
  });
  const { out, text } = runCheck(root);
  assert.ok(
    out.diagnostics.some(
      (line) =>
        line.includes('20260102-000000-live.md') &&
        line.includes(
          'mentions change "20260101-000000" without declaring it in depends_on or related_to',
        ),
    ),
    text,
  );
});

test('194220 CR13b: a frozen change declaring related_to still derives the backlink', () => {
  const mentioning = `---\n${frontmatter({
    id: '20260102-000000',
    type: 'change',
    status: 'approved',
  })}\n---\n\n## Request\n\nThe groundwork landed in 20260101-000000 and is not declared here.\n\n## Plan\n\nX\n`;
  const root = frozenFixture({
    '20260101-000000-frozen.md': validChore({
      archived: 'true',
      related_to: '["20260102-000000"]',
    }),
    '20260102-000000-live.md': mentioning,
  });
  const { out, text } = runCheck(root);
  assert.ok(
    !out.diagnostics.some(
      (line) =>
        line.includes('20260102-000000-live.md') &&
        line.includes(
          'mentions change "20260101-000000" without declaring it in depends_on or related_to',
        ),
    ),
    text,
  );
});

test('194220 CR14: a dependency cycle through a frozen change is detected', () => {
  const root = frozenFixture({
    '20260101-000000-frozen.md': validChore({
      archived: 'true',
      depends_on: '["20260102-000000"]',
    }),
    '20260102-000000-live.md': validChore({
      id: '20260102-000000',
      status: 'approved',
      depends_on: '["20260101-000000"]',
    }),
  });
  const { code, out, text } = runCheck(root);
  const cycle = out.diagnostics.find((line) => line.includes('dependency cycle: '));
  assert.ok(cycle, text);
  assert.ok(cycle.includes('20260101-000000'), cycle);
  assert.ok(cycle.includes('20260102-000000'), cycle);
  assert.equal(code, 1);
});

test('194220 CR15: releases still read the status of a frozen change', () => {
  const root = frozenFixture(
    {
      '20260102-000000-discarded.md': validChore({
        id: '20260102-000000',
        status: 'discarded',
      }),
    },
    {},
    {
      '1.0.0.yml': 'version: 1.0.0\ncreated: 2026-01-02T00:00:00Z\nchanges:\n  - 20260102-000000\n',
    },
  );
  const { code, text } = runCheck(root);
  assert.ok(text.includes('references change "20260102-000000" whose status is not done'), text);
  assert.equal(code, 1);
});

// A change in `approved` whose Plan cites a criterion its Specification never
// declares.
const REFACTOR_WITH_ORPHAN_REFERENCE = `---
id: "20260101-000000"
title: X
type: change
status: approved
created: 2026-01-01T00:00:00Z
depends_on: []
---

## Request

Quitar el flag heredado.

### Proposal

Eliminación limpia, sin capa de compatibilidad.

## Specification

### CR1 — La opción deja de existir

- **Given** un repo inicializado
- **When** se ejecuta \`changeledger context --have x\`
- **Then** el proceso termina con código de salida 1

## Plan

- [ ] Ajustar el comportamiento
  - **Criteria:** CR9

## Log
`;

test('141119 CR8: a refactor citing an undeclared criterion is no longer silently valid', () => {
  const root = frozenFixture({ '20260101-000000-orphan.md': REFACTOR_WITH_ORPHAN_REFERENCE });
  const { code, out, text } = runCheck(root);
  assert.ok(text.includes('Plan task references unknown criterion "CR9"'), text);
  assert.equal(code, 1);
  assert.ok(!out.calls.some((line) => line.includes('✓ 1 change(s) valid')), out.calls.join('\n'));
});

test('141119 CR4: the distributed config checks clean', () => {
  const distributed = parseYaml(fs.readFileSync(path.join(templatesDir, 'config.yml'), 'utf8'), {
    merge: false,
  });
  const { errors, warnings } = checkRepo({
    config: { ...distributed, min_cli_version: VERSION },
    changes: [],
  });
  assert.deepEqual([...msgs(errors), ...msgs(warnings)], []);
});

// --- 20260729-162616: silent-failure sweep (CR4, CR6, CR7) ---

test('162616 CR4: a change without Specification citing an unknown criterion is diagnosed, not silently skipped', () => {
  const { errors } = checkRepo({
    config: tddConfig,
    changes: [
      cov({
        frontmatter: { type: 'change', status: 'approved' },
        stages: [{ key: 'request' }, { key: 'plan' }],
        tasks: [{ state: 'todo', text: 'do it (CR99)', criteria: ['CR99'] }],
      }),
    ],
  });
  assert.ok(msgs(errors).some((m) => /Plan task references unknown criterion "CR99"/.test(m)));
});

test('162616 CR4: a change without Specification and no CR references stays clean', () => {
  const { errors } = checkRepo({
    config: tddConfig,
    changes: [
      cov({
        frontmatter: { type: 'change', status: 'approved' },
        stages: [{ key: 'request' }, { key: 'plan' }],
        tasks: [{ state: 'todo', text: 'do it (support)', criteria: [] }],
      }),
    ],
  });
  assert.deepEqual(msgs(errors), []);
});

test('162616 CR4: the same unknown reference is an error while the change is still draft', () => {
  const { warnings, errors } = checkRepo({
    config: tddConfig,
    changes: [
      cov({
        frontmatter: { type: 'change', status: 'draft' },
        stages: [{ key: 'request' }, { key: 'plan' }],
        tasks: [{ state: 'todo', text: 'do it (CR99)', criteria: ['CR99'] }],
      }),
    ],
  });
  assert.ok(msgs(errors).some((m) => /Plan task references unknown criterion "CR99"/.test(m)));
  assert.ok(!msgs(warnings).some((m) => /unknown criterion/.test(m)));
});

test('162616 CR6: a discarded change never emits depends_on/related_to invariants of its own', () => {
  const cfg = { ...config, statuses: [...config.statuses, 'discarded'] };
  const frozen = change({
    frontmatter: {
      id: '20260613-120000',
      status: 'discarded',
      depends_on: ['20260613-199999'],
      related_to: ['20260613-120000'],
    },
  });
  const errors = msgs(checkRepo({ config: cfg, changes: [frozen] }).errors);
  assert.deepEqual(
    errors.filter((m) =>
      /depends_on references missing|related_to cannot reference|related_to references missing/.test(
        m,
      ),
    ),
    [],
  );
});

test('162616 CR6: an open change with the same defects still emits its own errors', () => {
  const cfg = { ...config, statuses: [...config.statuses, 'discarded'] };
  const open = change({
    frontmatter: { id: '20260613-130000', depends_on: ['20260613-199999'] },
    name: '20260613-130000-y.md',
  });
  const errors = msgs(checkRepo({ config: cfg, changes: [open] }).errors);
  assert.ok(errors.includes('depends_on references missing change "20260613-199999"'));
});

test('162616 CR6: an open change referencing an existing frozen change resolves without error', () => {
  const cfg = { ...config, statuses: [...config.statuses, 'discarded'] };
  const frozen = change({ frontmatter: { id: '20260613-120000', status: 'discarded' } });
  const open = change({
    frontmatter: { id: '20260613-130000', depends_on: ['20260613-120000'] },
    name: '20260613-130000-y.md',
  });
  const errors = msgs(checkRepo({ config: cfg, changes: [frozen, open] }).errors);
  assert.deepEqual(
    errors.filter((m) => /depends_on references missing/.test(m)),
    [],
  );
});

test('162616 CR6: a done+archived change graduating to a missing spec does not emit', () => {
  const frozen = change({
    frontmatter: { id: '20260613-120000', status: 'done', archived: true },
    stages: [
      { key: 'request' },
      { key: 'plan' },
      { key: 'log', body: '- **2026-06-13T12:00:00Z** `[graduation]` spec: `ghost.md`\n' },
    ],
  });
  const errors = msgs(checkRepo({ config, changes: [frozen], specs: [] }).errors);
  assert.deepEqual(
    errors.filter((m) => /graduated to a missing spec/.test(m)),
    [],
  );
});

test('162616 CR7: a discarded change is still exempt from its own unclassified-mention check', () => {
  const cfg = { ...config, statuses: [...config.statuses, 'discarded'] };
  const target = change({
    frontmatter: { id: '20260613-130000' },
    name: '20260613-130000-target.md',
  });
  const source = change({
    frontmatter: { status: 'discarded' },
    stages: [
      { key: 'request', body: 'Builds on #20260613-130000 without declaring it.' },
      { key: 'plan', body: '' },
      { key: 'log', body: '' },
    ],
  });
  const { warnings } = checkRepo({ config: cfg, changes: [source, target] });
  assert.deepEqual(
    msgs(warnings).filter((m) => /mentions change/.test(m)),
    [],
  );
});

// --- 20261012-174340: git.release_branch must differ from git.integration_branch ---

const branchErrors = (git) => {
  const cfg = { ...tddConfig };
  if (git !== undefined) cfg.git = git;
  return msgs(checkRepo({ config: cfg, changes: [] }).errors);
};
const MUST_DIFFER =
  'config "git.release_branch" must differ from "git.integration_branch" (both are "dev")';

test('174340 CR4: release_branch equal to integration_branch is an error, trimmed', () => {
  assert.deepEqual(branchErrors({ integration_branch: 'dev', release_branch: 'dev' }), [
    MUST_DIFFER,
  ]);
  assert.deepEqual(branchErrors({ integration_branch: 'dev', release_branch: ' dev ' }), [
    MUST_DIFFER,
  ]);
  assert.deepEqual(branchErrors({ integration_branch: ' dev', release_branch: 'dev ' }), [
    MUST_DIFFER,
  ]);
});

test('174340 CR5: distinct or undeclared branches never report must differ', () => {
  for (const git of [
    { integration_branch: 'dev', release_branch: 'main' },
    { integration_branch: 'dev' },
    { release_branch: 'main' },
    { integration_branch: null, release_branch: null },
    {},
    undefined,
  ]) {
    assert.deepEqual(branchErrors(git), [], JSON.stringify(git));
  }
  // A malformed value keeps its own single error; the new rule adds nothing.
  assert.deepEqual(branchErrors({ integration_branch: 'dev', release_branch: '' }), [
    'config "git.release_branch" must be a non-empty string',
  ]);
  assert.deepEqual(branchErrors({ integration_branch: '', release_branch: '' }), [
    'config "git.integration_branch" must be a non-empty string',
    'config "git.release_branch" must be a non-empty string',
  ]);
  assert.deepEqual(branchErrors('main'), ['config "git" must be a mapping']);
});

// --- usage collector activation in git config (20261001-155612) ---

function gitCheckRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-check-usage-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  initializeRepo(root);
  initGitFixture(root);
  return root;
}

const setCollector = (root, value) =>
  execFileSync('git', ['config', 'changeledger.usage.collector', value], {
    cwd: root,
    env: sanitizedEnv(),
  });

test('20261001-155612 CR2: a git config collector other than ccusage is an error', () => {
  const root = gitCheckRepo();
  assert.deepEqual(checkUsageGitConfig(root), []);
  for (const value of ['other', '', 'CCUSAGE']) {
    setCollector(root, value);
    assert.deepEqual(msgs(checkUsageGitConfig(root)), [
      'git config "changeledger.usage.collector" must be "ccusage"',
    ]);
    assert.throws(() => usageCollector(root), {
      message: 'git config "changeledger.usage.collector" must be "ccusage"',
    });
  }
  setCollector(root, 'ccusage');
  assert.deepEqual(checkUsageGitConfig(root), []);
  assert.equal(usageCollector(root), 'ccusage');
});

test('20261001-155612 CR2: a usage key in config.yml is neither read nor validated', () => {
  for (const usage of [{ collector: 'other' }, { collector: 'ccusage' }, 'x', [], null]) {
    assert.deepEqual(checkRepo({ config: { ...config, usage }, changes: [] }).errors, []);
  }
  const root = gitCheckRepo();
  fs.appendFileSync(
    path.join(root, '.changeledger', 'config.yml'),
    '\nusage:\n  collector: ccusage\n',
  );
  assert.equal(usageCollector(root), undefined);
  const out = captureOutput();
  assert.equal(check([], root, out), 0, out.diagnostics.join('\n'));

  const template = fs.readFileSync(path.join(templatesDir, 'config.yml'), 'utf8');
  assert.equal(parseYaml(template).usage, undefined);
  assert.doesNotMatch(template, /usage/);
});

test('20261001-155612 CR2: `changeledger check` fails on an unknown git config collector', () => {
  const root = gitCheckRepo();
  setCollector(root, 'other');
  const bad = captureOutput();
  assert.equal(check([], root, bad), 1, bad.diagnostics.join('\n'));
  assert.ok(
    bad.diagnostics.some((line) =>
      line.includes('git config "changeledger.usage.collector" must be "ccusage"'),
    ),
    bad.diagnostics.join('\n'),
  );
  setCollector(root, 'ccusage');
  const good = captureOutput();
  assert.equal(check([], root, good), 0, good.diagnostics.join('\n'));
});

// --- 20261002-133728 CR4: check validates every usage record ----------------

const USAGE_CHECK_ID = '20261002-133728';
const VALID_RECORD = [
  `${USAGE_CHECK_ID}--20261002T153233Z-0a1b2c3d.json`,
  usageRecordText(USAGE_CHECK_ID),
];
const INVALID_RECORDS = {
  'invalid JSON': [`${USAGE_CHECK_ID}--20261002T153234Z-0a1b2c3e.json`, '{"schema": 1,'],
  'no schema 1': [
    `${USAGE_CHECK_ID}--20261002T153235Z-0a1b2c3f.json`,
    usageRecordText(USAGE_CHECK_ID, undefined, { schema: 2 }),
  ],
  'a change other than its name': [
    `${USAGE_CHECK_ID}--20261002T153236Z-0a1b2c40.json`,
    usageRecordText('20261002-999999'),
  ],
  'no change field': [
    `${USAGE_CHECK_ID}--20261002T153237Z-0a1b2c41.json`,
    usageRecordText(USAGE_CHECK_ID, undefined, { change: undefined }),
  ],
  'a name outside the form': [
    `${USAGE_CHECK_ID}--20261002T153233Z-1.json`,
    usageRecordText(USAGE_CHECK_ID),
  ],
};

// An initialized repo holding `records` (`[name, text]` pairs) in the usage
// collection of `layout`: the worktree's `.changeledger/usage/`, or the
// state ref of an activated repo whose config is the worktree's own.
function usageCheckRepo(t, layout, records) {
  const root = gitCheckRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  if (layout === 'legacy') {
    const dir = path.join(root, '.changeledger', 'usage');
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, text] of records) fs.writeFileSync(path.join(dir, name), text);
    return root;
  }
  const files = {
    '.changeledger-state/manifest.yml': 'format_version: 1\nproject_id: demo\n',
    '.changeledger-state/config.yml': fs.readFileSync(
      path.join(root, '.changeledger', 'config.yml'),
      'utf8',
    ),
  };
  for (const [name, text] of records) files[`.changeledger-state/usage/${name}`] = text;
  updateRef(root, STATE_REF, commitTree(root, buildTree(root, files), { message: 'chore: state' }));
  writeActivation(root, { stateRef: STATE_REF });
  return root;
}

function checkJson(root) {
  const out = captureOutput();
  const code = check(['--json'], root, out);
  return { code, ...JSON.parse(out.calls.join('\n')) };
}

for (const layout of ['legacy', 'state ref']) {
  test(`20261002-133728 CR4 (${layout}): a valid usage record produces no diagnostic`, (t) => {
    const root = usageCheckRepo(t, layout, [VALID_RECORD]);
    const { code, errors, warnings } = checkJson(root);
    assert.equal(code, 0, JSON.stringify(errors));
    assert.deepEqual([...errors, ...warnings], []);
  });

  for (const [label, [name, text]] of Object.entries(INVALID_RECORDS)) {
    test(`20261002-133728 CR4 (${layout}): a record with ${label} fails check, named`, (t) => {
      const root = usageCheckRepo(t, layout, [VALID_RECORD, [name, text]]);
      const { code, errors } = checkJson(root);
      assert.notEqual(code, 0);
      assert.equal(errors.length, 1, JSON.stringify(errors));
      assert.ok(errors[0].message.startsWith(`usage record ${name}: `), JSON.stringify(errors[0]));
    });
  }
}

test('20261002-133728 CR4: a record missing change or schema names the missing field', (t) => {
  const name = `${USAGE_CHECK_ID}--20261002T153238Z-0a1b2c42.json`;
  for (const [field, expected] of [
    ['change', `usage record ${name}: missing "change"`],
    ['schema', `usage record ${name}: missing "schema"`],
  ]) {
    const root = usageCheckRepo(t, 'legacy', [
      [name, usageRecordText(USAGE_CHECK_ID, undefined, { [field]: undefined })],
    ]);
    assert.deepEqual(
      checkJson(root).errors.map((e) => e.message),
      [expected],
    );
  }
});

// --- 20261012-125617 CR1/CR2: check validates the instant of a usage record ---

const AT_CHECK_ID = USAGE_CHECK_ID;

for (const layout of ['legacy', 'state ref']) {
  test(`20261012-125617 CR1 (${layout}): a usage record without "at" fails check, named`, (t) => {
    const name = `${AT_CHECK_ID}--20261002T153240Z-0a1b2c50.json`;
    const root = usageCheckRepo(t, layout, [
      VALID_RECORD,
      [name, usageRecordText(AT_CHECK_ID, undefined, { at: undefined })],
    ]);
    const { code, errors } = checkJson(root);
    assert.notEqual(code, 0);
    assert.deepEqual(
      errors.map((e) => e.message),
      [`usage record ${name}: missing "at"`],
    );
  });

  for (const [label, at] of [
    ['a number', 123],
    ['a word', 'ayer'],
  ]) {
    test(`20261012-125617 CR2 (${layout}): a usage record whose "at" is ${label} fails check, named`, (t) => {
      const name = `${AT_CHECK_ID}--20261002T153241Z-0a1b2c51.json`;
      const root = usageCheckRepo(t, layout, [
        VALID_RECORD,
        [name, usageRecordText(AT_CHECK_ID, undefined, { at })],
      ]);
      const { code, errors } = checkJson(root);
      assert.notEqual(code, 0);
      assert.deepEqual(
        errors.map((e) => e.message),
        [`usage record ${name}: at must be an ISO 8601 UTC instant, got ${JSON.stringify(at)}`],
      );
    });
  }
}

test('20261012-125617 CR2: a usage record "at" is accepted in the form the collector writes', (t) => {
  // The Log instant `YYYY-MM-DDTHH:MM:SSZ`, as the ledger's own records carry it.
  const root = usageCheckRepo(t, 'legacy', [
    [
      `${AT_CHECK_ID}--20261002T153242Z-0a1b2c52.json`,
      usageRecordText(AT_CHECK_ID, '2026-10-02T15:32:42Z'),
    ],
  ]);
  assert.deepEqual(checkJson(root).errors, []);
});

// --- 20261002-161641: check over a collection this CLI does not know ---------

function futureCheckRepo(t, extra) {
  const root = gitCheckRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = {
    '.changeledger-state/manifest.yml': 'format_version: 1\nproject_id: demo\n',
    '.changeledger-state/config.yml': fs.readFileSync(
      path.join(root, '.changeledger', 'config.yml'),
      'utf8',
    ),
    ...extra,
  };
  updateRef(root, STATE_REF, commitTree(root, buildTree(root, files), { message: 'chore: state' }));
  writeActivation(root, { stateRef: STATE_REF });
  return root;
}

test('20261002-161641 CR5: check does not validate an unknown collection and repeats the warning', (t) => {
  const root = futureCheckRepo(t, {
    '.changeledger-state/future/a.json': 'not json, and not ours to judge\n',
  });
  const { code, errors, warnings } = checkJson(root);
  assert.equal(code, 0, JSON.stringify(errors));
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, [
    {
      file: '.changeledger-state',
      message: `the state ref holds collections ChangeLedger ${VERSION} does not know (future); update the installation to use them`,
    },
  ]);
});

test('20261002-161641 CR5: check adds no warning when every collection is known', (t) => {
  const [usageName, usageText] = VALID_RECORD;
  const root = futureCheckRepo(t, {
    [`.changeledger-state/changes/${USAGE_CHECK_ID}-known.md`]: `---\nid: "${USAGE_CHECK_ID}"\ntitle: Known\ntype: change\nstatus: draft\ncreated: 2026-10-02T13:37:28Z\ndepends_on: []\n---\n\n## Request\n\nKnown.\n\n## Log\n`,
    [`.changeledger-state/usage/${usageName}`]: usageText,
  });
  const { code, errors, warnings } = checkJson(root);
  assert.equal(code, 0, JSON.stringify(errors));
  assert.deepEqual(warnings, []);
  const repo = loadRepo(root);
  assert.deepEqual(
    [repo.changes.length, repo.usage.length],
    [1, 1],
    'the ref holds a change and a usage record',
  );
});

// --- check --commits base from the change on the current branch (20261012-174407) ---

const RELEASE_CONFIG = `changes_dir: .changeledger/changes
git:
  integration_branch: dev
  release_branch: main
  change_branch_format: "{type}/{id}"
`;

const HOTFIX_ID = '20261012-174140';
const BUG_ID = '20261012-174141';
const MAIN_ONLY_SUBJECT = 'fix(y): earlier hotfix shipped on main, no marker';

function changeDocument(id, type, status, branch, integratesInto = undefined) {
  const lines = [
    '---',
    `id: "${id}"`,
    `title: "Change ${id}"`,
    `type: ${type}`,
    `status: ${status}`,
  ];
  if (integratesInto) lines.push(`integrates_into: ${integratesInto}`);
  lines.push('created: 2026-10-12T17:41:40Z', 'depends_on: []');
  if (branch) lines.push(`branch: ${branch}`);
  lines.push('related_to: []', 'owner: tester', '---', '', '## Request', '', 'x', '');
  return lines.join('\n');
}

// `main` holds a marker-less commit that `dev` lacks, and `dev` holds another
// one that `main` lacks, so the two possible bases give different verdicts.
function releaseFixture({ config = RELEASE_CONFIG, changes = {} } = {}) {
  const { root, git } = gitFixture();
  const changesDir = path.join(root, '.changeledger', 'changes');
  fs.mkdirSync(changesDir, { recursive: true });
  fs.writeFileSync(path.join(root, '.changeledger', 'config.yml'), config);
  for (const [name, text] of Object.entries(changes)) {
    fs.writeFileSync(path.join(changesDir, name), text);
  }
  const commit = (file, subject) => {
    fs.writeFileSync(path.join(root, file), `${file}\n`);
    git(['add', file]);
    git(['commit', '-q', '-m', subject]);
  };
  git(['branch', 'dev']);
  commit('m.txt', MAIN_ONLY_SUBJECT);
  const mainSha = git(['rev-parse', '--short', 'HEAD']).trim();
  git(['checkout', '-q', 'dev']);
  commit('d.txt', 'feat(x): unreleased dev work, no marker');
  git(['checkout', '-q', 'main']);
  return { root, git, commit, mainSha };
}

function branchFrom(fx, name, from, subject) {
  fx.git(['checkout', '-q', '-b', name, from]);
  fx.commit(`${name.replace(/\W/g, '_')}.txt`, subject);
}

const mainOnlyError = (sha) =>
  `  error  (commits): ${sha} missing [#id] marker: "${MAIN_ONLY_SUBJECT}"`;
const hotfixDoc = (branch = `change/${HOTFIX_ID}`, status = 'in-progress') =>
  changeDocument(HOTFIX_ID, 'change', status, branch, 'release');
const bugDoc = (branch = `change/${BUG_ID}`, status = 'in-progress') =>
  changeDocument(BUG_ID, 'change', status, branch);

test('174407 CR1: a hotfix branch created from release lints against the release branch', () => {
  const fx = releaseFixture({ changes: { [`${HOTFIX_ID}-h.md`]: hotfixDoc() } });
  branchFrom(fx, `change/${HOTFIX_ID}`, 'main', `fix(x): hotfix work [#${HOTFIX_ID}]`);

  const out = captureOutput();
  assert.equal(check(['--commits'], fx.root, out), 0, out.diagnostics.join('\n'));
  assert.deepEqual(out.calls, ['✓ commits main..HEAD valid']);
  assert.deepEqual(out.diagnostics, []);
});

test('174407 CR2: a change of an integration type keeps git.integration_branch', () => {
  const fx = releaseFixture({ changes: { [`${BUG_ID}-b.md`]: bugDoc() } });
  branchFrom(fx, `change/${BUG_ID}`, 'dev', `fix(x): bug work [#${BUG_ID}]`);

  const out = captureOutput();
  assert.equal(check(['--commits'], fx.root, out), 0, out.diagnostics.join('\n'));
  assert.deepEqual(out.calls, ['✓ commits dev..HEAD valid']);
});

test('174407 CR3: without a resolved change the base is git.integration_branch', () => {
  const fx = releaseFixture({ changes: { [`${HOTFIX_ID}-h.md`]: hotfixDoc() } });
  const expected = ['\n1 error(s) — commits dev..HEAD'];

  // on `main`: no change records or renders that branch
  const onMain = captureOutput();
  assert.equal(check(['--commits'], fx.root, onMain), 1);
  assert.deepEqual(onMain.diagnostics, [mainOnlyError(fx.mainSha)]);
  assert.deepEqual(onMain.calls, expected);

  // detached HEAD on the hotfix branch name: `checkoutBranch` reads ''
  branchFrom(fx, `change/${HOTFIX_ID}`, 'main', `fix(x): hotfix work [#${HOTFIX_ID}]`);
  fx.git(['checkout', '-q', '--detach']);
  const detached = captureOutput();
  assert.equal(check(['--commits'], fx.root, detached), 1);
  assert.deepEqual(detached.diagnostics, [mainOnlyError(fx.mainSha)]);
  assert.deepEqual(detached.calls, expected);
});

test('174407 CR3: detached HEAD keeps the fallback chain without reading the ledger', () => {
  const fx = releaseFixture({
    changes: {
      [`${HOTFIX_ID}-h.md`]: hotfixDoc(),
      '20261012-999999-bad.md': 'not a change',
    },
  });
  branchFrom(fx, `change/${HOTFIX_ID}`, 'main', `fix(x): hotfix work [#${HOTFIX_ID}]`);
  fx.git(['checkout', '-q', '--detach']);

  // a release type exists, so only the detached-HEAD guard keeps the malformed
  // document from being loaded
  const out = captureOutput();
  assert.equal(check(['--commits'], fx.root, out), 1);
  assert.deepEqual(out.diagnostics, [mainOnlyError(fx.mainSha)]);
  assert.deepEqual(out.calls, ['\n1 error(s) — commits dev..HEAD']);
});

test('174407 CR4: an explicit base wins and the ledger is not read', () => {
  const fx = releaseFixture({
    changes: {
      [`${HOTFIX_ID}-h.md`]: hotfixDoc(),
      '20261012-999999-bad.md': 'not a change',
    },
  });
  branchFrom(fx, `change/${HOTFIX_ID}`, 'main', `fix(x): hotfix work [#${HOTFIX_ID}]`);

  const out = captureOutput();
  assert.equal(check(['--commits', 'dev'], fx.root, out), 1);
  assert.deepEqual(out.diagnostics, [mainOnlyError(fx.mainSha)]);
  assert.deepEqual(out.calls, ['\n1 error(s) — commits dev..HEAD']);
});

test('174407 CR5: a change with no recorded branch is matched by its rendered branch', () => {
  const fx = releaseFixture({
    changes: { [`${HOTFIX_ID}-h.md`]: hotfixDoc(null, 'approved') },
  });
  branchFrom(fx, `change/${HOTFIX_ID}`, 'main', `fix(x): hotfix work [#${HOTFIX_ID}]`);

  const out = captureOutput();
  assert.equal(check(['--commits'], fx.root, out), 0, out.diagnostics.join('\n'));
  assert.deepEqual(out.calls, ['✓ commits main..HEAD valid']);
});

test('174407 CR6: terminal changes do not decide the base', () => {
  for (const status of ['done', 'discarded']) {
    const fx = releaseFixture({
      changes: { [`${HOTFIX_ID}-h.md`]: hotfixDoc('shared/work', status) },
    });
    branchFrom(fx, 'shared/work', 'main', `fix(x): shared work [#${HOTFIX_ID}]`);

    const out = captureOutput();
    assert.equal(check(['--commits'], fx.root, out), 1, status);
    const text = [...out.diagnostics, ...out.calls].join('\n');
    assert.match(text, /commits dev\.\.HEAD/, status);
    assert.doesNotMatch(text, /commits main\.\.HEAD/, status);
  }
});

const AMBIGUOUS_MESSAGE = `branch "shared/work" is recorded by changes #${HOTFIX_ID} (integrates into main) and #${BUG_ID} (integrates into dev); pass <base> explicitly`;

test('174407 CR7: two bases on one branch fail instead of choosing one', () => {
  const fx = releaseFixture({
    changes: {
      [`${HOTFIX_ID}-h.md`]: hotfixDoc('shared/work'),
      [`${BUG_ID}-b.md`]: bugDoc('shared/work'),
    },
  });
  branchFrom(fx, 'shared/work', 'main', `fix(x): shared work [#${HOTFIX_ID}]`);

  const out = captureOutput();
  assert.equal(check(['--commits'], fx.root, out), 1);
  assert.deepEqual(out.diagnostics, [`  error  (commits): ${AMBIGUOUS_MESSAGE}`]);
  assert.deepEqual(out.calls, []);

  const json = captureOutput();
  assert.equal(check(['--commits', '--json'], fx.root, json), 1);
  assert.equal(
    json.calls.at(-1),
    JSON.stringify(
      { errors: [{ file: '(commits)', message: AMBIGUOUS_MESSAGE }], warnings: [] },
      null,
      2,
    ),
  );
});

test('174407 CR7: two changes with the same base on one branch use it', () => {
  const other = changeDocument('20261012-174142', 'change', 'in-progress', 'shared/work');
  const fx = releaseFixture({
    changes: { [`${BUG_ID}-b.md`]: bugDoc('shared/work'), '20261012-174142-o.md': other },
  });
  branchFrom(fx, 'shared/work', 'dev', `fix(x): shared work [#${BUG_ID}]`);

  const out = captureOutput();
  assert.equal(check(['--commits'], fx.root, out), 0, out.diagnostics.join('\n'));
  assert.deepEqual(out.calls, ['✓ commits dev..HEAD valid']);
});

// Since 20261024-121022 the lint reads the ledger only while
// `git.release_branch` is declared, so without it a release change is linted
// against `dev` and the missing branch is reported by `changeledger check`
// on the change itself (174310 CR2).
test('174407 CR8: a release change without git.release_branch is linted against dev', () => {
  const fx = releaseFixture({
    config: RELEASE_CONFIG.replace('  release_branch: main\n', ''),
    changes: { [`${HOTFIX_ID}-h.md`]: hotfixDoc() },
  });

  for (const onBranch of [false, true]) {
    if (onBranch) {
      branchFrom(fx, `change/${HOTFIX_ID}`, 'main', `fix(x): hotfix work [#${HOTFIX_ID}]`);
    }
    const out = captureOutput();
    assert.equal(check(['--commits'], fx.root, out), 1);
    assert.deepEqual(out.diagnostics, [mainOnlyError(fx.mainSha)]);
    assert.deepEqual(out.calls, ['\n1 error(s) — commits dev..HEAD']);
  }
});

test('174407 CR9: the ledger is read only when git.release_branch is declared', () => {
  const bad = { '20261012-999999-bad.md': 'not a change' };
  const withoutRelease = RELEASE_CONFIG.replace('  release_branch: main\n', '');
  const plain = releaseFixture({ config: withoutRelease, changes: bad });
  branchFrom(plain, `change/${HOTFIX_ID}`, 'main', `fix(x): hotfix work [#${HOTFIX_ID}]`);
  const ok = captureOutput();
  assert.equal(check(['--commits'], plain.root, ok), 1);
  assert.match(ok.calls.join('\n'), /commits dev\.\.HEAD/);
  assert.deepEqual(ok.diagnostics, [mainOnlyError(plain.mainSha)]);

  const released = releaseFixture({ changes: bad });
  branchFrom(released, `change/${HOTFIX_ID}`, 'main', `fix(x): hotfix work [#${HOTFIX_ID}]`);
  const out = captureOutput();
  assert.equal(check(['--commits'], released.root, out), 1);
  const file = path.join(released.root, '.changeledger', 'changes', '20261012-999999-bad.md');
  assert.deepEqual(out.diagnostics, [
    `  error  (commits): ${file}: Change is missing its frontmatter block`,
  ]);
  assert.deepEqual(out.calls, []);
});

test('174407 CR11: without git.integration_branch the auto-detected base remains', () => {
  const fx = releaseFixture({
    config: RELEASE_CONFIG.replace('  integration_branch: dev\n', ''),
    changes: { [`${BUG_ID}-b.md`]: bugDoc() },
  });
  branchFrom(fx, `change/${BUG_ID}`, 'main', `fix(x): bug work [#${BUG_ID}]`);

  const out = captureOutput();
  assert.equal(check(['--commits'], fx.root, out), 0, out.diagnostics.join('\n'));
  assert.deepEqual(out.calls, ['✓ commits main..HEAD valid']);
});

// --- 131621: in-validation and blocked leave the lifecycle ---

const SIX_STATUSES = ['draft', 'approved', 'in-progress', 'in-review', 'done', 'discarded'];
const SIX_STATUS_FIXTURE_CONFIG = FROZEN_FIXTURE_CONFIG.replace(
  /^statuses: .*$/m,
  `statuses: [${SIX_STATUSES.join(', ')}]`,
);

test('131621 CR1: the repo config declares exactly the six remaining statuses', () => {
  const text = fs.readFileSync(path.resolve('.changeledger/config.yml'), 'utf8');
  assert.deepEqual(parseYaml(text).statuses, SIX_STATUSES);
  assert.doesNotMatch(text, /in-validation/);
  assert.doesNotMatch(text, /blocked/);
});

const RETIRED_STATUS_MESSAGES = {
  'in-validation': 'status "in-validation" is retired: move it to "done" or "in-progress"',
  blocked: 'status "blocked" is retired: move it to "in-progress" and record a [!] task',
};

test('131621 CR2: a live document in a retired status names the status and its destination', () => {
  for (const [status, message] of Object.entries(RETIRED_STATUS_MESSAGES)) {
    const id = '20260101-000000';
    const root = frozenFixture(
      { [`${id}-live.md`]: retiredShape({ status }) },
      {},
      {},
      SIX_STATUS_FIXTURE_CONFIG,
    );
    const { code, text } = runCheck(root, [id]);
    assert.equal(code, 1, status);
    assert.ok(text.includes(message), `${status}: ${text}`);
    assert.doesNotMatch(text, /unknown status/);
  }
});

test('131621 CR2: a status outside the lifecycle stays an unknown status', () => {
  const { errors } = checkRepo({
    config: { ...config, statuses: SIX_STATUSES },
    changes: [change({ frontmatter: { status: 'paused' } })],
  });
  assert.ok(msgs(errors).some((m) => /unknown status "paused"/.test(m)));
  assert.ok(!msgs(errors).some((m) => /is retired/.test(m)));
});

const RETIRED_HISTORY_LOG = `## Log
- **2026-06-13T12:00:00Z** \`[status]\` approved → in-progress
- **2026-06-13T12:10:00Z** \`[status]\` in-progress → blocked
- **2026-06-13T12:20:00Z** \`[status]\` blocked → in-progress
- **2026-06-13T12:30:00Z** \`[review]\` in-review → in-validation (delegated subagent)
- **2026-06-13T12:40:00Z** \`[validation]\` in-validation → done (human accepted)
`;

test('131621 CR3: archived and discarded history naming retired statuses stays valid', () => {
  const body = (over) =>
    `---\n${frontmatter(over)}\n---\n\n## Request\n\nX\n\n## Proposal\n\nX\n\n## Plan\n\nX\n\n${RETIRED_HISTORY_LOG}`;
  const root = frozenFixture(
    {
      '20260101-000000-archived.md': body({ archived: 'true' }),
      '20260102-000000-discarded.md': body({ id: '20260102-000000', status: 'discarded' }),
    },
    {},
    {},
    SIX_STATUS_FIXTURE_CONFIG,
  );
  const { code, out, text } = runCheck(root);
  assert.equal(code, 0, text);
  assert.deepEqual(out.diagnostics, []);
});

// --- pending acceptance (20261018-131621 CR22: check reports, never writes) ---

const ACCEPT_ID = '20261018-131621';
const ACCEPT_CONFIG = `changes_dir: .changeledger/changes
statuses: [draft, approved, in-progress, in-review, done, discarded]
git:
  integration_branch: dev
  change_branch_format: "{type}/{id}"
`;

function acceptDoc({
  branchLine = `- **2026-10-18T14:45:55Z** \`[branch]\` set: feature/${ACCEPT_ID} (auto)`,
  acceptedAt,
} = {}) {
  return [
    '---',
    `id: "${ACCEPT_ID}"`,
    'title: Acceptance telemetry',
    'type: change',
    'status: done',
    'created: 2026-10-18T13:16:21Z',
    'depends_on: []',
    ...(acceptedAt ? [`accepted_at: ${acceptedAt}`] : []),
    `branch: feature/${ACCEPT_ID}`,
    '---',
    '',
    '## Request',
    '',
    'Telemetry, not a gate.',
    '',
    '## Plan',
    '',
    '- [x] Ship it',
    '  - **Target:** `src/x.mjs`',
    '  - **Verify:** `node --test test/x.test.mjs`',
    '  - **Resolved:** `2026-10-18T14:45:56Z`',
    '',
    '## Log',
    '',
    '- **2026-10-18T14:45:53Z** `[status]` draft → approved',
    '- **2026-10-18T14:45:54Z** `[status]` approved → in-progress',
    ...(branchLine ? [branchLine] : []),
    '- **2026-10-18T14:45:56Z** `[status]` in-progress → done',
    '',
  ].join('\n');
}

// A repo whose change was worked on `feature/<id>`; `merged` decides whether
// that branch ever landed on the integration branch `dev`.
function acceptFixture({ merged = true, doc = acceptDoc(), config = ACCEPT_CONFIG } = {}) {
  const { root, git } = gitFixture();
  const changesDir = path.join(root, '.changeledger', 'changes');
  fs.mkdirSync(changesDir, { recursive: true });
  fs.writeFileSync(path.join(root, '.changeledger', 'config.yml'), config);
  const file = path.join(changesDir, `${ACCEPT_ID}-acceptance.md`);
  fs.writeFileSync(file, doc);

  git(['branch', 'dev']);
  git(['checkout', '-q', '-b', `feature/${ACCEPT_ID}`, 'dev']);
  fs.writeFileSync(path.join(root, 'work.txt'), 'work\n');
  git(['add', 'work.txt']);
  git(['commit', '-q', '-m', `feat(x): work [#${ACCEPT_ID}]`]);
  git(['checkout', '-q', 'dev']);
  if (merged)
    git(['merge', '--no-ff', '-q', '-m', `merge [#${ACCEPT_ID}]`, `feature/${ACCEPT_ID}`]);
  return { root, git, file };
}

test('20261018-131621 CR22: check warns that a merged done change is accepted, exits 0 and writes nothing', () => {
  const { root, file } = acceptFixture();
  const before = fs.readFileSync(file);

  const out = captureOutput();
  const code = check([ACCEPT_ID], root, out);

  assert.equal(code, 0, out.diagnostics.join('\n'));
  const warning = out.diagnostics.find((d) => d.includes('accepted'));
  assert.ok(warning, `expected an acceptance warning, got: ${out.diagnostics.join('\n')}`);
  assert.match(warning, /^ {2}warn {3}/);
  assert.ok(
    warning.includes(`${ACCEPT_ID}-acceptance.md`),
    `warning must name the change: ${warning}`,
  );
  assert.deepEqual(fs.readFileSync(file), before, 'check must leave the document byte-for-byte');
});

test('20261018-131621 CR22: an unmerged branch draws no acceptance warning', () => {
  const { root } = acceptFixture({ merged: false });

  const out = captureOutput();
  assert.equal(check([ACCEPT_ID], root, out), 0, out.diagnostics.join('\n'));
  assert.deepEqual(out.diagnostics, []);
});

test('20261018-131621 CR22: a change already stamped draws no acceptance warning', () => {
  const { root } = acceptFixture({ doc: acceptDoc({ acceptedAt: '2026-10-18T10:00:00Z' }) });

  const out = captureOutput();
  assert.equal(check([ACCEPT_ID], root, out), 0, out.diagnostics.join('\n'));
  assert.deepEqual(out.diagnostics, []);
});

test('20261018-131621 CR22: a change with no [branch] entry draws no acceptance warning', () => {
  const { root } = acceptFixture({ doc: acceptDoc({ branchLine: '' }) });

  const out = captureOutput();
  assert.equal(check([ACCEPT_ID], root, out), 0, out.diagnostics.join('\n'));
  assert.deepEqual(out.diagnostics, []);
});

test('20261018-131621 CR22: a rebound branch is read from the last [branch] entry', () => {
  // The change started on `feature/abandoned`, which did land on dev, and was
  // rebound to `feature/<id>`, which did not. Acceptance belongs to the branch
  // the change is on now, so the abandoned merge must not claim it.
  const { root, git } = acceptFixture({ merged: false });
  git(['checkout', '-q', '-b', 'feature/abandoned', 'dev']);
  fs.writeFileSync(path.join(root, 'abandoned.txt'), 'x\n');
  git(['add', 'abandoned.txt']);
  git(['commit', '-q', '-m', `feat(x): abandoned [#${ACCEPT_ID}]`]);
  git(['checkout', '-q', 'dev']);
  git(['merge', '--no-ff', '-q', '-m', 'merge abandoned', 'feature/abandoned']);

  const file = path.join(root, '.changeledger', 'changes', `${ACCEPT_ID}-acceptance.md`);
  fs.writeFileSync(
    file,
    fs
      .readFileSync(file, 'utf8')
      .replace(
        `- **2026-10-18T14:45:55Z** \`[branch]\` set: feature/${ACCEPT_ID} (auto)`,
        [
          '- **2026-10-18T14:45:55Z** `[branch]` set: feature/abandoned (auto)',
          `- **2026-10-18T14:45:55Z** \`[branch]\` set: feature/${ACCEPT_ID}`,
        ].join('\n'),
      ),
  );

  const out = captureOutput();
  check([ACCEPT_ID], root, out);
  assert.deepEqual(
    out.diagnostics.filter((d) => d.includes('accepted')),
    [],
  );
});

test('20261018-131621 CR22: only a delivered change is reported as accepted', () => {
  const { root } = acceptFixture({
    doc: acceptDoc()
      .replace('status: done', 'status: in-progress')
      .replace('- **2026-10-18T14:45:56Z** `[status]` in-progress → done\n', '')
      .replace('- [x] Ship it', '- [ ] Ship it')
      .replace('  - **Resolved:** `2026-10-18T14:45:56Z`\n', ''),
  });

  const out = captureOutput();
  check([ACCEPT_ID], root, out);
  assert.deepEqual(
    out.diagnostics.filter((d) => d.includes('accepted')),
    [],
  );
});

test('20261018-131621 CR22: a malformed integration branch is a config error, not a crash', () => {
  const { root } = acceptFixture({
    config: ACCEPT_CONFIG.replace('  integration_branch: dev', '  integration_branch: 42'),
  });

  const out = captureOutput();
  assert.equal(check([ACCEPT_ID], root, out), 1);
  assert.ok(
    out.diagnostics.some((d) => d.includes('git.integration_branch')),
    out.diagnostics.join('\n'),
  );
});

test('20261018-131621 CR22: without a declared integration branch there is nothing to detect', () => {
  const { root } = acceptFixture({
    config: ACCEPT_CONFIG.replace('  integration_branch: dev\n', ''),
  });

  const out = captureOutput();
  assert.equal(check([ACCEPT_ID], root, out), 0, out.diagnostics.join('\n'));
  assert.deepEqual(out.diagnostics, []);
});

// The git-fed findings `check` already had (`checkUsageGitConfig`) are
// repo-wide only; this one must reach a single named subject too, which is the
// scope CR22 actually asks for. The sweep is pinned here so the warning cannot
// later be moved behind that `!id` guard. (The fixture is a bare scratch repo,
// so the sweep also reports the missing AGENTS.md — the exit code is not the
// subject of this test.)
test('20261018-131621 CR22: the repo-wide sweep reports acceptance too', () => {
  const { root } = acceptFixture();

  const out = captureOutput();
  check([], root, out);
  assert.ok(
    out.diagnostics.some((d) => d.includes('accepted')),
    out.diagnostics.join('\n'),
  );
});

// 20261018-131621 CR10. Once `graduate` stamps `[validation] accepted (merged
// <sha>)`, that event has no `from`/`to`. The sequence replay must step over
// it: treating it as an unmodellable status would abandon the replay at the
// line — and with it the frontmatter reconciliation that closes the document.
test('20261018-131621 CR10: an accepted validation entry does not abandon the lifecycle replay', () => {
  const log = [
    '- **2026-06-13T12:01:00Z** `[status]` draft → approved',
    '- **2026-06-13T12:02:00Z** `[status]` approved → in-progress',
    '- **2026-06-13T12:03:00Z** `[status]` in-progress → in-review',
    '- **2026-06-13T12:04:00Z** `[review]` in-review → done',
    '- **2026-06-13T12:05:00Z** `[validation]` accepted (merged abc1234)',
  ];
  assert.deepEqual(msgs(run([versionLogChange('done', log)]).errors), []);
  assert.match(
    msgs(run([versionLogChange('approved', log)]).errors).join('\n'),
    /Log reconstructs status "done" but frontmatter says "approved"/,
  );
  // And a defect recorded after the acceptance is still reported.
  assert.match(
    msgs(
      run([
        versionLogChange('done', [...log, '- **2026-06-13T12:06:00Z** `[status]` done → approved']),
      ]).errors,
    ).join('\n'),
    /invalid lifecycle transition "done → approved"/,
  );
});

// --- 20261019-184719 CR1: delivery from in-review needs a verdict ----------
//
// `review pass` made `in-review → done` a canonical edge, so the graph alone
// can no longer tell a reviewed delivery from a hand-written `[status]` one.
// These two documents differ in exactly that one tag.

const VERDICT_ID = '20261019-000001';
const VERDICT_CONFIG = `changes_dir: .changeledger/changes
statuses: [draft, approved, in-progress, in-review, done, discarded]
`;

function verdictDoc(deliveryLine, history = []) {
  return [
    '---',
    `id: "${VERDICT_ID}"`,
    'title: Delivery from review',
    'type: change',
    'status: done',
    'created: 2026-10-19T00:00:01Z',
    'depends_on: []',
    '---',
    '',
    '## Request',
    '',
    'r',
    '',
    '## Specification',
    '',
    '### CR1 — c',
    '- **Given** a',
    '- **When** b',
    '- **Then** c',
    '',
    '## Plan',
    '',
    '- [x] Update `src/a.mjs`',
    '  - **Target:** `src/a.mjs`',
    '  - **Verify:** `node --test test/a.test.mjs`',
    '  - **Criteria:** CR1',
    '  - **Resolved:** `2026-10-19T00:10:00Z`',
    '',
    '## Log',
    '',
    '- **2026-10-19T00:01:00Z** `[status]` draft → approved',
    '- **2026-10-19T00:02:00Z** `[status]` approved → in-progress',
    '- **2026-10-19T00:03:00Z** `[status]` in-progress → in-review',
    ...history,
    deliveryLine,
    '',
  ].join('\n');
}

function verdictRepo(deliveryLine, history = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-verdict-'));
  const changesDir = path.join(root, '.changeledger', 'changes');
  fs.mkdirSync(changesDir, { recursive: true });
  fs.writeFileSync(path.join(root, '.changeledger', 'config.yml'), VERDICT_CONFIG);
  fs.writeFileSync(
    path.join(changesDir, `${VERDICT_ID}-delivery.md`),
    verdictDoc(deliveryLine, history),
  );
  return root;
}

test('20261019-184719 CR1: a [status] delivery from in-review fails check and names the verdict seat', () => {
  const root = verdictRepo('- **2026-10-19T00:04:00Z** `[status]` in-review → done');

  const out = captureOutput();
  const code = check([VERDICT_ID], root, out);

  assert.equal(code, 1, `expected a non-zero exit, got ${code}: ${out.diagnostics.join('\n')}`);
  assert.ok(
    out.diagnostics.some((d) => d.includes(`changeledger review ${VERDICT_ID} pass`)),
    `expected the verdict seat to be named: ${out.diagnostics.join('\n')}`,
  );
});

test('20261019-184719 CR1: the same delivery recorded as a [review] verdict exits 0', () => {
  const root = verdictRepo('- **2026-10-19T00:04:00Z** `[review]` in-review → done');

  const out = captureOutput();
  const code = check([VERDICT_ID], root, out);

  assert.equal(code, 0, out.diagnostics.join('\n'));
});

// --- 20261019-184719 CR3: the pending-acceptance warning reaches archived ---

// A Log that lived through a retired status is the population CR1 was written
// for: in the two consuming repos most of what is not archived names
// `in-validation` or `blocked` somewhere in its Log. The replay abandons at
// the first non-canonical status, so a gate that sat below that check was void
// in exactly those documents.
test('20261019-184719 CR1: a retired status earlier in the Log does not mask the delivery', () => {
  const root = verdictRepo('- **2026-10-19T00:06:00Z** `[status]` in-review → done', [
    '- **2026-10-19T00:04:00Z** `[status]` in-review → in-validation',
    '- **2026-10-19T00:05:00Z** `[status]` in-validation → in-review',
  ]);

  const out = captureOutput();
  const code = check([VERDICT_ID], root, out);

  assert.equal(code, 1, `expected a non-zero exit, got ${code}: ${out.diagnostics.join('\n')}`);
  assert.ok(
    out.diagnostics.some((d) => d.includes(`changeledger review ${VERDICT_ID} pass`)),
    `expected the verdict seat to be named: ${out.diagnostics.join('\n')}`,
  );
});

test('20261019-184719 CR3: an archived done change with a merged branch is warned like a live one', () => {
  const live = acceptFixture();
  const liveOut = captureOutput();
  check([ACCEPT_ID], live.root, liveOut);
  const liveWarning = liveOut.diagnostics.find((d) => d.includes('accepted'));
  assert.ok(liveWarning, 'the live subject must warn, otherwise this test proves nothing');

  const archived = acceptFixture({
    doc: acceptDoc().replace('status: done', 'status: done\narchived: true'),
  });
  const out = captureOutput();
  check([ACCEPT_ID], archived.root, out);

  const warning = out.diagnostics.find((d) => d.includes('accepted'));
  assert.ok(warning, `expected the archived change to warn too: ${out.diagnostics.join('\n')}`);
  // The two fixtures are independent git repos, so only the merge sha differs.
  const withoutSha = (line) => line.replace(/merged [0-9a-f]{7,40}/, 'merged <sha>');
  assert.equal(
    withoutSha(warning),
    withoutSha(liveWarning),
    'the archived change must be named exactly as the live one',
  );
});

// --- 20261019-184719 CR7: no legacy edge duplicates a canonical one --------
//
// The invariant, not the membership: `LEGACY_EDGES` exists only to tolerate
// history the current graph refuses. An edge `TRANSITIONS` already allows does
// no work there and hides which of the two authorities decided a replay.

test('20261019-184719 CR7: every LEGACY_EDGES entry names canonical statuses and a non-canonical edge', () => {
  const canonical = new Set(CANONICAL_STATUSES);
  assert.ok(LEGACY_EDGES.size > 0, 'an empty allowance would make this vacuous');
  for (const edge of LEGACY_EDGES) {
    const [from, to] = edge.split('→');
    assert.ok(
      canonical.has(from) && canonical.has(to),
      `legacy edge "${edge}" names a status the graph does not model`,
    );
    assert.equal(
      canTransition(from, to),
      false,
      `legacy edge "${edge}" is already canonical in TRANSITIONS — it allows nothing`,
    );
  }
});

// --- 20261023-181753: readiness retired, the dangling reference stays ---

const FEATURE_FIXTURE_CONFIG = FROZEN_FIXTURE_CONFIG;

const STATUS_LOG = {
  draft: '',
  approved: '- **2026-06-13T12:01:00Z** `[status]` draft → approved\n',
  'in-progress':
    '- **2026-06-13T12:01:00Z** `[status]` draft → approved\n' +
    '- **2026-06-13T12:02:00Z** `[status]` approved → in-progress\n',
  done:
    '- **2026-06-13T12:01:00Z** `[status]` draft → approved\n' +
    '- **2026-06-13T12:02:00Z** `[status]` approved → in-progress\n' +
    '- **2026-06-13T12:03:00Z** `[status]` in-progress → in-review\n' +
    '- **2026-06-13T12:04:00Z** `[review]` in-review → done (delegated subagent, clean context)\n',
};

function featureDoc(id, status, specification, plan) {
  return `---
id: "${id}"
title: X
type: change
status: ${status}
created: 2026-06-13T12:00:00Z
depends_on: []
---

## Request

R

### Objective

O

### Frontier

F

### Investigation

### Proposal

## Specification

${specification}
## Plan

${plan}
## Log

${STATUS_LOG[status]}`;
}

const READINESS_DIAGNOSTIC =
  /is not test-grade|must name target and verification|is not covered by any Plan task|references no criterion/;

test('20261023-181753 CR3: check judges no readiness in draft, approved or in-progress, and the draft approves', () => {
  const specification = '### CR1 — x\n\nProse without steps.\n\n### CR2 — y\n\nMore prose.\n';
  const plan = '- [ ] untargeted work\n- [ ] cites CR1 only\n  - **Criteria:** CR1\n';
  const ids = { draft: '20260613-120000', approved: '20260613-120001' };
  ids['in-progress'] = '20260613-120002';
  const root = frozenFixture(
    Object.fromEntries(
      Object.entries(ids).map(([status, id]) => [
        `${id}-x.md`,
        featureDoc(id, status, specification, plan),
      ]),
    ),
    {},
    {},
    FEATURE_FIXTURE_CONFIG,
  );

  const { text } = runCheck(root);
  const { errors, warnings } = checkRepo(loadRepo(root));

  assert.deepEqual(
    [...msgs(errors), ...msgs(warnings)].filter((m) => READINESS_DIAGNOSTIC.test(m)),
    [],
  );
  assert.doesNotMatch(text, READINESS_DIAGNOSTIC);
  approve(ids.draft, root);
  assert.equal(
    parseChange(
      fs.readFileSync(path.join(root, '.changeledger', 'changes', `${ids.draft}-x.md`), 'utf8'),
    ).frontmatter.status,
    'approved',
  );
});

for (const status of ['draft', 'in-progress', 'done']) {
  test(`20261023-181753 CR4: a task citing an undeclared criterion is an error in ${status}`, () => {
    const id = '20260613-120000';
    const resolved = status === 'done' ? '  - **Resolved:** `2026-06-13T12:02:30Z`\n' : '';
    const plan = `- [${status === 'done' ? 'x' : ' '}] do it\n  - **Criteria:** CR9\n${resolved}`;
    const root = frozenFixture(
      { [`${id}-x.md`]: featureDoc(id, status, '### CR1 — x\n', plan) },
      {},
      {},
      FEATURE_FIXTURE_CONFIG,
    );

    const { errors, warnings } = checkRepo(loadRepo(root));

    const unknown = 'Plan task references unknown criterion "CR9"';
    assert.ok(msgs(errors).includes(unknown), msgs(errors).join('\n'));
    assert.ok(!msgs(warnings).includes(unknown), msgs(warnings).join('\n'));
  });
}

// Unspecified by the change: the effective `tdd` no longer gates the reference
// check, which is structure, not test-first policy.
test('20261023-181753 CR4: tdd off does not exempt a task citing an undeclared criterion', () => {
  const { errors } = checkRepo({
    config: { ...tddConfig, tdd: false },
    changes: [
      cov({
        frontmatter: { status: 'draft' },
        criteria: ['CR1'],
        tasks: [{ state: 'todo', text: 'do it', criteria: ['CR9'] }],
      }),
    ],
  });
  assert.ok(msgs(errors).includes('Plan task references unknown criterion "CR9"'));
});

// Unspecified by the change: a document with no Request at all is named as
// missing rather than empty.
test('20261023-181753 CR2: a document with no Request is refused as missing', () => {
  const text =
    '---\nid: "20260613-120000"\ntitle: X\ntype: change\nstatus: draft\ncreated: 2026-06-13T12:00:00Z\ndepends_on: []\n---\n\n## Log\n';
  assert.throws(() => assertApprovable(text), {
    message: 'cannot approve: "## Request" is missing',
  });
});

// --- 20261024-121022: two types, four fixed stages, no matrix ---------------

const schema7 = {
  schema_version: 7,
  min_cli_version: VERSION,
  changes_dir: '.changeledger/changes',
  statuses: ['draft', 'approved', 'in-progress', 'in-review', 'done', 'discarded'],
};

function doc(text, name = undefined) {
  const parsed = parseChange(text);
  return { name: name ?? `${parsed.frontmatter.id}-x.md`, text, ...parsed };
}

function docText({ id = '20261024-120000', type = 'change', status = 'draft', extra = '', body }) {
  return `---\nid: "${id}"\ntitle: X\ntype: ${type}\nstatus: ${status}\ncreated: 2026-10-24T12:00:00Z\ndepends_on: []\n${extra}---\n\n${body ?? '## Request\n\nR.\n'}`;
}

test('20261024-121022 CR2: a live document with a retired type is told to set type to change', () => {
  const { errors } = checkRepo({
    config: schema7,
    changes: [
      doc(docText({ id: '20261024-120000', type: 'feature' })),
      doc(docText({ id: '20261024-120001', type: 'quick', status: 'in-progress' })),
    ],
  });
  assert.deepEqual(
    errors.map((e) => `${e.file}: ${e.message}`),
    [
      '20261024-120000-x.md: type "feature" is retired: set type to "change"',
      '20261024-120001-x.md: type "quick" is retired: set type to "change"',
    ],
  );
});

test('20261024-121022 CR2: every retired type names the same correction', () => {
  for (const type of [
    'feature',
    'bug',
    'hotfix',
    'audit',
    'refactor',
    'chore',
    'quick',
    'documentation',
  ]) {
    const { errors } = checkRepo({ config: schema7, changes: [doc(docText({ type }))] });
    assert.deepEqual(msgs(errors), [`type "${type}" is retired: set type to "change"`], type);
  }
});

test('20261024-121022 CR2: an unknown type names the two valid ones', () => {
  const { errors } = checkRepo({ config: schema7, changes: [doc(docText({ type: 'spike' }))] });
  assert.deepEqual(msgs(errors), ['unknown type "spike"; valid types: change, epic']);
});

// A `type:` that is not a plain string — a list, a mapping — is unknown, never
// "retired": `Object.hasOwn` over the retired map would coerce `[feature]` to
// "feature" and send the author to `fix`, which cannot read such a line.
test('20261024-121022 CR2: a type that is not a string is unknown, not retired', () => {
  const { errors } = checkRepo({
    config: schema7,
    changes: [doc(docText({ type: '[feature]' }))],
  });
  assert.deepEqual(msgs(errors), ['unknown type "feature"; valid types: change, epic']);
});

test('20261024-121022 CR2: frozen history carrying a retired or unknown type gets no type error', () => {
  for (const type of ['feature', 'quick', 'spike']) {
    const { errors } = checkRepo({
      config: schema7,
      changes: [
        doc(docText({ id: '20261024-120000', type, status: 'done', extra: 'archived: true\n' })),
        doc(docText({ id: '20261024-120001', type, status: 'discarded' })),
      ],
    });
    assert.deepEqual(msgs(errors), [], type);
  }
});

test('20261024-121022 CR3: Request and Log alone, or all four stages, carry no stage diagnostic', () => {
  const { errors, warnings } = checkRepo({
    config: schema7,
    changes: [
      doc(
        docText({ id: '20261024-120000', status: 'draft', body: '## Request\n\nR.\n\n## Log\n' }),
      ),
      doc(
        docText({
          id: '20261024-120001',
          body: '## Request\n\nR.\n\n## Specification\n\n### CR1 — x\n\n## Plan\n\n- [ ] t\n  - **Criteria:** CR1\n\n## Log\n',
        }),
      ),
    ],
  });
  assert.deepEqual([...msgs(errors), ...msgs(warnings)], []);
});

test('20261024-121022 CR3: an Investigation stage is unknown and the valid stages are the four', () => {
  const { errors } = checkRepo({
    config: schema7,
    changes: [
      doc(
        docText({
          body: '## Request\n\nR.\n\n## Investigation\n\nI.\n\n## Specification\n\n### CR1 — x\n\n## Log\n',
        }),
      ),
    ],
  });
  assert.deepEqual(msgs(errors), [
    'unknown stage "## investigation"; valid stages: request, specification, plan, log — run `changeledger fix`',
  ]);
  assert.ok(!msgs(errors).some((m) => /missing active stage|is not active for type/.test(m)));
});

test('20261024-121022 CR3: only a retired stage names the fix that repairs it', () => {
  const { errors } = checkRepo({
    config: schema7,
    changes: [
      doc(docText({ body: '## Request\n\nR.\n\n## Proposal\n\nP.\n\n## Notes\n\nN.\n\n## Log\n' })),
    ],
  });
  assert.deepEqual(msgs(errors), [
    'unknown stage "## proposal"; valid stages: request, specification, plan, log — run `changeledger fix`',
    'unknown stage "## notes"; valid stages: request, specification, plan, log',
  ]);
});

test('20261024-121022 CR3: Investigation and Proposal as Request subsections are free prose', () => {
  const body =
    '## Request\n\n### Objective\n\nO.\n\n### Frontier\n\nF.\n\n### Investigation\n\nI.\n\n### Proposal\n\nP.\n\n## Log\n';
  const { errors, warnings } = checkRepo({ config: schema7, changes: [doc(docText({ body }))] });
  assert.deepEqual([...msgs(errors), ...msgs(warnings)], []);
});

test('20261024-121022 CR3: a Proposal stage in an archived document gets no error', () => {
  const { errors } = checkRepo({
    config: schema7,
    changes: [
      doc(
        docText({
          status: 'done',
          extra: 'archived: true\n',
          body: '## Request\n\nR.\n\n## Proposal\n\nP.\n\n## Log\n',
        }),
      ),
    ],
  });
  assert.deepEqual(msgs(errors), []);
});

// Unspecified by the change: an epic carries no implementation, so the stages
// that hold one are a defect in it rather than prose.
test('20261024-121022 CR3: an epic carrying Specification or Plan is told its children carry them', () => {
  const { errors } = checkRepo({
    config: schema7,
    changes: [
      doc(
        docText({
          type: 'epic',
          body: '## Request\n\nR.\n\n## Specification\n\n### CR1 — x\n\n## Plan\n\n- [ ] t\n\n## Log\n',
        }),
      ),
    ],
  });
  assert.deepEqual(msgs(errors), [
    'stage "## specification" does not belong in an epic: its children carry the work',
    'stage "## plan" does not belong in an epic: its children carry the work',
  ]);
});

test('20261024-121022 CR8: tdd in the frontmatter must be a boolean', () => {
  const ok = checkRepo({ config: schema7, changes: [doc(docText({ extra: 'tdd: false\n' }))] });
  assert.deepEqual(msgs(ok.errors), []);
  const { errors } = checkRepo({
    config: schema7,
    changes: [doc(docText({ extra: 'tdd: "no"\n' }))],
  });
  assert.deepEqual(msgs(errors), ['tdd must be a boolean']);
});

test('20261024-121022 CR8: effectiveTdd reads the change frontmatter, then the global value', () => {
  assert.equal(effectiveTdd({ tdd: true }, { tdd: false }), false);
  assert.equal(effectiveTdd({ tdd: false }, { tdd: true }), true);
  assert.equal(effectiveTdd({ tdd: true }, {}), true);
  assert.equal(effectiveTdd({ tdd: false }, {}), false);
  assert.equal(effectiveTdd({}, {}), true);
  assert.equal(
    effectiveTdd({ tdd: false, types: { change: { tdd: true } } }, { type: 'change' }),
    false,
  );
});

// The epic's `none` and its absent tdd take precedence over its own keys, so a
// declared value would be silently ignored: check says so.
test('20261024-121022 CR9/CR8: release_impact and tdd on an epic are warned as ignored', () => {
  const epic = (extra) =>
    doc(docText({ type: 'epic', extra, body: '## Request\n\nR.\n\n## Log\n' }));
  const { errors, warnings } = checkRepo({
    config: schema7,
    changes: [epic('release_impact: major\ntdd: true\n')],
  });
  assert.deepEqual(msgs(errors), []);
  assert.deepEqual(msgs(warnings), [
    'release_impact on an epic is ignored: its children carry the impact',
    'tdd on an epic is ignored: it carries no implementation',
  ]);

  const plain = checkRepo({
    config: schema7,
    changes: [
      epic(''),
      doc(docText({ id: '20261024-120001', extra: 'release_impact: major\ntdd: false\n' })),
    ],
  });
  assert.deepEqual([...msgs(plain.errors), ...msgs(plain.warnings)], []);
});

test('20261024-121022 CR9: release.default_impact must be one of the four impacts', () => {
  for (const impact of RELEASE_IMPACTS) {
    const { errors } = checkRepo({
      config: { ...schema7, release: { default_impact: impact } },
      changes: [],
    });
    assert.deepEqual(msgs(errors), [], impact);
  }
  const { errors } = checkRepo({
    config: { ...schema7, release: { default_impact: 'big' } },
    changes: [],
  });
  assert.deepEqual(msgs(errors), [
    'config "release.default_impact" must be one of: none, patch, minor, major',
  ]);
});

test('20261024-121022 CR10: integrates_into must name a role', () => {
  for (const role of ['integration', 'release']) {
    const { errors } = checkRepo({
      config: { ...schema7, git: { integration_branch: 'dev', release_branch: 'main' } },
      changes: [doc(docText({ extra: `integrates_into: ${role}\n` }))],
    });
    assert.deepEqual(msgs(errors), [], role);
  }
  const { errors } = checkRepo({
    config: { ...schema7, git: { integration_branch: 'dev', release_branch: 'main' } },
    changes: [doc(docText({ extra: 'integrates_into: foo\n' }))],
  });
  assert.deepEqual(msgs(errors), ['integrates_into must be "integration" or "release"']);
});

test('20261024-121022 CR10: a live change integrating into an undeclared release branch is reported', () => {
  const { errors } = checkRepo({
    config: { ...schema7, git: { integration_branch: 'dev' } },
    changes: [doc(docText({ extra: 'integrates_into: release\n' }))],
  });
  assert.deepEqual(msgs(errors), [
    'change 20261024-120000 integrates into git.release_branch, which is not declared — set git.release_branch in .changeledger/config.yml, for example "main"',
  ]);
});

test('20261024-121022 CR13: each retired config key is an error naming config migrate', () => {
  const { errors } = checkRepo({
    config: {
      ...schema7,
      schema_version: 6,
      stages: ['request', 'log'],
      types: { feature: { stages: ['request', 'log'] } },
      release: { impacts: { feature: 'minor' } },
      readiness: { target_patterns: ['src/**'] },
    },
    changes: [],
  });
  assert.deepEqual(msgs(errors), [
    'config "types" is retired: run `changeledger config migrate`',
    'config "stages" is retired: run `changeledger config migrate`',
    'config "release.impacts" is retired: run `changeledger config migrate`',
    'config "readiness" is retired: run `changeledger config migrate`',
  ]);
});

test('20261024-121022 CR13: a schema 7 config that keeps readiness gets only that error', () => {
  const { errors } = checkRepo({
    config: { ...schema7, readiness: { target_patterns: ['src/**'] } },
    changes: [],
  });
  assert.deepEqual(msgs(errors), [
    'config "readiness" is retired: run `changeledger config migrate`',
  ]);
});

test('20261024-121022 CR13: a config without stages or types is complete', () => {
  const { errors } = checkRepo({ config: schema7, changes: [] });
  assert.deepEqual(msgs(errors), []);
});

// Unspecified by the change: with no matrix, the `in-review` gate asks for both
// stages wherever they are absent, instead of leaving an absent heading to a
// structural check that no longer reports it.
test('20261024-121022 CR3: in-review asks for a Specification with a criterion and a Plan', () => {
  const at = (body) => docText({ status: 'in-progress', body });
  assert.throws(() => assertReviewable(at('## Request\n\nR.\n\n## Log\n')), {
    message: 'cannot request review: "## Specification", "## Plan" are missing',
  });
  assert.throws(
    () => assertReviewable(at('## Request\n\nR.\n\n## Specification\n\n## Plan\n\n- [ ] t\n')),
    { message: 'cannot request review: "## Specification" is empty' },
  );
  assert.throws(
    () =>
      assertReviewable(
        at('## Request\n\nR.\n\n## Specification\n\nProse.\n\n## Plan\n\n- [ ] t\n'),
      ),
    { message: 'cannot request review: "## Specification" declares no criterion' },
  );
  assert.doesNotThrow(() =>
    assertReviewable(
      at('## Request\n\nR.\n\n## Specification\n\n### CR1 — x\n\n## Plan\n\n- [ ] t\n'),
    ),
  );
});

test('20261024-202659 CR3: check rejects a malformed finding with the existing typed-event error', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-check-finding-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  initializeRepo(root);
  fs.writeFileSync(
    path.join(root, '.changeledger', 'changes', '20261025-100000-x.md'),
    [
      '---',
      'id: "20261025-100000"',
      'title: X',
      'type: change',
      'status: draft',
      'created: 2026-10-25T10:00:00Z',
      'depends_on: []',
      '---',
      '',
      '## Request',
      '',
      'x',
      '',
      '## Log',
      '',
      '- **2026-10-25T10:00:00Z** `[finding]` 2 promoted #abc',
      '',
    ].join('\n'),
  );
  const lines = [];
  const output = { log: (m) => lines.push(m), error: (m) => lines.push(m) };
  assert.equal(check([], root, output), 1);
  assert.match(
    lines.join('\n'),
    /Log line \d+: invalid typed event; valid types: status, review, validation, owner, branch, graduation, archive, note, version, finding; expected: - \*\*YYYY-MM-DDTHH:MM:SSZ\*\* `\[type\]` payload/,
  );
});

test('the change id form has one seat that check reads for the id, parent and finding target', () => {
  assert.equal(CHANGE_ID_FORM.source, '^\\d{8}-\\d{6}$');
  const srcDir = new URL('../src/', import.meta.url);
  const sources = fs
    .readdirSync(srcDir, { recursive: true })
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => [name, fs.readFileSync(new URL(name, srcDir), 'utf8')]);
  for (const [name, text] of sources) {
    assert.doesNotMatch(text, /\b(?:ID_FORM|CHANGE_ID)\b/, name);
  }
  const { errors } = run([
    change({ frontmatter: { id: 'abc', parent: 'nope' }, name: 'abc-x.md' }),
  ]);
  assert.ok(msgs(errors).includes('id not in YYYYMMDD-HHMMSS form: abc'), msgs(errors).join(' | '));
  assert.ok(msgs(errors).includes('parent "nope" is not a change id'), msgs(errors).join(' | '));
});

// A live Log with one orphan resolution (F9) and a second resolution of F1.
function findingResolutionLog(status) {
  const lines = [
    '- **2026-06-13T12:10:00Z** `[finding]` falta la vista',
    '- **2026-06-13T12:11:00Z** `[finding]` 9 dropped: x',
    '- **2026-06-13T12:12:00Z** `[finding]` 1 dropped: no aplica',
    '- **2026-06-13T12:13:00Z** `[finding]` 1 dropped: otra vez',
  ];
  const text = seqChange(status, lines);
  const lineOf = (line) => text.split('\n').indexOf(line) + 1;
  return { text, lineOf, lines };
}

test('check reports an orphan or a repeated finding resolution in a live document with its line', () => {
  const { text, lineOf, lines } = findingResolutionLog('draft');
  const errors = msgs(covResult(text).errors).filter((m) => /finding F/.test(m));
  assert.deepEqual(errors, [
    `Log line ${lineOf(lines[1])}: finding F9 resolved but never recorded`,
    `Log line ${lineOf(lines[3])}: finding F1 already resolved at line ${lineOf(lines[2])}`,
  ]);
});

test('check reads past a fenced example of a Log outside the Log stage', () => {
  const text = seqChange('draft', [
    '- **2026-06-13T12:10:00Z** `[finding]` falta la vista',
  ]).replace(
    '## Request\n\nr\n',
    [
      '## Request',
      '',
      'An example of a resolved finding:',
      '',
      '```markdown',
      '## Log',
      '- **2026-06-13T12:00:00Z** `[finding]` 3 dropped: no aplica',
      '```',
      '',
    ].join('\n'),
  );
  const errors = msgs(covResult(text).errors).filter((m) => /Log line/.test(m));
  assert.deepEqual(errors, []);
});

test('check reads the whole first Log stage past a fenced pseudo-heading inside it', () => {
  const orphan = '- **2026-06-13T12:11:00Z** `[finding]` 9 dropped: x';
  const text = `${seqChange('draft', [
    '- **2026-06-13T12:10:00Z** `[finding]` falta la vista',
    '```text',
    '## not a heading',
    '```',
    orphan,
  ])}\n## Log\n\n- **2026-06-13T12:12:00Z** \`[finding]\` 8 dropped: second stage\n`;
  const errors = msgs(covResult(text).errors).filter((m) => /finding F/.test(m));
  assert.deepEqual(errors, [
    `Log line ${text.split('\n').indexOf(orphan) + 1}: finding F9 resolved but never recorded`,
  ]);

  const shouted = seqChange('draft', [orphan]).replace('## Log\n', '## LOG\n');
  assert.deepEqual(
    msgs(covResult(shouted).errors).filter((m) => /finding F/.test(m)),
    [`Log line ${shouted.split('\n').indexOf(orphan) + 1}: finding F9 resolved but never recorded`],
  );
});

test('check leaves orphan and repeated finding resolutions alone in frozen history', () => {
  for (const status of ['discarded', 'done\narchived: true']) {
    const { text } = findingResolutionLog(status);
    const errors = msgs(covResult(text).errors).filter((m) => /finding F/.test(m));
    assert.deepEqual(errors, [], status);
  }
});
