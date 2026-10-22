// --- 20261021-223918 CR2/CR3: equivalence between the seats of one operation
//
// The sweep in `seats.test.mjs` proves the inventory is complete. It cannot
// prove the seats AGREE, and disagreement is what the eight defects actually
// were: `review pass` reached `done` without the children guard that
// `statusMutation` had, `archive --graduated` ignored `--keep-branch` that
// `archive <id>` honoured, the worktree scaffold admitted documents `--from`
// refused.
//
// So each matrix below submits the SAME input to every seat of one operation
// and fails when they answer differently. The inputs are enumerated by name,
// never generated, so the coverage of the matrix is readable from the test
// (CR3) — and a gate no seat exercises is named as a gap instead of passing in
// silence.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { archive, archiveGraduated, review, status } from '../src/commands/agent.mjs';
import { apply } from '../src/commands/apply.mjs';
import { edit } from '../src/commands/edit.mjs';
import { init } from '../src/commands/init.mjs';
import { newChange, newChangeFrom, scaffoldChange } from '../src/commands/new.mjs';

function repo() {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-seats-')),
  );
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  init(root);
  return root;
}

function write(root, name, text) {
  fs.writeFileSync(path.join(root, '.changeledger', 'changes', name), text);
}

const outcome = (fn) => {
  try {
    fn();
    return 'accept';
  } catch (error) {
    return `refuse: ${error.message.split('\n')[0]}`;
  }
};

// --- Operation: reach `status: done` -------------------------------------
//
// The two seats are NOT substitutable, and that is the point: `statusMutation`
// is the only route for a type without `review_required`, `review pass` the
// only one for a type with it — the generic seat refuses `in-review → done`
// outright. So the equivalence is over the DELIVERY GATES, each exercised on
// the type its seat serves, rather than over one change driven two ways.

const LOG_TO_IN_PROGRESS =
  '- **2026-06-13T12:00:00Z** `[status]` draft → approved\n' +
  '- **2026-06-13T12:01:00Z** `[status]` approved → in-progress\n';

function choreAt(root, { plan, extra = '' }) {
  const id = '20260613-120000';
  write(
    root,
    `${id}-chore.md`,
    `---\nid: "${id}"\ntitle: Tarea\ntype: chore\nstatus: in-progress\ncreated: 2026-06-13T12:00:00Z\ndepends_on: []\n---\n\n## Request\n\nAlgo.\n\n## Plan\n\n${plan}\n\n## Log\n\n${LOG_TO_IN_PROGRESS}`,
  );
  if (extra) write(root, extra.name, extra.text);
  return id;
}

function refactorAt(root, { plan, extra = '' }) {
  const id = '20260613-130000';
  write(
    root,
    `${id}-refactor.md`,
    `---\nid: "${id}"\ntitle: Reorganizar\ntype: refactor\nstatus: in-review\ncreated: 2026-06-13T13:00:00Z\ndepends_on: []\n---\n\n## Request\n\nAlgo.\n\n## Proposal\n\nFrontera.\n\n## Specification\n\n- [ ] CR1 Given algo When algo Then algo\n\n## Plan\n\n${plan}\n\n## Log\n\n${LOG_TO_IN_PROGRESS}- **2026-06-13T13:01:00Z** \`[status]\` in-progress → in-review\n`,
  );
  if (extra) write(root, extra.name, extra.text);
  return id;
}

const RESOLVED_TASK = '- [x] Hacer la cosa\n  - **Resolved:** `2026-06-13T12:30:00Z`';
const OPEN_TASK = '- [ ] Hacer la cosa';

const liveChild = (parent) => ({
  name: '20260613-140000-child.md',
  text: `---\nid: "20260613-140000"\ntitle: Hijo\ntype: quick\nstatus: in-progress\ncreated: 2026-06-13T14:00:00Z\ndepends_on: []\nparent: "${parent}"\n---\n\n## Request\n\nAlgo.\n\n## Log\n\n- **2026-06-13T14:00:00Z** \`[note]\` created\n`,
});

