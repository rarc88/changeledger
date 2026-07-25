# ChangeLedger (`changeledger`)

> Turn conversations into buildable changes.

ChangeLedger is a local-first workflow for planning software changes with coding
agents before implementation begins. Features, bugs, audits and refactors become
reviewable documents with an enforced lifecycle, acceptance criteria, tasks and
persistent product truth.

Its human layer is a local viewer: instead of reading scattered Markdown files,
you get a searchable board across all registered projects, rendered
specifications and dependency diagrams.

## Quick start

ChangeLedger requires **Node.js 24 or newer**. Install the CLI globally:

```sh
npm install --global changeledger
# or: pnpm add --global changeledger
```

In a repository that already has an `AGENTS.md`:

```sh
changeledger init
changeledger view
```

`changeledger init` creates `.changeledger/`, gives the project a stable identity
and installs a small context bootstrap in the project-owned `AGENTS.md`. The
repository keeps only its configuration and documents; the CLI, viewer and
canonical contract fragments remain in the global package.

## The workflow

```text
conversation → draft → human approval → implementation → review
             → human validation → persistent specification
```

A typical change starts like this:

```sh
changeledger new feature oauth-login "Add OAuth login"
changeledger view
```

The agent completes the generated stages under `.changeledger/changes/`. You approve the
draft in the viewer before implementation. From there, ChangeLedger validates
lifecycle transitions, task traceability and the final human acceptance gate.
When the work is done, its lasting truth graduates into `.changeledger/specs/`.

The contract is agent-agnostic: Codex, Claude Code, opencode, Copilot, Cursor and
other tools discover it through the repository's `AGENTS.md` reference.

## Changes and specs

- **Changes** describe a delta: why it is needed, what was learned, the chosen
  design, acceptance criteria, implementation tasks and execution log.
- **Specs** describe the intended current system after completed changes
  graduate. They have no work lifecycle and remain concise, durable ChangeLedger
  product truth. Work performed without the CLI may diverge; observed drift is
  reported for human resolution rather than reconciled automatically.

With the default Definition of Ready policy, `changeledger check` verifies that acceptance
criteria are test-grade and mapped to actionable tasks. Repositories doing
exploratory work can set `tdd: false`; run `changeledger context spec` or
`changeledger context implement` for the complete task-specific rules.

## Essential commands

### Set up and inspect

```sh
changeledger init                         # initialize and register the current repository
changeledger register                     # refresh registration and the context bootstrap
changeledger view                         # view every registered project
changeledger view .                       # view only the current project
changeledger check [id]                   # validate the repository or one change
```

### Work with changes

```sh
changeledger new <type> <slug> <title>    # create a draft change
changeledger list [--status S] [--type T] [--owner NAME|--unowned]
changeledger list [--pending graduation|archive] [--archived|--all]
changeledger show <id> [--json]
changeledger status <id> <status>
changeledger task <id> done|block <n> [reason]
changeledger log <id> <message>
changeledger review <id> pass
changeledger review <id> fail --retry "<reason>"
changeledger review <id> fail --block "<reason>"
changeledger discard <id> <reason>
```

### Preserve completed truth

```sh
changeledger graduate <id> <spec-slug> --new     # create a marked scaffold; remains pending
# refine the scaffold and remove its marker
changeledger graduate <id> <spec-slug> --into    # finalize an existing refined spec
changeledger graduate <id> --skip [reason]       # record that no spec is needed
changeledger list --pending graduation --owner "Roberto Ruiz" # select personal decisions; resolve each id
changeledger list --pending archive --owner "Roberto Ruiz"    # preview the scoped bulk action
changeledger archive --graduated --owner "Roberto Ruiz"       # archive exactly that owner's candidates
changeledger archive --graduated                              # without a filter, archive every candidate
```

Run `changeledger --help` or `changeledger <command> --help` for the complete command reference.

## Shared state replica

