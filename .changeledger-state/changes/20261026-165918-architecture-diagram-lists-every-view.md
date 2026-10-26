---
id: "20261026-165918"
title: El diagrama de arquitectura enumera cuatro vistas y hay cinco
type: change
status: approved
created: 2026-10-26T16:59:18Z
depends_on: []
related_to: ["20261026-145217"]
owner: raruiz-hiberuscom
tdd: false
release_impact: none
---

## Request

Promueve el finding F2 de `#20261026-145217`: la línea 43 del diagrama de
`spec:architecture` enumera las vistas del visor y le falta una.

### Investigation

La línea dice `SRV --> UI[visor: board / table / Ledger / metrics]`, y el visor
tiene cinco vistas: board, table, Ledger, metrics y projects.

La omisión es anterior al change que retiró la vista Graph. Rastreada con
`git log -G'SRV --> UI'` sobre la ref del ledger: el commit `29ca6e50`
introdujo la línea ya sin `projects`, y el único otro commit que la toca es el
de `#20261026-145217`, que solo retiró `graph`. Nunca estuvo.

Por eso aquel change no la arregló: su frontera cubría corregir lo que esa
retirada dejaba falso, y esto es divergencia preexistente. El contrato pide
reportarla, no reconciliarla por inferencia dentro de otro trabajo.

El cuerpo de `viewer.md` sí describe las cinco vistas correctamente, así que la
divergencia está acotada a esa línea del diagrama.

`tdd: false` porque el change no entrega comportamiento que un test pueda
ejercitar: toca un documento del ledger y nada más.

### Objective

El diagrama de `spec:architecture` enumera las cinco vistas que el visor
ofrece. Está terminado cuando la línea las nombra, el diagrama sigue siendo
mermaid válido y `changeledger check` pasa.

### Frontier

Dentro: la línea del diagrama de `spec:architecture` que enumera las vistas del
visor.

Fuera: cualquier otra afirmación de esa spec, que no se revisa aquí; el cuerpo
de `viewer.md`, que ya es correcto; y el código del visor, que no cambia.

## Specification

## Plan

## Log
- **2026-10-26T16:59:18Z** `[version]` 1.0.0
- **2026-10-26T17:01:09Z** `[status]` draft → approved (human via conversation)
