---
id: "20260711-155719"
title: El Clear de type/owner no desmarca los checkboxes
type: quick
status: done
created: 2026-07-11T15:57:19Z
depends_on: [ "20260710-105206" ]
owner: raruiz-hiberuscom
---

## Request

En los popovers de filtro Type y Owner, pulsar `Clear` limpia el estado (los
changes vuelven a verse sin filtrar) pero los checkboxes y el resumen del
trigger quedan visualmente marcados. Causa: el handler de
`renderChoiceFilter` (`src/viewer/public/app.js`) limpia los Sets y llama a
`render()`, que solo re-renderiza la vista actual, nunca el DOM del popover.
El filtro Status ya lo hace bien: su Clear resetea `input.checked` y el texto
del resumen antes de `render()`. Arreglo: aplicar ese mismo patrón a los Clear
de Type y Owner, con cobertura en `test/viewer-metadata.test.mjs` si el
template lo permite. Un solo concern, reversible, sin superficie nueva.

La validación humana detectó el síntoma hermano de la misma preocupación
(sincronía visual de los filtros choice): el `onchange` de Type/Owner tampoco
actualiza el texto del trigger — solo cambia el Set y llama a `render()`, así
que el resumen queda obsoleto hasta que el poll de datos re-ejecuta
`hydrateFilters()`. Status sí actualiza `[data-status-summary]` en cada
`onchange`. Arreglo: espejar ese patrón en el `onchange` de los checkboxes de
choice y de `Unassigned`.

## Log
- **2026-07-11T16:12:18Z** — status: draft → approved
- **2026-07-11T16:20:09Z** — status: approved → in-progress
- **2026-07-11T16:20:09Z** — owner → raruiz-hiberuscom (auto)
- **2026-07-11T16:28:00Z** — Integrada implementación delegada (3514007): Clear de Type/Owner resetea checkboxes y resumen del trigger (patrón del filtro Status). pnpm verify 607/607.
- **2026-07-11T16:28:00Z** — status: in-progress → in-validation
- **2026-07-11T20:49:49Z** — validation → in-progress (agent rejected): Validación humana: Clear quedó arreglado pero el onchange de Type/Owner sigue sin reflejar la selección en el trigger (solo se refresca en el poll). Misma preocupación: sincronía visual de los filtros choice.
- **2026-07-11T20:52:20Z** — Rechazo en validación: extendido Request al onchange (mismo concern). Corrección sin commitear en app.js; comparte worktree con la iteración de 20260711-155721 (ficheros disjuntos).
- **2026-07-11T20:56:35Z** — status: in-progress → in-validation
- **2026-07-11T21:39:35Z** — validation → done (human accepted)
