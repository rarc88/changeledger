---
id: "20260810-181803"
title: Endurecer el contrato tri-estado de options.snapshot
type: quick
status: in-progress
created: 2026-08-10T18:18:03Z
depends_on: []
branch: quick/20260810-181803
related_to: ["20260809-194235", "20260810-010554"]
owner: claude
---

## Request

Residuo anotado al cerrar `20260809-194235`: el contrato tri-estado de
`options.snapshot` en `loadRepoWithConfig` (ausente = resuélvelo tú; null =
inactivo; objeto = sírvelo) tiene al menos un punto decidido por truthiness
en lugar de `=== undefined`, con lo que un caller que pase un valor falsy
distinto de null (0, '') tomaría la rama equivocada en silencio.

Verificar primero el sitio exacto contra el código de hoy — el informe de
`20260810-010554` sugiere que parte ya está guardada con `=== undefined` —
y cerrar la clase: la decisión por identidad estricta en una sola
definición, con el test del borde falsy que hoy falta. Si al verificar
resulta que la clase ya está cerrada, registrar la comprobación y descartar
este change con esa razón.

## Log
- **2026-08-10T21:36:16Z** `[status]` draft → approved (human via conversation)
- **2026-08-10T21:38:52Z** `[status]` approved → in-progress
- **2026-08-10T21:38:52Z** `[branch]` set: quick/20260810-181803 (auto)
- **2026-08-10T21:38:52Z** `[owner]` set: claude
- **2026-08-10T21:41:06Z** `[note]` Verificado primero: la resolución ya usaba === undefined (repo.mjs); el punto por truthiness era la decisión de servir (if (snapshot)). Cerrado con guard explícito fail-fast (objeto o null) + pin con los tres bordes falsy (0, '', false), visto fallar antes del fix con 'snapshot=0 must be refused'. Gate 1396/1396
