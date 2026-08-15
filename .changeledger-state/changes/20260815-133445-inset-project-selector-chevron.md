---
id: "20260815-133445"
title: Separar el icono del selector de proyectos
type: quick
status: in-progress
created: 2026-08-15T13:34:45Z
depends_on: []
branch: quick/20260815-133445
related_to:
  - "20260627-111218"
owner: Roberto Ruiz
---

## Request

El chevron nativo del selector superior de proyectos queda pegado al borde
derecho, a diferencia de los filtros de tipo, owner y estado. Sustituirlo por un
chevron propio con el mismo margen derecho de 10 px y reservar su espacio sin
cambiar el comportamiento del `<select>`.

## Log

- **2026-08-15T13:34:45Z** `[note]` Borrador quick autorizado por separado. La causa es el indicador nativo del navegador, que no respeta de forma fiable el padding de `.filter`; se verificará con `test/viewer-metadata.test.mjs` y una comprobación visual del header.
- **2026-08-15T13:37:22Z** `[status]` draft → approved (human via conversation)
- **2026-08-15T14:29:32Z** `[status]` approved → in-progress
- **2026-08-15T14:29:32Z** `[branch]` set: quick/20260815-133445 (auto)
- **2026-08-15T14:38:58Z** `[note]` Implementación TDD completa: selector nativo conservado con chevron propio decorativo, appearance none, 34 px reservados e inset medido de 10 px. Regresión roja/verde y mutante 10→9 px; viewer-metadata 122/122 y pnpm verify 1478/1478.
