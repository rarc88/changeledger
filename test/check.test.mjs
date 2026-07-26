import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parse as parseYaml } from 'yaml';
import { parseChange } from '../src/change.mjs';
import { checkRepo } from '../src/check.mjs';
import { check } from '../src/commands/check.mjs';
import { ensureReference } from '../src/contract.mjs';
import { templatesDir } from '../src/paths.mjs';

const config = {
  changes_dir: '.changeledger/changes',
  statuses: ['draft', 'approved', 'in-progress', 'in-validation', 'blocked', 'done'],
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
  const changes = [
    source,
    sibling('20260613-130001'),
    sibling('20260613-130002'),
    sibling('20260613-130003', { related_to: ['20260613-120000'] }),
    sibling('20260613-130004'),
    closedSource,
    archivedSource,
  ];

  const unclassified = run(changes).warnings.filter((warning) =>
    warning.message.startsWith('mentions change'),
  );
  assert.deepEqual(unclassified, []);
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
  const bad = { ...config, statuses: { draft: true }, stages: { request: true }, types: [] };
  const { errors } = checkRepo({ config: bad, changes: [change()] });
  assert.ok(msgs(errors).some((message) => message.includes('config "statuses" must be a list')));
  assert.ok(msgs(errors).some((message) => message.includes('config "stages" must be a list')));
  assert.ok(msgs(errors).some((message) => message.includes('config "types" must be a mapping')));
});

test('111218 CR4: malformed type definitions report precise structural errors', () => {
  const scalarTypes = checkRepo({ config: { ...config, types: 'feature' }, changes: [change()] });
  assert.ok(
    msgs(scalarTypes.errors).some((message) =>
      message.includes('config "types" must be a mapping'),
    ),
  );

  for (const stages of [{ request: true }, 'request']) {
    const result = checkRepo({
      config: { ...config, types: { feature: { stages } } },
      changes: [change()],
    });
    assert.ok(
      msgs(result.errors).some((message) =>
        message.includes('config type "feature": stages must be a list'),
      ),
    );
  }
});

test('111218 CR4: malformed readiness patterns report errors without breaking coverage', () => {
  for (const target_patterns of ['src/**', { src: true }]) {
    const result = checkRepo({
      config: { ...config, readiness: { target_patterns, verification_patterns: ['test/**'] } },
      changes: [change()],
    });
    assert.ok(
      msgs(result.errors).some((message) =>
        message.includes('config "readiness.target_patterns" must be a list'),
      ),
    );
  }
});

