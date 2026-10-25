import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import { init } from '../src/commands/init.mjs';
import { registerRepo } from '../src/commands/register.mjs';
import {
  BOOTSTRAP_CAPTURE_LINES,
  checkContract,
  REFERENCE,
  removeLegacyContract,
} from '../src/contract.mjs';
import { LOG_EVENT_DEFINITIONS, LOG_EVENT_TYPES, parseLogEvent } from '../src/lifecycle.mjs';
import { contextBudgets } from './budget-support.mjs';
import { sanitizedEnv } from './helpers/git-env.mjs';

const BIN = fileURLToPath(new URL('../bin/changeledger.mjs', import.meta.url));

// 20261020-130304 CR6 retargeted this. The contract used to carry a
// hand-maintained copy of the event table, so this test checked the copy
// against the parser. `log --help` prints the same table and more — which
// command writes each type — and GENERATES it from `LOG_EVENT_DEFINITIONS`
// with its own fail-closed consistency check, so the copy was pure cost. The
// assertion now reads the generated output: the surface an agent is sent to
// is the surface under test, and the contract keeps only the obligation.
test('20261020-130304 CR6: the generated Log help exposes every executable event and payload', () => {
  const { stdout } = spawnSync(process.execPath, [BIN, 'log', '--help'], {
    encoding: 'utf8',
    env: sanitizedEnv(),
  });
  for (const type of LOG_EVENT_TYPES) {
    assert.match(stdout, new RegExp(`^ {2}${type}$`, 'm'), `log --help omits the "${type}" type`);
  }
  for (const [type, definition] of Object.entries(LOG_EVENT_DEFINITIONS)) {
    // The help renders a multi-arm form as `Payload:` plus one `Or:` per arm,
    // so each arm is asserted on its own rather than the joined string.
    for (const arm of definition.form.split(' | ')) {
      assert.ok(stdout.includes(arm), `log --help omits a payload arm of "${type}": ${arm}`);
    }
    assert.ok(
      parseLogEvent(`- **2026-08-24T16:00:00Z** \`[${type}]\` ${definition.canonicalPayload}`),
      `${type} documented form is disconnected from its parser`,
    );
  }
  // What the contract still owns, because the help does not carry it.
  const implement = fs.readFileSync(
    new URL('../templates/contract/implement.md', import.meta.url),
    'utf8',
  );
  assert.match(implement, /Each transition event records exactly one transition/);
  assert.match(implement, /every top-level `- ` line must be a valid typed event/);
});

process.env.CHANGELEDGER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-home-'));

function root() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-repo-'));
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Project rules\n');
  return dir;
}

function reflowBootstrap(text) {
  return text.replace(
    '> **ChangeLedger governs this repo.** Before planning, investigating, answering\n> or editing anything, run exactly this — it is mandatory, not optional:',
    '>**ChangeLedger governs this repo.** Before planning, investigating,\n> answering or editing anything, run exactly this — it is mandatory, not optional:',
  );
}

function prettierBootstrap(text) {
  return text
    .replace(/(<!-- CHANGELEDGER BOOTSTRAP BEGIN v\d+ -->)\n/, '$1\n\n')
    .replace('> or editing anything, run', 'or editing anything, run')
    .replace('\n<!-- CHANGELEDGER BOOTSTRAP END -->', '\n\n<!-- CHANGELEDGER BOOTSTRAP END -->');
}

test('212659 CR1/CR2: init installs an optional bootstrap without hiding real failures', () => {
  const dir = root();
  init(dir);
  assert.equal(fs.existsSync(path.join(dir, '.changeledger', 'AGENTS.md')), false);
  assert.equal(fs.existsSync(path.join(dir, '.gitignore')), false);
  const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.match(
    agents,
    new RegExp(
      `run exactly this[\\s\\S]*\`changeledger context 2>&1 \\| head -${BOOTSTRAP_CAPTURE_LINES}\``,
    ),
  );
  assert.match(agents, /Command not installed[\s\S]*continue the task normally/i);
  assert.match(agents, /Command present but failing[\s\S]*report the captured error[\s\S]*human/i);
  assert.match(agents, /human, and wait\s+>?\s*for their decision/i);
  assert.doesNotMatch(agents, /restore\/install ChangeLedger|command -v|which changeledger/i);
  assert.doesNotMatch(agents, /\.changeledger\/AGENTS\.md/);
  assert.deepEqual(checkContract(dir), []);
});

test('212659 CR1: bootstrap attempts the core load immediately, not only before edits', () => {
  const dir = root();
  init(dir);
  const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.match(agents, /Before planning, investigating, answering\s+>?\s*or editing anything/);
  assert.match(agents, /run exactly this — it is mandatory, not optional/);
  assert.doesNotMatch(agents, /Before creating or modifying files/);
});

test('212659 CR7: bootstrap leaves lifecycle authority to loaded context', () => {
  const dir = root();
  init(dir);
  const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.match(agents, /Nothing before that line is\s+>?\s*actionable/i);
  assert.doesNotMatch(agents, /Do not create or modify files without an authorized change/);
  assert.doesNotMatch(agents, /workflow, the task contexts, and the narrow operational exception/);
  assert.doesNotMatch(agents, /spec\|implement\|review\|release/);
});

