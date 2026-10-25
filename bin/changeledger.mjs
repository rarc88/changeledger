#!/usr/bin/env node
import { createRequire } from 'node:module';
import path from 'node:path';
import { Argument, Command, Help, InvalidArgumentError, Option } from 'commander';
import { CANONICAL_STAGES, CHANGE_TYPES } from '../src/change.mjs';
import { activate } from '../src/commands/activate.mjs';
import {
  approve,
  archive,
  archiveGraduated,
  branch,
  discard,
  list,
  log,
  owner,
  recordFinding,
  resolveFinding,
  review,
  show,
  status,
  task,
} from '../src/commands/agent.mjs';
import { AGENT_ROLES, agentContext } from '../src/commands/agent-context.mjs';
import { agentPrompt } from '../src/commands/agent-prompt.mjs';
import { runAnalyze } from '../src/commands/analyze.mjs';
import { apply } from '../src/commands/apply.mjs';
import { check } from '../src/commands/check.mjs';
import { commit } from '../src/commands/commit.mjs';
import { context } from '../src/commands/context.mjs';
import { cutover } from '../src/commands/cutover.mjs';
import { edit } from '../src/commands/edit.mjs';
import { fix } from '../src/commands/fix.mjs';
import { graduate, scaffoldSpec, skipGraduation } from '../src/commands/graduate.mjs';
import { importFromRef } from '../src/commands/import.mjs';
import { init } from '../src/commands/init.mjs';
import { newChange, newChangeFrom, requireType, scaffoldChange } from '../src/commands/new.mjs';
import { registerRepo } from '../src/commands/register.mjs';
import { initReleaseHistory, recordRelease, releasePlan } from '../src/commands/release.mjs';
import { runSearch } from '../src/commands/search.mjs';
import { sync } from '../src/commands/sync.mjs';
import { view } from '../src/commands/view.mjs';
import {
  BRANCH_FORMAT_PLACEHOLDERS,
  findChangeledgerDir,
  loadEffectiveConfig,
} from '../src/config.mjs';
import { applyMigration } from '../src/config-migration.mjs';
import { LOG_EVENT_DEFINITIONS, REVIEW_VERDICTS, TASK_ACTIONS } from '../src/lifecycle.mjs';
import { nowUtc } from '../src/paths.mjs';
import { RELEASE_IMPACTS } from '../src/release.mjs';
import {
  CAS_CONFLICT_MESSAGE,
  LedgerConflictError,
  setUnknownCollectionsListener,
  unknownCollectionsMessage,
} from '../src/state-store.mjs';
import { USAGE_GROUP_KEYS } from '../src/usage-analysis.mjs';
import { repoCliVersionError } from '../src/version-guard.mjs';

const { version } = createRequire(import.meta.url)('../package.json');

// A state ref holding collections this CLI does not declare is read without
// them (20261002-161641); one command may read the tree several times, so the
// warning is written on the first read only. Installed before the first read
// of this module, the configured-domains lookup below.
let unknownCollectionsWarned = false;
setUnknownCollectionsListener((collections) => {
  if (unknownCollectionsWarned) return;
  unknownCollectionsWarned = true;
  console.error(`warning: ${unknownCollectionsMessage(collections, version)}`);
});

function configuredDomains(cwd = process.cwd()) {
  try {
    const changeledgerDir = findChangeledgerDir(cwd);
    if (!changeledgerDir) return null;
    const config = loadEffectiveConfig(path.dirname(changeledgerDir), changeledgerDir);
    return { statuses: Array.isArray(config.statuses) ? config.statuses : [] };
  } catch {
    return null;
  }
}

const CONFIGURED_DOMAINS = configuredDomains();

function closedArgument(syntax, description, choices) {
  const argument = new Argument(syntax, description);
  return choices?.length ? argument.choices(choices) : argument;
}

function closedOption(flags, description, choices) {
  const option = new Option(flags, description);
  return choices?.length ? option.choices(choices) : option;
}

// Types and stages are fixed in code; statuses are still read from the repo.
function configuredDomainsHelp() {
  return [
    '',
    `types: ${CHANGE_TYPES.join(', ')}`,
    `stages: ${CANONICAL_STAGES.join(', ')}`,
    ...(CONFIGURED_DOMAINS
      ? [`effective statuses: ${CONFIGURED_DOMAINS.statuses.join(', ')}`]
      : []),
  ];
}

// `new` shows the two types as choices but refuses with the creation seat's
// own message, so the CLI and `requireType` cannot word it differently.
function changeTypeArgument() {
  return new Argument('<type>', 'change or epic').choices(CHANGE_TYPES).argParser((value) => {
    try {
      requireType(value);
    } catch (error) {
      throw new InvalidArgumentError(error.message);
    }
    return value;
  });
}

