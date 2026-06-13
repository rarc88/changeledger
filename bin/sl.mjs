#!/usr/bin/env node
import { list, log, show, status, task } from '../src/commands/agent.mjs';
import { check } from '../src/commands/check.mjs';
import { init } from '../src/commands/init.mjs';
import { newChange } from '../src/commands/new.mjs';
import { view } from '../src/commands/view.mjs';
import { nowUtc } from '../src/paths.mjs';

const USAGE = `Spec Ledger (sl)

  sl init                          set up .sl/ in the current repo
  sl new <type> <slug> <title>     scaffold a new change (slug is the English filename)
  sl view [port]                   launch the local viewer (default port 4040)
  sl check [id] [--json]           validate the repo or one change
  sl status <id> <status>          move a change's lifecycle status
  sl log <id> <message>            append a timestamped Log entry
  sl task <id> done|block <n> [reason]   mark a Plan task
  sl list [--status S] [--type T] [--json]   list changes
  sl show <id> [--json]            print a change`;

const flagVal = (args, flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

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
    case 'status': {
      const [id, st] = args;
      if (!id || !st) throw new Error('Usage: sl status <id> <status>');
      status(id, st);
      console.log(`#${id} → ${st}`);
      break;
    }
    case 'log': {
      const [id, ...rest] = args;
      const message = rest.join(' ').trim();
      if (!id || !message) throw new Error('Usage: sl log <id> <message>');
      log(id, message);
      console.log(`logged on #${id}`);
      break;
    }
    case 'task': {
      const [id, action, nStr, ...rest] = args;
      const n = Number(nStr);
      const reason = rest.join(' ').trim();
      if (!id || !action || !n) throw new Error('Usage: sl task <id> done|block <n> [reason]');
      task(id, action, n, reason);
      console.log(`task #${n} on #${id} → ${action}`);
      break;
    }
    case 'list': {
      const items = list({ status: flagVal(args, '--status'), type: flagVal(args, '--type') });
      if (args.includes('--json')) {
        console.log(JSON.stringify(items, null, 2));
      } else {
        for (const c of items) console.log(`${String(c.status).padEnd(12)} #${c.id}  ${c.title}`);
      }
      break;
    }
    case 'show': {
      const id = args.find((a) => !a.startsWith('--'));
      if (!id) throw new Error('Usage: sl show <id> [--json]');
      const c = show(id);
      if (args.includes('--json')) console.log(JSON.stringify(c, null, 2));
      else console.log(`#${c.id} ${c.frontmatter.title} [${c.frontmatter.status}]`);
      break;
    }
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
