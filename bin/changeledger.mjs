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
import {
  graduate,
  pendingGraduation,
  scaffoldSpec,
  skipGraduation,
} from '../src/commands/graduate.mjs';
import { init } from '../src/commands/init.mjs';
import { newChange } from '../src/commands/new.mjs';
import { registerRepo } from '../src/commands/register.mjs';
import { initReleaseHistory, recordRelease, releasePlan } from '../src/commands/release.mjs';
import { view } from '../src/commands/view.mjs';
import { findChangeledgerDir } from '../src/config.mjs';
import { applyMigration, SUPPORTED_SCHEMA_VERSION } from '../src/config-migration.mjs';
import { nowUtc } from '../src/paths.mjs';

const { version } = createRequire(import.meta.url)('../package.json');

const USAGE = `ChangeLedger (changeledger)

Run \`changeledger context\` first in any repo — it is the mandatory bootstrap.

  changeledger init | register | new | view | check | context
  changeledger status | discard | review | owner | archive | unarchive
  changeledger log | task | list | show | graduate | config | release

Run \`changeledger <command> --help\` for that command's syntax, values and examples.`;

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
  .version(version, '-v, --version', 'output the installed version (-V also accepted)')
  .helpOption('-h, --help', 'display help for command')
  .addHelpText(
    'after',
    '\nRun `changeledger context` first in any repo — it is the mandatory bootstrap.\n' +
      "Run `changeledger <command> --help` for that command's syntax, values and examples.",
  );

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
  .argument('<type>', 'a type key configured in .changeledger/config.yml (types:)')
  .argument('<slug>', 'English filename slug, e.g. self-describing-cli-help')
  .argument('<title...>', 'content title, written in the repo language (config.yml: language)')
  .option('--owner <name>', 'set the initial owner (defaults to unassigned)')
  .addHelpText(
    'after',
    [
      '',
      'Example:',
      '  changeledger new feature self-describing-cli-help "Self-describing CLI help"',
    ].join('\n'),
  )
  .action(
    action((type, slug, titleParts, options) => {
      const title = titleParts.join(' ').trim();
      const file = newChange({ type, slug, title, owner: options.owner, now: nowUtc() });
      console.log(`Created ${file}`);
    }),
  );

program
  .command('view')
  .description('launch the local viewer (all registered projects, or one repo with `.`)')
  .argument('[args...]', 'optional "." for local-only mode and/or a port (default 4040)')
  .addHelpText(
    'after',
    [
      '',
      'Examples:',
      '  changeledger view              # every registered project, port 4040',
      '  changeledger view .            # only the current repo, port 4040',
      '  changeledger view 4041         # every registered project, port 4041',
      '  changeledger view . 4041       # only the current repo, port 4041',
    ].join('\n'),
  )
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
  .argument(
    '[mode-or-change-id]',
    'spec|implement|review|release, or a change id (pack inferred from its status)',
  )
  .addHelpText(
    'after',
    [
      '',
      'With no argument: prints the mandatory bootstrap core. Always run this first —',
      'every mode and change id below is incremental and extends the core already read,',
      'it never replaces it.',
      '',
      'Explicit modes (pass one literally):',
      '  spec        author or refine a change',
      '  implement   execute an approved change',
      '  review      independently verify completed work',
      '  release     plan portable delivery metadata',
      '',
      'Change id (e.g. changeledger context 20260630-225212): loads the pack inferred',
      "from that change's current lifecycle status — you never choose this pack",
      'yourself. Lifecycle overlays such as blocked, validation, close and discarded',
      'are inferred the same way from the change id; they are not modes you pass',
      'explicitly.',
      '',
      'Examples:',
      '  changeledger context',
      '  changeledger context spec',
      '  changeledger context implement',
      '  changeledger context review',
      '  changeledger context release',
      '  changeledger context 20260630-225212',
    ].join('\n'),
  )
  .action(action((input) => context(input)));

