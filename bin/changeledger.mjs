#!/usr/bin/env node
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Command } from 'commander';
import {
  approve,
  archive,
  archiveGraduated,
  discard,
  list,
  log,
  owner,
  reopen,
  review,
  show,
  status,
  task,
  validation,
} from '../src/commands/agent.mjs';
import { agentContext } from '../src/commands/agent-context.mjs';
import { agentPrompt } from '../src/commands/agent-prompt.mjs';
import { check } from '../src/commands/check.mjs';
import { commit } from '../src/commands/commit.mjs';
import { migrateConfig } from '../src/commands/config.mjs';
import { context } from '../src/commands/context.mjs';
import { fix } from '../src/commands/fix.mjs';
import { graduate, scaffoldSpec, skipGraduation } from '../src/commands/graduate.mjs';
import { init } from '../src/commands/init.mjs';
import { newChange } from '../src/commands/new.mjs';
import { registerRepo } from '../src/commands/register.mjs';
import { initReleaseHistory, recordRelease, releasePlan } from '../src/commands/release.mjs';
import { runSearch } from '../src/commands/search.mjs';
import {
  stateAbort,
  stateActivate,
  stateDoctor,
  stateExport,
  stateMigrate,
  stateStatus,
  stateSync,
  stateValidateReceive,
  stateValidateUpdate,
} from '../src/commands/state.mjs';
import { view } from '../src/commands/view.mjs';
import { findChangeledgerDir } from '../src/config.mjs';
import { formatLedgerReceipt, loadLedgerStore, repoProvenance } from '../src/ledger-store.mjs';
import { nowUtc } from '../src/paths.mjs';
import { parseYaml } from '../src/yaml.mjs';

const { version } = createRequire(import.meta.url)('../package.json');

