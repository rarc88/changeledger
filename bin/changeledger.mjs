#!/usr/bin/env node
import { createRequire } from 'node:module';
import { Command } from 'commander';
import {
  archive,
  archiveGraduated,
  discard,
  list,
  log,
  owner,
  review,
  show,
  status,
  task,
} from '../src/commands/agent.mjs';
import { check } from '../src/commands/check.mjs';
import { context } from '../src/commands/context.mjs';
import { graduate, pendingGraduation, skipGraduation } from '../src/commands/graduate.mjs';
import { init } from '../src/commands/init.mjs';
import { newChange } from '../src/commands/new.mjs';
import { registerRepo } from '../src/commands/register.mjs';
import { initReleaseHistory, recordRelease, releasePlan } from '../src/commands/release.mjs';
import { view } from '../src/commands/view.mjs';
import { nowUtc } from '../src/paths.mjs';

const { version } = createRequire(import.meta.url)('../package.json');

const USAGE = `ChangeLedger (changeledger)

  changeledger init                          set up .changeledger/ in the current repo (+ register it)
  changeledger register                      refresh registration and context bootstrap
  changeledger new <type> <slug> <title>     scaffold a new change (slug is the English filename)
  changeledger view [port]                   launch the local viewer (default port 4040)
  changeledger check [id] [--json]           validate the repo or one change
  changeledger context [mode|change-id]       print deterministic task context
  changeledger status <id> <status>          move a change's lifecycle status
  changeledger discard <id> "<reason>"       discard a change (terminal; keeps the record)
  changeledger review <id> pass              independent review passed → in-validation
  changeledger review <id> fail --retry|--block "<reason>"   review failed → in-progress|blocked
  changeledger owner <id> <name|->           set or clear a change's owner
  changeledger archive <id> / unarchive <id>   hide/show a change in the viewer
  changeledger archive --graduated [--dry-run] archive done changes already graduated/skipped
  changeledger log <id> <message>            append a timestamped Log entry
  changeledger task <id> done|block <n> [reason]   mark a Plan task
  changeledger list [--status S] [--type T] [--json]   list changes
  changeledger show <id> [--json]            print a change
  changeledger graduate <change-id> <spec-slug>   graduate a change to a new spec
  changeledger graduate <change-id> <spec-slug> --into   graduate into an existing spec
  changeledger graduate <change-id> --skip [reason]   mark graduation reviewed, no spec
  changeledger graduate --pending                 list done changes not yet reviewed
  changeledger release init <version>             initialize release history at X.Y.Z
  changeledger release plan [--json]              calculate the next portable SemVer release
  changeledger release record <version>           record the calculated release manifest`;

const program = new Command();

function action(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (e) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
  };
}

program
  .name('changeledger')
  .description('ChangeLedger (changeledger)')
  .version(version, '-V, --version', 'output the installed version')
  .helpOption('-h, --help', 'display help for command')
  .addHelpText('after', `\n${USAGE}`);

program
  .command('init')
  .description('set up .changeledger/ in the current repo (+ register it)')
  .action(
    action(() => {
      const dir = init();
      console.log(`Initialized ChangeLedger at ${dir}`);
    }),
  );

program
  .command('register')
  .description('refresh registration and context bootstrap')
  .action(
    action(() => {
      const { id, path: p } = registerRepo();
      console.log(`Registered ${id} → ${p}`);
    }),
  );

program
  .command('new')
  .description('scaffold a new change')
  .argument('<type>')
  .argument('<slug>')
  .argument('<title...>')
  .option('--owner <name>', 'set the initial owner')
  .action(
    action((type, slug, titleParts, options) => {
      const title = titleParts.join(' ').trim();
      const file = newChange({ type, slug, title, owner: options.owner, now: nowUtc() });
      console.log(`Created ${file}`);
    }),
  );

program
  .command('view')
  .description('launch the local viewer')
  .argument('[args...]')
  .action(action((args) => view(args)));