const LOG_EVENT_PRODUCERS = Object.freeze({
  status: ['changeledger approve', 'changeledger status', 'changeledger discard'],
  review: ['changeledger review'],
  // The `in-validation → <to>` arm is retired with the status and survives only
  // so Logs written while it existed keep parsing; the acceptance arm is live
  // and has two seats, because a branch that lands after the graduation is
  // stamped later by `sync`.
  validation: [
    'changeledger graduate (the accepted (merged <sha>) arm, at graduation)',
    'changeledger sync (the same arm, when the merge lands after the graduation; no command writes the in-validation arm any more)',
  ],
  owner: ['changeledger owner', 'changeledger status (automatic when work starts)'],
  branch: ['changeledger branch', 'changeledger status (automatic when work starts)'],
  graduation: ['changeledger graduate'],
  archive: ['changeledger archive'],
  note: ['changeledger log'],
  version: [
    'changeledger new, changeledger apply (creation)',
    'every command listed here that appends a Log event, when the Log has no stamp or its last one differs from the installed version (not edit or apply documents)',
  ],
  finding: ['changeledger finding'],
});

function logEventGrammarHelp() {
  const types = Object.keys(LOG_EVENT_DEFINITIONS);
  const missingProducers = types.filter((type) => !LOG_EVENT_PRODUCERS[type]);
  const staleProducers = Object.keys(LOG_EVENT_PRODUCERS).filter(
    (type) => !LOG_EVENT_DEFINITIONS[type],
  );
  if (missingProducers.length || staleProducers.length) {
    throw new Error(
      `Log help producer map does not match executable definitions (missing: ${missingProducers.join(', ') || 'none'}; stale: ${staleProducers.join(', ') || 'none'})`,
    );
  }

  return [
    '',
    'Record a note with `changeledger log <id> "Investigation complete"`.',
    'Example Log line (timestamp generated when you run it):',
    '  - **2026-08-24T17:42:40Z** `[note]` Investigation complete',
    '',
    'Use `changeledger log` only for human-readable notes.',
    'Other Log events are written by the lifecycle commands listed below.',
    'Do not type an event name in <message...>.',
    '',
    'Valid Log events and their writers:',
    ...Object.entries(LOG_EVENT_DEFINITIONS).flatMap(([type, definition]) => {
      const [payload, ...alternatives] = definition.form.split(' | ');
      return [
        `  ${type}`,
        `    Payload: ${payload}`,
        ...alternatives.map((alternative) => `    Or: ${alternative}`),
        '    Written by:',
        ...LOG_EVENT_PRODUCERS[type].map((producer) => `      ${producer}`),
      ];
    }),
    '',
    'Advanced batch writes:',
    '  `changeledger apply` can write status, owner, and note events from a JSON manifest.',
    '  Run `changeledger apply --help` for that separate workflow.',
  ].join('\n');
}

const USAGE = `ChangeLedger (changeledger)

Run \`changeledger context\` first in any repo unless a ChangeLedger delegation
prompt identifies your role and tells you to run \`agent-context\` instead.

  changeledger init | register | new | edit | apply | view | check | fix | context | agent-context
  changeledger commit | status | approve | discard | review | owner
  changeledger archive | log | finding | task | list | show | search | analyze | graduate | config | release
  changeledger cutover | activate | import | sync

Run \`changeledger <command> --help\` for that command's syntax, values and examples.`;

const program = new Command();

function fail(e) {
  // A CAS conflict from the state store (`change-store.mjs`/
  // `state-store.mjs`) is presented with its own actionable message —
  // the store already guarantees no partial write, so the bin's only
  // job is to tell the caller to reload and re-run, not to relay the
  // store's own "state ref moved: expected X, found Y" internals.
  if (e instanceof LedgerConflictError) {
    console.error(`${CAS_CONFLICT_MESSAGE} — re-run the command`);
  } else {
    console.error(`Error: ${e.message}`);
  }
  process.exit(1);
}

function action(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (e) {
      fail(e);
    }
  };
}

function commandPath(command) {
  const names = [];
  for (let current = command; current.parent; current = current.parent) {
    names.unshift(current.name());
  }
  return names.join(' ');
}

// Closed list. Help and version output exit inside commander's parse before any
// preAction hook, so they never reach it. `init` keeps its own "already exists"
// error; `view` serves several projects, so the minimum belongs to each project
// it writes to rather than to the cwd; a migration preview writes nothing.
function bypassesVersionGuard(command) {
  const name = commandPath(command);
  if (name === 'init' || name === 'view') return true;
  return name === 'config migrate' && command.opts().dryRun === true;
}

// Collects a repeatable option (e.g. `--id`) into an array across invocations.
function collect(value, previous) {
  return previous.concat([value]);
}