Repositories activated with `authority.yml format_version: 2` keep changes,
specifications and release manifests in one committed ledger snapshot shared
through `refs/heads/changeledger/state`. The checked-out code branch is never
the ledger authority. Each clone reads internal `confirmed`, `observed` and
single-operation `pending` refs, so ordinary reads stay local and deterministic.

Authority itself is checkout-independent: `refs/changeledger/activation`, not
the worktree's `.changeledger/authority.yml`, is what every command resolves,
so it applies the same regardless of which branch or worktree is checked out.
The worktree file is transport only — read to bootstrap activation or detect a
tampered clone, never as an operative source once activation is installed. A
branch that predates the cutover, or a fresh clone that has not yet run
`state activate --install`, keeps loading in plain worktree mode; a clone of a
branch that already carries a v2 authority file but no activation ref fails
closed with `state authority format_version: 2 is not installed; run
\`changeledger state activate --install --integration-ref <full-ref>\`` instead
of silently guessing.

`format_version: 2` authority also carries `minimum_client_version`: every read
or mutation compares it against the running CLI's own version and fails closed
with `state authority requires client >= X` when the installed client is older.
This is a compatibility floor, not a network check — it runs entirely from the
local `authority.yml` and the CLI's own `package.json` version, so it applies
offline too. Resolve it by upgrading the CLI to at least the named version
(`npm install --global changeledger@latest` or the equivalent for however it was
installed), then re-run the command; the authority itself never needs editing.

```sh
changeledger state status               # inspect refs and freshness; no network
changeledger state sync                 # fetch, reconcile and publish when safe
changeledger state abort --pending      # verify the remote before discarding pending
changeledger state abort --pending --offline # discard only the local ref, explicitly
```

Online mutations synchronize before constructing the operation and publish its
successor with an ordinary fast-forward push. Add `--offline` to a mutating CLI
command only when intentionally creating one local pending operation. A second
mutation is rejected until that pending operation is synchronized or aborted.
The viewer exposes the same explicit “Sync state” action and never
refreshes over the network merely to render a page.

### Recoverable adoption

Adoption is reviewable and does not switch authority while collecting data. Use
full refs so no branch is discovered or preferred implicitly:

```sh
changeledger state migrate --preview \
  --source origin:refs/heads/dev \
  --source origin:refs/heads/feature/example \
  --source local:refs/heads/private \
  --output migration-plan.yml
# Resolve every divergent identity, explicit normalization and required
# replacement, then validate the edited plan without publishing.
changeledger state migrate --preview --plan migration-plan.yml
changeledger state migrate --create --plan migration-plan.yml
changeledger state activate --prepare --baseline <S0>
changeledger state doctor --activation-ref changeledger/activate-<S0-prefix>
changeledger state doctor --activation-ref changeledger/activate-<S0-prefix> --online
```

`--preview` fetches only explicitly named remote refs without updating user
branches or remote-tracking refs. `--preview --plan` reconstructs the complete
inventory and validates the resolved snapshot without publishing. `--create`
repeats those checks against the fixed source commits, rejects any stale
path/mode/blob or replacement, then publishes the initial state with create-only
CAS. Its manifest keeps every candidate and source OID—not only the selected
documents—so later cutover checks do not depend on the local plan.

`activate --prepare` removes the exact legacy inventory belonging to the fixed
integration commit, preserves every unrelated path, and creates one
deterministic local commit/ref without checkout, push or merge. A repeated
activation may reuse only that exact commit. Doctor reconstructs the expected
tree byte-for-byte; local mode also checks local source refs, while `--online`
observes the public baseline and remote sources. Review and merge the activation
branch through the repository's normal workflow.

Once the activation commit is merged into the integration branch, install it so
every worktree and clone shares the same authority:

```sh
changeledger state activate --install --integration-ref refs/heads/dev
```

