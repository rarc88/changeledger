---
id: "20261012-125604"
title: El viewer no presenta datos de otro proyecto mientras carga el seleccionado
type: bug
status: in-review
created: 2026-10-12T12:56:04Z
depends_on: []
branch: bug/20261012-125604
related_to: ["20261007-172305", "20261007-135148"]
owner: rarc88
---

## Request

Las revisiones de `20261007-172305` y `20261007-135148` dejaron tres casos en los
que el viewer muestra datos que no son del proyecto seleccionado:

- con un proyecto A cargado, al seleccionar otro proyecto C, mientras la carga
  de C está en vuelo una búsqueda o un cambio de vista vuelve a pintar los
  changes de A con C seleccionado;
- tras fallar la carga de un proyecto B seleccionado desde A, los filtros (tipos,
  owners) siguen ofreciendo los valores de A;
- mientras la primera carga de un proyecto seleccionado está en vuelo, la vista
  muestra `No projects registered. Run changeledger init in a repo.`

Se pide que el viewer no presente datos o estados de otro proyecto como del
seleccionado: mientras su carga está en vuelo, la vista lo dice.

## Investigation

En `src/viewer/public/app-state.js`, `selectProject` limpia `lastJson` y
`loadError` pero conserva `state.repo`. En `src/viewer/public/app.js`, la guarda
de `render()` pinta el error de carga sólo si hay `loadError` y `state.repo` es
nulo o de otro proyecto, y pinta el mensaje de «sin proyectos» si `state.repo`
es nulo; con la carga de C en vuelo no hay `loadError`, así que `render()` pinta
`state.repo` de A. `hydrateFilters` sólo corre en `applyLoadedRepo`, de modo que
un fallo de carga no rehace los filtros. La revisión de `20261007-172305`
reprodujo el primer caso en JSDOM y el segundo lo razonó desde el código.

Interfaces externas: ninguna.

## Specification

### CR1 — Un payload de otro proyecto no se pinta mientras carga el seleccionado
- **Given** el viewer con el proyecto A cargado y la carga de C seleccionado todavía en vuelo
- **When** se escribe en la búsqueda y se activan `board`, `table`, `graph`, `ledger` y `metrics`
- **Then** ninguna vista muestra changes de A y cada una muestra `Loading project…`

### CR2 — La primera carga en vuelo no dice que no hay proyectos
- **Given** el viewer con un proyecto seleccionado, sin payload cargado y su primera carga en vuelo
- **When** se activa la vista `metrics`
- **Then** muestra `Loading project…` y no `No projects registered`

### CR3 — Los filtros no ofrecen valores de otro proyecto
- **Given** el proyecto A cargado con el tipo `bug` y el owner `ana`, y el proyecto B seleccionado cuya carga falla
- **When** se abren los filtros de tipo y de owner
- **Then** no ofrecen `bug` ni `ana`

### CR5 — Los filtros no ofrecen valores de otro proyecto mientras carga el seleccionado
- **Given** el proyecto A cargado con el tipo `bug` y el owner `ana`, y la carga del proyecto C seleccionado todavía en vuelo
- **When** se abren los filtros de tipo y de owner
- **Then** no ofrecen `bug` ni `ana`

### CR6 — El aviso de documentos inválidos es del proyecto seleccionado
- **Given** el proyecto A cargado con un documento de change inválido, y el proyecto B seleccionado cuya carga falla o sigue en vuelo
- **When** se mira la cabecera del viewer
- **Then** no aparece el aviso de documentos inválidos de A

### CR4 — El primer uso real
- **Given** `changeledger view` con un proyecto válido A y un proyecto B cuya config está rota
- **When** se carga A, se selecciona B, se busca y se cambia de vista, y se vuelve a A
- **Then** con B seleccionado no aparecen changes ni filtros de A, y al volver a A se ven los suyos

## Plan

- [x] Escribir pruebas fallidas de la carga en vuelo y de los filtros tras un fallo
  - **Target:** `test/viewer-metadata.test.mjs`
  - **Verify:** `pnpm test`
  - **Criteria:** CR1, CR2, CR3, CR5, CR6
  - **Resolved:** `2026-10-12T13:15:17Z`
- [x] Pintar el estado de carga y no reutilizar el payload ni los filtros de otro proyecto
  - **Target:** `src/viewer/public/app.js, src/viewer/public/app-state.js`
  - **Verify:** `pnpm test`
  - **Criteria:** CR1, CR2, CR3, CR5, CR6
  - **Resolved:** `2026-10-12T13:15:18Z`