const USAGE = `ChangeLedger (changeledger)

Run \`changeledger context\` first in any repo unless a ChangeLedger delegation
prompt identifies your role and tells you to run \`agent-context\` instead.

  changeledger init | register | new | view | check | fix | context | agent-context
  changeledger commit | status | approve | validation | discard | review | owner
  changeledger archive | log | task | list | show | search | graduate | state | config | release

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

function stateReceiptDetails(receipt) {
  return `Receipt: ${JSON.stringify({
    projectId: receipt.project_id ?? null,
    repositoryPath: receipt.repository_path ?? null,
    sources: receipt.sources ?? [],
    sourceOids: receipt.sourceOids ?? {},
    baseline: receipt.baseline ?? null,
    branch: receipt.branch ?? null,
    ref: receipt.ref ?? null,
    inventoryDigest: receipt.inventoryDigest ?? null,
    uninventoried: receipt.uninventoried ?? [],
    protectedRef: receipt.protectedRef ?? receipt.ref ?? null,
    oldOid: receipt.oldOid ?? null,
    newOid: receipt.newOid ?? null,
    commits: receipt.commits ?? 0,
    objectBytes: receipt.object_bytes ?? receipt.objectBytes ?? 0,
    provider: receipt.provider ?? null,
    capabilities: receipt.capabilities ?? null,
    network: Boolean(receipt.network),
    written: Boolean(receipt.written),
  })}`;
}

function stateReceiptProvenance() {
  try {
    return repoProvenance();
  } catch {
    const cwd = process.cwd();
    let repository_path = path.resolve(cwd);
    try {
      const changeledgerDir = findChangeledgerDir(cwd);
      if (changeledgerDir) repository_path = path.dirname(changeledgerDir);
    } catch {
      // Receipt construction must never replace the operation's primary error.
    }
    return { project_id: null, repository_path };
  }
}

function stateFailureReceipt(command, options, error, activity) {
  let sources = (options.source ?? []).map((name) => ({ name, commit: null }));
  let inventoryDigest = null;
  if (command === 'migrate' && options.plan) {
    try {
      const plan = parseYaml(fs.readFileSync(path.resolve(process.cwd(), options.plan), 'utf8'));
      if (Array.isArray(plan.sources)) sources = plan.sources;
      if (typeof plan.inventory_digest === 'string') inventoryDigest = plan.inventory_digest;
    } catch {
      // The primary error still owns the failure; absent plan context remains explicit null.
    }
  }
  if (Array.isArray(activity.sources) && activity.sources.length > 0) sources = activity.sources;
  const baseline = activity.baseline ?? options.baseline ?? null;
  const branch =
    command === 'activate' && /^[0-9a-f]{40,64}$/.test(baseline ?? '')
      ? `changeledger/activate-${baseline.slice(0, 12)}`
      : null;
  const ref =
    command === 'migrate' && options.create
      ? 'refs/heads/changeledger/state'
      : command === 'doctor'
        ? (options.activationRef ?? null)
        : branch
          ? `refs/heads/${branch}`
          : null;
  return {
    ok: false,
    command,
    error: error.message,
    ...stateReceiptProvenance(),
    sources,
    sourceOids:
      activity.sourceOids && Object.keys(activity.sourceOids).length > 0
        ? activity.sourceOids
        : Object.fromEntries(sources.map((source) => [source.name, source.commit])),
    baseline,
    branch: activity.branch ?? branch,
    ref: activity.ref ?? ref,
    inventoryDigest: activity.inventoryDigest ?? inventoryDigest,
    network: Boolean(activity.network),
    written: Boolean(activity.written),
    ...(activity.oldOid ? { oldOid: activity.oldOid } : {}),
    ...(activity.newOid ? { newOid: activity.newOid } : {}),
    ...(activity.protectedRef ? { protectedRef: activity.protectedRef } : {}),
    commits: activity.commits ?? 0,
    object_bytes: activity.object_bytes ?? 0,
    provider: activity.provider ?? null,
    ...(activity.capabilities ? { capabilities: activity.capabilities } : {}),
  };
}

function validationLimits(options) {
  const limits = {};
  for (const [option, key] of [
    ['maxCommits', 'max_commits'],
    ['maxObjectBytes', 'max_object_bytes'],
    ['timeoutMs', 'timeout_ms'],
  ]) {
    if (options[option] === undefined) continue;
    const value = Number(options[option]);
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new Error(
        `--${option.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} must be a positive integer`,
      );
    limits[key] = value;
  }
  return limits;
}

function stateAction(command, fn) {
  return async (options) => {
    const activity = { network: false, written: false };
    try {
      const result = await fn(options, activity);
      if (options.json) {
        console.log(JSON.stringify({ ok: result.ok ?? true, command, ...result }, null, 2));
      }
      return result;
    } catch (error) {
      if (error?.receipt) Object.assign(activity, error.receipt);
      const receipt = stateFailureReceipt(command, options, error, activity);
      if (!options.json) {
        console.error(stateReceiptDetails(receipt));
        console.error(`Error: ${error.message}`);
        process.exitCode = 1;
        return null;
      }
      console.error(JSON.stringify(receipt, null, 2));
      process.exitCode = 1;
      return null;
    }
  };
}

// Collects a repeatable option (e.g. `--id`) into an array across invocations.
function collect(value, previous) {
  return previous.concat([value]);
}

function ledgerRevisionFromResult(result) {
  if (Array.isArray(result)) {
    if (result.ledgerRevision) return result.ledgerRevision;
    for (const item of result) {
      const revision = ledgerRevisionFromResult(item);
      if (revision) return revision;
    }
    return undefined;
  }
  if (result && typeof result === 'object') {
    if (result.ledger_revision) return result.ledger_revision;
    return ledgerRevisionFromResult(result.file);
  }
  if (typeof result !== 'string') return undefined;
  return /^git:([^:]+):/.exec(result)?.[1];
}

function printLedgerRevision(result) {
  const revision = ledgerRevisionFromResult(result);
  if (!revision) return;
  const receipt = {
    ledger_revision: revision,
    ledger_freshness: 'local',
    ledger_confirmation: 'local',
    ledger_observed_at: null,
    ...repoProvenance(),
  };
  try {
    const snapshot = loadLedgerStore().load();
    if (snapshot.revision === revision) {
      receipt.ledger_freshness = snapshot.ledgerFreshness ?? receipt.ledger_freshness;
      receipt.ledger_confirmation = snapshot.ledgerConfirmation ?? receipt.ledger_confirmation;
      receipt.ledger_observed_at = snapshot.ledgerObservedAt ?? null;
    }
  } catch {
    // The mutation result remains a valid receipt even if a subsequent read fails.
  }
  console.log(formatLedgerReceipt(receipt));
}

program
  .name('changeledger')
  .description('ChangeLedger (changeledger)')
  .version(version, '-v, --version', 'output the installed version (-V also accepted)')
  .helpOption('-h, --help', 'display help for command')
  .addHelpText(
    'after',
    '\nRun `changeledger context` first unless a ChangeLedger delegation prompt tells your role to use `agent-context`.\n' +
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
  .option('--offline', 'create one local pending mutation without network access')
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
      const file = newChange({
        type,
        slug,
        title,
        owner: options.owner,
        now: nowUtc(),
        offline: options.offline,
      });
      console.log(`Created ${file}`);
      printLedgerRevision(file);
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
    'lint commit subjects on <base>..HEAD for the [#id] marker (base auto-detected if omitted)',
  )
  .addHelpText(
    'after',
    ['', 'Examples:', '  changeledger check --commits', '  changeledger check --commits main'].join(
      '\n',
    ),
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
  .description('repair mechanical, unambiguous format defects (or one change)')
  .argument('[id]')
  .option('--dry-run', 'print the proposed diff without writing')
  .option('--graduation-links', 'migrate spec graduation provenance from Logs and legacy markers')
  .option('--structured-sections', 'migrate task metadata and typed Log events')
  .option('--offline', 'create one local pending mutation without network access')
  .action((id, options) => {
    try {
      const args = [
        ...(id ? [id] : []),
        ...(options.dryRun ? ['--dry-run'] : []),
        ...(options.graduationLinks ? ['--graduation-links'] : []),
        ...(options.structuredSections ? ['--structured-sections'] : []),
        ...(options.offline ? ['--offline'] : []),
      ];
      process.exit(fix(args));
    } catch (e) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
  });

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
  .addHelpText(
    'after',
    [
      '',
      'When --id is omitted, the single in-progress change is used automatically;',
      'zero or multiple in-progress changes require --id explicitly. Repeat --id',
      'for a multi-id commit: the clean subject gets a ChangeLedger: [#A] [#B] body.',
      '',
      'Examples:',
      '  changeledger commit -m "feat(cli): add helper"',
      '  changeledger commit -m "feat(cli): add helper" --id 20260711-000001',
      '  changeledger commit -m "feat(cli): add helper" --id 20260711-000001 --id 20260711-000002',
    ].join('\n'),
  )
  .action(
    action((options) => {
      const subject = commit({ message: options.message, ids: options.id });
      console.log(`Committed: ${subject}`);
    }),
  );

program
  .command('context')
  .description('print deterministic task context')
  .argument(
    '[mode-or-change-id]',
    'spec|implement|review|release, or a change id (pack inferred from its status)',
  )
  .option(
    '--have <rev>',
    'skip the full reload when this matches the current rev (short `unchanged` confirmation instead)',
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
      'Each BEGIN line carries `rev:<hash>`. After a compaction, pass the rev your',
      'retained capture carried as `--have <rev>`: a match prints a short confirmation',
      'instead of reloading the full body; a mismatch prints the complete output.',
      '',
      'Examples:',
      '  changeledger context',
      '  changeledger context spec',
      '  changeledger context implement',
      '  changeledger context review',
      '  changeledger context release',
      '  changeledger context 20260630-225212',
      '  changeledger context --have 0123456789ab',
    ].join('\n'),
  )
  .action(action((input, options) => context(input, { have: options.have })));

program
  .command('agent-prompt')
  .description('print a portable delegation prompt skeleton for a role')
  .argument('<role>', 'investigation | implementation | review | audit')
  .addHelpText(
    'after',
    [
      '',
      'Prints a fill-in-the-blanks delegation prompt for the given role. Works',
      'outside a ChangeLedger repo — the skeletons ship inside the package.',
      '',
      '`audit` is a read-only inspection of a change already in `in-validation`,',
      'after review already passed; it never issues a verdict or moves the change.',
      '',
      'Examples:',
      '  changeledger agent-prompt investigation',
      '  changeledger agent-prompt implementation',
      '  changeledger agent-prompt review',
      '  changeledger agent-prompt audit',
    ].join('\n'),
  )
  .action(action((role) => agentPrompt(role)));

program
  .command('agent-context')
  .description('print a self-contained minimal context for a delegated role')
  .argument('<role>', 'investigation | implementation | review | audit')
  .argument(
    '[change-id]',
    'optional for investigation; required for implementation, review and audit',
  )
  .addHelpText(
    'after',
    [
      '',
      'Use only when a delegation prompt emitted by `changeledger agent-prompt`',
      'identifies you as that role. This replaces the normal core bootstrap for',
      'the delegated leaf; normal agents still run `changeledger context` first.',
      '',
      '`audit` requires a change in `in-validation`; it is read-only inspection',
      'after review already passed, and never issues a verdict or moves the change.',
      '',
      'Examples:',
      '  changeledger agent-context investigation',
      '  changeledger agent-context investigation <id>',
      '  changeledger agent-context implementation <id>',
      '  changeledger agent-context review <id>',
      '  changeledger agent-context audit <id>',
    ].join('\n'),
  )
  .action(action((role, changeId) => agentContext(role, changeId)));

program
  .command('status')
  .description("move a change's lifecycle status (agent-owned, non-terminal moves only)")
  .argument('<id>')
  .argument(
    '<status>',
    'a status configured in .changeledger/config.yml (statuses:), e.g. in-progress, in-review, blocked',
  )
  .option('--offline', 'create one local pending mutation without network access')
  .addHelpText(
    'after',
    [
      '',
      'Terminal moves are not accepted here: use `changeledger discard <id> "<reason>"`',
      'to discard. Human-owned moves use the viewer, `changeledger approve <id>`,',
      'or `changeledger validation <id> pass` after an explicit human prompt.',
      '',
      'Examples:',
      '  changeledger status <id> in-progress',
      '  changeledger status <id> blocked',
    ].join('\n'),
  )
  .action(
    action((id, st, options) => {
      const file = status(id, st, process.cwd(), {
        actor: 'agent',
        offline: options.offline,
      });
      console.log(`#${id} → ${st}`);
      printLedgerRevision(file);
    }),
  );