// Each row is one delivery gate, submitted to both seats. `expected` is what
// BOTH must answer; stating it makes a row that silently stopped exercising
// its gate — because both seats went green — fail instead of agreeing on the
// wrong answer.
const DELIVERY_GATES = [
  { gate: 'nothing in the way', plan: RESOLVED_TASK, child: false, expected: 'accept' },
  { gate: 'an open Plan task', plan: OPEN_TASK, child: false, expected: 'refuse' },
  { gate: 'an unresolved child', plan: RESOLVED_TASK, child: true, expected: 'refuse' },
];

for (const { gate, plan, child, expected } of DELIVERY_GATES) {
  test(`20261021-223918 CR2: both seats that deliver agree on ${gate}`, () => {
    const generic = repo();
    const genericId = choreAt(generic, { plan, extra: child ? liveChild('20260613-120000') : '' });
    const viaStatus = outcome(() => status(genericId, 'done', generic));

    const reviewed = repo();
    const reviewedId = refactorAt(reviewed, {
      plan,
      extra: child ? liveChild('20260613-130000') : '',
    });
    const viaReview = outcome(() => review(reviewedId, 'pass', {}, reviewed));

    const verdict = (answer) => (answer === 'accept' ? 'accept' : 'refuse');
    assert.equal(
      verdict(viaStatus),
      expected,
      `\`status <id> done\` should ${expected} ${gate}, got: ${viaStatus}`,
    );
    assert.equal(
      verdict(viaReview),
      verdict(viaStatus),
      `the two delivery seats disagree on ${gate}:\n  status → ${viaStatus}\n  review pass → ${viaReview}`,
    );
  });
}

// --- Operation: archive a change -----------------------------------------
//
// The two seats differ by design in WHAT they select — one takes an id, the
// other sweeps every graduated `done` change — and in one documented effect:
// the bulk seat deletes no branch. That difference needs no matrix here: the
// inventory already pins `deleteMergedBranch` to a single seat reached only
// from `archive <id>`, so teaching the bulk path to prune fails there first.
//
// What this asserts is the part that must NOT differ: for a change both seats
// select, the document they leave behind is byte-for-byte the same.

function graduatedDone(root, id) {
  write(
    root,
    `${id}-hecho.md`,
    `---\nid: "${id}"\ntitle: Hecho\ntype: chore\nstatus: done\ncreated: 2026-06-13T12:00:00Z\ndepends_on: []\nreviewed: true\n---\n\n## Request\n\nAlgo.\n\n## Plan\n\n${RESOLVED_TASK}\n\n## Log\n\n${LOG_TO_IN_PROGRESS}- **2026-06-13T12:40:00Z** \`[status]\` in-progress → done\n- **2026-06-13T12:45:00Z** \`[graduation]\` skipped: sin verdad durable\n`,
  );
  return id;
}

// The archive event carries the instant it ran, so two runs a millisecond
// apart differ in that one field and nowhere else. Comparing the documents
// with it blanked keeps the assertion about the SEATS instead of the clock.
const withoutInstants = (text) => text.replace(/\*\*[0-9T:Z.-]+\*\*/g, '**<at>**');

test('20261021-223918 CR2: both archive seats leave the same document', () => {
  const single = repo();
  const id = graduatedDone(single, '20260613-150000');
  archive(id, single);

  const bulk = repo();
  graduatedDone(bulk, '20260613-150000');
  archiveGraduated({}, bulk);

  const read = (root) =>
    withoutInstants(
      fs.readFileSync(
        path.join(root, '.changeledger', 'changes', '20260613-150000-hecho.md'),
        'utf8',
      ),
    );
  assert.equal(
    read(bulk),
    read(single),
    'the two archive seats wrote different documents for the same change',
  );
  assert.match(read(single), /^archived: true$/m, 'and both must actually archive it');
});