// 20260726-124833 retired the revision-recovery half of 212659 CR4 together
// with `--have`. 20260726-124834 restated CR3's complete-capture rule as a
// checkable validity condition plus a bounded retry, replacing prose that
// forbade truncation without giving the agent any way to detect it.
test('212659 CR3: bootstrap preserves the complete-capture rule', () => {
  const dir = root();
  init(dir);
  const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.match(agents, /only if its last line contains\s+>?\s*`CHANGELEDGER CONTEXT END`\*\*/);
  assert.match(agents, /Nothing before that line is\s+>?\s*actionable/i);
  assert.match(agents, /if `END` is missing, re-run with/i);
  assert.doesNotMatch(agents, /no pipes, filters, summaries, previews or voluntary output limits/i);
});

// 20260726-124833 CR5: the installed bootstrap no longer teaches a revision
// check that the CLI cannot perform any more.
test('124833 CR5: the installed bootstrap never mentions --have or a retained rev', () => {
  const dir = root();
  init(dir);
  const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.doesNotMatch(agents, /--have/);
  assert.doesNotMatch(agents, /rev:/);
  assert.doesNotMatch(agents, /After a compaction/i);
  assert.doesNotMatch(agents, /retained capture/i);
  assert.deepEqual(checkContract(dir), []);
});

// The delimited block wraps every line in `> `; flatten the blockquote so the
// literal phrases the specification pins can be asserted without encoding the
// hard line wraps that Markdown formatters are free to move.
function bootstrapProse(dir) {
  const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  const begin = agents.indexOf('<!-- CHANGELEDGER BOOTSTRAP BEGIN');
  const end = agents.indexOf('<!-- CHANGELEDGER BOOTSTRAP END -->');
  assert.ok(begin !== -1 && end > begin, 'AGENTS.md must carry a delimited bootstrap block');
  return agents.slice(begin, end);
}

const flatten = (block) => block.replace(/^>[ ]?/gm, '').replace(/\s+/g, ' ');

test('124834 CR1: the bootstrap publishes the exact bounded capture command', () => {
  const dir = root();
  init(dir);
  const prose = flatten(bootstrapProse(dir));
  assert.ok(
    prose.includes(`\`changeledger context 2>&1 | head -${BOOTSTRAP_CAPTURE_LINES}\``),
    'the block must publish the bounded command literally',
  );
  assert.ok(
    prose.includes('run exactly this — it is mandatory, not optional'),
    'the block must state the mandatory framing literally',
  );
});

test('124834 CR2: a positive validity condition replaces the negative rule', () => {
  const dir = root();
  init(dir);
  const block = bootstrapProse(dir);
  const prose = flatten(block);
  assert.ok(
    prose.includes('valid **only if its last line contains `CHANGELEDGER CONTEXT END`**'),
    'the block must state the positive validity condition literally',
  );
  assert.ok(
    !prose.includes('no pipes, filters, summaries, previews or voluntary output limits'),
    'the retired negative rule must be gone',
  );
  assert.ok(
    prose.includes('re-run with `head -<lines>`'),
    'the truncation retry must name the exact bounded retry command',
  );
  assert.ok(!block.includes('lines + 2'), 'the block must not carry the retired retry arithmetic');
});

test('124834 CR3: absent command stays distinct from a present command that fails', () => {
  const dir = root();
  init(dir);
  const prose = flatten(bootstrapProse(dir));
  assert.ok(
    prose.includes(
      'Command not installed (`command not found`) → ChangeLedger is absent: continue the task normally and never emulate it',
    ),
    'the absent branch must be stated literally',
  );
  assert.ok(
    prose.includes(
      'Command present but failing (any other error or non-zero exit) → stop, report the captured error to the human, and wait for their decision',
    ),
    'the failing branch must be stated literally and separately',
  );
});

test('124834 CR4: the block re-runs after compaction and teaches no revision check', () => {
  const dir = root();
  init(dir);
  const block = bootstrapProse(dir);
  assert.ok(
    flatten(block).includes(
      'Run this again as the first action of the first response after any context compaction',
    ),
    'the compaction retry must be stated literally',
  );
  assert.ok(!block.includes('--have'), 'the block must not mention the retired --have flag');
  assert.ok(!block.includes('rev:'), 'the block must not mention a retained rev');
});

