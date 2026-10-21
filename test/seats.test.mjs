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
// WHAT THIS DOES NOT CATCH, stated rather than implied: the sweep follows
// callers of a primitive, so a seat that bypasses the primitive entirely —
// hand-rolling the frontmatter edit instead of calling `setStatus` — is
// invisible to it. The primitives below are the only writers of their field
// today, and that is the assumption this inventory rests on.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  callsTo,
  enclosingDeclaration,
  seatsCalling,
  withoutComments,
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
export function inventoryDrift({ primitive, guards, declared, found }) {
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

// CR1's third clause, on a synthetic source rather than on the tree: today no
// comment in `src/` happens to spell a primitive with its parenthesis, so
// disabling the stripping changes nothing and the sweeps above stay green.
// That is the vacuity this change exists to stop shipping — the clause has to
// be falsifiable on its own terms, not on whatever the tree happens to hold.
const SYNTHETIC = `
// a line comment that mentions setStatus(text, 'done') in prose
/* and a block one that mentions setStatus(text, 'done') too */
export function realSeat(text) {
  return setStatus(text, 'done');
}
function notACall() {
  return unsetStatus(text);
}
`;

test('20261021-223918 CR1: the sweep reads calls, not prose', () => {
  const scannable = withoutComments(SYNTHETIC);
  assert.equal(
    scannable.split('\n').length,
    SYNTHETIC.split('\n').length,
    'stripping must preserve line count, or every reported line is wrong',
  );
  const calls = callsTo(scannable, 'setStatus');
  assert.equal(calls.length, 1, 'the two commented mentions are not calls');
  assert.equal(enclosingDeclaration(scannable, calls[0].start), 'realSeat');
});

test('20261021-223918 CR1: the sweep respects identifier boundaries', () => {
  assert.equal(
    callsTo(withoutComments(SYNTHETIC), 'setStatus').length,
    1,
    '`unsetStatus(` ends with the opener and must not be read as a call of it',
  );
});

test('20261021-223918 CR1: the sweep does not count a primitive as its own seat', () => {
  const definition = 'export function setStatus(text, status) {\n  return text;\n}\n';
  assert.equal(
    [...seatsCalling('nothingCallsThis')].length,
    0,
    'a primitive nobody calls yields no seat',
  );
  assert.equal(callsTo(definition, 'setStatus').length, 1, 'the definition does look like a call');
  // ...which is why `seatsCalling` drops the declaration whose name IS the
  // primitive. `writer.mjs:setStatus` never appears in the inventory above.
  assert.ok(![...seatsCalling('setStatus')].some((seat) => seat.endsWith(':setStatus')));
});