test('171002 CR1/CR5: every config with done requires in-validation before it', () => {
  const missing = {
    ...config,
    statuses: ['draft', 'approved', 'in-progress', 'blocked', 'done'],
  };
  assert.ok(
    msgs(checkRepo({ config: missing, changes: [] }).errors).some((m) =>
      /must include "in-validation" before "done"/.test(m),
    ),
  );
  const misplaced = {
    ...config,
    statuses: ['draft', 'approved', 'in-progress', 'in-review', 'done', 'in-validation'],
  };
  assert.ok(
    msgs(checkRepo({ config: misplaced, changes: [] }).errors).some((m) =>
      /"in-validation" must appear before "done"/.test(m),
    ),
  );
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
    '- [ ] Update src/foo.mjs (CR1) — verify: pnpm test',
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
type: feature
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

// --- Definition of Ready coverage (tdd) ---

const tddConfig = {
  changes_dir: '.changeledger/changes',
  statuses: ['draft', 'approved', 'in-progress', 'in-validation', 'blocked', 'done'],
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

test('195016 CR1: task with (support) does not warn about missing criterion', () => {
  const w = covWarn({
    criteria: ['CR1'],
    tasks: [
      { state: 'todo', text: 'run pnpm test (support)', criteria: [] },
      { state: 'todo', text: 'real impl (CR1)', criteria: ['CR1'] },
    ],
  });
  assert.ok(!w.some((m) => /pnpm test/.test(m)), '(support) task must not warn');
});

test('195016 CR2: task without (support) still warns when no criterion', () => {
  const w = covWarn({
    criteria: ['CR1'],
    tasks: [
      { state: 'todo', text: 'plain task with no cr', criteria: [] },
      { state: 'todo', text: 'real (CR1)', criteria: ['CR1'] },
    ],
  });
  assert.ok(
    w.some((m) => /plain task with no cr/.test(m)),
    'non-support task must warn',
  );
});

test('195016 CR1: (support) task does not trigger readiness check', () => {
  // readiness check only fires on tasks with criteria — so support tasks are
  // already exempt from readiness even without the (support) exemption.
  // Verify this holds: a (support) task with no src/test references causes no warning.
  const w = covWarn({
    criteria: ['CR1'],
    tasks: [
      { state: 'todo', text: 'read docs (support)', criteria: [] },
      {
        state: 'todo',
        text: 'impl in src/x.mjs verified with test/x.test.mjs (CR1)',
        criteria: ['CR1'],
      },
    ],
  });
  assert.ok(!w.some((m) => /read docs/.test(m)), '(support) task must not trigger readiness');
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

test('151216 CR2: approved implementation tasks must name target and verification', () => {
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
  assert.ok(
    msgs(errors).some((m) => /Plan task for CR1 must name target and verification/.test(m)),
  );
});

test('122611 CR1: default readiness gaps show the effective default patterns', () => {
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
  const message = msgs(errors).find((m) => /Plan task for CR1/.test(m));
  assert.match(message, /default readiness/);
  assert.match(message, /target_patterns=\["src\/\*\*"\]/);
  assert.match(message, /verification_patterns=\["test\/\*\*"\]/);
});

test('020229 CR1: readiness patterns are configurable per repo', () => {
  const { errors } = covResult(
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

### CR1 — Complete
- **Given** input
- **When** action
- **Then** output

## Plan

- [ ] Update app/profile.ts and app/profile.spec.ts (CR1)

## Log
`,
    {
      ...tddConfig,
      readiness: {
        target_patterns: ['app/**'],
        verification_patterns: ['**/*.spec.ts'],
      },
    },
  );
  assert.deepEqual(
    msgs(errors).filter((m) => /target and verification/.test(m)),
    [],
  );
});

test('020229 CR1: verification can be a command instead of a test path', () => {
  const { errors } = covResult(
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

### CR1 — Complete
- **Given** input
- **When** action
- **Then** output

## Plan

- [ ] Update packages/auth/index.ts and run pnpm test --filter auth (CR1)

## Log
`,
    {
      ...tddConfig,
      readiness: {
        target_patterns: ['packages/**'],
        verification_patterns: ['pnpm test'],
      },
    },
  );
  assert.deepEqual(
    msgs(errors).filter((m) => /target and verification/.test(m)),
    [],
  );
});

test('122611 CR2: configured readiness gaps show configured patterns', () => {
  const { errors } = covResult(
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

### CR1 — Complete
- **Given** input
- **When** action
- **Then** output

## Plan

- [ ] Implement the behavior somewhere else (CR1)

## Log
`,
    {
      ...tddConfig,
      readiness: {
        target_patterns: ['app/**'],
        verification_patterns: ['pnpm test'],
      },
    },
  );
  const message = msgs(errors).find((m) => /Plan task for CR1/.test(m));
  assert.match(message, /configured readiness/);
  assert.match(message, /target_patterns=\["app\/\*\*"\]/);
  assert.match(message, /verification_patterns=\["pnpm test"\]/);
});

test('122611 CR3: verify clause can be the configured verification convention', () => {
  const { errors } = covResult(
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

### CR1 — Complete
- **Given** input
- **When** action
- **Then** output

## Plan

- [ ] Update app/profile.ts; verify: manual device check (CR1)

## Log
`,
    {
      ...tddConfig,
      readiness: {
        target_patterns: ['app/**'],
        verification_patterns: ['verify:'],
      },
    },
  );
  assert.deepEqual(
    msgs(errors).filter((m) => /target and verification/.test(m)),
    [],
  );
});

test('115134 CR5 / 125007 CR1: verification precedes final criteria despite punctuation', () => {
  const { errors } = covResult(
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

### CR1 — Complete
- **Given** input
- **When** action
- **Then** output

## Plan

- [ ] Update app/profile.ts — verify: manual device check (CR1)

## Log
`,
    {
      ...tddConfig,
      readiness: {
        target_patterns: ['app/**'],
        verification_patterns: ['verify:'],
      },
    },
  );
  assert.deepEqual(errors, []);
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
    msgs(errors).filter((m) => /test-grade|target and verification/.test(m)),
    [],
  );
  assert.ok(msgs(warnings).some((m) => /CR1 is not test-grade/.test(m)));
  assert.ok(
    msgs(warnings).some((m) => /Plan task for CR1 must name target and verification/.test(m)),
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
    [...msgs(errors), ...msgs(warnings)].filter((m) =>
      /test-grade|target and verification/.test(m),
    ),
    [],
  );
});

test('020229 CR5: invalid readiness config fails clearly', () => {
  const { errors } = checkRepo({
    config: {
      ...tddConfig,
      readiness: { target_patterns: 'src/**', verification_patterns: ['test/**', ''] },
    },
    changes: [cov()],
  });
  assert.ok(msgs(errors).some((m) => /readiness\.target_patterns" must be a list/.test(m)));
  assert.ok(msgs(errors).some((m) => /readiness\.verification_patterns" entries/.test(m)));
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

// 20260711-103756 CR3: the `quick` lane scaffolds only request+log — check
// must accept it with no diagnostics for the deactivated stages.
test('103756 CR3: a valid quick change with only request and log passes clean', () => {
  const cfg = { ...config, types: { ...config.types, quick: { stages: ['request', 'log'] } } };
  const c = {
    name: '20260613-120000-x.md',
    frontmatter: {
      id: '20260613-120000',
      title: 'X',
      type: 'quick',
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

test('225208 CR3: approved keeps the severity split — defects error, coverage gaps warn', () => {
  const text = `---
id: "20260613-120000"
title: x
type: feature
status: approved
created: 2026-06-13T12:00:00Z
depends_on: []
---

## Request

r

## Specification

### CR1 — Test-grade
- **Given** a
- **When** b
- **Then** c

### CR2 — Not test-grade
- **Given** a

### CR3 — Uncovered
- **Given** a
- **When** b
- **Then** c

## Plan

- [ ] Update \`src/a.mjs\`; verify: \`node --test test/a.test.mjs\` (CR1)
- [ ] vague work without recognizable evidence (CR2)
- [ ] Update \`src/b.mjs\`; verify: \`node --test test/b.test.mjs\` (CR404)
- [ ] loose task without criterion

## Log

- l
`;
  const { errors, warnings } = covResult(text);
  const e = msgs(errors);
  const w = msgs(warnings);
  assert.ok(e.some((m) => /CR2 is not test-grade: missing Given\/When\/Then/.test(m)));
  assert.ok(e.some((m) => /references unknown criterion "CR404"/.test(m)));
  assert.ok(e.some((m) => /Plan task for CR2 must name target and verification/.test(m)));
  assert.ok(w.some((m) => /CR3 is not covered by any Plan task/.test(m)));
  assert.ok(w.some((m) => /references no criterion/.test(m)));
  assert.deepEqual(
    e.filter((m) => /covered by any Plan task|references no criterion/.test(m)),
    [],
  );
});

// 20260630-225210 — lifecycle sequence validation over ## Log.
function seqChange(status, logLines) {
  return `---
id: "20260613-120000"
title: x
type: feature
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

- [ ] Update \`src/a.mjs\`; verify: \`node --test test/a.test.mjs\` (CR1)

## Log

${logLines.join('\n')}
`;
}

test('225210 CR1: a repeated review verdict after in-validation is an error with line and expectation', () => {
  const text = seqChange('done', [
    '- **2026-06-13T12:10:00Z** `[status]` draft → approved',
    '- **2026-06-13T12:20:00Z** `[status]` approved → in-progress',
    '- **2026-06-13T12:30:00Z** `[status]` in-progress → in-review',
    '- **2026-06-13T12:40:00Z** `[review]` in-review → in-validation (delegated subagent, clean context)',
    '- **2026-06-13T12:50:00Z** `[review]` in-review → in-validation (delegated subagent, clean context)',
    '- **2026-06-13T13:00:00Z** `[validation]` in-validation → done (human accepted)',
  ]);
  const e = msgs(covResult(text).errors);
  assert.ok(
    e.some((m) =>
      /Log line \d+: transition "in-review → in-validation" starts from "in-review" but the reconstructed status is "in-validation"/.test(
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
    '- **2026-06-13T12:40:00Z** `[review]` in-review → in-progress (retry): reason',
    '- **2026-06-13T12:45:00Z** `[status]` in-progress → in-review',
    '- **2026-06-13T12:50:00Z** `[review]` in-review → in-validation (delegated subagent, clean context)',
    '- **2026-06-13T13:00:00Z** `[validation]` in-validation → done (human accepted)',
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

test('150232 CR6: sequence validation accepts reopen followed by normal gates', () => {
  const text = seqChange('done', [
    '- **2026-06-13T12:10:00Z** `[status]` draft → approved',
    '- **2026-06-13T12:20:00Z** `[status]` approved → in-progress',
    '- **2026-06-13T12:30:00Z** `[status]` in-progress → in-review',
    '- **2026-06-13T12:40:00Z** `[review]` in-review → in-validation (delegated subagent, clean context)',
    '- **2026-06-13T12:50:00Z** `[validation]` in-validation → done (human accepted)',
    '- **2026-06-13T13:00:00Z** `[status]` done → in-progress (human reopened): fix',
    '- **2026-06-13T13:10:00Z** `[status]` in-progress → in-review',
    '- **2026-06-13T13:20:00Z** `[review]` in-review → in-validation (delegated subagent, clean context)',
    '- **2026-06-13T13:30:00Z** `[validation]` in-validation → done (human accepted)',
  ]);
  assert.deepEqual(
    msgs(covResult(text).errors).filter((m) => /Log line|reconstructs status/.test(m)),
    [],
  );
});

test('225210 CR3: bounded legacy closes stay readable, not errors', () => {
  const legacyReviewClose = seqChange('done', [
    '- **2026-06-13T12:10:00Z** `[status]` draft → approved',
    '- **2026-06-13T12:20:00Z** `[status]` approved → in-progress',
    '- **2026-06-13T12:30:00Z** `[status]` in-progress → in-review',
    '- **2026-06-13T12:40:00Z** `[status]` in-review → done',
  ]);
  assert.deepEqual(
    msgs(covResult(legacyReviewClose).errors).filter((m) => /Log/.test(m)),
    [],
  );

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
const GIT_FIXTURE_ENV = { ...process.env };
for (const key of [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_CEILING_DIRECTORIES',
]) {
  delete GIT_FIXTURE_ENV[key];
}

function gitFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-check-commits-'));
  const git = (args) =>
    execFileSync('git', args, { cwd: root, env: GIT_FIXTURE_ENV, encoding: 'utf8' });
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
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

const FROZEN_FIXTURE_CONFIG = `schema_version: 4
language: en
tdd: true
changes_dir: .changeledger/changes
specs_dir: .changeledger/specs
statuses: [draft, approved, in-progress, in-review, in-validation, blocked, done, discarded]
stages: [request, investigation, proposal, specification, plan, log]
types:
  refactor:
    stages: [request, proposal, specification, plan, log]
    review_required: true
  chore:
    stages: [request, plan]
`;

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
    type: 'refactor',
    status: 'done',
    created: '2026-01-01T00:00:00Z',
    depends_on: '[]',
    ...over,
  };
  return Object.entries(fm)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
}

// A `refactor` body that omits `## Specification`, the stage the fixture config
// activates for that type — the defect today's rules report on frozen history.
function missingSpecification(over) {
  return `---\n${frontmatter(over)}\n---\n\n## Request\n\nX\n\n## Proposal\n\nX\n\n## Plan\n\nX\n\n## Log\n`;
}

// A well-formed `chore` body, used where the criterion is about repo-wide
// invariants rather than about per-document defects.
function validChore(over, logBody = '') {
  const fm = frontmatter({ type: 'chore', ...over });
  const log = logBody ? `\n## Log\n\n${logBody}\n` : '';
  return `---\n${fm}\n---\n\n## Request\n\nX\n\n## Plan\n\nX\n${log}`;
}

function runCheck(root, args = []) {
  const out = captureOutput();
  const code = check(args, root, out);
  return { code, out, text: [...out.diagnostics, ...out.calls].join('\n') };
}

test('194220 CR1: a done and archived change gets no diagnostics of its own', () => {
  const root = frozenFixture({
    '20260101-000000-frozen.md': missingSpecification({ archived: 'true' }),
  });
  const { code, out } = runCheck(root);
  assert.deepEqual(
    out.diagnostics.filter((line) => line.includes('20260101-000000-frozen.md')),
    [],
  );
  assert.equal(code, 0);
});

test('194220 CR2: a done change that is not archived is still validated', () => {
  const root = frozenFixture({ '20260101-000000-frozen.md': missingSpecification() });
  const { code, text } = runCheck(root);
  assert.ok(text.includes('missing active stage "## specification" for type refactor'), text);
  assert.equal(code, 1);
});

test('194220 CR3: a discarded change gets no diagnostics of its own', () => {
  const root = frozenFixture({
    '20260101-000000-frozen.md': missingSpecification({ status: 'discarded' }),
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
    '20260101-000000-frozen.md': missingSpecification({
      status: 'in-progress',
      archived: 'true',
    }),
  });
  const { code, text } = runCheck(root);
  assert.ok(text.includes('missing active stage "## specification" for type refactor'), text);
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
    type: 'chore',
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
    type: 'chore',
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

test('141119 CR7: a refactor missing Specification errors until the stage is written', () => {
  const cfg = {
    ...tddConfig,
    stages: ['request', 'proposal', 'specification', 'plan', 'log'],
    types: {
      refactor: {
        stages: ['request', 'proposal', 'specification', 'plan', 'log'],
        review_required: true,
      },
    },
  };
  const head = `---
id: "20260613-120000"
title: X
type: refactor
status: approved
created: 2026-06-13T12:00:00Z
depends_on: []
---

## Request

Quitar el flag heredado.

## Proposal

Eliminación limpia, sin capa de compatibilidad.
`;
  const tail = `
## Plan

- [ ] Quitar la opción de \`src/cli.mjs\`; verify: \`node --test test/cli.test.mjs\` (CR1)

## Log
`;
  const without = covResult(head + tail, cfg);
  assert.ok(
    msgs(without.errors).some((m) =>
      /missing active stage "## specification" for type refactor/.test(m),
    ),
    'a refactor without Specification must be an error once the stage is active',
  );

  const specification = `
## Specification

### CR1 — La opción deja de existir

- **Given** un repo inicializado
- **When** se ejecuta \`changeledger context --have x\`
- **Then** el proceso termina con código de salida 1
`;
  const withSpec = covResult(head + specification + tail, cfg);
  assert.deepEqual(msgs(withSpec.errors), []);
});

// --- 141119: review_required is only meaningful on a type that can hold
// criteria (## Specification) and tasks that cite them (## Plan) ---

const LIGHT_REVIEW_CONFIG = `schema_version: 4
language: en
tdd: true
changes_dir: .changeledger/changes
specs_dir: .changeledger/specs
statuses: [draft, approved, in-progress, in-review, in-validation, blocked, done, discarded]
stages: [request, investigation, proposal, specification, plan, log]
types:
  quick:
    stages: [request, log]
    review_required: true
`;

test('141119 CR1: a light type requiring review names both missing stages', () => {
  const root = frozenFixture({}, {}, {}, LIGHT_REVIEW_CONFIG);
  const { code, text } = runCheck(root);
  assert.ok(
    text.includes(
      'config type "quick": review_required: true requires active stages: specification, plan',
    ),
    text,
  );
  assert.equal(code, 1);
});

test('141119 CR2: a type missing only specification names only that stage', () => {
  const bad = {
    ...config,
    types: {
      refactor: { stages: ['request', 'proposal', 'plan', 'log'], review_required: true },
    },
  };
  const { errors } = checkRepo({ config: bad, changes: [] });
  const configErrors = msgs(errors).filter((m) => m.includes('config type "refactor"'));
  assert.deepEqual(configErrors, [
    'config type "refactor": review_required: true requires active stages: specification',
  ]);
});

test('141119 CR3: a type missing only plan names only that stage', () => {
  const bad = {
    ...config,
    types: {
      audit: {
        stages: ['request', 'investigation', 'specification', 'log'],
        review_required: true,
      },
    },
  };
  const { errors } = checkRepo({ config: bad, changes: [] });
  assert.ok(
    msgs(errors).includes(
      'config type "audit": review_required: true requires active stages: plan',
    ),
    msgs(errors).join('\n'),
  );
});

// A `refactor` in `approved` whose Plan cites a criterion its Specification
// never declares. Before `refactor` activated `specification`, checkCoverage
// returned early for this type and both diagnostics were unreachable.
const REFACTOR_WITH_ORPHAN_REFERENCE = `---
id: "20260101-000000"
title: X
type: refactor
status: approved
created: 2026-01-01T00:00:00Z
depends_on: []
---

## Request

Quitar el flag heredado.

## Proposal

Eliminación limpia, sin capa de compatibilidad.

## Specification

### CR1 — La opción deja de existir

- **Given** un repo inicializado
- **When** se ejecuta \`changeledger context --have x\`
- **Then** el proceso termina con código de salida 1

## Plan

- [ ] Ajustar el comportamiento (CR9)

## Log
`;

test('141119 CR8: a refactor citing an undeclared criterion is no longer silently valid', () => {
  const root = frozenFixture({ '20260101-000000-orphan.md': REFACTOR_WITH_ORPHAN_REFERENCE });
  const { code, out, text } = runCheck(root);
  assert.ok(text.includes('Plan task references unknown criterion "CR9"'), text);
  assert.ok(
    out.diagnostics.some((line) =>
      line.includes('Plan task for CR9 must name target and verification ('),
    ),
    text,
  );
  assert.equal(code, 1);
  assert.ok(!out.calls.some((line) => line.includes('✓ 1 change(s) valid')), out.calls.join('\n'));
});

test('141119 CR4: the distributed config and review_required: false are legitimate', () => {
  const distributed = parseYaml(fs.readFileSync(path.join(templatesDir, 'config.yml'), 'utf8'), {
    merge: false,
  });
  const { errors, warnings } = checkRepo({ config: distributed, changes: [] });
  const all = [...msgs(errors), ...msgs(warnings)];
  assert.ok(!all.some((m) => m.includes('requires active stages')), all.join('\n'));

  const optedOut = {
    ...distributed,
    types: {
      ...distributed.types,
      quick: { stages: ['request', 'log'], review_required: false },
    },
  };
  const opted = checkRepo({ config: optedOut, changes: [] });
  const optedAll = [...msgs(opted.errors), ...msgs(opted.warnings)];
  assert.ok(!optedAll.some((m) => m.includes('requires active stages')), optedAll.join('\n'));
});
