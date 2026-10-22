// --- 20261021-223918: the executable seat inventory ----------------------
//
// Eight of the fourteen defects in `20261020-172221` were one shape: a rule
// installed at some seats of an operation and not at all of them. The repo has
// two storage layouts — the worktree under `.changeledger/changes` and an
// activated ledger on `refs/heads/changeledger/state` — and several command
// seats per semantic operation, and nothing enumerated them, so a new rule
// landed wherever the author happened to be looking.
//
// What found them was not more attention: it was enumerating the seats and
// comparing their answer to the same input. These guards make that enumeration
// executable, so a seat added tomorrow fails the suite instead of waiting for
// a reviewer who thinks to look.
//
// WHAT THIS DOES NOT CATCH, stated rather than implied. The first cut of
// these guards swept text and review demonstrated five classes of silent
// miss on this very tree; the scan now parses, and the three guards below
// close them from different directions:
//
//   · `seatsCalling` reads the AST, so a generator, a class method, an arrow
//     behind `let`, a string containing `//` and a regex containing `/*` are
//     all read as what they are. It covers `src/` and `bin/`, `.mjs` and
//     `.js`, and a call it cannot attribute to a named function is reported
//     as `(module scope)` instead of dropped.
//   · `modulesImporting` is the backstop for everything static analysis
//     cannot follow INSIDE a module — an alias through a local variable, a
//     re-bind, a call through a value. Those still have to import the
//     primitive, so the module shows up even when the call does not.
//   · `modulesReachingDynamically` closes the one remaining route, a
//     primitive reached through `await import(...)`.
//
// What is left: a module that reconstructs the operation without the
// primitive at all — hand-rolling the frontmatter edit instead of calling
// `setStatus`. The primitives are the only writers of their field today, and
// that is the assumption these guards rest on.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  modulesImporting,
  modulesReachingDynamically,
  seatsCalling,
} from './helpers/source-scan.mjs';

// Each operation names the primitive that performs it and the seats allowed to
// reach it. The list is pinned, not derived: its whole purpose is to be the
// thing a new seat has to be added to, deliberately, after someone has checked
// that the operation's guards travel with it.
const OPERATIONS = [
  {
    operation: 'move a change between lifecycle statuses',
    primitive: 'setStatus',
    guards: 'the delivery gates in `statusMutation` and `review` — see the CR6 tests',
    seats: [
      'src/commands/agent.mjs:discard',
      'src/commands/agent.mjs:review',
      'src/commands/agent.mjs:statusMutation',
    ],
  },
  {
    operation: 'archive a change',
    primitive: 'setArchived',
    guards: 'the terminal-status gate on branch pruning, and `--keep-branch`',
    seats: ['src/commands/agent.mjs:archive', 'src/commands/agent.mjs:archiveGraduated'],
  },
  {
    operation: 'delete a local branch',
    primitive: 'deleteMergedBranch',
    guards:
      'the four refusals: the integration branch, a branch the change does not declare, an unmerged branch, the current checkout',
    seats: ['src/commands/agent.mjs:pruneChangeBranch'],
  },
  {
    operation: 'admit a document into the ledger',
    primitive: 'newErrors',
    guards: "the repo-wide candidate diff against the repo's own current errors",
    seats: [
      'src/commands/edit.mjs:prepareChangeEdit',
      'src/commands/new.mjs:assertScaffoldIntroducesNoErrors',
      'src/commands/new.mjs:prepareNewChange',
    ],
  },
];

// The drift report as a value, not as an assertion message: CR4 says the
// failure must name the seat, its operation and the action to take, and a
// message that only exists inside a failing assert cannot be checked. Built
// here, asserted by the CR4 test below, and used by the CR1 tests.
function inventoryDrift({ primitive, guards, declared, found }) {
  const added = [...found].filter((seat) => !declared.includes(seat)).sort();
  const stale = [...declared].filter((seat) => !found.has(seat)).sort();
  // Both directions in one report: a rename is an addition and a removal at
  // once, and reading it as two unrelated failures hides that it is one edit.
  const message = [
    `The seats that call \`${primitive}\` have drifted from the inventory.`,
    added.length
      ? `  New seat(s) the inventory does not declare: ${added.join(', ')}.\n` +
        `  Before declaring them, check that this operation's guards travel with them — ${guards} —\n` +
        '  then add them to OPERATIONS in test/seats.test.mjs.'
      : '',
    stale.length
      ? `  Declared seat(s) that no longer call it: ${stale.join(', ')}.\n` +
        '  Remove them from OPERATIONS, or restore the call if the removal was not intended.'
      : '',
  ]
    .filter(Boolean)
    .join('\n');
  return { added, stale, message };
}

