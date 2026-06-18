---
id: "20260616-174432"
title: Split view command into domain and HTTP transport layers
type: refactor
status: done
created: 2026-06-16T17:44:32Z
depends_on: [ "20260616-174429" ]
owner: Roberto Ruiz
reviewed: true
archived: true
---

## Request
`src/commands/view.mjs` acts as a God Class holding logic for domain serialization, security validation, and raw HTTP Server routing.

## Proposal
Split `view.mjs` using SRP after the viewer data path is made async in
`20260616-174429`. Extract the HTTP and security layers out of the command logic
into a dedicated `src/viewer/server/` module structure, while keeping the public
`view()` command as the CLI bootstrap.

The refactor must preserve the existing exported behavior used by
`test/view.test.mjs`: local-host checks, write authorization, static asset
containment, vendor serving, and API response shapes.

## Plan
- [x] Move `createRequestListener`, request dispatch, and `staticFile` from `src/commands/view.mjs` into a `src/viewer/server/` router module covered by `test/view.test.mjs`. — 2026-06-16T20:57:39Z
- [x] Move `isLocalHost`, `isAuthorizedWrite`, and hostname parsing into a `src/viewer/server/` security module covered by the existing localhost/write-authorization tests. — 2026-06-16T20:57:42Z
- [x] Leave `src/commands/view.mjs` responsible for CLI argument parsing, token creation, server startup, and browser opening only. — 2026-06-16T20:57:45Z
- [x] Preserve the public exports needed by existing tests, either by re-exporting from `view.mjs` or updating tests to import the new modules directly. — 2026-06-16T20:57:48Z

## Log
- **2026-06-16T20:47:03Z** — status: draft → approved
- **2026-06-16T20:55:53Z** — status: approved → in-progress
- **2026-06-16T20:55:53Z** — owner → Roberto Ruiz (auto)
- **2026-06-16T20:57:51Z** — status: in-progress → in-review
- **2026-06-16T21:00:02Z** — review → in-progress (retry): view command still owns domain logic and router imports back from command module
- **2026-06-16T21:01:22Z** — status: in-progress → in-review
- **2026-06-16T21:02:41Z** — review → done (delegated subagent, clean context)
- **2026-06-16T21:03:56Z** — graduation skipped: no persistent spec change; internal viewer module split
- **2026-06-17T15:23:05Z** — archived
