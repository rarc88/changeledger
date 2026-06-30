# Closing Accepted Work

The human accepted this change. Resolve persistent truth before archiving. Run
`changeledger context <id>` after acceptance even if the base context was loaded
earlier; this lifecycle-specific close overlay is not part of the base context.
Changes describe a journey; `.changeledger/specs/*.md` describe the current
capability, architecture or domain truth that code reflects.

Specs have no lifecycle or `status`. They use minimal frontmatter and free
Markdown:

```yaml
---
title: Short title
updated: 2026-06-30T10:00:00Z
tags: []
---
```

Choose exactly one explicit graduation mode. A positional slug without a mode
is an error, so words such as `skip` or `skip-*` can never silently become specs.

- For a new spec, run `changeledger graduate <id> <spec-slug> --new`. This creates
  a seed from the change's Specification or Proposal but leaves graduation
  pending. Rewrite it as concise durable current truth and remove the explicit
  scaffold marker. Then run `changeledger graduate <id> <spec-slug> --into` to
  finalize it. `--into` refuses an unrefined marked scaffold.
- For an existing spec, the agent edits its body first, then runs
  `changeledger graduate <id> <spec-slug> --into`. It refreshes `updated`, records
  the link and does not overwrite the body.
- `changeledger graduate <id> --skip [reason]` records that no persistent truth
  changed.
- `changeledger graduate --pending` lists accepted changes whose decision is
  unresolved.

Finalization with `--into` and skip both set `reviewed: true` on the change;
`--new` does not. The boolean means the persistent-truth question was settled,
not necessarily that a spec was created.
The graduation link remains derivable from the Log marker `graduado a spec`,
which carries the spec link, rather than from the boolean flag.

Operational inspection and visibility:

- `changeledger list [--status S] [--type T] [--json]`
- `changeledger show <id> [--json]`
- `changeledger archive <id>` / `changeledger unarchive <id>`

Use Mermaid where it communicates persistent relationships better than prose.
After closure, share a brief retrospective. New work needs a newly authorized
change; `done` never reopens.