// Retirement of a `BEGIN vN` block is generic: `replaceDelimited` compares the
// version numerically and never the payload, so no hash has to be registered in
// `LEGACY_CONTRACT_HASHES`. The first fixture holds the current payload under a
// v3 marker to isolate that numeric comparison from any content comparison; the
// second is the real v3 prose this change retires.
test('124834 CR5: a v3 block is outdated and register rewrites it to v4', () => {
  const historicalV3 = `> [!IMPORTANT]
> Attempt to run **ChangeLedger** with \`changeledger context\` immediately after
> reading this file — before planning, investigating, or acting. If it succeeds,
> retain complete stdout through the \`CHANGELEDGER CONTEXT END\` line and follow that
> complete context: no pipes, filters, summaries, previews or voluntary output limits.
> If the tool exposes an output budget, reserve enough for the whole response. A
> missing END means the output was truncated: stop and re-run with a larger capture.
>
> If the command is unavailable, continue normally without ChangeLedger. If it
> starts but fails, report the error to the human and wait for them to decide how
> to continue; do not treat a failing command as absent.
`;

  for (const payload of [REFERENCE, historicalV3]) {
    const dir = root();
    init(dir);
    const file = path.join(dir, 'AGENTS.md');
    const stale = `# Project\n\n<!-- CHANGELEDGER BOOTSTRAP BEGIN v3 -->\n${payload}<!-- CHANGELEDGER BOOTSTRAP END -->\n`;
    fs.writeFileSync(file, stale);

    assert.deepEqual(checkContract(dir), [
      'AGENTS.md has an outdated ChangeLedger reference — run `changeledger register`',
    ]);

    registerRepo(dir);

    assert.equal(
      fs.readFileSync(file, 'utf8'),
      `# Project\n\n<!-- CHANGELEDGER BOOTSTRAP BEGIN v4 -->\n${REFERENCE}<!-- CHANGELEDGER BOOTSTRAP END -->\n`,
    );
    assert.deepEqual(checkContract(dir), []);
  }
});

const OUTDATED = 'AGENTS.md has an outdated ChangeLedger reference — run `changeledger register`';

const ABSENT_BULLET = `> - Command not installed (\`command not found\`) → ChangeLedger is absent:
>   continue the task normally and never emulate it.
`;
const FAILING_BULLET = `> - Command present but failing (any other error or non-zero exit) → stop,
>   report the captured error to the human, and wait for their decision.
`;

// The v4 block is the first REFERENCE built from a Markdown list. These fixtures
// pin the two halves a list must not cost us: formatter tolerance beyond byte
// equality (CR7) and drift detection inside the bullets (CR8).
function installed() {
  const dir = root();
  init(dir);
  const file = path.join(dir, 'AGENTS.md');
  const canonical = fs.readFileSync(file, 'utf8');
  assert.match(canonical, /CHANGELEDGER BOOTSTRAP BEGIN v4/);
  return { dir, file, canonical };
}

function rejects(mutate, why) {
  const { dir, file, canonical } = installed();
  const changed = mutate(canonical);
  assert.notEqual(changed, canonical, `the fixture must actually change the block: ${why}`);
  fs.writeFileSync(file, changed);
  assert.deepEqual(checkContract(dir), [OUTDATED], why);
}

test('124834 CR7: semantic equivalence survives the bullet list', () => {
  const { dir, file, canonical } = installed();
  const equivalent = canonical
    .replace('**ChangeLedger governs this repo.**', '__ChangeLedger governs this repo.__')
    .replace('>   compaction.', '> compaction.');
  assert.notEqual(equivalent, canonical);
  assert.match(equivalent, /__ChangeLedger governs this repo\.__/);
  assert.match(equivalent, /any context\n> compaction\./);
  fs.writeFileSync(file, equivalent);

  assert.deepEqual(checkContract(dir), []);

  registerRepo(dir);
  assert.equal(
    fs.readFileSync(file, 'utf8'),
    equivalent,
    'register must leave an equivalent file byte-for-byte identical',
  );
});

test('124834 CR8: drift in the bounded command is still outdated', () => {
  rejects(
    (text) => text.replace(`head -${BOOTSTRAP_CAPTURE_LINES}`, 'head -999'),
    'a changed capture bound is drift',
  );
});

// 20260728-212043 CR3: `124834 CR8` above only ever mutated the bound upward.
// That direction alone would tolerate a guard that only rejects raising the
// literal — the exact defect a `head -325` → `head -300` mutation would slip
// through undetected. This is the direction this change's own edit takes, so
// it is the one this test must prove the guard was never blind to.
test('20260728-212043 CR3: drift lowering the bounded command is outdated too', () => {
  rejects(
    (text) => text.replace(`head -${BOOTSTRAP_CAPTURE_LINES}`, 'head -300'),
    'a lowered capture bound is drift too',
  );
});

// Enumerate the bullets with the same parser the projection uses, so the test's
// notion of "a bullet" cannot drift from `projectToken`'s. Pinning individual
// bullets by hand left the uncovered ones open: a projection that dropped any
// subset of `items` (`slice(0, -1)`, `slice(1)`, …) survived. Deriving the set
// from the parse makes coverage exhaustive and self-extending — a bullet added
// to `REFERENCE` is verified without anyone remembering to extend this test.
function referenceBullets() {
  const blockquote = marked.lexer(REFERENCE).filter((token) => token.type !== 'space')[0];
  assert.equal(blockquote?.type, 'blockquote', 'the reference must be a single blockquote');
  const list = blockquote.tokens.find((token) => token.type === 'list');
  assert.ok(list, 'the v4 reference must carry a bullet list');

  const anchors = list.items.map((item) => {
    const anchor = `> ${item.raw.split('\n')[0]}`;
    assert.equal(
      REFERENCE.split(anchor).length - 1,
      1,
      `each bullet must be locatable exactly once in the block: ${anchor}`,
    );
    return anchor;
  });

  // Cross-check the parsed count against an independent scan of the raw block.
  // Two derivations agreeing is what makes the loop provably exhaustive; no
  // bullet count is ever written down here.
  const bulletLines = (REFERENCE.match(/^> - /gm) ?? []).length;
  assert.ok(bulletLines > 0, 'the v4 reference must contain at least one bullet');
  assert.equal(anchors.length, bulletLines, 'every bullet line must be enumerated');
  return anchors;
}

