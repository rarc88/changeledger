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
             → done (merge = acceptance) → persistent specification
```

A typical change starts like this:

```sh
changeledger new change oauth-login "Add OAuth login"
changeledger view
```

There are two types: `change` implements and `epic` groups several changes. The
agent drafts the change under `.changeledger/changes/`, stating its objective and
its frontier in the Request. You approve the objective and the frontier of the draft in
the viewer before implementation; the agent then writes the Specification and Plan with
the code in front. From there, ChangeLedger validates
lifecycle transitions and task traceability; the merge is the acceptance.
A `change` goes from `in-progress` to `done` directly only when git shows that neither
its unmerged branch nor the uncommitted paths of its checkout touch anything outside
the ledger; any other `change` goes through `in-review` and reaches `done` with
`changeledger review <id> pass`. When the work is done, its lasting truth graduates
into `.changeledger/specs/`.

The contract is agent-agnostic: Codex, Claude Code, opencode, Copilot, Cursor and
other tools discover it through the repository's `AGENTS.md` reference.

## Changes and specs

- **Changes** describe a delta: why it is needed, what was learned, the chosen
  design, acceptance criteria, implementation tasks and execution log.
- **Specs** describe the intended current system after completed changes
  graduate. They have no work lifecycle and remain concise, durable ChangeLedger
  product truth. Work performed without the CLI may diverge; observed drift is
  reported for human resolution rather than reconciled automatically.

With the default `tdd: true`, the implementer writes each criterion's failing test
before the code, and moving a change to `in-review` requires a Specification with at
least one acceptance criterion and a Plan. Repositories doing exploratory work can set
`tdd: false` in the configuration; a change that delivers no behaviour a test can
exercise declares `tdd: false` in its own frontmatter. A defect fixed on the release
branch declares `integrates_into: release` in its frontmatter. Run
`changeledger context spec` or `changeledger context implement` for the complete
task-specific rules.

## Essential commands

### Set up and inspect

```sh
changeledger init                         # initialize and register the current repository
changeledger register                     # refresh registration and the context bootstrap
changeledger view                         # view every registered project
changeledger view .                       # view only the current project
changeledger check [id]                   # validate the repository or one change
changeledger analyze [id] [--by K]        # token use and cost from the usage records (--json)
```

### Work with changes

```sh
changeledger new change|epic <slug> <title> # create a draft change
changeledger list [--status S] [--type T] [--owner NAME|--unowned]
changeledger list [--pending graduation|archive] [--archived|--all]
changeledger show <id> [--json]
changeledger status <id> <status>
changeledger task <id> done|block <n> [reason]
changeledger log <id> <message>
changeledger review <id> pass
changeledger review <id> fail "<reason>"
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

## Release planning

ChangeLedger can calculate a portable SemVer release from completed changes
without assuming a package ecosystem:

```sh
changeledger release init 0.1.0       # adopt an existing published version once
changeledger release plan --json      # calculate the next version without writing
changeledger release record 0.2.0     # record the calculated release manifest
```

The CLI decides which changes belong to the release and calculates their
effective `release_impact`: the configured `release.default_impact` unless a change
declares its own. The operating agent applies that version to the
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
for human direction.

Roles are `investigation`, `implementation`, `review` and
`graduation-review`; all but `implementation` are read-only.
`graduation-review` is a read-only check of the spec
reconciliation drafted for a change already `done`, before the first `--into`;
it never moves the change either. Each generated
delegation prompt explicitly replaces the bootstrap's default context load with
its specialized `agent-context` command.

### Upgrading an existing repo's configuration

`changeledger check` warns when the configuration is at an older schema and
names what remains to migrate. `changeledger config migrate` takes the
configuration from schema 6 to 7: it removes `types`, `stages`,
`release.impacts`, `readiness` and the retired statuses, and declares
`release.default_impact`. `changeledger fix` then rewrites the live documents: a
retired type becomes `change`, and `## Investigation` and `## Proposal` fold
under the Request as `###` subsections. What a retired type implied — its release
impact, `integrates_into: release` for `hotfix`, `tdd: false` for `documentation` —
is written into the frontmatter unless the document already declares it, and a
`type:` line `fix` cannot read is listed for a manual fix. `fix` migrates no archived
or discarded document; the format repairs still apply to them.

```sh
changeledger config migrate --dry-run   # preview changes without writing
changeledger config migrate             # apply atomically
changeledger fix --dry-run              # preview the live-document repairs
changeledger fix                        # apply them
changeledger check                      # confirm the repo is valid
```

Both are safe to run more than once — if nothing is left to migrate, the
command reports so and exits without modifying any file. A schema older than 6
is refused, and the error names the ChangeLedger version that migrates it.

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
