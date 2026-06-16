---
id: "20260616-174430"
title: Use AST parser for YAML mutation in writer
type: refactor
status: done
created: 2026-06-16T17:44:30Z
depends_on: []
owner: Roberto Ruiz
---

## Request
`src/writer.mjs` mutates YAML files using regular expressions: `/^status:.*$/m`. This will corrupt valid YAML files containing multiline strings or nested states.

## Proposal
Use a proper AST to manipulate the YAML frontmatter. The project already depends on `yaml`. By using `yaml.parseDocument()`, setting the node, and calling `.toString()`, the structure will remain intact.

## Plan
- [x] Load the frontmatter into memory with `yaml.parseDocument`. — 2026-06-16T20:49:50Z
- [x] Replace Regex substitutions inside `writer.mjs` methods. — 2026-06-16T20:49:53Z
- [x] Write integration tests proving it respects multiline YAML formats. — 2026-06-16T20:49:55Z

## Log
- **2026-06-16T20:47:01Z** — status: draft → approved
- **2026-06-16T20:48:39Z** — status: approved → in-progress
- **2026-06-16T20:48:39Z** — owner → Roberto Ruiz (auto)
- **2026-06-16T20:50:00Z** — status: in-progress → in-review
- **2026-06-16T20:59:32Z** — review → done (delegated subagent, clean context)