program
  .command('check')
  .description('validate the repo or one change')
  .argument('[id]')
  .option('--json', 'print JSON')
  .action((id, options) => {
    try {
      const args = [...(id ? [id] : []), ...(options.json ? ['--json'] : [])];
      process.exit(check(args));
    } catch (e) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
  });

program
  .command('context')
  .description('print deterministic task context')
  .argument('[mode-or-change-id]')
  .action(action((input) => context(input)));

program
  .command('status')
  .description("move a change's lifecycle status")
  .argument('<id>')
  .argument('<status>')
  .action(
    action((id, st) => {
      status(id, st);
      console.log(`#${id} → ${st}`);
    }),
  );

program
  .command('discard')
  .description('discard a change (terminal; keeps the record and reason)')
  .argument('<id>')
  .argument('<reason...>')
  .action(
    action((id, reasonParts) => {
      discard(id, reasonParts.join(' ').trim());
      console.log(`#${id} → discarded`);
    }),
  );

program
  .command('review')
  .description('record an independent review verdict')
  .argument('<id>')
  .argument('<verdict>', 'pass|fail')
  .argument('[reason...]')
  .option('--retry', 'route a failed review back to in-progress')
  .option('--block', 'route a failed review to blocked')
  .addHelpText(
    'after',
    [
      '',
      'Examples:',
      '  changeledger review <id> pass',
      '  changeledger review <id> fail --retry "<reason>"',
      '  changeledger review <id> fail --block "<reason>"',
    ].join('\n'),
  )
  .action(
    action((id, verdict, reasonParts, options) => {
      const mode = options.retry ? 'retry' : options.block ? 'block' : undefined;
      const reason = reasonParts.join(' ').trim() || undefined;
      review(id, verdict, { mode, reason });
      console.log(`#${id} review ${verdict}${mode ? ` --${mode}` : ''}`);
    }),
  );

program
  .command('owner')
  .description("set or clear a change's owner")
  .argument('<id>')
  .argument('<name>')
  .action(
    action((id, name) => {
      owner(id, name);
      console.log(`#${id} owner → ${name === '-' ? '(cleared)' : name}`);
    }),
  );

program
  .command('archive')
  .description('hide a change in the viewer, or archive all graduated done changes')
  .argument('[id]')
  .option('--graduated', 'archive done changes already graduated or skipped')
  .option('--dry-run', 'show what would be archived without writing')
  .action(
    action((id, options) => {
      if (options.graduated) {
        if (id) throw new Error('archive --graduated does not take an id');
        const archived = archiveGraduated({ dryRun: options.dryRun });
        for (const c of archived) console.log(`#${c.id} ${c.title}`);
        console.log(
          `${options.dryRun ? 'Would archive' : 'Archived'} ${archived.length} change(s)`,
        );
        return;
      }
      if (options.dryRun) throw new Error('--dry-run requires --graduated');
      if (!id) throw new Error('archive requires <id> or --graduated');
      archive(id, true);
      console.log(`#${id} archived`);
    }),
  );

program
  .command('unarchive')
  .description('show a change in the viewer')
  .argument('<id>')
  .action(
    action((id) => {
      archive(id, false);
      console.log(`#${id} unarchived`);
    }),
  );

program
  .command('log')
  .description('append a timestamped Log entry')
  .argument('<id>')
  .argument('<message...>')
  .action(
    action((id, messageParts) => {
      log(id, messageParts.join(' ').trim());
      console.log(`logged on #${id}`);
    }),
  );

program
  .command('task')
  .description('mark a Plan task')
  .argument('<id>')
  .argument('<action>', 'done|block')
  .argument('<n>')
  .argument('[reason...]')
  .action(
    action((id, taskAction, nStr, reasonParts) => {
      const n = Number(nStr);
      task(id, taskAction, n, reasonParts.join(' ').trim());
      console.log(`task #${n} on #${id} → ${taskAction}`);
    }),
  );

