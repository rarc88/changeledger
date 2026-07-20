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
graduated_from: []
---
```

Choose exactly one explicit graduation mode. A positional slug without a mode
is an error, so words such as `skip` or `skip-*` can never silently become specs.

For a new spec, follow this ordered recipe — `--new` alone does not finish it:

1. `changeledger graduate <id> <spec-slug> --new` creates a seed from the
   change's Specification or Proposal but leaves graduation pending; it does not
   set `reviewed: true`.
2. Rewrite the seed as concise durable current truth and remove the explicit
   scaffold marker.
3. `changeledger graduate <id> <spec-slug> --into` finalizes it; `--into`
   refuses an unrefined marked scaffold and sets `reviewed: true`.

Alternatives to the two-step:

- For an existing spec, edit its body first, then run
  `changeledger graduate <id> <spec-slug> --into`. It refreshes `updated`, records
  the link, does not overwrite the body and sets `reviewed: true`.
- `changeledger graduate <id> --skip [reason]` records that no persistent truth
  changed and sets `reviewed: true`.
- `changeledger list --pending graduation` lists accepted changes whose decision is
  unresolved.

`reviewed: true` means the persistent-truth question was settled, not necessarily
that a spec was created. `--into` records the same link in both directions: the
change Log carries `graduado a spec`, and the target spec appends the change id to
`graduated_from`. `changeledger check` requires both sides to agree. Repositories
with legacy prose markers can migrate them deterministically with
`changeledger fix --graduation-links` (or preview with `--dry-run`).

After `--into` or `--skip`, create one final closure commit that coalesces any
pending `in-review → in-validation → done` ledger updates with the graduation
decision and durable spec edit. Do not create separate commits whose only
content is one of those transitions. If no lifecycle state is pending, the
graduation or skip itself remains the meaningful closure evidence.

Operational inspection and visibility:

- `changeledger list [--status S] [--type T] [--owner NAME|--unowned] [--pending graduation|archive] [--archived|--all] [--json]`
- `changeledger list --pending graduation --owner NAME` scopes a multi-change request, but every returned id is resolved individually with `graduate --new`, `--into` or `--skip`; graduation is never a bulk mutation.
- `changeledger list --pending archive [--owner NAME|--unowned]` previews the exact candidates for `changeledger archive --graduated [--owner NAME|--unowned]` when both commands use the same filter. Without a filter, the action keeps its repository-wide behavior.
- `changeledger show <id> [--json]`
- `changeledger archive <id>` (reversible by manually editing `archived: false` in frontmatter)

Use Mermaid where it communicates persistent relationships better than prose.
After closure, share a brief retrospective. New work needs a newly authorized
change; graduated, skipped, archived or released work never reopens.
