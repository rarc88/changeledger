#!/usr/bin/env node
import { init } from '../src/commands/init.mjs';
import { newChange } from '../src/commands/new.mjs';
import { view } from '../src/commands/view.mjs';
import { check } from '../src/commands/check.mjs';
import { nowUtc } from '../src/paths.mjs';

const USAGE = `Spec Ledger (sl)

  sl init                 set up .sl/ in the current repo
  sl new <type> <slug> <title>   scaffold a new change (slug is the English filename)
  sl view [port]          launch the local viewer (default port 4040)
  sl check [--json]       validate changes and repo health`;

const [cmd, ...args] = process.argv.slice(2);

try {
  switch (cmd) {
    case 'init': {
      const dir = init();
      console.log(`Initialized Spec Ledger at ${dir}`);
      break;
    }
    case 'new': {
      const [type, slug, ...rest] = args;
      const title = rest.join(' ').trim();
      if (!type || !slug || !title) throw new Error('Usage: sl new <type> <slug> <title>');
      const file = newChange({ type, slug, title, now: nowUtc() });
      console.log(`Created ${file}`);
      break;
    }
    case 'view':
      await view(args);
      break;
    case 'check':
      process.exit(check(args));
      break;
    case undefined:
    case '-h':
    case '--help':
      console.log(USAGE);
      break;
    default:
      console.error(`Unknown command: ${cmd}\n\n${USAGE}`);
      process.exit(1);
  }
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}
