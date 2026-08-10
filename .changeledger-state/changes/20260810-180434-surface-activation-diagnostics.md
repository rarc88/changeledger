---
id: "20260810-180434"
title: Sacar a la superficie los diagnósticos de activación
type: quick
status: in-validation
created: 2026-08-10T18:04:34Z
depends_on: []
branch: quick/20260810-180434
related_to: ["20260810-120457"]
owner: claude
---

## Request

Dos hallazgos del review de `20260810-120457`, ambos en los diagnósticos de
la activación pre-ancla:

- `registry.listProjects` traga cualquier error del probe antes de resolver
  `activated`, así que una activación legacy (sin `ledger_dir`) se lista
  como repo inactivo con el nombre cacheado stale, mientras el CLI (exit 1)
  y el viewer (400) sí muestran el error accionable de re-activación. El
  listado debe distinguir "no activado" de "activación ilegible" sin perder
  su tolerancia a rutas registradas inutilizables.
- El throw defensivo de activate (`cannot activate <root>: it is not inside
  a Git repository`) es inalcanzable desde sus dos callers y no tiene test:
  retirarlo, o hacerlo alcanzable y pinearlo — nunca dejarlo como código
  muerto defensivo.

Test-only más un ajuste acotado de `registry.mjs`; sin superficie pública
nueva ni verdad persistente.

## Log
- **2026-08-10T21:36:16Z** `[status]` draft → approved (human via conversation)
- **2026-08-10T22:35:36Z** `[status]` approved → in-progress
- **2026-08-10T22:35:36Z** `[branch]` set: quick/20260810-180434 (auto)
- **2026-08-10T22:35:37Z** `[owner]` set: claude
- **2026-08-10T22:42:52Z** `[note]` Implemented both review findings from #20260810-120457. (1) registry.listProjects: split the repoIsActivated probe into its own try/catch after the statSync directory check, so an activation error (e.g. a legacy authority.yml with no ledger_dir) surfaces as an `activationError` field on the entry instead of being swallowed by the pre-existing catch-all (which never saw it — `activated` is only assigned on a successful, non-throwing return, so `if (activated) throw error` never fired for this case). The prior tolerance for unusable registered paths (missing, replaced-by-file, unreadable-ancestor) is untouched and still green: test/registry.test.mjs '194234 CR3' and both '20260809-113242 CR12' tests pass unchanged. New test: '20260810-180434: listProjects reports an unreadable legacy activation instead of silently listing inactive'. (2) writeActivation's "not inside a Git repository" throw (src/state-store.mjs): confirmed unreachable from both CLI callers (activate.mjs's readStateRef, cutover.mjs's resolveContext rev-parse both already fail first on a non-Git repoRoot — verified by hand against a scratch non-Git directory) but reachable and meaningful as writeActivation's own exported precondition (it guards against writing `ledger_dir: null` into the activation authority). Chose to pin rather than retire: added test/state-store.test.mjs '20260810-180434: writeActivation refuses a repoRoot outside any Git repository', calling writeActivation directly on a non-Git temp dir. Both new tests were shown failing with their literal output before the fix/pin, and one isolated mutant per pin was killed then reverted by hand (file diff confirmed clean between mutants). Gate: pnpm lint exit 0, pnpm test 1401/1401 pass exit 0, changeledger check exit 0. Unspecified decisions: (a) field name activationError on the registry entry — smallest addition the viewer (resolveProjects/router.mjs) already ignores gracefully via object spread/JSON.stringify, no renderer references it; (b) for finding 2, pinned the guard via a direct unit test of the exported function rather than retiring it, since removal would let a future direct caller silently write a malformed ledger_dir: null instead of failing fast.
- **2026-08-10T22:44:38Z** `[status]` in-progress → in-validation
