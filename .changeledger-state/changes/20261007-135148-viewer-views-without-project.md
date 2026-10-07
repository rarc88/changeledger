---
id: "20261007-135148"
title: Cambiar de vista en el viewer sin proyecto cargado no rompe
type: bug
status: in-progress
created: 2026-10-07T13:51:48Z
depends_on: []
branch: bug/20261007-135148
related_to: ["20260711-155721", "20260627-111218"]
owner: rarc88
---

## Request

En el viewer global (`changeledger view`) sin ningún proyecto registrado, al
pulsar `Metrics` la consola muestra
`TypeError: Cannot read properties of null (reading 'changes')` y la vista queda
en blanco. Se observó el 2026-10-07 con `~/.changeledger/.registry.json` vacío.
Se pide que cambiar de vista sin proyecto cargado no rompa y muestre el estado
vacío que ya existe.

Queda fuera de este change cualquier cambio en la gestión de proyectos o en el
registro.

## Investigation

Causa raíz: `state.repo` empieza en `null` y sólo lo fija `setRepo`. En
`src/viewer/public/app.js`, `activateView` llama a `render()`, que despacha por
`state.currentView` sin comprobar `state.repo`. `visibleChanges()` lee
`state.repo.changes` sin guarda y la usan `renderBoard`, `renderTable` y
`renderMetrics`; `renderBoard` lee también `state.repo.statuses`, `renderGraph`
lee `state.repo.changes` y `paintLedger` lee `state.repo.specs`. `renderProjects`
y la búsqueda global no usan `state.repo`.

El texto vacío `No projects registered. Run <code>changeledger init</code> in a
repo.` lo pinta `showNoProjects` en `#board`, pero sólo en la carga inicial: los
botones de vista pasan por `activateView` y lo saltan. El test de
`test/viewer-metadata.test.mjs` que llama a `showNoProjects` no cubre
`activateView` con `state.repo` nulo, y ningún otro test lo hace.

Interfaces externas: ninguna.

## Specification

### CR1 — Ninguna vista de proyecto rompe sin proyecto cargado
- **Given** el cliente del viewer con `state.repo` nulo
- **When** se activa cada una de las vistas `board`, `table`, `graph`, `ledger` y `metrics`
- **Then** ninguna lanza y cada una muestra `No projects registered. Run changeledger init in a repo.`

### CR2 — La vista de proyectos sigue igual
- **Given** el cliente del viewer con `state.repo` nulo y ningún proyecto registrado
- **When** se activa la vista `projects`
- **Then** muestra `No projects registered.` como hoy

### CR3 — El primer uso real sin proyectos
- **Given** `changeledger view` con `CHANGELEDGER_HOME` apuntando a un directorio cuyo registro está vacío
- **When** se abre en el navegador y se pulsan `Board`, `Table`, `Graph`, `Ledger`, `Metrics` y `Projects`
- **Then** cada vista muestra su estado vacío y la consola no registra ningún error

## Plan

- [x] Escribir pruebas fallidas de las vistas con `state.repo` nulo
  - **Target:** `test/viewer-metadata.test.mjs`
  - **Verify:** `node --test test/viewer-metadata.test.mjs`
  - **Criteria:** CR1, CR2
  - **Resolved:** `2026-10-07T16:13:16Z`
- [x] Mostrar el estado vacío en `render` cuando no hay proyecto cargado
  - **Target:** `src/viewer/public/app.js`
  - **Verify:** `node --test test/viewer-metadata.test.mjs test/view.test.mjs`
  - **Criteria:** CR1, CR2
  - **Resolved:** `2026-10-07T16:13:16Z`
- [ ] Recorrer el viewer real sin proyectos
  - **Target:** `src/viewer/public/app.js`
  - **Verify:** verify: manual — `changeledger view` con un registro vacío y cada vista en el navegador
  - **Criteria:** CR3
- [ ] Ejecutar el gate completo
  - **Verify:** `pnpm verify`
  - **Support:**

## Log
- **2026-10-07T13:51:48Z** `[version]` 0.18.0-dev
- **2026-10-07T15:02:57Z** `[status]` draft → approved (human via conversation)
- **2026-10-07T16:10:07Z** `[status]` approved → in-progress
- **2026-10-07T16:10:07Z** `[branch]` set: bug/20261007-135148 (auto)
