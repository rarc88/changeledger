// --- 20261021-223918 CR1/CR2: equivalence between the seats of one operation
//
// Eight of the fourteen defects in `20261020-172221` were one shape: a rule
// installed at some seats of an operation and not at all of them. `review
// pass` reached `done` without the children guard that `statusMutation` had,
// `archive --graduated` ignored the `--keep-branch` that `archive <id>`
// honoured, the worktree scaffold admitted documents `--from` refused.
//
// Each matrix below submits the SAME input to every seat of one operation and
// fails naming both answers. The inputs are enumerated by name, never
// generated, so the coverage is readable from the test — and what no seat
// exercises is declared in the register at the end of this file, with a
// predicate over the code it is about, never in prose.
//
// A sibling guard that swept the tree for undeclared seats was part of this
// change and was withdrawn: two independent reviews demonstrated ten classes
// of silent miss across a text version and an AST version. The Proposal
// records why. Nothing here depends on it.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkRepo } from '../src/check.mjs';
import { archive, archiveGraduated, review, status } from '../src/commands/agent.mjs';
import { apply } from '../src/commands/apply.mjs';
import { edit } from '../src/commands/edit.mjs';
import { init } from '../src/commands/init.mjs';
import { newChange, newChangeFrom, scaffoldChange } from '../src/commands/new.mjs';
import { loadRepo } from '../src/repo.mjs';
import { sanitizedEnv } from './helpers/git-env.mjs';

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
  test(`20261021-223918 CR1: both seats that deliver agree on ${gate}`, () => {
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
// the bulk seat deletes no branch, which the CLI help and `close.md` both
// state. That difference used to be waved away here in prose, on the strength
// of a sibling guard that this change withdrew; with the guard gone, teaching
// the bulk seat to prune failed nothing at all (round 3 D1). A difference
// between two seats is asserted or it is a gap — never a paragraph.
//
// So both are asserted below: the document they leave behind must NOT differ,
// and the branch outcome MUST, in exactly the declared direction.

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

test('20261021-223918 CR1: both archive seats leave the same document', () => {
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

// Two of the eight defects this change answers were in branch deletion, the
// one irreversible action in the tool. `archive <id>` prunes the change's own
// merged branch; `archive --graduated` prunes nothing, and that asymmetry is
// load-bearing — the bulk seat takes no id, so it would be deleting branches
// for a sweep the caller never enumerated.
test('20261021-223918 CR1: only the id seat deletes a branch; the bulk seat deletes none', () => {
  const onBranch = (root, id) => {
    const config = path.join(root, '.changeledger', 'config.yml');
    fs.writeFileSync(
      config,
      fs
        .readFileSync(config, 'utf8')
        .replace(/^ {2}integration_branch:.*$/m, '  integration_branch: dev')
        .replace(/^ {2}change_branch_format:.*$/m, '  change_branch_format: "work/{id}"'),
    );
    const run = (args) =>
      execFileSync('git', args, { cwd: root, env: sanitizedEnv(), encoding: 'utf8' });
    run(['init', '-q', '-b', 'dev']);
    run(['config', 'user.email', 't@e.com']);
    run(['config', 'user.name', 'T']);
    run(['add', '-A']);
    run(['commit', '-qm', 'seed']);
    const branch = `work/${id}`;
    run(['checkout', '-q', '-b', branch, 'dev']);
    fs.writeFileSync(path.join(root, 'work.txt'), 'work\n');
    run(['add', 'work.txt']);
    run(['commit', '-qm', 'work']);
    run(['checkout', '-q', 'dev']);
    run(['merge', '--no-ff', '-q', '-m', 'merge', branch]);
    // `recordedBranch` reads the Log, never the checkout.
    const file = path.join(root, '.changeledger', 'changes', `${id}-hecho.md`);
    fs.appendFileSync(file, `- **2026-06-13T12:50:00Z** \`[branch]\` set: ${branch} (auto)\n`);
    return {
      branch,
      branches: () => run(['branch', '--format=%(refname:short)']).split('\n').filter(Boolean),
    };
  };

  const single = repo();
  const id = graduatedDone(single, '20260613-150000');
  const fromId = onBranch(single, id);
  archive(id, single);
  assert.ok(!fromId.branches().includes(fromId.branch), 'the id seat deletes its merged branch');

  const bulk = repo();
  graduatedDone(bulk, '20260613-150000');
  const fromBulk = onBranch(bulk, '20260613-150000');
  assert.equal(archiveGraduated({}, bulk).length, 1, 'the bulk seat selects the same change');
  assert.ok(
    fromBulk.branches().includes(fromBulk.branch),
    'the bulk seat takes no id and must delete no branch, however merged',
  );
});

// The selection difference is declared, not accidental: the bulk seat skips a
// change that has not resolved its graduation, and the id seat does not. Pin
// it, so a change of selection policy is a deliberate edit here rather than a
// silent widening of a sweep that deletes nothing but hides everything.
test('20261021-223918 CR1/CR2: the archive seats differ only in selection, and the difference is declared', () => {
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
// The entry points are listed in `ADMISSION_SEATS` below — no count here,
// because the three times this sentence carried one it went stale. The
// scaffold gates in `assertScaffoldIntroducesNoErrors`; `--from` and `apply
// --target new` both funnel into `prepareNewChange`; `edit` and `apply
// --target change:<id>` both reach `prepareChangeEdit`; and the two `apply`
// seats then run `apply`'s own candidate gate. Each of those calls
// `introducedErrors`, so swapping one call site for the all-errors form makes
// the unrelated-break row refuse at exactly the seats that run it. Three of the eight defects lived between two of these:
// the worktree scaffold wrote documents `--from` refused, then the fix
// restated the rules instead of running the same gate and diverged again on
// the clause it had not copied. The parent inputs are the ones that told those
// two apart; the unrelated-break input is the one that told `apply` apart
// from `edit`.

// Named once. Rounds 3, 4 and 6 each found a gap entry whose prose counted
// these wrong, every time because a seat had landed and the sentence had
// not been reread. A count that duplicates what the matrix knows goes stale;
// this one is read from here.
const ADMISSION_SEATS = ['scaffold', '--from', 'apply', 'edit', 'apply change:'];
const ACTIVATED_REFUSES = ['scaffold'];

const ADMISSION_INPUTS = [
  { input: 'a parent that does not exist', parent: '20200101-000000', expected: 'refuse' },
  { input: 'a parent that is itself a child', parent: '20260613-170000', expected: 'refuse' },
  { input: 'a parent that is live and first-level', parent: '20260613-180000', expected: 'accept' },
  // The row above plus one break the document has nothing to do with, so the
  // break is the only thing this row adds. A seat that gated on every error
  // the candidate carries, instead of on the ones the write introduces, would
  // refuse here.
  {
    input: 'a clean document in a repo with an unrelated break',
    parent: '20260613-180000',
    unrelatedBreak: true,
    expected: 'accept',
  },
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

// A change whose parent does not exist, which no seat's document names. The
// row that carries it means something only while the break is a real `check`
// error, so the repo is checked before any seat sees it: a break that stopped
// being an error would leave that row agreeing with the live-parent row for
// no reason.
function unrelatedBreak(root) {
  write(
    root,
    '20260613-200000-roto.md',
    '---\nid: "20260613-200000"\ntitle: Roto\ntype: quick\nstatus: draft\ncreated: 2026-06-13T20:00:00Z\ndepends_on: []\nparent: "20200101-000000"\n---\n\n## Request\n\nAlgo.\n\n## Log\n',
  );
  assert.deepEqual(
    checkRepo(loadRepo(root)).errors.map((e) => `${e.file}: ${e.message}`),
    ['20260613-200000-roto.md: parent references missing change "20200101-000000"'],
    'the unrelated break must be the one error the repo carries before the write',
  );
}

for (const { input, parent, unrelatedBreak: broken = false, expected } of ADMISSION_INPUTS) {
  test(`20261021-223918 CR1: every admission seat answers the same for ${input}`, () => {
    const answers = {};
    const seed = (root) => {
      hierarchy(root);
      if (broken) unrelatedBreak(root);
    };

    const scaffoldRoot = repo();
    seed(scaffoldRoot);
    const args = {
      type: 'quick',
      slug: 'cand',
      title: 'Cand',
      parent,
      now: '2026-06-13T19:00:00Z',
    };
    answers.scaffold = outcome(() => newChange(args, scaffoldRoot, { ownerHandle: () => '' }));

    const documentRoot = repo();
    seed(documentRoot);
    const composed = scaffoldChange(args, documentRoot, { ownerHandle: () => '' }).text;
    const source = path.join(documentRoot, 'cand.md');
    fs.writeFileSync(source, composed);
    answers['--from'] = outcome(() =>
      newChangeFrom({ type: 'quick', slug: 'cand', title: 'Cand', from: source }, documentRoot),
    );

    const batchRoot = repo();
    seed(batchRoot);
    const manifest = path.join(batchRoot, 'batch.json');
    fs.writeFileSync(
      manifest,
      JSON.stringify([{ target: 'new', slug: 'cand', content: composed }]),
    );
    answers.apply = outcome(() => apply({ from: manifest }, batchRoot));

    const editRoot = repo();
    seed(editRoot);
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

    // `apply` editing an existing document. It shares `prepareChangeEdit` with
    // `edit` and then runs `apply`'s own candidate gate; the unrelated-break
    // row is the input on which the two once answered differently.
    const batchEditRoot = repo();
    seed(batchEditRoot);
    const editManifest = path.join(batchEditRoot, 'batch-edit.json');
    fs.writeFileSync(
      editManifest,
      JSON.stringify([{ target: 'change:20260613-190000', content: withParent }]),
    );
    answers['apply change:'] = outcome(() => apply({ from: editManifest }, batchEditRoot));

    assert.deepEqual(
      Object.keys(answers).sort(),
      [...ADMISSION_SEATS].sort(),
      'a seat was submitted or dropped without updating ADMISSION_SEATS, which the gap register reads',
    );

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

// --- CR2: the gaps, as a register rather than as prose ------------------
//
// Three rounds of review each found a gap of the same kind that was not
// declared, and the first two declared ones were a comment beside a sentinel
// and a comment beside nothing. A gap nobody can execute is a gap nobody
// maintains, so each carries a predicate over the code it is about.
//
// The predicates read the BODY of the function each gap names, not the whole
// file: a whole-file regex stayed green when the activation gate moved from
// `newChange` into `newChangeFrom` — which inverts the activation entry's claim outright —
// and when the matched text survived only inside a comment (round 4 D1).
// Line comments are stripped from the slice for the same reason.
//
// The entries are COVERAGE gaps: "no matrix submits this path". That is a
// claim about the tests, so nothing in the code can confirm it; the predicate
// is only a tripwire on the construct the gap names, and it carries three
// measured residuals. It does not fail when the gap is closed from the TEST
// side, so closing one means deleting its entry by hand in the same edit. It
// does not fail when the named gate is neutered in place — `if (false && …)`
// keeps the text — though a gate MOVED to another function is caught. And it
// does not fail when the behaviour is closed from a function the entry does
// not name.
//
// An entry may also say why a path differs from a seat it resembles, and then
// it names the code comment or contract text that declares the difference. A
// difference nothing declares is a DIVERGENCE, and a divergence is not an
// entry here: it is a claim about the code, so it is reproduced as a test that
// fails once the divergence closes, never grepped. The first cut grepped two,
// and both predicates were unsound in exactly the ways above: one matched a
// second occurrence inside an error-message template, and both pinned one side
// of a two-function divergence while the realistic fix lives in the other.
// This file reproduces no divergence today: the two document-seat divergences
// closed when the document seats converged on `introducedErrors`
// (20261022-213751) and became the unrelated-break row of the admission
// matrix, and the third turned out to be graduation's declared design.

// The body of a named top-level function, by brace matching from its
// declaration. Narrow on purpose — it locates ONE named function, which is
// the whole job here, and does not try to attribute arbitrary code.
function functionBody(source, name) {
  const declaration = new RegExp(`^(?:export )?(?:async )?function \\*?${name}\\(`, 'm');
  const at = source.search(declaration);
  assert.notEqual(at, -1, `the register names \`${name}\`, which this file no longer declares`);
  // Past the parameter list before looking for the body: a destructured or
  // defaulted parameter (`filters = {}`) opens a brace of its own, and
  // matching from it returns an empty body that satisfies nothing.
  let parens = 0;
  let cursor = source.indexOf('(', at);
  for (; cursor < source.length; cursor += 1) {
    if (source[cursor] === '(') parens += 1;
    else if (source[cursor] === ')') {
      parens -= 1;
      if (parens === 0) break;
    }
  }
  const open = source.indexOf('{', cursor);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        return source
          .slice(open, i + 1)
          .split('\n')
          .map((line) => line.replace(/\/\/.*$/, ''))
          .join('\n');
      }
    }
  }
  throw new Error(`\`${name}\` has no balanced body`);
}

const COVERAGE_GAPS = [
  {
    gap: 'the archive matrix reaches only the worktree branch of `archiveGraduated`',
    in: ['src/commands/agent.mjs', 'archiveGraduated'],
    stillOpen: (body) => /if \(repo\.state\)/.test(body),
  },
  {
    gap: `every admission seat runs in the worktree layout; an activated repo refuses ${ACTIVATED_REFUSES.join(', ')}, so the other ${ADMISSION_SEATS.length - ACTIVATED_REFUSES.length} — ${ADMISSION_SEATS.filter((seat) => !ACTIVATED_REFUSES.includes(seat)).join(', ')} — all behave there untested by this matrix`,
    in: ['src/commands/new.mjs', 'newChange'],
    stillOpen: (body) => /repoIsActivated\(repoRoot\)/.test(body),
  },
  {
    gap: "the delivery matrix runs in the worktree layout and never submits `statusMutation`'s candidate-in-flight branch, where `apply` supplies `changes` instead of the stored ledger",
    in: ['src/commands/agent.mjs', 'statusMutation'],
    stillOpen: (body) => /changes \?\? siblingChanges\(repoRoot\)/.test(body),
  },
  {
    gap: '`discard` is a declared seat of the same operation as the delivery matrix and no matrix submits it',
    in: ['src/commands/agent.mjs', 'discard'],
    stillOpen: (body) => /setStatus\(text, 'discarded'\)/.test(body),
  },
  {
    // Restored: this entry was dropped when the register was restructured,
    // silently and without being asked (round 5 D1) — a declared hole deleted
    // while refactoring the hole register, which is the shape the register is
    // for.
    gap: '`in-review → in-progress` has two seats — `review <id> fail "<reason>"` and `status <id> in-progress` — and no matrix submits either. They differ by contract: `templates/contract/review.md` reserves `review fail`, which refuses without a reason, for a reviewer\'s verdict, and names `status <id> in-progress` the no-verdict path for a local gate that fails once the candidate reached `in-review`',
    in: ['src/commands/agent.mjs', 'review'],
    stillOpen: (body) => /if \(!reason\)/.test(body) && /to = 'in-progress';/.test(body),
  },
  {
    gap: '`graduate <id> <slug> --new` (`scaffoldSpec`) writes a spec and no matrix submits it. It is not a seat of document admission: graduation is two-phase by design, as the header of `src/commands/graduate.mjs` declares — the seed is an editable scaffold, marked with `SPEC_SCAFFOLD_MARKER`, that `check` may reject until it is rewritten, and `graduate --into` refuses the spec while it still carries the marker',
    in: ['src/commands/graduate.mjs', 'scaffoldSpec'],
    stillOpen: (body) => /SPEC_SCAFFOLD_MARKER/.test(body),
  },
  {
    gap: "`apply`'s final candidate gate, `assertCandidateClean`, has no matrix that reaches its refusal. The document entries the admission matrix refuses stop earlier, at their own seat, inside the entry envelope `apply refused, nothing was written — entry 1 (…)`; the gate answers for what an event entry's text transform leaves behind, as a `task block` on a `done` change does",
    in: ['src/commands/apply.mjs', 'apply'],
    stillOpen: (body) => /assertCandidateClean\(/.test(body),
  },
];

test('20261021-223918 CR2: every coverage gap still describes the code it is about', () => {
  const read = (name) => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
  for (const {
    gap,
    in: [file, fn],
    stillOpen,
  } of COVERAGE_GAPS) {
    assert.ok(
      stillOpen(functionBody(read(file), fn)),
      `this gap no longer describes \`${fn}\` in ${file} — close it here or reword it: ${gap}`,
    );
  }
});