program
  .command('list')
  .description('list changes')
  .option('--status <status>', 'filter by status')
  .option('--type <type>', 'filter by type')
  .option('--json', 'print JSON')
  .action(
    action((options) => {
      const items = list({ status: options.status, type: options.type });
      if (options.json) {
        console.log(JSON.stringify(items, null, 2));
      } else {
        for (const c of items) console.log(`${String(c.status).padEnd(12)} #${c.id}  ${c.title}`);
      }
    }),
  );

program
  .command('show')
  .description('print a change')
  .argument('<id>')
  .option('--json', 'print JSON')
  .action(
    action((id, options) => {
      const c = show(id);
      if (options.json) console.log(JSON.stringify(c, null, 2));
      else console.log(`#${c.id} ${c.frontmatter.title} [${c.frontmatter.status}]`);
    }),
  );

program
  .command('graduate')
  .description('graduate a done change to persistent truth')
  .argument('[change-id]')
  .argument('[spec-slug]')
  .argument('[reason...]')
  .option('--into', 'graduate into an existing spec')
  .option('--skip', 'mark graduation reviewed without a spec')
  .option('--pending', 'list done changes not yet reviewed')
  .addHelpText(
    'after',
    [
      '',
      'Examples:',
      '  changeledger graduate <change-id> <spec-slug>',
      '  changeledger graduate <change-id> <spec-slug> --into',
      '  changeledger graduate <change-id> --skip [reason]',
      '  changeledger graduate --pending',
    ].join('\n'),
  )
  .action(
    action((id, slug, reasonParts, options) => {
      if (options.pending) {
        const items = pendingGraduation();
        if (!items.length) console.log('No changes pending graduation.');
        for (const c of items) console.log(`#${c.id}  ${c.title}`);
        return;
      }
      if (options.skip) {
        if (!id) throw new Error('Usage: changeledger graduate <change-id> --skip [reason]');
        const reason = [slug, ...reasonParts].filter(Boolean).join(' ').trim();
        skipGraduation(id, reason);
        console.log(`#${id} graduation skipped`);
        return;
      }
      if (!id || !slug) throw new Error('Usage: changeledger graduate <change-id> <spec-slug>');
      const file = graduate(id, slug, process.cwd(), { into: options.into });
      console.log(`Graduated #${id} → ${file}`);
    }),
  );

const releaseCommand = program
  .command('release')
  .description('plan and record portable SemVer releases');

releaseCommand
  .command('init')
  .description('initialize release history from the current published version')
  .argument('<version>')
  .action(
    action((version) => {
      const { file, manifest } = initReleaseHistory(version);
      console.log(`Initialized release ${manifest.version} baseline → ${file}`);
    }),
  );

releaseCommand
  .command('plan')
  .description('calculate the next release without writing files')
  .option('--json', 'print a stable JSON plan')
  .action(
    action((options) => {
      const plan = releasePlan();
      if (options.json) {
        console.log(JSON.stringify(plan, null, 2));
        return;
      }
      if (!plan.releasable) {
        console.log(
          `No release required from ${plan.currentVersion}: ${plan.changes.length} pending change(s), highest impact none.`,
        );
        return;
      }
      console.log(`${plan.currentVersion} → ${plan.nextVersion} (${plan.impact})`);
      for (const change of plan.changes) {
        console.log(`  #${change.id} [${change.releaseImpact}] ${change.title}`);
      }
    }),
  );

releaseCommand
  .command('record')
  .description('record the currently calculated release')
  .argument('<version>')
  .action(
    action((version) => {
      const { file, manifest } = recordRelease(version);
      console.log(`Recorded release ${manifest.version} → ${file}`);
    }),
  );

if (process.argv.length <= 2) {
  console.log(USAGE);
} else {
  program.parse();
}