test('124834 CR8: drift in every parsed bullet is still outdated', () => {
  const bullets = referenceBullets();
  for (const anchor of bullets) {
    rejects(
      (text) => text.replace(anchor, anchor.replace('> - ', '> - Never ')),
      `drift must be detected in bullet ${bullets.indexOf(anchor) + 1}/${bullets.length}: ${anchor}`,
    );
  }
});

test('124834 CR8: reordering two bullets without changing their text is outdated', () => {
  rejects((text) => {
    assert.ok(text.includes(`${ABSENT_BULLET}${FAILING_BULLET}`), 'both bullets must be adjacent');
    return text.replace(`${ABSENT_BULLET}${FAILING_BULLET}`, `${FAILING_BULLET}${ABSENT_BULLET}`);
  }, 'bullet order must be preserved inside lists');
});

test('212659 CR5: bootstrap contains no delegation mechanism', () => {
  const dir = root();
  init(dir);
  const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.doesNotMatch(
    agents,
    /delegat|subagent|agent-context|investigation|implementation|CHANGELEDGER AGENT CONTEXT END/i,
  );
});

test('212659 CR6: bootstrap leaves divergence policy to loaded context', () => {
  const dir = root();
  init(dir);
  const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.doesNotMatch(agents, /divergence|specs and code|reconcile/i);
});

test('CR10/CR12: reference refresh is idempotent and stale references fail check', () => {
  const dir = root();
  init(dir);
  registerRepo(dir);
  registerRepo(dir);
  const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.equal(agents.match(/CHANGELEDGER BOOTSTRAP BEGIN v\d+/g).length, 1);
  assert.equal(agents.match(/CHANGELEDGER BOOTSTRAP END/g).length, 1);
  assert.ok(agents.includes(REFERENCE.trim()));

  fs.writeFileSync(
    path.join(dir, 'AGENTS.md'),
    '# Project\n\n<!-- changeledger -->\n> Read `.changeledger/AGENTS.md`.\n',
  );
  assert.match(checkContract(dir).join('\n'), /outdated ChangeLedger reference/);
  registerRepo(dir);
  assert.deepEqual(checkContract(dir), []);
});

test('213931 CR7: the pre-sentinel managed block fails check until re-register', () => {
  const dir = root();
  init(dir);
  const previousReference = `<!-- changeledger -->
> [!IMPORTANT]
> This repo uses **ChangeLedger**. Before creating or modifying files, run
> \`changeledger context\` directly, read its complete output, and follow it.
> Do not pipe, filter, summarize, limit, or truncate the output before reading it.
> If the output is truncated/incomplete, stop and restore complete context before
> proceeding. If the command is unavailable, stop and restore/install
> ChangeLedger; do not proceed from memory.
`;
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), `# Project\n\n${previousReference}`);
  assert.match(checkContract(dir).join('\n'), /outdated ChangeLedger reference/);
  registerRepo(dir);
  assert.deepEqual(checkContract(dir), []);
});

test('150300 CR1: check accepts equivalent blockquote reflow', () => {
  const dir = root();
  init(dir);
  const file = path.join(dir, 'AGENTS.md');
  const canonical = fs.readFileSync(file, 'utf8');
  const reformatted = reflowBootstrap(canonical);
  assert.notEqual(reformatted, canonical);

  fs.writeFileSync(file, reformatted);

  assert.deepEqual(checkContract(dir), []);
});

test('153633 CR1/CR3: check accepts the real Prettier lazy-continuation fixture', () => {
  const dir = root();
  init(dir);
  const file = path.join(dir, 'AGENTS.md');
  const canonical = fs.readFileSync(file, 'utf8');
  const reformatted = prettierBootstrap(canonical);
  assert.notEqual(reformatted, canonical);
  assert.match(reformatted, /investigating, answering\nor editing anything, run/);

  fs.writeFileSync(file, reformatted);

  assert.deepEqual(checkContract(dir), []);
});

test('153633 CR3: check accepts different Markdown syntax with the same token tree', () => {
  const dir = root();
  init(dir);
  const file = path.join(dir, 'AGENTS.md');
  const canonical = fs.readFileSync(file, 'utf8');
  const equivalent = canonical.replace(
    '**ChangeLedger governs this repo.**',
    '__ChangeLedger governs this repo.__',
  );
  assert.notEqual(equivalent, canonical);

  fs.writeFileSync(file, equivalent);

  assert.deepEqual(checkContract(dir), []);
});

