import assert from 'node:assert/strict';
import test from 'node:test';
import { beginSentinel, endSentinel } from '../src/framing.mjs';

// 20260726-124833 CR3: `contentRev` served only the retired `--have` flag, so
// the module's public surface is exactly the framing helpers plus the version.
test('124833 CR3: framing exports only VERSION and the two sentinels', async () => {
  const framing = await import('../src/framing.mjs');
  assert.deepEqual(Object.keys(framing), ['VERSION', 'beginSentinel', 'endSentinel']);
});

test('framing sentinels frame a payload without embedding a revision', () => {
  assert.match(beginSentinel('CONTEXT', 'mode: core'), /^===== CHANGELEDGER CONTEXT BEGIN/);
  assert.doesNotMatch(beginSentinel('CONTEXT', 'mode: core'), /rev:/);
  assert.match(endSentinel('CONTEXT'), /if this line is missing, the output was truncated/);
});
