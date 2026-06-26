# Contributing to ChangeLedger

Thanks for your interest. ChangeLedger **dogfoods itself**: changes are planned
as documents under `.changeledger/` before code is written. Please follow the same flow.

## The flow

1. **Plan first.** Scaffold a change: `changeledger new <type> <slug> "<title>"`. Fill the
   stages your type activates (see [`AGENTS.md`](AGENTS.md)). Open `changeledger view` to
   read it rendered.
2. **Get it approved.** A change starts in `draft`. Don't implement until it's
   `approved` (the human's one move, in the viewer or by editing the file).
3. **Implement via TDD.** With `tdd: true`, write the failing test from each
   acceptance criterion (`CRn`), make it pass, refactor. Tick tasks as you go
   (`changeledger task <id> done <n>`) and move status with `changeledger status`.
4. **Independent review.** Types with `review_required` pass through `in-review`
   before `done` — a fresh, clean-context review verifies every `CRn` is met and
   no residue is left.
5. **Graduate the truth.** On `done`, update or create the affected `specs/`
   doc (`changeledger graduate ...`), or `--skip` when there's no persistent truth.

The full contract for agents is [`AGENTS.md`](AGENTS.md).

## Development setup

The repository uses **pnpm**, pinned through `packageManager`, and **Biome** for
linting and formatting:

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
frontmatter; the viewer uses `lit-html`, `marked`, `dompurify` and `mermaid` for
templating, Markdown, sanitization and diagrams.

## Quality gate

Every commit must pass the gate. Enable the hook and run it locally:

```sh
git config core.hooksPath hooks   # enable the pre-commit gate
pnpm verify                       # lint (Biome) + tests (node --test) + changeledger check
```

- **Atomic commits** referencing the change id: `feat(scope): description [#<id>]`.
- Commit messages in English, Conventional Commits, subject ≤ 50 chars.
- No `TODO`/`FIXME` or dead code in delivered work.

The versioned pre-commit hook runs `lint-staged`, `pnpm test` and `changeledger check`.
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
