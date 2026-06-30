# Closing Accepted Work

The human accepted this change. Resolve persistent truth before archiving.
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

Choose one graduation outcome:

- `changeledger graduate <id> <spec-slug>` creates a new spec seeded from the
  change's Specification and Proposal; refine its wording manually.
- `changeledger graduate <id> <spec-slug> --into` links an existing spec and
  refreshes `updated` without overwriting the spec body (the agent edits the body manually).
- `changeledger graduate <id> --skip [reason]` records that no persistent truth
  changed.
- `changeledger graduate --pending` lists accepted changes whose decision is
  unresolved.

Graduation and skip both set `reviewed: true` on the change: it means the
persistent-truth question was settled, not necessarily that a spec was created.
The graduation link remains derivable from the Log marker `graduado a spec`,
which carries the spec link, rather than from the boolean flag.

Operational inspection and visibility:

- `changeledger list [--status S] [--type T] [--json]`
- `changeledger show <id> [--json]`
- `changeledger archive <id>` / `changeledger unarchive <id>`

Use Mermaid where it communicates persistent relationships better than prose.
After closure, share a brief retrospective. New work needs a newly authorized
change; `done` never reopens.
