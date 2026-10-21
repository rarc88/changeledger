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
import { seatsCalling } from './helpers/source-scan.mjs';

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

for (const { operation, primitive, guards, seats } of OPERATIONS) {
  test(`20261021-223918 CR1: the seats that ${operation} are exactly the declared ones`, () => {
    const found = [...seatsCalling(primitive)].sort();
    const declared = [...seats].sort();

    const added = found.filter((seat) => !declared.includes(seat));
    const stale = declared.filter((seat) => !found.includes(seat));

    // CR4: the message says what to do, not that two sets differ. Both
    // directions are reported in one failure so a rename — which is an
    // addition and a removal at once — reads as the one edit it is.
    assert.deepEqual(
      { added, stale },
      { added: [], stale: [] },
      [
        `The seats that call \`${primitive}\` have drifted from the inventory.`,
        added.length
          ? `  New seat(s) the inventory does not declare: ${added.join(', ')}.\n` +
            `  Before declaring them, check that this operation's guards travel with them — ${guards} —` +
            `  then add them to OPERATIONS in test/seats.test.mjs.`
          : '',
        stale.length
          ? `  Declared seat(s) that no longer call it: ${stale.join(', ')}.\n` +
            `  Remove them from OPERATIONS, or restore the call if the removal was not intended.`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  });
}

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