// The selection difference is declared, not accidental: the bulk seat skips a
// change that has not resolved its graduation, and the id seat does not. Pin
// it, so a change of selection policy is a deliberate edit here rather than a
// silent widening of a sweep that deletes nothing but hides everything.
test('20261021-223918 CR2/CR3: the archive seats differ only in selection, and the difference is declared', () => {
  const root = repo();
  const id = '20260613-160000';
  write(
    root,
    `${id}-sin-graduar.md`,
    // `reviewed: true` on purpose: without it the selector stops at the review
    // flag and never reaches the graduation clause, so the row agreed with the
    // gate deleted (round 2 D1). The ONE thing missing here must be the
    // graduation resolution.
    `---\nid: "${id}"\ntitle: Sin graduar\ntype: chore\nstatus: done\ncreated: 2026-06-13T16:00:00Z\ndepends_on: []\nreviewed: true\n---\n\n## Request\n\nAlgo.\n\n## Plan\n\n${RESOLVED_TASK}\n\n## Log\n\n${LOG_TO_IN_PROGRESS}- **2026-06-13T16:40:00Z** \`[status]\` in-progress → done\n`,
  );

  assert.deepEqual(archiveGraduated({}, root), [], 'the bulk seat skips an unresolved graduation');
  assert.doesNotThrow(() => archive(id, root), 'the id seat archives what it is told to');
});

// --- Operation: admit a document into the ledger -------------------------
//
// Three gates reach the candidate diff — `--from` and `apply` both funnel
// into `prepareNewChange`, so the matrix runs four entry points over three
// independent code paths — and three of the eight defects lived between two
// of them: the worktree scaffold wrote documents `--from` refused,
// then the fix restated the rules instead of running the same gate and
// diverged again on the clause it had not copied. The inputs are the ones
// that told those two apart.

const ADMISSION_INPUTS = [
  { input: 'a parent that does not exist', parent: '20200101-000000', expected: 'refuse' },
  { input: 'a parent that is itself a child', parent: '20260613-170000', expected: 'refuse' },
  { input: 'a parent that is live and first-level', parent: '20260613-180000', expected: 'accept' },
];

// An epic with one child, so '20260613-170000' is a second-level change and
// naming it as a parent is the third level.
function hierarchy(root) {
  write(
    root,
    '20260613-180000-epica.md',
    '---\nid: "20260613-180000"\ntitle: Épica\ntype: chore\nstatus: in-progress\ncreated: 2026-06-13T18:00:00Z\ndepends_on: []\n---\n\n## Request\n\nObjetivo.\n\n## Plan\n\n' +
      OPEN_TASK +
      '\n\n## Log\n\n' +
      LOG_TO_IN_PROGRESS,
  );
  // The `edit` seat rewrites THIS one, never the second-level change itself:
  // setting a change's parent to its own id trips the self-parent rule and
  // `check` stops there, so the seat would agree with the others for a reason
  // that has nothing to do with the gate under test (round 1 D1).
  write(
    root,
    '20260613-190000-sujeto.md',
    '---\nid: "20260613-190000"\ntitle: Sujeto\ntype: quick\nstatus: draft\ncreated: 2026-06-13T19:00:00Z\ndepends_on: []\n---\n\n## Request\n\nAlgo.\n\n## Log\n',
  );
  write(
    root,
    '20260613-170000-hijo.md',
    '---\nid: "20260613-170000"\ntitle: Hijo\ntype: quick\nstatus: draft\ncreated: 2026-06-13T17:00:00Z\ndepends_on: []\nparent: "20260613-180000"\n---\n\n## Request\n\nAlgo.\n\n## Log\n',
  );
}