test('124113 CR1: CLAUDE.md may import the canonical AGENTS.md bootstrap', () => {
  for (const claude of ['@AGENTS.md\n', '# Claude\n\nFollow @AGENTS.md for shared rules.\n']) {
    const dir = root();
    init(dir);
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), claude);

    assert.deepEqual(checkContract(dir), []);
  }
});

test('124113 CR2: register preserves an imported CLAUDE.md byte-for-byte', () => {
  const dir = root();
  init(dir);
  const file = path.join(dir, 'CLAUDE.md');
  const claude = '# Claude-specific rules\n\n@AGENTS.md\n\nKeep this text.\n';
  fs.writeFileSync(file, claude);

  registerRepo(dir);

  assert.equal(fs.readFileSync(file, 'utf8'), claude);
});

test('124113 CR3: an import does not hide an invalid canonical AGENTS.md', () => {
  const dir = root();
  init(dir);
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '@AGENTS.md\n');
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Project rules without bootstrap\n');

  assert.deepEqual(checkContract(dir), [
    'AGENTS.md has no ChangeLedger reference — run `changeledger register`',
  ]);
});

test('124113 CR4: other paths and partial tokens are not canonical imports', () => {
  const invalid = [
    'AGENTS.md\n',
    '@docs/AGENTS.md\n',
    '@../AGENTS.md\n',
    '@/repo/AGENTS.md\n',
    '@AGENTS.md.bak\n',
  ];
  for (const claude of invalid) {
    const dir = root();
    init(dir);
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), claude);

    assert.deepEqual(checkContract(dir), [
      'CLAUDE.md has no ChangeLedger reference — run `changeledger register`',
    ]);
  }
});

test('124113 CR5: a direct stale CLAUDE.md bootstrap still requires repair', () => {
  const dir = root();
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Claude rules\n');
  init(dir);
  const file = path.join(dir, 'CLAUDE.md');
  const stale = fs
    .readFileSync(file, 'utf8')
    .replace(/BOOTSTRAP BEGIN v\d+ -->/, 'BOOTSTRAP BEGIN v0 -->');
  fs.writeFileSync(file, `@AGENTS.md\n\n${stale}`);

  assert.deepEqual(checkContract(dir), [
    'CLAUDE.md has an outdated ChangeLedger reference — run `changeledger register`',
  ]);
  registerRepo(dir);
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /BOOTSTRAP BEGIN v0/);
});

test('150300 CR3/CR4: check rejects semantic and structural bootstrap changes', () => {
  const mutations = [
    (text) => text.replace('`changeledger context 2>&1', '`changeledger check 2>&1'),
    (text) =>
      text.replace('**ChangeLedger governs this repo.**', '**ChangeLedger  governs this repo.**'),
    (text) => text.replace('> or editing anything', '>\n> or editing anything'),
    (text) =>
      text.replace('> or editing anything', '>\n\noutside the blockquote\n\n> or editing anything'),
  ];

  for (const mutate of mutations) {
    const dir = root();
    init(dir);
    const file = path.join(dir, 'AGENTS.md');
    const canonical = fs.readFileSync(file, 'utf8');
    const changed = mutate(canonical);
    assert.notEqual(changed, canonical);
    fs.writeFileSync(file, changed);

    assert.deepEqual(checkContract(dir), [
      'AGENTS.md has an outdated ChangeLedger reference — run `changeledger register`',
    ]);
  }

  const dir = root();
  init(dir);
  const file = path.join(dir, 'AGENTS.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').trimEnd());
  assert.throws(() => checkContract(dir), /END marker must occupy its own line/);

  const missingEndDir = root();
  init(missingEndDir);
  const missingEndFile = path.join(missingEndDir, 'AGENTS.md');
  fs.writeFileSync(
    missingEndFile,
    fs.readFileSync(missingEndFile, 'utf8').replace('<!-- CHANGELEDGER BOOTSTRAP END -->', ''),
  );
  assert.throws(() => checkContract(missingEndDir), /BEGIN marker without a matching END marker/);
});

test('153633 CR4/CR5: check rejects semantic token and delimiter changes', () => {
  const mutations = [
    (text) => text.replace('`changeledger context 2>&1', '`changeledger check 2>&1'),
    (text) =>
      text.replace(
        '**ChangeLedger governs this repo.**',
        '**[ChangeLedger](https://example.com) governs this repo.**',
      ),
    (text) => `${text}<!-- CHANGELEDGER BOOTSTRAP END -->\n`,
    (text) =>
      text.replace('<!-- CHANGELEDGER BOOTSTRAP BEGIN', 'prefix <!-- CHANGELEDGER BOOTSTRAP BEGIN'),
  ];

  for (const mutate of mutations) {
    const dir = root();
    init(dir);
    const file = path.join(dir, 'AGENTS.md');
    const canonical = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, mutate(canonical));

    let errors;
    try {
      errors = checkContract(dir);
    } catch (error) {
      assert.match(error.message, /Malformed ChangeLedger bootstrap/);
      continue;
    }
    assert.deepEqual(errors, [
      'AGENTS.md has an outdated ChangeLedger reference — run `changeledger register`',
    ]);
  }
});