`--install` resolves `<full-ref>`'s exact tip, verifies its authority matches
the baseline manifest (`project_id`, `inventory_digest`, `minimum_client_version`)
and fixes `refs/changeledger/activation` there with a create-or-match CAS —
repeating it once installed is a no-op, and a ref that has moved to a different
tip is rejected rather than silently replaced. `<full-ref>` must be
`refs/heads/<integration>` or `refs/remotes/<remote>/<integration>` naming the
configured `git.integration_branch`; a clone that already fetched the
integration branch (or its remote-tracking ref) needs no extra network access
to install. A branch checked out before the cutover ever ran installs from that
same integration ref exactly the same way — it does not need to already carry
`authority.yml`.

### Canceling a published baseline before cutover

`state migrate --create` publishes the initial baseline to the remote
`refs/heads/changeledger/state` before anyone has activated it — cutover only
happens later, when the reviewed activation commit is merged into the
integration ref. If the operator aborts between those two steps, the published
baseline is an orphan: safe to remove, but only while nothing has actually cut
over.

Before deleting it:

1. Confirm authority is still inactive: `git show <integration-ref>:.changeledger/authority.yml`
   on the integration branch (e.g. `origin/dev`) must still read
   `format_version: 1` (or be absent) — if it already reads `format_version: 2`,
   the activation commit has merged and this baseline is live; do not delete it.
2. Resolve any dependency on the migration first — an in-progress `state
   migrate`/`state activate` change or branch that still targets this baseline
   must be discarded or completed before the ref disappears under it.
3. Record the exact ref and OID you are about to remove
   (`git ls-remote origin refs/heads/changeledger/state`) so the deletion is
   attributable.
4. Delete only that exact ref, explicitly, on the remote:
   `git push origin --delete refs/heads/changeledger/state`. Never force-push a
   replacement over it — a future `migrate --create` publishes its own initial
   baseline with the same create-only CAS this command always uses.
5. Verify afterward: `git ls-remote origin refs/heads/changeledger/state`
   returns nothing, and `state status` in any clone that never activated shows
   no confirmed/observed/pending refs. A clone that already ran `state sync`
   against the removed baseline keeps its local replica; do not run `state
   sync` there again against a re-migrated baseline without repeating adoption
   from that clone.

This procedure only removes an unactivated baseline. It never touches a replica
that has already cut over — that path is a durable ledger and belongs to the
recovery procedure below, not to this cleanup.

### Optional remote enforcement after cutover

Integrity does not depend on this hook. Every client validates identity
continuity against the baseline pinned by the activation commit before it
confirms anything, on every provider, with no configuration: a published state
that dropped a change is refused at read time by the next clone that syncs,
including a fresh clone with no prior local state. What the hook adds is
availability — it rejects that push at write time, so the remote never gets
stuck holding a state nobody will adopt. It is an optional extra for operators
who run their own Git server, never a requirement for a release or a maturity
level.

Install it only after the activation commit is present on the integration ref. A
self-managed bare Git server can install the packaged `hooks/pre-receive` and set
both full refs explicitly:

```sh
export CHANGELEDGER_STATE_REF=refs/heads/changeledger/state
export CHANGELEDGER_INTEGRATION_REF=refs/heads/dev
cp hooks/pre-receive <bare-repository>/hooks/pre-receive
chmod +x <bare-repository>/hooks/pre-receive
```

The hook validates every incoming state snapshot from Git's receive quarantine,
including that no change, spec or release identity present in a parent snapshot
disappears from its child — archiving or discarding a document keeps it in its
collection, so only data loss or tampering trips this check. It also rejects
non-fast-forward integration updates and any commit that changes the active
authority or reintroduces legacy config, changes, specs or releases. A receipt
reporting that this contract held for the inspected snapshots is not an
authentication of who pushed them. There is no portable authenticated actor
identity: `owner` remains responsibility metadata, not an access-control list.
There is no actor, human-override, probe or provider-autodetection option.

#### Validation budget sizing