program
  .command('approve')
  .description('transmit an explicit human decision to approve a draft via conversation')
  .argument('<id>')
  .option('--offline', 'create one local pending mutation without network access')
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
    action((id, options) => {
      const file = approve(id, process.cwd(), { offline: options.offline });
      console.log(`#${id} → approved (human via conversation)`);
      printLedgerRevision(file);
    }),
  );

program
  .command('validation')
  .description('transmit an explicit human validation decision, or reject as the agent')
  .argument('<id>')
  .argument('<verdict>', 'pass|fail')
  .argument('[reason...]')
  .option('--human', 'attribute a fail verdict to an explicit human decision via conversation')
  .option('--offline', 'create one local pending mutation without network access')
  .addHelpText(
    'after',
    [
      '',
      '`pass` and `fail --human` are human-owned: run only after an explicit human',
      'decision in the conversation. Never infer acceptance or rejection.',
      'Plain `fail` remains an agent-owned rejection and always requires a reason.',
      '',
      'Examples:',
      '  changeledger validation <id> pass',
      '  changeledger validation <id> fail "<reason>"',
      '  changeledger validation <id> fail --human "<reason>"',
    ].join('\n'),
  )
  .action(
    action((id, verdict, reasonParts, options) => {
      const reason = (reasonParts ?? []).join(' ').trim();
      let file;
      if (verdict === 'pass') {
        if (reason) throw new Error('validation pass does not accept a reason');
        if (options.human) throw new Error('validation pass is already human-owned; omit --human');
        file = validation(id, 'pass', {
          actor: 'human',
          channel: 'conversation',
          offline: options.offline,
        });
      } else if (verdict === 'fail') {
        file = validation(id, 'fail', {
          reason,
          actor: options.human ? 'human' : 'agent',
          channel: options.human ? 'conversation' : 'agent',
          offline: options.offline,
        });
      } else {
        throw new Error(`Unknown validation verdict "${verdict}" (use pass|fail)`);
      }
      console.log(`#${id} validation ${verdict}${options.human ? ' --human' : ''}`);
      printLedgerRevision(file);
    }),
  );

