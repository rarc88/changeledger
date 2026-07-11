import assert from 'node:assert/strict';
import test from 'node:test';
import { beginSentinel, contentRev, endSentinel } from '../src/framing.mjs';

test('CR1: contentRev is a stable 12-hex-char digest of the body', () => {
  const body = 'Effective policy: language=en — tdd=on\n\nSome contract body.';
  const first = contentRev(body);
  const second = contentRev(body);
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{12}$/);
});

test('CR2: contentRev changes when the body changes', () => {
  const a = contentRev('Effective policy: language=en — tdd=on');
  const b = contentRev('Effective policy: language=es — tdd=on');
  assert.notEqual(a, b);
});

test('framing sentinels are unaffected by rev computation', () => {
  assert.match(beginSentinel('CONTEXT', 'mode: core'), /^===== CHANGELEDGER CONTEXT BEGIN/);
  assert.match(endSentinel('CONTEXT'), /if this line is missing, the output was truncated/);
});