test('CR11: register removes a legacy symlink and exact gitignore entry', () => {
  const dir = root();
  init(dir);
  const artifact = path.join(dir, '.changeledger', 'AGENTS.md');
  const target = path.join(dir, 'legacy-contract.md');
  fs.writeFileSync(target, '# legacy\n');
  fs.symlinkSync(target, artifact);
  fs.writeFileSync(path.join(dir, '.gitignore'), 'dist\n.changeledger/AGENTS.md\n.env\n');
  registerRepo(dir);
  assert.equal(fs.existsSync(artifact), false);
  assert.equal(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), 'dist\n.env\n');
});

test('CR11: register removes a recognized Windows fallback copy', () => {
  const dir = root();
  init(dir);
  const artifact = path.join(dir, '.changeledger', 'AGENTS.md');
  const legacy = '# AGENTS.md — ChangeLedger Contract\nknown exact legacy payload\n';
  fs.writeFileSync(artifact, legacy);
  const digest = crypto.createHash('sha256').update(legacy).digest('hex');
  removeLegacyContract(path.join(dir, '.changeledger'), new Set([digest]));
  assert.equal(fs.existsSync(artifact), false);
});

test('CR11: register preserves and rejects an unknown regular file', () => {
  const dir = root();
  init(dir);
  const artifact = path.join(dir, '.changeledger', 'AGENTS.md');
  fs.writeFileSync(artifact, '# AGENTS.md — ChangeLedger Contract\nuser-owned additions\n');
  assert.throws(() => registerRepo(dir), /not a recognized legacy ChangeLedger contract/);
  assert.equal(
    fs.readFileSync(artifact, 'utf8'),
    '# AGENTS.md — ChangeLedger Contract\nuser-owned additions\n',
  );
});

test('CR11: register removes only the literal legacy gitignore line', () => {
  const dir = root();
  init(dir);
  fs.writeFileSync(
    path.join(dir, '.gitignore'),
    '.changeledger/AGENTS.md\n .changeledger/AGENTS.md\n.changeledger/AGENTS.md \n',
  );
  registerRepo(dir);
  assert.equal(
    fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'),
    ' .changeledger/AGENTS.md\n.changeledger/AGENTS.md \n',
  );
});

// 20261024-121022 retired `141119 CR5`: it pinned the `refactor` row of the
// per-type stage matrix in both versioned configs, and the matrix is gone — the
// configuration declares no `types` and no `stages` (CR11), and the four
// canonical stages are fixed in code.

// --- 20261020-172221: the epic in the contract ---------------------------
//
// Three attempts at guarding this prose with regexes produced three sets of
// phrasing pins: `two levels` broke on `two tiers`, `outside the relation
// graph` broke on `kept out of the graph depends_on and related_to build`,
// and a rewrite that deleted the closure rule outright slipped past a pattern
// built to catch it. The instrument is the problem — a regex tests tokens and
// the obligation is semantics — and AGENTS.md rejects a pin on a literal
// sentence precisely because it taxes every later rewrite without buying
// enforcement.
//
// So the four epic rules are NOT guarded here. Each is enforced by code and
// held by a falsifiable test: two levels and the cycle discrimination in
// `test/check.test.mjs` (CR2), the relation-graph exclusion by the
// `depends_on`-its-own-child fixture (CR3), the closure rule at three seats
// (CR6), the short lifecycle by a walk (CR4). What remains below is the kind
// of assertion a rewrite cannot break and a deletion cannot survive: the
// identifier, a retired-phrase sweep, and co-occurrences each verified
// against both an obligation-preserving and an obligation-removing rewrite.

const fragment = (name) =>
  fs
    .readFileSync(new URL(`../templates/contract/${name}`, import.meta.url), 'utf8')
    .replace(/\s+/g, ' ');

test('20261020-172221 CR4/CR5: the contract names the grouping field', () => {
  assert.match(fragment('spec.md'), /`parent`/, 'spec.md must name the field');
  assert.match(
    fragment('spec.md'),
    /`parent`[^.]{0,200}`(epic|done)`|epic[^.]{0,200}`parent`/i,
    'the field must be introduced with the grouping it declares, not listed bare',
  );
});

test('20261020-172221 CR5: close.md reserves the spec link to the parent', () => {
  assert.match(
    fragment('close.md'),
    /`parent`[^.]{0,80}(never|not|no)[^.]{0,40}links? a spec/i,
    'a change with a parent must be told it never links a spec',
  );
});

test('20261020-172221 CR8: the contract no longer calls an archive fully reversible', () => {
  for (const name of ['core.md', 'close.md']) {
    assert.ok(
      !/archive is undone by editing/i.test(fragment(name)),
      `${name} must not claim an archive is undone by editing the document alone`,
    );
  }
  // Co-occurrence guards: the two concepts are named together or the rule is
  // gone, whatever words carry it. Exactly one span in core.md matches.
  assert.match(
    fragment('core.md'),
    /archiv\w+[^.]*branch|branch[^.]*archiv\w+/i,
    'core.md must connect archiving to the branch it deletes',
  );
  assert.match(
    fragment('close.md'),
    // Clause-scoped (`[^.;]`): the sentence goes on to say that `archive <id>`
    // DOES delete a branch, and a looser span matched that instead.
    /`archive --graduated`[^.;]{0,120}(no branches|leaves[^.;]*branch|branch[^.;]*(untouched|alone))/i,
    'close.md must scope the deletion away from the bulk seat',
  );
});

