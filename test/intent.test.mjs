import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const intent = fs.readFileSync(new URL('../INTENT.md', import.meta.url), 'utf8');

// Each guard spans at most one sentence (`[^.]*`) and names the obligation, not
// its wording, so the prose can be rewritten without retargeting the test.

test('the human approves the objective and the frontier of a draft', () => {
  assert.match(intent, /human\w*[^.]*aprueba[^.]*objetivo[^.]*frontera/i);
});

test('acceptance is the merge into the integration branch', () => {
  assert.match(intent, /aceptaci[oó]n[^.]*fusi[oó]n[^.]*integraci[oó]n/i);
});

test('a delivered change returns to in-progress with a reason', () => {
  assert.match(
    intent,
    /(vuelv\w*|volver|devuelv\w*)[^.]*(en progreso|`in-progress`)[^.]*raz[oó]n/i,
  );
});

test('only a recorded release is irreversible', () => {
  assert.match(intent, /release[^.]*[uú]nica[^.]*irreversible/i);
});

test('discarded is terminal', () => {
  assert.match(intent, /`discarded`[^.]*terminal/i);
});