for (const { operation, primitive, guards, seats } of OPERATIONS) {
  test(`20261021-223918 CR1: the seats that ${operation} are exactly the declared ones`, () => {
    const { added, stale, message } = inventoryDrift({
      primitive,
      guards,
      declared: seats,
      found: seatsCalling(primitive),
    });
    assert.deepEqual({ added, stale }, { added: [], stale: [] }, message);
  });
}

// CR4, on fabricated drift: the real inventory is clean, so the only way to
// hold the message to its obligations is to build the report for a drift that
// is not there.
test('20261021-223918 CR4: the drift report names the seat, its operation and what to do', () => {
  const { message } = inventoryDrift({
    primitive: 'setArchived',
    guards: 'the terminal-status gate on branch pruning',
    declared: ['src/commands/agent.mjs:archive'],
    found: new Set(['src/commands/agent.mjs:archive', 'src/commands/apply.mjs:applyArchive']),
  });
  assert.match(message, /src\/commands\/apply\.mjs:applyArchive/, 'the new seat is named');
  assert.match(message, /setArchived/, 'the operation is named by its primitive');
  assert.match(message, /terminal-status gate/, 'the guards to check travel with the report');
  assert.match(message, /OPERATIONS in test\/seats\.test\.mjs/, 'the action is named');

  const removed = inventoryDrift({
    primitive: 'setArchived',
    guards: 'irrelevant',
    declared: ['src/commands/agent.mjs:archive', 'src/commands/agent.mjs:gone'],
    found: new Set(['src/commands/agent.mjs:archive']),
  });
  assert.match(removed.message, /no longer call it: src\/commands\/agent\.mjs:gone/);
  assert.match(
    removed.message,
    /Remove them from OPERATIONS/,
    'the other direction says its action too',
  );
  assert.doesNotMatch(
    removed.message,
    /New seat/,
    'a removal must not be reported as an addition as well',
  );
});

// CR1's second direction, as its own subject: a sweep that silently found
// nothing would report an empty set as agreement with an empty inventory, and
// every guard above would pass while the operation had vanished.
test('20261021-223918 CR1: no operation declares an empty seat list', () => {
  for (const { primitive, seats } of OPERATIONS) {
    assert.ok(seats.length > 0, `${primitive} declares no seat; the sweep would compare nothing`);
    assert.ok(
      seatsCalling(primitive).size > 0,
      `the sweep finds no caller of \`${primitive}\` — either it was renamed, or the scan is broken`,
    );
  }
});

// CR1's second guard: the module level, where static analysis stops. An alias
// through a local variable or a destructured re-bind makes the CALL invisible
// to `seatsCalling`, but the module still has to import the primitive — so a
// module that imports one and declares no seat is drift.
for (const { operation, primitive, seats } of OPERATIONS) {
  test(`20261021-223918 CR1: only declared modules import the primitive that can ${operation}`, () => {
    const declared = [...new Set(seats.map((seat) => seat.split(':')[0]))].sort();
    const importing = [...modulesImporting(primitive)].sort();
    assert.deepEqual(
      importing,
      declared,
      `\`${primitive}\` is imported by a module the inventory does not place a seat in.\n` +
        '  A call this guard sees and `seatsCalling` does not is an alias or an indirection:\n' +
        '  find it, check the guards travel with it, and declare its seat in OPERATIONS.',
    );
  });
}

// CR1's third guard: the one route that needs no import.
test('20261021-223918 CR1: no module reaches a primitive through a dynamic import', () => {
  const suspects = [...modulesReachingDynamically(OPERATIONS.map((o) => o.primitive))].sort();
  assert.deepEqual(
    suspects,
    [],
    'a module both uses `await import(...)` and names a governed primitive:\n' +
      `  ${suspects.join('\n  ')}\n` +
      '  Static analysis cannot follow that call. Import the primitive directly, or declare the seat.',
  );
});
