// Fixtures derived from the published bootstrap block, shared by
// test/contract.test.mjs and test/register.test.mjs. They live here so a
// rewrite of the block's prose moves one derivation instead of two copies, and
// so no test file hand-writes a span of `REFERENCE` that it then mutates —
// which is what charged every earlier rewrite a round of retargeting.

import assert from 'node:assert/strict';
import { REFERENCE } from '../../src/contract.mjs';

// The first bold span: what a fixture means by "the lead" when it mutates it.
export const BOLD_LEAD = REFERENCE.match(/\*\*[^*]+\*\*/)[0];
export const UNDERSCORE_LEAD = `__${BOLD_LEAD.slice(2, -2)}__`;

const LINES = REFERENCE.split('\n');
const LEAD = LINES.slice(1, LINES.indexOf('>'));

// A formatter may leave a paragraph continuation without its quote marker.
// Anchored on "a continuation line of the lead paragraph" rather than on an
// index: if the lead ever shrinks, an index would select the blank `>` line,
// the replace would become a no-op, and the lazy-continuation coverage would
// vanish while every assertion still passed.
export const LAZY_LINE = (() => {
  const line = LEAD.at(-1);
  assert.ok(LEAD.length > 1 && /^> \S/.test(line), `no lead continuation to lazy-wrap: ${line}`);
  return line;
})();

// Rewraps the lead paragraph of the real block at a different width and drops
// the space after the quote marker, as an editor reflow would. The result must
// stay semantically equivalent, so `check` is expected to accept it.
export function reflowBootstrap(text) {
  const words = LEAD.map((line) => line.replace(/^> ?/, ''))
    .join(' ')
    .split(' ');
  const wrapped = [];
  let current = '';
  for (const word of words) {
    if (current && current.length + word.length + 1 > 58) {
      wrapped.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  wrapped.push(current);
  const rewrapped = wrapped.map((line, i) => (i === 0 ? `>${line}` : `> ${line}`)).join('\n');
  return text.replace(LEAD.join('\n'), rewrapped);
}