program
  .command('reopen')
  .description('reopen a provisional done change with a reason')
  .argument('<id>')
  .argument('<reason...>')
  .option('--offline', 'create one local pending mutation without network access')
  .action(
    action((id, reasonParts, options) => {
      const file = reopen(id, reasonParts.join(' ').trim(), process.cwd(), {
        actor: 'agent',
        offline: options.offline,
      });
      console.log(`#${id} → in-progress`);
      printLedgerRevision(file);
    }),
  );

program
  .command('discard')
  .description('discard a change (terminal; keeps the record and reason)')
  .argument('<id>')
  .argument('<reason...>')
  .option('--offline', 'create one local pending mutation without network access')
  .action(
    action((id, reasonParts, options) => {
      const file = discard(id, reasonParts.join(' ').trim(), process.cwd(), {
        offline: options.offline,
      });
      console.log(`#${id} → discarded`);
      printLedgerRevision(file);
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
  .option('--offline', 'create one local pending mutation without network access')
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
      const file = review(id, verdict, { mode, reason, offline: options.offline });
      console.log(`#${id} review ${verdict}${mode ? ` --${mode}` : ''}`);
      printLedgerRevision(file);
    }),
  );

program
  .command('owner')
  .description("set or clear a change's owner")
  .argument('<id>')
  .argument('<name>', 'owner handle, or "-" to clear it')
  .option('--offline', 'create one local pending mutation without network access')
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
    action((id, name, options) => {
      const file = owner(id, name, process.cwd(), { offline: options.offline });
      console.log(`#${id} owner → ${name === '-' ? '(cleared)' : name}`);
      printLedgerRevision(file);
    }),
  );

program
  .command('archive')
  .description('hide a change in the viewer, or archive all graduated done changes')
  .argument('[id]', 'a change id; mutually exclusive with --graduated')
  .option('--graduated', 'archive every done change already graduated or skipped (takes no id)')
  .option('--owner <name>', 'with --graduated, filter by exact owner name')
  .option('--unowned', 'with --graduated, filter changes without an owner')
  .option('--offline', 'create one local pending mutation without network access')
  .addHelpText(
    'after',
    [
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
        const archived = archiveGraduated({
          owner: options.owner,
          unowned: options.unowned,
          offline: options.offline,
        });
        for (const c of archived) console.log(`#${c.id} ${c.title}`);
        console.log(`Archived ${archived.length} change(s)`);
        printLedgerRevision(archived);
        return;
      }
      if (!id) throw new Error('archive requires <id> or --graduated');
      const file = archive(id, process.cwd(), { offline: options.offline });
      console.log(`#${id} archived`);
      printLedgerRevision(file);
    }),
  );