test('20260728-170429 CR2/CR6: the AGENTS.md budgets paragraph names the tokenizer unit, drops bytes/dual-publish and bans spending headroom', () => {
  const repoRoot = new URL('../', import.meta.url);
  const normalized = fs.readFileSync(new URL('AGENTS.md', repoRoot), 'utf8').replace(/\s+/g, ' ');

  const expectedParagraph =
    'Each entry in `templates/contract/budgets.yml` declares a `tokens` ceiling ' +
    'and a `lines` ceiling: tokens are counted by a pinned reference tokenizer, ' +
    'not by what a particular model consumes. Neither is derived from what the ' +
    "content currently measures, and neither is the bootstrap's `head` cut, which " +
    'is a fixed bound of its own. A ceiling is never a goal: never remove ' +
    'normative prose to fit one, and headroom under a ceiling is never permission ' +
    'to spend it — every entry into a context is deliberate and optimized. A ' +
    'ceiling may only decrease; raising one is a human decision recorded in a ' +
    'change, and every move shows up as an edit to the pinned values in ' +
    '`test/context.test.mjs`. A rule may leave a fragment only when its new home ' +
    'is named and a grep of the obligation itself — not of similar words — finds ' +
    'it there. If correct content does not fit, stop and ask the human.';

  // Exact match, not a partial regex: any wording drift on the tokenizer unit
  // (CR2) or on the kept/added budgets rules (CR6) fails this on its own.
  assert.ok(
    normalized.includes(expectedParagraph),
    `AGENTS.md must carry the budgets paragraph verbatim; got:\n${normalized}`,
  );

  // CR6, belt and suspenders across the whole file, not just the paragraph:
  // the retired per-entry `bytes` ceiling and dual-dimension BEGIN publish
  // must not resurface anywhere, even outside the paragraph above.
  assert.doesNotMatch(normalized, /`bytes` ceiling/);
  assert.doesNotMatch(normalized, /publishes its occupancy of both/);
});

// 20260728-212043 CR2: the capture bound lives in two production places — this
// repo's own `AGENTS.md` and the `REFERENCE` block `src/contract.mjs` publishes
// to every consuming repo — and they must never read a different number. Byte
// equality of the whole block is what proves they agree, not just a shared
// substring: a `.trim()` because `AGENTS.md` wraps `REFERENCE` with a leading
// marker line and a trailing blank line that are not part of the block.
test("20260728-212043 CR2: this repo's own AGENTS.md bootstrap matches the published REFERENCE", () => {
  const repoRoot = new URL('../', import.meta.url);
  const agents = fs.readFileSync(new URL('AGENTS.md', repoRoot), 'utf8');
  const bound = new RegExp(`head -${BOOTSTRAP_CAPTURE_LINES}\\b`);
  assert.match(REFERENCE, bound);
  assert.match(agents, bound);
  assert.ok(
    agents.includes(REFERENCE.trim()),
    "AGENTS.md's installed bootstrap block must be byte-identical to the published REFERENCE",
  );
});

// 20261020-130304 CR7: the bound no longer tracks the ceiling, so the one
// relation that still has to hold is asserted directly. Below the ceiling, a
// core context that legally filled its budget would be truncated by the very
// command the bootstrap mandates — recoverable through the `END` sentinel, but
// a silent cost on every capture until someone noticed.
test('20261020-130304 CR7: the bootstrap bound is never smaller than the core line ceiling', () => {
  const ceiling = contextBudgets.base.core.lines;
  assert.ok(
    BOOTSTRAP_CAPTURE_LINES >= ceiling,
    `the bootstrap captures ${BOOTSTRAP_CAPTURE_LINES} lines but core may occupy ${ceiling}`,
  );
});

// --- 20261024-121022 CR18: README, CONTRIBUTING and the CLI help follow the code ---

