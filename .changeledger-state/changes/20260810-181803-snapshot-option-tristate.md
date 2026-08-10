---
id: "20260810-181803"
title: Endurecer el contrato tri-estado de options.snapshot
type: quick
status: draft
created: 2026-08-10T18:18:03Z
depends_on: []
related_to: ["20260809-194235"]
owner: rarc88
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