program
  .command('log')
  .description('append a timestamped Log entry')
  .argument('<id>')
  .argument('<message...>')
  .option('--offline', 'create one local pending mutation without network access')
  .action(
    action((id, messageParts, options) => {
      const file = log(id, messageParts.join(' ').trim(), process.cwd(), {
        offline: options.offline,
      });
      console.log(`logged on #${id}`);
      printLedgerRevision(file);
    }),
  );

program
  .command('task')
  .description('mark a Plan task')
  .argument('<id>')
  .argument('<action>', 'done|block')
  .argument('<n>', 'the Plan task index, 1-based, in document order')
  .argument('[reason...]', 'required when action is block; ignored when action is done')
  .option('--offline', 'create one local pending mutation without network access')
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
    action((id, taskAction, nStr, reasonParts, options) => {
      const n = Number(nStr);
      const file = task(id, taskAction, n, reasonParts.join(' ').trim(), process.cwd(), {
        offline: options.offline,
      });
      console.log(`task #${n} on #${id} → ${taskAction}`);
      printLedgerRevision(file);
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
  .option('--owner <name>', 'filter by exact owner name; incompatible with --unowned')
  .option('--unowned', 'list changes without an owner; incompatible with --owner')
  .option('--pending <kind>', 'filter pending work (graduation|archive)')
  .option('--archived', 'list only archived changes; incompatible with --all')
  .option('--all', 'include archived and non-archived changes; incompatible with --archived')
  .option('--json', 'print JSON')
  .addHelpText(
    'after',
    [
      '',
      'Examples:',
      '  changeledger list --status approved',
      '  changeledger list --owner "Roberto Ruiz" --status in-validation',
      '  changeledger list --unowned',
      '  changeledger list --pending graduation',
      '  changeledger list --pending archive',
      '  changeledger list --archived',
      '  changeledger list --type feature --json',
    ].join('\n'),
  )
  .action(
    action((options) => {
      const items = list({
        status: options.status,
        type: options.type,
        owner: options.owner,
        unowned: options.unowned,
        pending: options.pending,
        archived: options.archived,
        all: options.all,
      });
      if (options.json) {
        const output = items.ledgerRevision
          ? {
              project_id: items.projectId,
              repository_path: items.repositoryPath,
              ledger_revision: items.ledgerRevision,
              ledger_freshness: items.ledgerFreshness,
              ledger_confirmation: items.ledgerConfirmation,
              ledger_observed_at: items.ledgerObservedAt,
              changes: items,
            }
          : items;
        console.log(JSON.stringify(output, null, 2));
      } else {
        console.log(`Project: ${items.projectId ?? 'unknown'} (repo: ${items.repositoryPath})`);
        if (items.ledgerRevision) {
          console.log(
            formatLedgerReceipt({
              ledger_revision: items.ledgerRevision,
              ledger_freshness: items.ledgerFreshness,
              ledger_confirmation: items.ledgerConfirmation,
              ledger_observed_at: items.ledgerObservedAt,
            }),
          );
        }
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
        console.log(`Project: ${c.project_id ?? 'unknown'} (repo: ${c.repository_path})`);
        if (c.ledger_revision) {
          console.log(formatLedgerReceipt(c));
        }
        console.log(`#${c.id} ${c.frontmatter.title} [${c.frontmatter.status}]`);
      }
    }),
  );

program
  .command('search')
  .description('deterministic lexical search over changes (incl. archived) and specs')
  .argument('<query...>', 'search terms')
  .option('--limit <n>', 'max results (default 10)')
  .option(
    '--type <type>',
    'filter by a change type configured in .changeledger/config.yml (types:); excludes specs',
  )
  .option(
    '--status <status>',
    'filter by a change status configured in .changeledger/config.yml (statuses:); excludes specs',
  )
  .option('--json', 'print JSON')
  .addHelpText(
    'after',
    [
      '',
      'Examples:',
      '  changeledger search wallet',
      '  changeledger search wallet --type bug --status done',
      '  changeledger search "app check" --json',
    ].join('\n'),
  )
  .action(action((queryParts, options) => runSearch(queryParts, options)));

program
  .command('graduate')
  .description('graduate a done change to persistent truth')
  .argument('[change-id]')
  .argument('[spec-slug]')
  .argument('[reason...]')
  .option('--new', 'create a spec scaffold without resolving graduation')
  .option('--into', 'finalize graduation into an existing refined spec')
  .option('--skip', 'mark graduation reviewed without a spec')
  .option('--to <file>', 'export the --new scaffold to an editable local file')
  .option('--from <file>', 'import the final spec for --into')
  .option('--offline', 'create one local pending mutation without network access')
  .addHelpText(
    'after',
    [
      '',
      'Examples:',
      '  changeledger graduate <change-id> <spec-slug> --new --to <file>',
      '  changeledger graduate <change-id> <spec-slug> --into --from <file>',
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
      if (options.to && !options.new) throw new Error('--to requires --new');
      if (options.from && !options.into) throw new Error('--from requires --into');
      if (options.skip) {
        if (!id) throw new Error('Usage: changeledger graduate <change-id> --skip [reason]');
        const reason = [slug, ...reasonParts].filter(Boolean).join(' ').trim();
        const file = skipGraduation(id, reason, process.cwd(), { offline: options.offline });
        console.log(`#${id} graduation skipped`);
        printLedgerRevision(file);
        return;
      }

      if (!id || !slug || reasonParts.length) throw new Error(modeUsage);
      if (options.new) {
        let ledger;
        const file = scaffoldSpec(id, slug, process.cwd(), {
          to: options.to,
          onSnapshot(snapshot) {
            ledger = snapshot;
          },
        });
        console.log(
          `Created spec scaffold ${file}. Refine it, then run: changeledger graduate ${id} ${slug} --into --from ${file}`,
        );
        printLedgerRevision(ledger ?? file);
        return;
      }
      const file = graduate(id, slug, process.cwd(), {
        into: options.into,
        from: options.from,
        offline: options.offline,
      });
      console.log(`Graduated #${id} → ${file}`);
      printLedgerRevision(file);
    }),
  );

const configCommand = program
  .command('config')
  .description('inspect and manage the repo configuration');

configCommand
  .command('migrate')
  .description('migrate .changeledger/config.yml to the current schema')
  .option('--dry-run', 'show the migration plan and candidate YAML without writing')
  .option('--offline', 'create one local pending mutation without network access')
  .action(
    action((options) => {
      const result = migrateConfig(process.cwd(), {
        dryRun: options.dryRun ?? false,
        offline: options.offline,
      });
      console.log(result);
    }),
  );

const stateCommand = program
  .command('state')
  .description('inspect and synchronize the global ledger state replica');

stateCommand
  .command('status')
  .description('show local replica refs and freshness without network access')
  .action(
    action(() => {
      const result = stateStatus();
      const provenance = repoProvenance();
      console.log(`Project: ${provenance.project_id ?? 'unknown'}`);
      console.log(`Repository: ${provenance.repository_path}`);
      console.log(`Remote: ${result.remote ?? '(unresolved)'}`);
      console.log(`Condition: ${result.condition}`);
      console.log(`Effective: ${result.effective ?? '(none)'}`);
      console.log(`Confirmed: ${result.confirmed ?? '(none)'}`);
      console.log(`Observed: ${result.observed ?? '(none)'}`);
      console.log(`Pending: ${result.pending ?? '(none)'}`);
      console.log(`Observed at: ${result.observedAt ?? 'unknown'}`);
    }),
  );

stateCommand
  .command('sync')
  .description('fetch, reconcile and publish one pending mutation when safe')
  .action(
    action(() => {
      const result = stateSync();
      const provenance = repoProvenance();
      const confirmation = result.pending ? 'local, pending publication' : 'confirmed';
      console.log(
        `State ${result.action}: ${result.effective} (${confirmation}) (project: ${provenance.project_id ?? 'unknown'}) (repo: ${provenance.repository_path})`,
      );
      if (result.error) console.log(`Publication result ambiguous: ${result.error}`);
      if (result.pending && !result.confirmed) process.exitCode = 2;
    }),
  );

stateCommand
  .command('abort')
  .description('discard one pending local mutation after checking the remote')
  .option('--pending', 'confirm that the pending mutation is the abort target')
  .option('--offline', 'discard only the local pending ref without checking the remote')
  .option('--json', 'print a stable JSON receipt')
  .action(
    action((options) => {
      const result = stateAbort(process.cwd(), options);
      const provenance = repoProvenance(process.cwd());
      if (options.json) {
        console.log(JSON.stringify({ ok: true, ...result, ...provenance }, null, 2));
        return;
      }
      if (result.confirmed) {
        console.log(`Pending was already published and is now confirmed at ${result.effective}`);
      } else {
        console.log(
          `Pending mutation aborted${result.offline ? ' locally without remote verification' : ''}`,
        );
      }
      if (result.stale) {
        console.log('Replica is stale; run `changeledger state sync` to catch up.');
      }
      console.log(
        `Project: ${provenance.project_id ?? 'unknown'} (repo: ${provenance.repository_path})`,
      );
    }),
  );

stateCommand
  .command('migrate')
  .description('preview or create a global state baseline from explicit legacy refs')
  .option('--preview', 'write no state; emit or validate a deterministic migration plan')
  .option('--create', 'validate a saved plan and publish its initial baseline')
  .option('--source <source>', 'repeatable local:<full-ref> or <remote>:<full-ref>', collect, [])
  .option('--output <file>', 'write preview YAML to this local file')
  .option('--plan <file>', 'resolved plan validated by --preview or consumed by --create')
  .option('--json', 'print a stable JSON receipt')
  .action(
    action(
      stateAction('migrate', (options, activity) => {
        const result = stateMigrate(
          process.cwd(),
          {
            preview: options.preview,
            create: options.create,
            sources: options.source,
            output: options.output,
            plan: options.plan,
          },
          activity,
        );
        Object.assign(result, repoProvenance());
        if (!options.json && options.preview) {
          console.log(result.text);
          console.error(stateReceiptDetails(result));
        } else if (!options.json)
          console.log(
            `State baseline ${result.baseline} at ${result.remote}:${result.stateRef} (inventory ${result.inventoryDigest}; network: ${result.network}; written: ${result.written})\n${stateReceiptDetails(result)}`,
          );
        return result;
      }),
    ),
  );

stateCommand
  .command('activate')
  .description('prepare, install or deactivate checkout-independent state activation')
  .option('--prepare', 'create the local activation branch')
  .option('--install', 'fix refs/changeledger/activation at the integration tip')
  .option('--deactivate', 'remove activation and replica refs after recovery')
  .option('--baseline <oid>', 'published state baseline commit OID (--prepare only)')
  .option('--integration-ref <ref>', 'fully-qualified integration ref (--install/--deactivate)')
  .option('--json', 'print a stable JSON receipt')
  .action(
    action(
      stateAction('activate', (options, activity) => {
        const result = stateActivate(process.cwd(), options, activity);
        Object.assign(result, repoProvenance());
        if (!options.json) {
          if (options.install) {
            console.log(
              `${result.written ? 'Installed' : 'Confirmed'} ${result.ref} at ${result.activation} for ${result.integration} (baseline ${result.baseline}; inventory ${result.inventoryDigest}; network: ${result.network}; written: ${result.written})\n${stateReceiptDetails(result)}`,
            );
          } else if (options.deactivate) {
            console.log(
              `${result.written ? 'Deactivated' : 'Already deactivated'}: removed ${result.removed.length === 0 ? '(none)' : result.removed.join(', ')} (network: ${result.network}; written: ${result.written})\n${stateReceiptDetails(result)}`,
            );
          } else {
            console.log(
              `Prepared ${result.branch} at ${result.commit} from ${result.integration} (baseline ${result.baseline}; inventory ${result.inventoryDigest}; network: ${result.network}; written: ${result.written})\n${stateReceiptDetails(result)}`,
            );
          }
        }
        return result;
      }),
    ),
  );

stateCommand
  .command('doctor')
  .description('diagnose an activation locally, with optional explicit remote observation')
  .option('--activation-ref <ref>', 'activation branch or commit to inspect (required)')
  .option('--online', 'observe remote state and migration sources without publication')
  .option('--json', 'print a stable JSON receipt')
  .action(
    action(
      stateAction('doctor', (options, activity) => {
        const result = stateDoctor(process.cwd(), options, activity);
        Object.assign(result, repoProvenance());
        if (!options.json) {
          console.log(`Activation: ${result.activation}`);
          console.log(`Baseline: ${result.baseline}`);
          console.log(`Inventory: ${result.inventoryDigest}`);
          console.log(`Network: ${result.network}`);
          console.log(`Written: ${result.written}`);
          console.log(`Result: ${result.ok ? 'ready' : 'not ready'}`);
          for (const capability of Object.values(result.capabilities)) {
            console.log(
              `Capability: ${capability.capability}=${capability.value} (${capability.reason ?? capability.mechanism})`,
            );
          }
          for (const source of result.sources) {
            console.log(
              `Source: ${source.name} expected ${source.expected} actual ${source.actual}`,
            );
          }
          for (const problem of result.problems) console.log(`- ${problem}`);
          console.log(stateReceiptDetails(result));
        }
        if (!result.ok) process.exitCode = 1;
        return result;
      }),
    ),
  );

stateCommand
  .command('validate-update')
  .description('validate one protected ref update using local Git objects only')
  .argument('<old-oid>')
  .argument('<new-oid>')
  .argument('<ref>')
  .requiredOption('--state-ref <ref>', 'protected full state ref')
  .requiredOption('--integration-ref <ref>', 'protected full integration ref')
  .option('--max-commits <n>', 'maximum commits inspected')
  .option('--max-object-bytes <n>', 'maximum unique object bytes inspected')
  .option('--timeout-ms <n>', 'monotonic validation deadline in milliseconds')
  .option('--json', 'print a stable JSON receipt')
  .action(
    action((oldOid, newOid, ref, options) =>
      stateAction('validate-update', (selected, activity) => {
        Object.assign(activity, { oldOid, newOid, protectedRef: ref });
        const result = stateValidateUpdate(process.cwd(), {
          oldOid,
          newOid,
          ref,
          stateRef: selected.stateRef,
          integrationRef: selected.integrationRef,
          limits: validationLimits(selected),
        });
        activity.capabilities = result.capabilities;
        const receipt = { ...stateReceiptProvenance(), ...result };
        if (!selected.json) {
          console.log(
            `Accepted ${receipt.ref}: ${receipt.oldOid} -> ${receipt.newOid} (${receipt.commits} commits, ${receipt.object_bytes} bytes; provider: ${receipt.provider}; network: ${receipt.network}; written: ${receipt.written})\n${stateReceiptDetails(receipt)}`,
          );
        }
        return receipt;
      })(options),
    ),
  );

stateCommand
  .command('validate-receive')
  .description('validate a pre-receive batch while preserving Git quarantine')
  .requiredOption('--state-ref <ref>', 'protected full state ref')
  .requiredOption('--integration-ref <ref>', 'protected full integration ref')
  .option('--max-commits <n>', 'maximum commits inspected across the batch')
  .option('--max-object-bytes <n>', 'maximum unique object bytes across the batch')
  .option('--timeout-ms <n>', 'monotonic validation deadline in milliseconds')
  .option('--json', 'print a stable JSON receipt')
  .action(
    action((options) =>
      stateAction('validate-receive', (selected, activity) => {
        const result = stateValidateReceive(fs.readFileSync(0, 'utf8'), process.cwd(), {
          stateRef: selected.stateRef,
          integrationRef: selected.integrationRef,
          limits: validationLimits(selected),
        });
        activity.capabilities = result.flatMap((item) => Object.values(item.capabilities));
        const provenance = stateReceiptProvenance();
        const updates = result.map((item) => ({ ...provenance, ...item }));
        if (!selected.json) {
          for (const receipt of updates) {
            console.log(
              `Accepted ${receipt.ref}: ${receipt.oldOid} -> ${receipt.newOid} (${receipt.commits} commits, ${receipt.object_bytes} bytes; provider: ${receipt.provider}; network: ${receipt.network}; written: ${receipt.written})\n${stateReceiptDetails(receipt)}`,
            );
          }
        }
        return { ...provenance, updates, network: false, written: false };
      })(options),
    ),
  );

stateCommand
  .command('export')
  .description('prepare a local recovery branch from the confirmed state')
  .option('--recovery-branch', 'materialize confirmed state in legacy layout')
  .option('--json', 'print a stable JSON receipt')
  .action(
    action(
      stateAction('export', (options, activity) => {
        const result = stateExport(process.cwd(), options, activity);
        Object.assign(result, repoProvenance());
        if (!options.json)
          console.log(
            `Prepared ${result.branch} at ${result.commit} from ${result.integration} (confirmed ${result.confirmed}; baseline ${result.baseline}; inventory ${result.inventoryDigest}; network: ${result.network}; written: ${result.written})\n${stateReceiptDetails(result)}`,
          );
        return result;
      }),
    ),
  );

const releaseCommand = program
  .command('release')
  .description('plan and record portable SemVer releases');

releaseCommand
  .command('init')
  .description('initialize release history from the current published version')
  .argument('<version>')
  .option('--offline', 'create one local pending mutation without network access')
  .action(
    action((version, options) => {
      const { file, manifest } = initReleaseHistory(version, process.cwd(), nowUtc(), {
        offline: options.offline,
      });
      console.log(`Initialized release ${manifest.version} baseline → ${file}`);
      printLedgerRevision(file);
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
      if (plan.ledger_revision) {
        console.log(formatLedgerReceipt(plan));
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
  .option('--offline', 'create one local pending mutation without network access')
  .action(
    action((version, options) => {
      const { file, manifest } = recordRelease(version, process.cwd(), nowUtc(), {
        offline: options.offline,
      });
      console.log(`Recorded release ${manifest.version} → ${file}`);
      printLedgerRevision(file);
    }),
  );

// Normalize -V to --version so both short aliases work identically.
const argv = process.argv.map((a) => (a === '-V' ? '--version' : a));
if (argv.length <= 2) {
  console.log(USAGE);
} else {
  program.parse(argv);
}
