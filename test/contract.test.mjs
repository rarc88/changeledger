import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { marked } from 'marked';
import { init } from '../src/commands/init.mjs';
import { registerRepo } from '../src/commands/register.mjs';
import { checkContract, REFERENCE, removeLegacyContract } from '../src/contract.mjs';

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
  assert.match(agents, /run exactly this[\s\S]*`changeledger context 2>&1 \| head -200`/);
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
    prose.includes('`changeledger context 2>&1 | head -200`'),
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
  rejects((text) => text.replace('head -200', 'head -500'), 'a changed capture bound is drift');
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

test('141119 CR5: refactor activates specification in every versioned artifact', () => {
  const repoRoot = new URL('../', import.meta.url);
  for (const file of ['.changeledger/config.yml', 'templates/config.yml']) {
    assert.match(
      fs.readFileSync(new URL(file, repoRoot), 'utf8'),
      / {2}refactor:\n {4}stages: \[request, proposal, specification, plan, log\]\n {4}review_required: true\n/,
      `${file} must activate specification for the refactor type`,
    );
  }
  assert.ok(
    fs
      .readFileSync(new URL('templates/contract/spec.md', repoRoot), 'utf8')
      .includes('| refactor | ✓ | — | ✓ | ✓ | ✓ | ✓ |'),
    'the default activation matrix must mark specification active for refactor',
  );
});

test('20260728-170429 CR2/CR6: the AGENTS.md budgets paragraph names the tokenizer unit, drops bytes/dual-publish and bans spending headroom', () => {
  const repoRoot = new URL('../', import.meta.url);
  const normalized = fs.readFileSync(new URL('AGENTS.md', repoRoot), 'utf8').replace(/\s+/g, ' ');

  const expectedParagraph =
    'Each entry in `templates/contract/budgets.yml` declares a `tokens` ceiling and ' +
    'a `lines` ceiling: tokens are counted by a pinned reference tokenizer, not by ' +
    'what a particular model consumes, and lines bound what the bootstrap `head` ' +
    'must carry. A ceiling is never a goal: never remove normative prose to fit ' +
    'one, and headroom under a ceiling is never permission to spend it — every ' +
    'entry into a context is deliberate and optimized. A rule may leave a fragment ' +
    'only when its new home is named and a grep of the obligation itself — not of ' +
    'similar words — finds it there. If correct content does not fit, stop and ask ' +
    'the human.';

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