- [x] Recorrer el viewer real con dos proyectos, uno de ellos roto
  - **Target:** `src/viewer/public/app.js`
  - **Verify:** verify: manual — `changeledger view` con dos proyectos temporales y cambio entre ellos en el navegador
  - **Criteria:** CR4
  - **Resolved:** `2026-10-12T13:15:18Z`
- [x] Ejecutar el gate completo
  - **Verify:** `pnpm verify`
  - **Support:**
  - **Resolved:** `2026-10-12T13:15:18Z`

## Log
- **2026-10-12T12:56:04Z** `[version]` 0.18.0-dev
- **2026-10-12T12:58:36Z** `[status]` draft → approved (human via conversation)
- **2026-10-12T12:59:00Z** `[status]` approved → in-progress
- **2026-10-12T12:59:00Z** `[branch]` set: bug/20261012-125604 (auto)
- **2026-10-12T13:08:18Z** `[note]` La implementación de CR1–CR3 mostró dos casos más del mismo pedido: los menús de filtros listan los valores de A mientras la carga de C está en vuelo, y el aviso de documentos inválidos de A sigue visible con B seleccionado. Se añaden CR5 y CR6 porque el Request pide que el viewer no presente datos de otro proyecto como del seleccionado.
- **2026-10-12T13:15:16Z** `[note]` Implementación: `selectedRepo()` devuelve el payload sólo si es del proyecto seleccionado; `render()` pinta `Loading project…` mientras no lo es y no hay error de carga; `dropForeignProjectShell()` rehace los filtros y retira el aviso de documentos inválidos al seleccionar otro proyecto y al fallar su carga. Un fallo al recargar el mismo proyecto conserva sus filtros y su aviso (test propio). Mutantes N1–N5 y M1–M10 fallaron por la aserción esperada.
- **2026-10-12T13:15:17Z** `[note]` CR4: con `changeledger view` sobre alpha (bug con owner ana y un documento inválido) y beta (config rota), al seleccionar beta, buscar Alpha y pasar por board, table, graph, ledger y metrics, cada vista mostró «Internal server error» sin «Alpha change»; el filtro de tipo quedó vacío, el de owner sólo con Unassigned y no hubo aviso. Al volver a alpha se vieron su change, ana y el aviso de su documento inválido. La consola sólo registró los 500 de beta.
- **2026-10-12T13:15:19Z** `[status]` in-progress → in-review
- **2026-10-12T13:15:40Z** `[note]` Mandato de revisión: la superficie que el change gobierna — el estado del viewer al cambiar de proyecto (render, filtros, aviso de documentos inválidos, carga en vuelo y fallida) en src/viewer/public/app.js y app-state.js, con dev..HEAD (8a48d0d3) y sus tests.
- **2026-10-12T13:19:10Z** `[review]` in-review → in-progress (retry): CR5 y CR6 fallan cuando el proyecto se selecciona por la restauración de ruta (Atrás/Adelante) o por gotoChange: con la carga en vuelo, los filtros ofrecen bug y ana y el aviso de documentos inválidos de alpha sigue visible. El comentario de dropForeignProjectShell y la nota de implementación del Log afirman lo contrario.
- **2026-10-12T13:19:17Z** `[note]` Corrige la nota de implementación anterior: dropForeignProjectShell() rehace los filtros y retira el aviso cuando la selección pasa por el selector de proyectos (selectViewerProject) y cuando la carga falla; la revisión confirmó que la restauración de ruta no lo hacía mientras la carga está en vuelo.
- **2026-10-12T13:27:03Z** `[note]` Corrección de la ronda 1: un listener de app-state (setProjectSelectedListener) llama a syncSelectedProjectShell tras selectProject y cuando initializeProjects cambia la selección; tests en vuelo y tras fallo por el selector, la restauración de ruta, un resultado de búsqueda global y el refresco del registro. Mutantes P1–P8 fallaron por la aserción esperada. pnpm verify: 1836/1836.
- **2026-10-12T13:27:03Z** `[status]` in-progress → in-review
- **2026-10-12T13:27:08Z** `[note]` Mandato de la revisión de confirmación: los dos hallazgos de la ronda 1 (selección por restauración de ruta y por gotoChange con la carga en vuelo; prosa falsada) sobre el diff sin commit encima de 8a48d0d3, y regresiones que introduzca.
