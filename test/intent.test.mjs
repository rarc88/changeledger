import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const intent = fs.readFileSync(new URL('../INTENT.md', import.meta.url), 'utf8');

test('102908: intent describes done as provisional and durable closure as terminal', () => {
  assert.match(intent, /`done` significa.*provisional/i);
  assert.match(intent, /agente o el humano pueden devolverlo a `in-progress`/i);
  assert.match(intent, /graduación\/skip, archivo o release.*irreversible/i);
  assert.match(intent, /`discarded` es terminal/i);
  assert.match(intent, /humano sigue siendo quien aprueba un draft y acepta/i);
});