`state validate-update` and `state validate-receive` bound every push with
three fail-closed budgets: `--max-commits` (default 256), `--max-object-bytes`
(default 128 MiB of unique Git object content across the validated range) and
`--timeout-ms` (default 30000). The defaults are sized for the declared
profile — a batch of 256 commits over a 5,000-change ledger — which measures
about 68 million unique object bytes (dominated by per-commit tree objects,
not document blobs), leaving roughly 2× byte headroom on a stock install. That
envelope is a reproducible measurement, not a promised threshold: it was taken
at three repetitions per cell on a single machine, so treat it as a sizing aid
and measure your own profile before relying on the margin.
Reproduce the envelope with
`node scripts/bench-batch-validation.mjs --commits 256 --sizes 5000 --limits default`.
Repositories beyond that profile must resize the hook explicitly by adding the
flags to `hooks/pre-receive` (for example `--max-object-bytes 268435456`); a
rejected push names the exceeded budget in its receipt and never leaves
partial state on the server.

What is guaranteed, and where:

- **Every provider, no setup.** Identity continuity and descent from the pinned
  baseline, enforced client-side before any confirmation. This is the integrity
  guarantee, and it is the same on a self-managed server, on GitHub, GitLab or
  Bitbucket, and on a bare repository on a USB stick.
- **Your own Git server, with the hook installed.** The same contract also
  rejected at push time, so a bad state never lands on the remote.

ChangeLedger claims nothing about the policy engines of servers it does not
administer. It cannot read them portably, and a check performed by the pusher is
not enforcement. Provider branch protection and rulesets are worth enabling if
you have them, but ChangeLedger neither requires, detects nor reports on them —
and integrity does not depend on them.

`state validate-update` and `state validate-receive` emit human or `--json`
receipts with refs, OIDs, inspected commits/bytes, explicit `network: false` and
`written: false`, a `provider` field naming the topology that ran the check
(`local-validator` or `self-managed-git`), and a four-entry `capabilities`
block.

That `capabilities` block is deprecated and a later release removes it, here and
in `state doctor`, which prints the same four entries as `Capability:` lines.
Read it narrowly until then: `state validate-update` and `state doctor` populate
no evidence at all, so a **successful** run still reports `content_validation:
unavailable` alongside three other `unknown`/`unavailable` entries. Only the
hook path fills it in. Its graded values are a trust-level model ChangeLedger no
longer stands behind, and they were never a rating of any hosting provider. What
a validation actually proves is in the rest of the receipt: the refs, OIDs and
commit/byte counts it inspected, and the fact that it either accepted or
rejected fail-closed.

Add `--json` to migration, activation, doctor or recovery commands for a stable
success or failure receipt containing sources/OIDs, baseline, affected
branch/ref, inventory digest, network use and whether anything was written.

Before the first state mutation, reverting the activation commit restores the
legacy files. After state advances, synchronize first and prepare a recovery
branch from the confirmed head:

```sh
changeledger state sync
changeledger state export --recovery-branch
```

Recovery loads the exact confirmed OID, refuses pending or stale replicas and
atomically verifies all three replica refs while creating a collision-free local
branch. It never checks out, merges or publishes that branch. State status,
sync, abort and export validate authority against its baseline before reading or
mutating replica refs. These commands prove the cutover data and client version;
they do not enforce remote path policy against old clients or perform a
production rollout. Those remain separate deployment controls.

Once the recovery branch is merged into the integration ref and no longer
carries `.changeledger/authority.yml`, `--deactivate` is the inverse of
`--install`:

```sh
changeledger state activate --deactivate --integration-ref refs/heads/dev
```

It verifies the integration ref's tip is stable, that no `pending` replica
exists, and that `confirmed`/`observed` still agree, then removes
`refs/changeledger/activation`, `refs/changeledger/confirmed` and
`refs/changeledger/observed` together in one CAS transaction — all three absent
already is a no-op. The `changeledger/state` branch and its commits are never
deleted, so the recovered evidence stays reachable. Afterward every worktree
re-applies the same precedence: one with no authority file loads as plain
worktree, one that still carries a v2 `authority.yml` returns to bootstrap and
needs a fresh `--install` to resume state mode.

