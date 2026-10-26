---
id: "20261026-165918"
title: El diagrama de arquitectura enumera cuatro vistas y hay cinco
type: change
status: in-progress
created: 2026-10-26T16:59:18Z
depends_on: []
branch: change/20261026-165918
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

### Proposal

La línea enumera las vistas en el orden en que el visor las ofrece, así que
`projects` entra al final, detrás de `metrics`. No se reordenan las otras ni se
cambia la forma del nodo: el diagrama es verdad persistente sobre la
arquitectura, no sobre la presentación, y cuanto menos se toque menos ruido
genera en la siguiente lectura.

Descartado sustituir la enumeración por algo que no haya que mantener —un
`UI[visor]` a secas, o un recuento— porque el valor de la línea es justamente
decir cuáles son: quien lee el diagrama no tiene el código delante.

### CR1 — El diagrama nombra las cinco vistas

- **Given** `spec:architecture`
- **When** se lee la línea del nodo `UI` que enumera las vistas del visor
- **Then** nombra `board`, `table`, `Ledger`, `metrics` y `projects`
- **And** las cinco coinciden con `VALID_VIEWS` de `src/viewer/public/app-state.js` y con `VIEWS` de `src/viewer/public/app.js`

### CR2 — El diagrama sigue siendo mermaid válido y nada más cambia

- **Given** el bloque mermaid de `spec:architecture`
- **When** se compara con su versión anterior
- **Then** la única diferencia es el contenido entre corchetes de ese nodo: la flecha, el identificador `UI`, los `subgraph` y el resto de aristas quedan igual
- **And** `changeledger check` pasa

## Plan

- [x] Añadir `projects` a la enumeración del nodo `UI`
  - **Target:** `spec:architecture`
  - **Verify:** `changeledger check`
  - **Criteria:** CR1, CR2
  - **Resolved:** `2026-10-26T17:23:15Z`
- [ ] Pasar la puerta local completa
  - **Support:** `pnpm verify`

## Log
- **2026-10-26T16:59:18Z** `[version]` 1.0.0
- **2026-10-26T17:01:09Z** `[status]` draft → approved (human via conversation)
- **2026-10-26T17:22:09Z** `[status]` approved → in-progress
- **2026-10-26T17:22:09Z** `[branch]` set: change/20261026-165918 (auto)
