---
id: "20260711-155719"
title: El Clear de type/owner no desmarca los checkboxes
type: quick
status: in-progress
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

## Log
- **2026-07-11T16:12:18Z** — status: draft → approved
- **2026-07-11T16:20:09Z** — status: approved → in-progress
- **2026-07-11T16:20:09Z** — owner → raruiz-hiberuscom (auto)