Remote protection deliberately rejects a normal push that removes
`.changeledger/authority.yml`, including a generated recovery branch. Recovery
therefore requires a visible provider-administration operation: temporarily
remove or bypass the integration protection rule, merge the reviewed recovery
commit, and immediately restore the rule/hook. No flag in a pushed payload can
bypass validation.

This protection is push/hook-scoped, not a local guarantee: it validates
snapshots as they cross the server's receive path, so it cannot see — and
cannot reject — a direct local edit or checkout that reverts `authority.yml` in
a clone. That local file remains ordinary, writable Git-tracked content; a
reverted or downgraded local authority is a client-side integrity problem, not
a bypass of the remote rule. Treat "the hook is installed" as a statement about
what the shared history can contain, never as a claim that every local clone's
current files are trustworthy.

## Release planning

ChangeLedger can calculate a portable SemVer release from completed changes
without assuming a package ecosystem:

```sh
changeledger release init 0.1.0       # adopt an existing published version once
changeledger release plan --json      # calculate the next version without writing
changeledger release record 0.2.0     # record the calculated release manifest
```

The CLI decides which changes belong to the release and calculates their
effective `release_impact`. The operating agent applies that version to the
project's own surfaces—`package.json`, `pubspec.yaml`, `Cargo.toml`, Gradle,
Xcode or a monorepo—then runs the local quality gates and release workflow.

## Repository integration

`changeledger check` exits non-zero on contract errors, so it can be used in Git hooks and
CI:

```sh
changeledger check || exit 1
```

The contract ships as task-focused fragments and is compiled on demand:

```sh
changeledger context                    # minimal non-negotiable core
changeledger context <change-id>        # lifecycle-aware rules + selected change
changeledger context review             # explicit task mode
changeledger agent-prompt <role>         # portable delegation skeleton
changeledger agent-context <role> [id]  # self-contained context for that delegate
```

`init` places a small optional-discovery bootstrap in the project-owned
`AGENTS.md`; there is no linked or copied contract under `.changeledger/`. Run
`changeledger register` after upgrading to refresh that bootstrap. An agent
attempts `changeledger context` and, on success, immediately captures its full
output through the END sentinel. When the command is unavailable it continues
normally without ChangeLedger; when the executable fails it reports the error
for human direction. A retained revision is checked with `--have <rev>` after
compaction.

Roles are `investigation`, `implementation`, `review` and `audit`. `audit` is a
read-only inspection of a change already in `in-validation` — after review has
already passed — for a human or orchestrator to consult before accepting or
rejecting it; it never moves the change or records a verdict. Each generated
delegation prompt explicitly replaces the bootstrap's default context load with
its specialized `agent-context` command.

### Upgrading an existing repo's configuration

Repos created before ChangeLedger 0.6 may have an older configuration schema.
Run this to inspect and apply available migrations:

```sh
changeledger config migrate --dry-run   # preview changes without writing
changeledger config migrate             # apply atomically
changeledger check                      # confirm the repo is valid
```

Migrations are safe to run more than once — if the config is already current,
the command reports so and exits without modifying any file.

## Compatibility and security

- Node.js **24+**.
- Tested on Linux, macOS and Windows.
- No symlink privileges are required on Windows; context fragments remain in the
  installed package and the CLI prints them on demand.
- The viewer binds to loopback and treats repository content as untrusted input.
  See [`SECURITY.md`](SECURITY.md) for the threat model and private reporting
  instructions.

## Project status

ChangeLedger is usable and self-hosting, but remains **pre-1.0**. Expect the
contract and CLI to evolve while the core workflow settles. Upgrade to the
latest `0.x` release to receive fixes.

Contributions are welcome. Development setup, quality gates and repository
conventions live in [`CONTRIBUTING.md`](CONTRIBUTING.md). The canonical agent
contract is composed from [`templates/contract/`](templates/contract/).

## Language policy

Structure is always English: frontmatter keys, enum values, stage headings, CLI
commands and filenames. Generated content follows the repository's configured
`language`.