program
  .command('status')
  .description("move a change's lifecycle status (agent-owned, non-terminal moves only)")
  .argument('<id>')
  .argument(
    '<status>',
    'a status configured in .changeledger/config.yml (statuses:), e.g. approved, in-progress, in-review, blocked',
  )
  .addHelpText(
    'after',
    [
      '',
      'Terminal moves are not accepted here: use `changeledger discard <id> "<reason>"`',
      'to discard, and human validation in the viewer to reach done.',
      '',
      'Examples:',
      '  changeledger status <id> in-progress',
      '  changeledger status <id> blocked',
    ].join('\n'),
  )
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
  .argument('<name>', 'owner handle, or "-" to clear it')
  .addHelpText(
    'after',
    [
      '',
      'Examples:',
      '  changeledger owner <id> jdoe',
      '  changeledger owner <id> -   # clears the owner',
    ].join('\n'),
  )
  .action(
    action((id, name) => {
      owner(id, name);
      console.log(`#${id} owner → ${name === '-' ? '(cleared)' : name}`);
    }),
  );

program
  .command('archive')
  .description('hide a change in the viewer, or archive all graduated done changes')
  .argument('[id]', 'a change id; mutually exclusive with --graduated')
  .option('--graduated', 'archive every done change already graduated or skipped (takes no id)')
  .option('--dry-run', 'preview --graduated without writing; requires --graduated')
  .addHelpText(
    'after',
    [
      '',
      'Examples:',
      '  changeledger archive <id>',
      '  changeledger archive --graduated',
      '  changeledger archive --graduated --dry-run',
    ].join('\n'),
  )
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
  .argument('<n>', 'the Plan task index, 1-based, in document order')
  .argument('[reason...]', 'required when action is block; ignored when action is done')
  .addHelpText(
    'after',
    [
      '',
      'Examples:',
      '  changeledger task <id> done 1',
      '  changeledger task <id> block 2 "waiting on design decision"',
    ].join('\n'),
  )
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
  .option(
    '--status <status>',
    'filter by a status configured in .changeledger/config.yml (statuses:)',
  )
  .option('--type <type>', 'filter by a type configured in .changeledger/config.yml (types:)')
  .option('--json', 'print JSON')
  .addHelpText(
    'after',
    [
      '',
      'Examples:',
      '  changeledger list --status approved',
      '  changeledger list --type feature --json',
    ].join('\n'),
  )
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
  .option('--new', 'create a spec scaffold without resolving graduation')
  .option('--into', 'finalize graduation into an existing refined spec')
  .option('--skip', 'mark graduation reviewed without a spec')
  .option('--pending', 'list done changes not yet reviewed')
  .addHelpText(
    'after',
    [
      '',
      'Examples:',
      '  changeledger graduate <change-id> <spec-slug> --new',
      '  changeledger graduate <change-id> <spec-slug> --into',
      '  changeledger graduate <change-id> --skip [reason]',
      '  changeledger graduate --pending',
    ].join('\n'),
  )
  .action(
    action((id, slug, reasonParts, options) => {
      const modeCount = [options.new, options.into, options.skip, options.pending].filter(
        Boolean,
      ).length;
      const modeUsage =
        'Usage: changeledger graduate requires exactly one mode: --new, --into, --skip, or --pending';
      if (modeCount !== 1) throw new Error(modeUsage);

      if (options.pending) {
        if (id || slug || reasonParts.length) throw new Error(modeUsage);
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

      if (!id || !slug || reasonParts.length) throw new Error(modeUsage);
      if (options.new) {
        const file = scaffoldSpec(id, slug);
        console.log(
          `Created spec scaffold ${file}. Refine it, then run: changeledger graduate ${id} ${slug} --into`,
        );
        return;
      }
      const file = graduate(id, slug, process.cwd(), { into: options.into });
      console.log(`Graduated #${id} → ${file}`);
    }),
  );

const configCommand = program
  .command('config')
  .description('inspect and manage the repo configuration');

configCommand
  .command('migrate')
  .description('migrate .changeledger/config.yml to the current schema')
  .option('--dry-run', 'show the migration plan and candidate YAML without writing')
  .action(
    action((options) => {
      const changeledgerDir = findChangeledgerDir();
      if (!changeledgerDir) throw new Error('Not a ChangeLedger repo.');
      const configFile = `${changeledgerDir}/config.yml`;
      const result = applyMigration(configFile, { dryRun: options.dryRun ?? false });
      console.log(result);
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

// Normalize -V to --version so both short aliases work identically.
const argv = process.argv.map((a) => (a === '-V' ? '--version' : a));
if (argv.length <= 2) {
  console.log(USAGE);
} else {
  program.parse(argv);
}
