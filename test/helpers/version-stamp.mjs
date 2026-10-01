// Shared by the suites that pin the `[version]` Log stamp (20261001-155216).
// A "previous" CLI is simulated by seeding a Log whose last `[version]` is
// PREVIOUS_VERSION, so the real installed version always differs from it.

import assert from 'node:assert/strict';
import { VERSION } from '../../src/framing.mjs';
import { parseLogEvent } from '../../src/lifecycle.mjs';

export const PREVIOUS_VERSION = '0.17.0';

// Typed events of the `## Log` section, in order.
export function logEvents(text) {
  const events = [];
  let inLog = false;
  for (const line of text.split('\n')) {
    if (/^##\s/.test(line)) {
      inLog = /^##\s+Log\s*$/.test(line);
      continue;
    }
    const event = inLog ? parseLogEvent(line) : null;
    if (event) events.push(event);
  }
  return events;
}

// The events `after` has beyond `before`, asserting `before`'s Log is an
// untouched prefix of it.
export function eventsAdded(before, after) {
  const was = logEvents(before);
  const now = logEvents(after);
  assert.deepEqual(now.slice(0, was.length), was, 'the earlier Log entries are untouched');
  return now.slice(was.length);
}

export const versionEvents = (events) => events.filter((event) => event.type === 'version');

// What creation lands for a composed document: the document plus the running
// version's stamp at `created`. Written out by hand rather than through the
// writer, so a test that expects it is not the writer checking itself.
export function withCreationStamp(document, created) {
  const entry = `- **${created}** \`[version]\` ${VERSION}`;
  return /^## Log\n/m.test(document)
    ? document.replace(/^## Log\n/m, `## Log\n${entry}\n`)
    : `${document.trimEnd()}\n\n## Log\n\n${entry}\n`;
}