const helpOf = (...args) => {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    env: sanitizedEnv(),
  });
  assert.equal(result.status, 0, `${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.replace(/\s+/g, ' ');
};

const repoDoc = (name) =>
  fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8').replace(/\s+/g, ' ');

// A retired type named as a type: a `new <type>` example, its backticked enum
// form, `<name> type`, or the retired review key. Branch names such as
// `feature/x` and the plain nouns of the README's prose are not types.
const RETIRED_TYPE_MENTIONS = [
  /review_required/,
  /\bnew (feature|bug|quick)\b/,
  /`(feature|bug|quick)`/,
  /\b(feature|bug|quick) type/i,
  /type:? (feature|bug|quick)\b/,
];

test('20261024-121022 CR18: README and CONTRIBUTING name no retired type', () => {
  for (const name of ['README.md', 'CONTRIBUTING.md']) {
    const text = repoDoc(name);
    for (const pattern of RETIRED_TYPE_MENTIONS) {
      assert.doesNotMatch(text, pattern, `${name} still names a retired type: ${pattern}`);
    }
  }
});

test('20261024-121022 CR18: README creates a change and describes the 6 → 7 migration', () => {
  const readme = repoDoc('README.md');
  assert.match(readme, /changeledger new change /);
  assert.match(readme, /\b6\b[^.]{0,12}(→|to)[^.]{0,6}\b7\b/);
  assert.match(readme, /changeledger config migrate/);
  assert.match(readme, /changeledger fix\b/);
});

test('20261024-121022 CR18: the CLI help names no retired type and describes the single migration', () => {
  for (const args of [['--help'], ['new', '--help'], ['list', '--help'], ['search', '--help']]) {
    const help = helpOf(...args);
    for (const pattern of RETIRED_TYPE_MENTIONS) {
      assert.doesNotMatch(help, pattern, `${args.join(' ')} names a retired type: ${pattern}`);
    }
    assert.doesNotMatch(help, /\b(feature|bug|quick)\b(?![/-])/, `${args.join(' ')}`);
  }
  assert.match(helpOf('fix', '--help'), /retired type[^.]{0,40}`?change`?/i);
  assert.match(helpOf('fix', '--help'), /Investigation[^.]{0,40}Proposal[^.]{0,60}Request/);
  assert.match(helpOf('config', 'migrate', '--help'), /schema 6 to 7/);
});

// 20261024-202659 CR12: a finding outside the frontier is recorded with the
// `finding` command; the prose proposal it replaced stays retired everywhere.
test('20261024-202659 CR12: the contract records an out-of-frontier finding instead of proposing it', () => {
  const contractDir = new URL('../templates/contract/', import.meta.url);
  const fragments = fs
    .readdirSync(contractDir, { recursive: true })
    .filter((name) => String(name).endsWith('.md'))
    .map((name) => [name, fs.readFileSync(new URL(name, contractDir), 'utf8')]);
  for (const [name, text] of fragments) {
    assert.doesNotMatch(text, /propose type, title and reason/i, `${name} still proposes in prose`);
    assert.doesNotMatch(text, /Create the draft only after explicit authorization/i, name);
  }
  const read = (file) => fs.readFileSync(new URL(file, contractDir), 'utf8');
  // The handoff triage lives in the delegation fragment since the cut.
  assert.match(
    read('delegation.md').replace(/\s+/g, ' '),
    /\boutside\b[^.]{0,60}\b(objective|frontier)\b[^.]{0,80}`changeledger finding <id>`/i,
  );
  const core = read('core.md');
  assert.match(core, /^\| asks what is pending \|[^\n]*--pending findings/m);
  const discovery = core.slice(core.indexOf('## Operational discovery'));
  assert.match(discovery, /`changeledger list --pending [^`]*\bfindings\b[^`]*`/);
});

test('20261024-202659 CR13: README documents the finding command and the findings query', () => {
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.ok(readme.includes('changeledger list [--pending graduation|archive|findings]'));
  const entry = 'changeledger finding <id> "<text>" | <n> promote <id> | <n> drop "<reason>"';
  const lines = readme.split('\n');
  const at = lines.findIndex((line) => line.startsWith(entry));
  assert.notEqual(at, -1, 'README has no finding entry');
  assert.match(lines.slice(at - 1, at + 1).join('\n'), /finding[^\n]*outside[^\n]*frontier/i);
});

// README and CONTRIBUTING describe the contract that remains: one delegate
// capsule (`review`), no correction isolation, and the rule that nothing
// outside `.changeledger/` cites the ledger, enforced by `no-ledger-refs.sh`.
// The test names carry no change id or criterion: this file is itself subject
// to that rule (see hooks/no-ledger-refs.sh).
const RETIRED_DELEGATION_PHRASES = [
  /graduation-review/,
  /agent-prompt investigation/,
  /agent-context implementation/,
  /uncommitted until/i,
  /Correction isolation/i,
];

test('README and CONTRIBUTING name no retired delegate role nor correction isolation', () => {
  for (const name of ['README.md', 'CONTRIBUTING.md']) {
    const text = repoDoc(name);
    for (const pattern of RETIRED_DELEGATION_PHRASES) {
      assert.doesNotMatch(text, pattern, `${name} still carries a retired phrase: ${pattern}`);
    }
  }
});

test('CONTRIBUTING documents the no-ledger-refs hook and naming tests by behaviour', () => {
  const text = repoDoc('CONTRIBUTING.md');
  assert.match(text, /no-ledger-refs\.sh/);
  assert.match(text, /\b(?:change id|id of a change)\b[^.]{0,40}`?CRn`?/i);
  assert.match(text, /name[^.]{0,30}test[^.]{0,40}behaviou?r/i);
  assert.match(text, /`?Target`?[^.]{0,20}`?Verify`?[^.]{0,60}\[#id\]/);
});

test('README says hooks/ is not packaged and a consuming repo copies the script', () => {
  const text = repoDoc('README.md');
  assert.match(text, /no-ledger-refs\.sh/);
  assert.match(text, /`?hooks\/`? is not packaged/i);
  assert.match(text, /copies? the script/i);
  assert.match(text, /outside `\.changeledger\/`/);
});
