---
id: "20260809-140157"
title: Avisar la causa cuando el import no ve documentos
type: quick
status: done
created: 2026-08-09T14:01:57Z
depends_on: ["20260809-113241"]
reviewed: true
branch: quick/20260809-140157
related_to: []
owner: rarc88
---

## Request

Follow-up del review de `20260809-113241`, decisión de política tomada con el
humano el 2026-08-09: cuando `import --from <ref>` no ve documentos porque el
`config.yml` del propio source declara un layout distinto al del snapshot
(p. ej. `changes_dir` recolocado), avisar por stderr nombrando la causa —
"el source declara `changes_dir: <X>`; este repo lee `<Y>` — esos documentos
no se importan" — manteniendo el exit 0 y el mensaje honesto actual (la
scriptabilidad idempotente de CR2 no cambia; un error rompería al rezagado
legítimo que solo absorbe lo visible). En la misma pasada, alinear el texto de
help del comando en `bin/changeledger.mjs`: hoy promete que "valida el source
entero" y la autoridad real de layout y reglas es el config del snapshot.
Superficie: `src/commands/import.mjs`, `bin/changeledger.mjs` (solo help) y
`test/import.test.mjs`.

## Log
- **2026-08-09T16:18:33Z** `[status]` draft → approved (human via conversation)
- **2026-08-09T16:22:39Z** `[status]` approved → in-progress
- **2026-08-09T16:22:39Z** `[branch]` set: quick/20260809-140157 (auto)
- **2026-08-09T17:28:02Z** `[note]` Implementación TDD completada: import 18/18, help 9/9 y pnpm verify 1323/1323; el mismatch avisa por stderr sin mover la ref ni cambiar exit 0.
- **2026-08-09T17:28:39Z** `[status]` in-progress → in-validation
- **2026-08-09T19:37:00Z** `[validation]` in-validation → done (human accepted via conversation)
- **2026-08-09T19:39:45Z** `[graduation]` spec: `architecture.md`
- **2026-08-09T19:40:10Z** `[note]` Cierre: graduado a architecture.md en commit combinado con 113242/171107/234920/131004/140157 — la spec es superficie compartida de los cinco y separar la reconciliación era imposible sin cinco ediciones en conflicto.