program
  .name('changeledger')
  .description('ChangeLedger (changeledger)')
  .version(version, '-v, --version', 'output the installed version (-V also accepted)')
  .helpOption('-h, --help', 'display help for command')
  // Commander enforces mandatory options but does not say so in help; the help
  // must name every argument a command cannot run without.
  .configureHelp({
    optionDescription(option) {
      const description = Help.prototype.optionDescription.call(this, option);
      return option.mandatory ? `${description} (required)` : description;
    },
  })
  .addHelpText(
    'after',
    '\nRun `changeledger context` first unless a ChangeLedger delegation prompt tells your role to use `agent-context`.\n' +
      "Run `changeledger <command> --help` for that command's syntax, values and examples.",
  )
  // Runs after argument parsing (which has no effects) and before any action,
  // so an incompatible CLI stops before a lock, write or ref update.
  .hook('preAction', (_program, actionCommand) => {
    if (bypassesVersionGuard(actionCommand)) return;
    const changeledgerDir = findChangeledgerDir();
    if (!changeledgerDir) return;
    const message = repoCliVersionError(path.dirname(changeledgerDir), changeledgerDir, version);
    if (message) fail(new Error(message));
  });

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
  .addArgument(changeTypeArgument())
  .argument('<slug>', 'English filename slug, e.g. self-describing-cli-help')
  .argument('<title...>', 'content title, written in the repo language (config.yml: language)')
  .option('--owner <name>', 'set the initial owner (defaults to the local git identity)')
  .option('--parent <id>', 'create this change as a child of that epic')
  .option('--print', 'emit the scaffold to stdout and write nothing, in either mode')
  .option('--from <file>', 'land this already composed document ("-" reads stdin)')
  .addHelpText(
    'after',
    [
      '',
      'An activated repo publishes to a permanent journal, so it refuses to create an',
      'empty scaffold there: compose the document with `--print`, fill it, and land it',
      'whole with `--from`. An inactive repo still scaffolds into the worktree.',
      '',
      'Examples:',
      '  changeledger new change self-describing-cli-help "Self-describing CLI help"',
      '  changeledger new change seam "Costura" --print > draft.md',
      '  changeledger new change seam "Costura" --from draft.md',
      '  changeledger new change leak "Fuga" --parent <epic-id>',
    ].join('\n'),
  )
  .action(
    action((type, slug, titleParts, options) => {
      const title = titleParts.join(' ').trim();
      if (options.print && options.from) throw new Error('use --print or --from, not both');
      if (options.owner && options.from) {
        throw new Error('the document passed to --from declares its own owner; drop --owner');
      }
      // Same rule as --owner: a field the incoming document owns is refused,
      // never dropped. `--parent` used to vanish here, and since `--from` is
      // the only way to create a change in an activated repo, that was the
      // main path (20261020-172221 D2).
      if (options.parent && options.from) {
        throw new Error('the document passed to --from declares its own parent; drop --parent');
      }
      if (options.print) {
        process.stdout.write(
          scaffoldChange({
            type,
            slug,
            title,
            owner: options.owner,
            parent: options.parent,
            now: nowUtc(),
          }).text,
        );
        return;
      }
      const file = options.from
        ? newChangeFrom({ type, slug, title, from: options.from })
        : newChange({
            type,
            slug,
            title,
            owner: options.owner,
            parent: options.parent,
            now: nowUtc(),
          });
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
  .option(
    '--commits [base]',
    'lint commit subjects on <base>..HEAD for the [#id] marker (base defaults to the integration branch of the change on the current branch, else git.integration_branch, else auto-detected)',
  )
  .addHelpText(
    'after',
    [
      ...configuredDomainsHelp(),
      '',
      'Examples:',
      '  changeledger check --commits',
      '  changeledger check --commits main',
    ].join('\n'),
  )
  .action((id, options) => {
    try {
      const args = [
        ...(id ? [id] : []),
        ...(options.json ? ['--json'] : []),
        ...(options.commits !== undefined
          ? ['--commits', ...(typeof options.commits === 'string' ? [options.commits] : [])]
          : []),
      ];
      process.exit(check(args));
    } catch (e) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
  });

program
  .command('fix')
  .description(
    'repair mechanical format defects and migrate live documents: a retired type becomes `change`, `## Investigation`/`## Proposal` fold under the Request (or one change)',
  )
  .argument('[id]')
  .option('--dry-run', 'print the proposed diff without writing')
  .addHelpText(
    'after',
    [
      '',
      'default repairs: checkbox markers [ x ]/[X], legacy hyphen separators, near-ISO UTC timestamps',
    ].join('\n'),
  )
  .action((id, options) => {
    try {
      const args = [...(id ? [id] : []), ...(options.dryRun ? ['--dry-run'] : [])];
      process.exit(fix(args));
    } catch (e) {
      if (e instanceof LedgerConflictError) {
        console.error(`${CAS_CONFLICT_MESSAGE} — re-run the command`);
      } else {
        console.error(`Error: ${e.message}`);
      }
      process.exit(1);
    }
  });

program
  .command('edit')
  .description('replace one document (change or spec) with a complete one, in a single write')
  .argument('<target>', 'a change id, or `spec:<slug>` for a spec')
  .requiredOption('--from <file>', 'the complete document to write ("-" reads stdin)')
  .addHelpText(
    'after',
    [
      '',
      'The unit is the whole document: `edit` writes CONTENT (body, title,',
      'depends_on, related_to, release_impact) and never lifecycle — `id` and',
      '`created` are immutable, and `status`, `owner`, `branch`, `archived` and',
      '`reviewed` must match the current values, each named with the command that',
      'owns it. The incoming document is validated whole before anything is',
      'written, and a byte-identical document is a no-op.',
      '',
      'Activated repos land it as exactly one commit on the state ref; inactive',
      'repos replace the worktree file atomically and commit nothing.',
      '',
      'Examples:',
      '  changeledger edit <id> --from draft.md',
      '  changeledger edit spec:global-state-scope --from spec.md',
    ].join('\n'),
  )
  .action(
    action((target, options) => {
      const { path: written, changed } = edit(target, { from: options.from });
      console.log(changed ? `Edited ${written}` : `Unchanged ${written} (byte-identical)`);
    }),
  );

program
  .command('apply')
  .description('land a JSON manifest of documents and agent events as one journal entry')
  .requiredOption('--from <file>', 'the manifest to apply ("-" reads stdin)')
  .option('--dry-run', 'validate the whole manifest and write nothing, in either mode')
  .addHelpText(
    'after',
    [
      '',
      'The manifest is a JSON array of entries applied IN ORDER against one',
      'accumulated candidate, landing as exactly one commit — or, if any entry is',
      'invalid, as nothing at all. A document entry is',
      '{"target": "new"|"change:<id>"|"spec:<slug>", "content": "<full markdown>"}',
      'and runs every guard `new --from`/`edit` run, byte-identical included; a',
      '`new` entry may add "slug" to name the file (derived from the title if absent).',
      'An event entry is {"op": "status"|"log"|"task"|"owner", "id": "<id>", ...} and',
      "runs its own command's validations. `approve`, `review` and `discard` stay",
      'individual commands and are refused here by name.',
      '',
      'Examples:',
      '  changeledger apply --from batch.json --dry-run',
      '  changeledger apply --from batch.json',
      '  changeledger apply --from -',
    ].join('\n'),
  )
  .action(
    action((options) => {
      const result = apply({ from: options.from, dryRun: Boolean(options.dryRun) });
      for (const w of result.warnings) console.warn(`  warn   ${w.file}: ${w.message}`);
      for (const e of result.errors) console.error(`  error  ${e.file}: ${e.message}`);
      for (const w of result.statusWarnings) console.warn(`  warn   ${w}`);
      if (result.dryRun) {
        console.log(
          `Dry run: ${result.changed.length} document(s) would change — ${result.message}`,
        );
        return;
      }
      console.log(
        result.changed.length
          ? `Applied ${result.changed.length} document(s): ${result.changed.join(', ')}`
          : 'Unchanged (the manifest lands nothing new)',
      );
    }),
  );

program
  .command('commit')
  .description('compose the canonical [#id] marker and create a git commit')
  .requiredOption('-m, --message <subject>', 'conventional subject: type(scope): description')
  .option(
    '--id <change-id>',
    'change id to reference (repeatable); auto-resolved from the single in-progress change if omitted',
    collect,
    [],
  )
  .option(
    '--no-change <reason>',
    'declare an operational commit outside any change (mutually exclusive with --id): ' +
      'composes a marker-less subject and a ChangeLedger: none — <reason> body',
  )
  .addHelpText(
    'after',
    [
      '',
      'When --id is omitted, the single in-progress change is used automatically;',
      'zero or multiple in-progress changes require --id explicitly. Repeat --id',
      'for a multi-id commit: the clean subject gets a ChangeLedger: [#A] [#B] body.',
      '',
      '--no-change <reason> declares a purely operational, reversible edit that no',
      'change covers: the subject carries no marker and the body becomes exactly',
      '"ChangeLedger: none — <reason>". It never falls back to the in-progress',
      'change, and cannot be combined with --id.',
      '',
      'A failed `pre-commit` hook leaves the index staged. Inspect the staged set',
      'with `git diff --cached --name-only` before retrying: fixing the cause is not',
      "enough if the index kept the previous attempt's files.",
      '',
      'Examples:',
      '  changeledger commit -m "feat(cli): add helper"',
      '  changeledger commit -m "feat(cli): add helper" --id <id>',
      '  changeledger commit -m "feat(cli): add helper" --id <id> --id <id>',
      '  changeledger commit -m "docs(workflow): record the sieve" --no-change "no change covers it"',
    ].join('\n'),
  )
  .action(
    action((options) => {
      // Commander's `--no-` prefix is normally reserved for negating a boolean
      // flag (e.g. `--no-color`) and stores the value under the name with
      // "no-" stripped — here that means `options.change`, not
      // `options.noChange`, even though this option takes a required
      // argument rather than being a boolean. Absent, it defaults to the
      // negate placeholder `true`; only a string means the flag was given.
      const noChange = typeof options.change === 'string' ? options.change : undefined;
      const subject = commit(
        { message: options.message, ids: options.id, noChange },
        process.cwd(),
        undefined,
        console.log,
      );
      console.log(`Committed: ${subject}`);
    }),
  );

program
  .command('cutover')
  .description("publish this repo's ledger to the state ref and activate it (one shot)")
  .option('--undo', 'revert the cutover while the state ref still points at the published baseline')
  .addHelpText(
    'after',
    [
      '',
      'Preconditions, all checked fail-closed before anything is written:',
      '  - HEAD is the integration branch (git.integration_branch, or the default);',
      '  - the repo is not activated yet and carries no state ref;',
      '  - the ledger is clean: no modified, staged, untracked or ignored files under',
      '    the collection directories (changes/, specs/, releases/), and an empty index.',
      'It then validates the whole ledger, publishes it to the state ref, activates the',
      'repo and commits the worktree cleanup that keeps only config.yml.',
      'A re-run over an identical cut is a no-op; a divergent state ref is refused.',
      '',
      '--undo reverses all of it while the state ref still points at the published',
      'baseline. Once the ledger has moved past it, the undo refuses: dropping that',
      'history is a human decision, not a tool default.',
      '',
      'Examples:',
      '  changeledger cutover',
      '  changeledger cutover --undo',
    ].join('\n'),
  )
  .action(action((options) => cutover({ undo: Boolean(options.undo) })));

program
  .command('activate')
  .description('activate this checkout against an already published state ref')
  .addHelpText(
    'after',
    [
      '',
      'For a clone or worktree of a repo that was already cut over: it takes the',
      'local activation decision against the existing state ref and nothing else.',
      'Re-running over the same state is a no-op; an activation that already names',
      'a different state ref is refused, never overwritten.',
      '',
      'Example:',
      '  changeledger activate',
    ].join('\n'),
  )
  .action(action(() => activate()));

program
  .command('sync')
  .description("compare this repo's state ref with the remote, advance it safely, then publish")
  .option('--status', 'report the local↔remote-tracking relation offline, with no network call')
  .addHelpText(
    'after',
    [
      '',
      'Pure git over the remote the repo already configures (origin, or the single',
      'configured one). It always compares first: identical is a no-op, a remote ahead',
      'fast-forwards the local ref, a local ahead is published, and a divergence whose',
      'two sides touched different documents is reconciled as one commit preserving',
      'both journals. When both sides changed the SAME document differently, nothing is',
      'written and every colliding document is reported for the human to resolve.',
      '',
      'It never blocks the local flow: no remote, no remote ref, an unreachable remote',
      'or a checkout that is not activated are informative no-ops. Activation never',
      'travels — each clone takes it locally with `changeledger activate`.',
      '',
      'Examples:',
      '  changeledger sync',
      '  changeledger sync --status',
    ].join('\n'),
  )
  .action(action((options) => sync({ status: Boolean(options.status) })));

program
  .command('import')
  .description('absorb one worktree-layout ref into this activated repo, all or nothing')
  .requiredOption('--from <ref>', 'the ref whose tree holds the ledger to absorb')
  .addHelpText(
    'after',
    [
      '',
      'For the branches that were in flight when the repo was cut over, and for the',
      'documents that land on them afterwards: it validates every document visible',
      'under that layout, then adds what is missing and updates every change whose',
      'Log strictly extends the published one. Re-running the same ref is a no-op.',
      '',
      'The ref must BE a commit (an annotated tag is refused, never peeled), and the',
      "state ref's config defines the layout and validation rules. The source's",
      'config.yml is never imported. Any conflict aborts the whole import and is',
      'yours to resolve.',
      '',
      'Example:',
      '  changeledger import --from feature/in-flight',
    ].join('\n'),
  )
  .action(action((options) => importFromRef({ from: options.from })));

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
      'With no argument: prints the mandatory bootstrap core, plus the global-state',
      'overlay in an activated repo. Always run this first — every mode and change id',
      'below is incremental and extends the core already read, it never replaces it.',
      '',
      'Explicit modes (pass one literally):',
      '  spec        author or refine a change',
      '  implement   execute an approved change',
      '  review      independently verify completed work',
      '  release     plan portable delivery metadata',
      '',
      'Change id (e.g. changeledger context <id>): loads the pack inferred',
      "from that change's current lifecycle status — you never choose this pack",
      'yourself. The close overlay of a done change is inferred the same way from the',
      'change id; it is not a mode you pass explicitly.',
      '',
      'Examples:',
      '  changeledger context',
      '  changeledger context spec',
      '  changeledger context implement',
      '  changeledger context review',
      '  changeledger context release',
      '  changeledger context <id>',
    ].join('\n'),
  )
  .action(action((input) => context(input)));

program
  .command('agent-prompt')
  .description('print a portable delegation prompt skeleton for a role')
  .addArgument(closedArgument('<role>', AGENT_ROLES.join(' | '), AGENT_ROLES))
  .addHelpText(
    'after',
    [
      '',
      'Prints a fill-in-the-blanks delegation prompt for the given role. Works',
      'outside a ChangeLedger repo — the skeletons ship inside the package.',
      '',
      'Examples:',
      '  changeledger agent-prompt review',
    ].join('\n'),
  )
  .action(action((role) => agentPrompt(role)));

program
  .command('agent-context')
  .description('print a self-contained minimal context for a delegated role')
  .addArgument(closedArgument('<role>', AGENT_ROLES.join(' | '), AGENT_ROLES))
  .argument('<change-id>', 'the change in `in-review` the delegate reviews')
  .addHelpText(
    'after',
    [
      '',
      'Use only when a delegation prompt emitted by `changeledger agent-prompt`',
      'identifies you as that role. This replaces the normal core bootstrap for',
      'the delegated leaf; normal agents still run `changeledger context` first.',
      '',
      'Examples:',
      '  changeledger agent-context review <id>',
    ].join('\n'),
  )
  .action(action((role, changeId) => agentContext(role, changeId)));

program
  .command('status')
  .description("move a change's lifecycle status (agent-owned, non-terminal moves only)")
  .argument('<id>')
  .addArgument(
    closedArgument(
      '<status>',
      'a status configured in .changeledger/config.yml (statuses:), e.g. in-progress, in-review',
      CONFIGURED_DOMAINS?.statuses,
    ),
  )
  .argument('[reason...]', 'why delivered work is being sent back to `in-progress`')
  .option('--human', 'attribute the return from `done` to an explicit human decision')
  .addHelpText(
    'after',
    [
      '',
      'Terminal moves are not accepted here: use `changeledger discard <id> "<reason>"`',
      'to discard. Human-owned moves use the viewer or `changeledger approve <id>`',
      'after an explicit human prompt.',
      '',
      '`--human` marks the return from `done` as a human rejection — the only',
      'edge the rejection metric counts. Without it the return belongs to the agent.',
      '',
      'Examples:',
      '  changeledger status <id> in-progress',
      '  changeledger status <id> in-review',
      '  changeledger status <id> in-progress --human "<reason>"',
    ].join('\n'),
  )
  .action(
    action((id, st, reasonParts, options) => {
      // `--human` attributes one edge and nothing else: accepting it anywhere
      // would hand the agent the human approval seat that
      // `assertStatusDestinationAllowed` exists to deny it.
      if (options.human && st !== 'in-progress') {
        throw new Error(
          'the `--human` flag only attributes the return to `in-progress`; to approve a draft use `changeledger approve <id>`',
        );
      }
      const { warnings } = status(id, st, process.cwd(), {
        actor: options.human ? 'human' : 'agent',
        reason: reasonParts.join(' ').trim() || undefined,
      });
      for (const warning of warnings) console.error(warning);
      console.log(`#${id} → ${st}`);
    }),
  );

program
  .command('approve')
  .description('transmit an explicit human decision to approve a draft via conversation')
  .argument('<id>')
  .addHelpText(
    'after',
    [
      '',
      'Human-owned: run only after an explicit human message identifies this change',
      'and orders approval. Praise, permission to continue, or agent inference is not approval.',
      '',
      'Example:',
      '  changeledger approve <id>',
    ].join('\n'),
  )
  .action(
    action((id) => {
      approve(id);
      console.log(`#${id} → approved (human via conversation)`);
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
  .addArgument(closedArgument('<verdict>', REVIEW_VERDICTS.join('|'), REVIEW_VERDICTS))
  .argument('[reason...]')
  .addHelpText(
    'after',
    [
      '',
      '`pass` delivers the change to `done`; `fail` returns it to `in-progress`.',
      'The failure class belongs in the reason, not in a flag.',
      '',
      'Examples:',
      '  changeledger review <id> pass',
      '  changeledger review <id> fail "<reason>"',
    ].join('\n'),
  )
  .action(
    action((id, verdict, reasonParts) => {
      const reason = reasonParts.join(' ').trim() || undefined;
      review(id, verdict, { reason });
      console.log(`#${id} review ${verdict}`);
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
  .command('branch')
  .description("set or clear a change's branch")
  .argument('<id>')
  .argument('<name>', 'branch name, or "-" to clear it')
  .addHelpText(
    'after',
    [
      '',
      'Examples:',
      '  changeledger branch <id> feature/x',
      '  changeledger branch <id> -   # clears the branch',
    ].join('\n'),
  )
  .action(
    action((id, name) => {
      branch(id, name);
      console.log(`#${id} branch → ${name === '-' ? '(cleared)' : name}`);
    }),
  );

program
  .command('archive')
  .description('hide a change in the viewer, or archive all graduated done changes')
  .argument('[id]', 'a change id; mutually exclusive with --graduated')
  .option('--graduated', 'archive every done change already graduated or skipped (takes no id)')
  .option('--owner <name>', 'with --graduated, filter by exact owner name')
  .option('--unowned', 'with --graduated, filter changes without an owner')
  .option('--keep-branch', 'with an id, do not delete the local branch even when it is merged')
  .addHelpText(
    'after',
    [
      '',
      'Archiving one change by id deletes the local branch it recorded, but only',
      'once that change is done or discarded and that branch is already merged into',
      'the integration branch — never an unmerged one, and never a remote reference.',
      '--graduated archives in bulk and deletes no branches.',
      '',
      'Examples:',
      '  changeledger archive <id>',
      '  changeledger archive --graduated',
      '  changeledger list --pending archive --owner "Roberto Ruiz"',
      '  changeledger archive --graduated --owner "Roberto Ruiz"',
      '',
      'To reverse an archive, edit `archived: false` in the change frontmatter directly.',
    ].join('\n'),
  )
  .action(
    action((id, options) => {
      if (options.owner !== undefined && options.unowned) {
        throw new Error('--owner and --unowned are mutually exclusive');
      }
      if ((options.owner !== undefined || options.unowned) && !options.graduated) {
        throw new Error('--owner and --unowned require --graduated');
      }
      if (options.graduated) {
        if (id) throw new Error('archive --graduated does not take an id');
        // Refused rather than ignored: --graduated deletes no branches, so the
        // flag would read as a promise the bulk path never made.
        if (options.keepBranch) {
          throw new Error('--keep-branch takes an id: archive --graduated deletes no branches');
        }
        const archived = archiveGraduated({ owner: options.owner, unowned: options.unowned });
        for (const c of archived) console.log(`#${c.id} ${c.title}`);
        console.log(`Archived ${archived.length} change(s)`);
        return;
      }
      if (!id) throw new Error('archive requires <id> or --graduated');
      const { branch, branchOutcome } = archive(id, process.cwd(), {
        keepBranch: options.keepBranch,
      });
      console.log(`#${id} archived`);
      if (branchOutcome === null) console.log(`Deleted local branch ${branch}.`);
      else if (branch) console.log(`Local branch not deleted: ${branchOutcome}.`);
    }),
  );

program
  .command('log')
  .description('append a human-readable note to a change Log')
  .argument('<id>', 'change id')
  .argument('<message...>', 'plain text stored as the `note` payload')
  .addHelpText('after', logEventGrammarHelp)
  .action(
    action((id, messageParts) => {
      log(id, messageParts.join(' ').trim());
      console.log(`logged on #${id}`);
    }),
  );

program
  .command('finding')
  .description("record a finding outside the active change's frontier, or resolve one")
  .argument('<id>', 'the change whose Log holds the finding')
  .argument('<parts...>', '"<text>", or promote <n> <change-id>, or drop <n> "<reason>"')
  .addHelpText(
    'after',
    [
      '',
      "A finding is something found outside the active change's frontier. It is",
      'recorded in the Log of the change where it was found, and the human decides',
      'later whether it becomes a change (promote) or not (drop).',
      '',
      'Forms:',
      '  changeledger finding <id> "<text>"                  record an open finding',
      '  changeledger finding <id> promote <n> <change-id>   link finding F<n> to the change it became',
      '  changeledger finding <id> drop <n> "<reason>"       close finding F<n> with a reason',
      '',
      "<n> is the finding's ordinal in that change's Log (F1, F2, ...).",
      'A first word promote or drop followed by an ordinal is a resolution when given',
      'as separate arguments and is refused when quoted as one text; any other text',
      'is recorded as an open finding.',
      'promote only appends to this Log and creates no change: create it first through',
      'the authorized flow.',
      'List the open findings with `changeledger list --pending findings`.',
    ].join('\n'),
  )
  .action(
    action((id, parts) => {
      if (['promote', 'drop'].includes(parts[0]) && /^\d+$/.test(parts[1] ?? '')) {
        const [outcome, n, ...rest] = parts;
        const value = rest.join(' ').trim();
        resolveFinding(id, n, outcome, value);
        const result = outcome === 'promote' ? `promoted to #${value}` : 'dropped';
        console.log(`finding F${n} on #${id} → ${result}`);
        return;
      }
      const { n } = recordFinding(id, parts.join(' ').trim());
      console.log(`finding F${n} recorded on #${id}`);
    }),
  );

program
  .command('task')
  .description('mark a Plan task')
  .argument('<id>')
  .addArgument(closedArgument('<action>', TASK_ACTIONS.join('|'), TASK_ACTIONS))
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
  .addOption(
    closedOption(
      '--status <status>',
      'filter by a status configured in .changeledger/config.yml (statuses:)',
      CONFIGURED_DOMAINS?.statuses,
    ),
  )
  .addOption(closedOption('--type <type>', 'filter by type', CHANGE_TYPES))
  .option('--owner <name>', 'filter by exact owner name; incompatible with --unowned')
  .option('--unowned', 'list changes without an owner; incompatible with --owner')
  .option('--parent <id>', 'list the children of that epic')
  .option('--pending <kind>', 'filter pending work (graduation|archive|findings)')
  .option('--archived', 'list only archived changes; incompatible with --all')
  .option('--all', 'include archived and non-archived changes; incompatible with --archived')
  .option('--json', 'print JSON')
  .addHelpText(
    'after',
    [
      '',
      'Examples:',
      '  changeledger list --status approved',
      '  changeledger list --owner "Roberto Ruiz" --status in-review',
      '  changeledger list --unowned',
      '  changeledger list --pending graduation',
      '  changeledger list --parent <epic-id>',
      '  changeledger list --pending archive',
      '  changeledger list --pending findings   # open findings, archived changes included',
      '  changeledger list --archived',
      '  changeledger list --type change --json',
    ].join('\n'),
  )
  .action(
    action((options) => {
      const items = list({
        status: options.status,
        type: options.type,
        owner: options.owner,
        unowned: options.unowned,
        parent: options.parent,
        pending: options.pending,
        archived: options.archived,
        all: options.all,
      });
      if (options.json) {
        console.log(JSON.stringify(items, null, 2));
      } else if (options.pending === 'findings') {
        for (const f of items) console.log(`#${f.id} F${f.n}  ${f.text}`);
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
      else {
        console.log(`#${c.id} ${c.frontmatter.title} [${c.frontmatter.status}]`);
        if (c.frontmatter.parent) console.log(`  parent: #${c.frontmatter.parent}`);
        for (const child of c.children) {
          const hidden = child.archived ? ' (archived)' : '';
          console.log(
            `  child: ${String(child.status).padEnd(12)} #${child.id}  ${child.title}${hidden}`,
          );
        }
      }
    }),
  );

program
  .command('search')
  .description('deterministic lexical search over changes (incl. archived) and specs')
  .argument('<query...>', 'search terms')
  .option('--limit <n>', 'max results (default 10)')
  .addOption(closedOption('--type <type>', 'filter by change type; excludes specs', CHANGE_TYPES))
  .addOption(
    closedOption(
      '--status <status>',
      'filter by a change status configured in .changeledger/config.yml (statuses:); excludes specs',
      CONFIGURED_DOMAINS?.statuses,
    ),
  )
  .option('--json', 'print JSON')
  .addHelpText(
    'after',
    [
      '',
      'Examples:',
      '  changeledger search wallet',
      '  changeledger search wallet --type change --status done',
      '  changeledger search "app check" --json',
    ].join('\n'),
  )
  .action(action((queryParts, options) => runSearch(queryParts, options)));

program
  .command('analyze')
  .description('token and cost figures from the ledger usage records (read-only)')
  .argument('[id]', 'one change: its segments with tokens, cost, models and version')
  .addOption(
    closedOption('--by <key>', 'aggregate every measured change by this key', USAGE_GROUP_KEYS),
  )
  .option('--json', 'print JSON: { schema, changes, groups, hints }')
  .addHelpText(
    'after',
    [
      '',
      'Examples:',
      '  changeledger analyze',
      '  changeledger analyze <id>',
      '  changeledger analyze --by model',
      '  changeledger analyze --json',
    ].join('\n'),
  )
  .action(action((id, options) => runAnalyze(id, options)));

program
  .command('graduate')
  .description('graduate a done change to persistent truth')
  .argument('[change-id]')
  .argument('[spec-slug]')
  .argument('[reason...]')
  .option('--new', 'create a spec scaffold without resolving graduation')
  .option('--into', 'finalize graduation into an existing refined spec')
  .option('--skip', 'mark graduation reviewed without a spec')
  .addHelpText(
    'after',
    [
      '',
      'Examples:',
      '  changeledger graduate <change-id> <spec-slug> --new',
      '  changeledger graduate <change-id> <spec-slug> --into',
      '  changeledger graduate <change-id> --skip [reason]',
      '  changeledger list --pending graduation   # list unresolved decisions',
    ].join('\n'),
  )
  .action(
    action((id, slug, reasonParts, options) => {
      const modeCount = [options.new, options.into, options.skip].filter(Boolean).length;
      const modeUsage =
        'Usage: changeledger graduate requires exactly one mode: --new, --into, or --skip';
      if (modeCount !== 1) throw new Error(modeUsage);
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
  .description('migrate .changeledger/config.yml from schema 6 to 7')
  .option('--dry-run', 'show the migration plan and candidate YAML without writing')
  .action(
    action((options) => {
      const changeledgerDir = findChangeledgerDir();
      if (!changeledgerDir) throw new Error('Not a ChangeLedger repo.');
      const configFile = `${changeledgerDir}/config.yml`;
      const result = applyMigration(configFile, {
        dryRun: options.dryRun ?? false,
        repoRoot: path.dirname(changeledgerDir),
      });
      console.log(result);
    }),
  );

const releaseCommand = program
  .command('release')
  .description('plan and record portable SemVer releases')
  .addHelpText(
    'after',
    [
      '',
      `release impacts: ${RELEASE_IMPACTS.join(', ')}`,
      `branch format placeholders: ${BRANCH_FORMAT_PLACEHOLDERS.map((name) => `{${name}}`).join(', ')}`,
    ].join('\n'),
  );

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
