# Contributing to ChangeLedger

Thanks for your interest. ChangeLedger **dogfoods itself**: changes are planned
as documents under `.changeledger/` before code is written. Please follow the same flow.

## The flow

1. **Plan first.** Scaffold a change: `changeledger new change <slug> "<title>"`. Fill its
   objective and frontier (see [`AGENTS.md`](AGENTS.md)). Open `changeledger view` to
   read it rendered.
2. **Get it approved.** A change starts in `draft`. Don't implement until it's
   `approved` (the human's one move, in the viewer or by editing the file).
3. **Implement via TDD.** With `tdd: true`, write the failing test from each
   acceptance criterion (`CRn`), make it pass, refactor. Name each test for the behaviour
   it proves, not `<id> CRn`: the reference runs from the change to the code through the
   Plan's `Target` and `Verify` and the `[#id]` commit marker. Tick tasks as you go
   (`changeledger task <id> done <n>`) and move status with `changeledger status`.
4. **Independent review.** A `change` passes through `in-review` before `done` — a
   fresh, clean-context review verifies the behaviour the Specification declares and that
   no residue is left — except for a ledger-only change. Direct `done` requires that its
   branch and its uncommitted paths touch nothing outside the ledger and that none of its marked
   `[#id]` commits has reached the integration branch yet; whenever git cannot tell,
   the gate refuses and names the cause.
5. **Graduate the truth.** On `done`, update or create the affected `specs/`
   doc (`changeledger graduate ...`), or `--skip` when there's no persistent truth.

The full contract for agents is [`AGENTS.md`](AGENTS.md).

## Development setup

The repository uses **pnpm**, with its minimum version in
`devEngines.packageManager`, and **Biome** for linting and formatting:

```sh
pnpm install
pnpm lint
pnpm format
pnpm test
pnpm verify
```

The CLI core stays intentionally lightweight and mostly standard-library based.
Runtime dependencies are welcome only when they are mature and reduce real
maintenance or security risk. The CLI uses `yaml` for configuration and
frontmatter, and `commander` as a mature CLI parser that centralizes arguments,
options, subcommands, errors and help; the viewer uses `lit-html`, `marked`,
`dompurify` and `mermaid` for templating, Markdown, sanitization and diagrams.

## Quality gate

Every commit must pass the gate. Enable the hook and run it locally:

```sh
git config core.hooksPath hooks   # enable the pre-commit gate
pnpm verify                       # lint (Biome) + tests (node --test) + changeledger check
```

- **Atomic commits** referencing the change id: `feat(scope): description [#<id>]`.
- Commit messages in English, Conventional Commits, subject ≤ 50 chars.
- No `TODO`/`FIXME` or dead code in delivered work.

The versioned pre-commit hook runs `lint-staged`, `hooks/no-ledger-refs.sh --cached`,
`pnpm test` and `changeledger check`. `no-ledger-refs.sh` rejects an added line outside
`.changeledger/` (`.changeledger-state/` and `templates/contract/spec.md` are exempt) that
holds a change id or a `CRn`, naming file and line; CI runs it on
pull requests (Linux and macOS legs) over `origin/dev...HEAD`. Existing references stay as they are.
`lint-staged` formats only staged JavaScript, JSON and CSS files while preserving
partial commits; `pnpm verify` remains the complete manual and CI gate.

## Use a checkout as the global CLI

To exercise local edits through the same `changeledger` command used by installed
consumers:

```sh
pnpm link --global
changeledger --help
pnpm unlink --global
```

## Coverage and dependency audits

`pnpm test` is the fast cycle. For a coverage snapshot run `pnpm test:coverage`
(uses `--experimental-test-coverage`) — diagnostic only, not a gate.

Dependency advisories are checked with `pnpm audit:deps` (wraps `pnpm audit
--audit-level moderate`). Note: this sends lockfile metadata to the npm registry.
Run it before publishing a release or on a scheduled CI job; do not add it to
`pnpm verify` unless that trade-off is explicitly accepted.

## Reporting security issues

See [`SECURITY.md`](SECURITY.md) — report vulnerabilities privately, not as a
public issue.