for (const { input, parent, expected } of ADMISSION_INPUTS) {
  test(`20261021-223918 CR2: every admission seat answers the same for ${input}`, () => {
    const answers = {};

    const scaffoldRoot = repo();
    hierarchy(scaffoldRoot);
    const args = {
      type: 'quick',
      slug: 'cand',
      title: 'Cand',
      parent,
      now: '2026-06-13T19:00:00Z',
    };
    answers.scaffold = outcome(() => newChange(args, scaffoldRoot, { ownerHandle: () => '' }));

    const documentRoot = repo();
    hierarchy(documentRoot);
    const composed = scaffoldChange(args, documentRoot, { ownerHandle: () => '' }).text;
    const source = path.join(documentRoot, 'cand.md');
    fs.writeFileSync(source, composed);
    answers['--from'] = outcome(() =>
      newChangeFrom({ type: 'quick', slug: 'cand', title: 'Cand', from: source }, documentRoot),
    );

    const batchRoot = repo();
    hierarchy(batchRoot);
    const manifest = path.join(batchRoot, 'batch.json');
    fs.writeFileSync(
      manifest,
      JSON.stringify([{ target: 'new', slug: 'cand', content: composed }]),
    );
    answers.apply = outcome(() => apply({ from: manifest }, batchRoot));

    const editRoot = repo();
    hierarchy(editRoot);
    const existing = path.join(editRoot, '.changeledger', 'changes', '20260613-190000-sujeto.md');
    const rewritten = path.join(editRoot, 'rewritten.md');
    const withParent = fs
      .readFileSync(existing, 'utf8')
      .replace(/^depends_on: \[\]$/m, `depends_on: []\nparent: "${parent}"`);
    assert.notEqual(
      withParent,
      fs.readFileSync(existing, 'utf8'),
      'the edit must change something',
    );
    fs.writeFileSync(rewritten, withParent);
    answers.edit = outcome(() => edit('20260613-190000', { from: rewritten }, editRoot));

    const verdicts = Object.fromEntries(
      Object.entries(answers).map(([seat, answer]) => [
        seat,
        answer === 'accept' ? 'accept' : 'refuse',
      ]),
    );
    const detail = Object.entries(answers)
      .map(([seat, answer]) => `  ${seat} → ${answer}`)
      .join('\n');
    const distinct = new Set(Object.values(verdicts));
    assert.equal(distinct.size, 1, `the admission seats disagree on ${input}:\n${detail}`);
    assert.equal([...distinct][0], expected, `every seat should ${expected} ${input}:\n${detail}`);
  });
}

// --- CR3: the gaps, as a register rather than as prose ------------------
//
// Two rounds of review each found a gap of the same kind that was not
// declared, and the first two declared ones were a comment beside a sentinel
// and a comment beside nothing. A gap nobody can execute is a gap nobody
// maintains, so each one carries a predicate over the code it is about.
//
// What the predicates do and do not do, since the first wording of this
// comment overstated them (round 2 D10): each fails when the SOURCE shape its
// gap names disappears, so moving or rewriting that code forces the register
// to be read. None of them fails when the gap is closed from the TEST side —
// adding the missing coverage here leaves the register green and asserting a
// gap that no longer exists. Closing a gap therefore means deleting its entry
// by hand, in the same edit.
const DECLARED_GAPS = [
  {
    gap: '`review fail` writes a status like `review pass` does, and no matrix submits it; its only lifecycle guard can be deleted with every test here green',
    stillOpen: (sources) => /to = 'in-progress';/.test(sources['src/commands/agent.mjs']),
  },
  {
    gap: 'the archive matrix reaches only the worktree branch of `archiveGraduated`',
    // Closing the gap means this branch stops existing or stops being skipped.
    stillOpen: (sources) => /if \(repo\.state\)/.test(sources['src/commands/agent.mjs']),
  },
  {
    gap: 'every admission seat runs in the worktree layout; `--from` and `apply` are the two reachable in an activated repo and are covered elsewhere',
    stillOpen: (sources) => /repoIsActivated\(repoRoot\)/.test(sources['src/commands/new.mjs']),
  },
  {
    gap: "the delivery matrix runs in the worktree layout, never submits `statusMutation`'s candidate-in-flight branch (`apply` supplies `changes`), and never exercises `discard`, which is a declared seat of the same operation",
    stillOpen: (sources) =>
      /changes \?\? siblingChanges\(repoRoot\)/.test(sources['src/commands/agent.mjs']),
  },
];

test('20261021-223918 CR3: every declared gap still describes the code it is about', () => {
  const read = (name) => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
  const sources = {
    'src/commands/agent.mjs': read('src/commands/agent.mjs'),
    'src/commands/new.mjs': read('src/commands/new.mjs'),
  };
  for (const { gap, stillOpen } of DECLARED_GAPS) {
    assert.ok(
      stillOpen(sources),
      `this gap no longer describes the code — close it here or reword it: ${gap}`,
    );
  }
});
