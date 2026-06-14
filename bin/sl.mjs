#!/usr/bin/env node
import { archive, list, log, owner, show, status, task } from '../src/commands/agent.mjs';
import { check } from '../src/commands/check.mjs';
import { graduate, pendingGraduation, skipGraduation } from '../src/commands/graduate.mjs';
import { init } from '../src/commands/init.mjs';
import { newChange } from '../src/commands/new.mjs';
import { registerRepo } from '../src/commands/register.mjs';
import { view } from '../src/commands/view.mjs';
import { nowUtc } from '../src/paths.mjs';

const USAGE = `Spec Ledger (sl)

  sl init                          set up .sl/ in the current repo (+ register it)
  sl register                      (re)link this repo's path in the global registry
  sl new <type> <slug> <title>     scaffold a new change (slug is the English filename)
  sl view [port]                   launch the local viewer (default port 4040)
  sl check [id] [--json]           validate the repo or one change
  sl status <id> <status>          move a change's lifecycle status
  sl owner <id> <name|->           set or clear a change's owner
  sl archive <id> / unarchive <id>   hide/show a change in the viewer
  sl log <id> <message>            append a timestamped Log entry
  sl task <id> done|block <n> [reason]   mark a Plan task
  sl list [--status S] [--type T] [--json]   list changes
  sl show <id> [--json]            print a change
  sl graduate <change-id> <spec-slug>   graduate a change to a spec
  sl graduate <change-id> --skip [reason]   mark graduation reviewed, no spec
  sl graduate --pending                 list done changes not yet reviewed`;

// Per-command usage, shown by `sl <cmd> --help` / `-h` and reused by the
// `Usage:` errors below so there is a single source of truth.
const HELP = {
  init: 'sl init — set up .sl/ in the current repo (+ register it)',
  register: "sl register — (re)link this repo's path in the global registry",
  new: 'sl new <type> <slug> <title> [--owner name] — scaffold a change',
  view: 'sl view [port] — launch the local viewer (default port 4040)',
  check: 'sl check [id] [--json] — validate the repo or one change',
  status: "sl status <id> <status> — move a change's lifecycle status",
  owner: "sl owner <id> <name|-> — set or clear a change's owner",
  archive: 'sl archive <id> | sl unarchive <id> — hide/show a change in the viewer',
  unarchive: 'sl archive <id> | sl unarchive <id> — hide/show a change in the viewer',
  log: 'sl log <id> <message> — append a timestamped Log entry',
  task: 'sl task <id> done|block <n> [reason] — mark a Plan task',
  list: 'sl list [--status S] [--type T] [--json] — list changes',
  show: 'sl show <id> [--json] — print a change',
  graduate:
    'sl graduate <change-id> <spec-slug> — graduate a change to a spec\n' +
    'sl graduate <change-id> --skip [reason] — mark graduation reviewed, no spec\n' +
    'sl graduate --pending — list done changes not yet reviewed',
};

const usage = (cmd) => `Usage: ${HELP[cmd]}`;

const flagVal = (args, flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const [cmd, ...args] = process.argv.slice(2);

// `sl <cmd> --help|-h` prints that command's usage and exits cleanly.
if ((args[0] === '--help' || args[0] === '-h') && HELP[cmd]) {
  console.log(HELP[cmd]);
  process.exit(0);
}

try {
  switch (cmd) {
    case 'init': {
      const dir = init();
      console.log(`Initialized Spec Ledger at ${dir}`);
      break;
    }
    case 'register': {
      const { id, path: p } = registerRepo();
      console.log(`Registered ${id} → ${p}`);
      break;
    }
    case 'new': {
      const ownerVal = flagVal(args, '--owner');
      const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--owner');
      const [type, slug, ...rest] = positional;
      const title = rest.join(' ').trim();
      if (!type || !slug || !title)
        throw new Error('Usage: sl new <type> <slug> <title> [--owner name]');
      const file = newChange({ type, slug, title, owner: ownerVal, now: nowUtc() });
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
    case 'owner': {
      const [id, name] = args;
      if (!id || !name) throw new Error('Usage: sl owner <id> <name|->');
      owner(id, name);
      console.log(`#${id} owner → ${name === '-' ? '(cleared)' : name}`);
      break;
    }
    case 'archive':
    case 'unarchive': {
      const [id] = args;
      if (!id) throw new Error(`Usage: sl ${cmd} <id>`);
      archive(id, cmd === 'archive');
      console.log(`#${id} ${cmd}d`);
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
      if (!id || !action || !n) throw new Error(usage('task'));
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
    case 'graduate': {
      if (args.includes('--pending')) {
        const items = pendingGraduation();
        if (!items.length) console.log('No changes pending graduation.');
        for (const c of items) console.log(`#${c.id}  ${c.title}`);
        break;
      }
      const skipIdx = args.indexOf('--skip');
      if (skipIdx !== -1) {
        const id = args.find((a) => !a.startsWith('--'));
        if (!id) throw new Error(usage('graduate'));
        const reason = args
          .slice(skipIdx + 1)
          .join(' ')
          .trim();
        skipGraduation(id, reason);
        console.log(`#${id} graduation skipped`);
        break;
      }
      const [id, slug] = args;
      if (!id || !slug) throw new Error(usage('graduate'));
      const file = graduate(id, slug);
      console.log(`Graduated #${id} → ${file}`);
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
