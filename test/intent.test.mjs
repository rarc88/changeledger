import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const intent = fs.readFileSync(new URL('../INTENT.md', import.meta.url), 'utf8');

// Each guard stays inside one sentence of one paragraph (`[^.\n]*`: a heading
// has no period, so a plain `[^.]*` would let it lend words to the sentence
// below) and names the obligation, not its wording, so the prose can be
// rewritten without retargeting the test.

test('the human approves the objective and the frontier of a draft', () => {
  assert.match(intent, /human\w*[^.\n]*aprueba[^.\n]*objetivo[^.\n]*frontera/i);
});

test('acceptance is the merge into the integration branch', () => {
  assert.match(intent, /aceptaci[oó]n[^.\n]*fusi[oó]n[^.\n]*integraci[oó]n/i);
});

test('a delivered change returns to in-progress with a reason', () => {
  assert.match(
    intent,
    /entreg\w*[^.\n]*(vuelv\w*|volver|devuelv\w*)[^.\n]*(en progreso|`in-progress`)[^.\n]*raz[oó]n/i,
  );
});

test('only a recorded release is irreversible', () => {
  assert.match(intent, /release[^.\n]*[uú]nica[^.\n]*irreversible/i);
});

test('discarded is terminal', () => {
  assert.match(intent, /`discarded`[^.\n]*terminal/i);
});
