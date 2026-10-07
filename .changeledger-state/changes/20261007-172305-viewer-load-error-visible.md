---
id: "20261007-172305"
title: El viewer muestra el error de carga de un proyecto en la vista activa
type: bug
status: draft
created: 2026-10-07T17:23:05Z
depends_on: []
related_to: ["20261007-135148"]
owner: rarc88
---

## Request

En el viewer, cuando la carga de un proyecto seleccionado falla, el error no
queda a la vista: si la vista activa es Table, Graph o Metrics, cambiar de vista
muestra `No projects registered. Run changeledger init in a repo.`, y volver a
Board o cualquier re-render tapa el error de carga hasta el siguiente sondeo. Lo
observó la revisión de `20261007-135148`. Se pide que el error de carga de un
proyecto se vea en la vista activa y que el mensaje de «sin proyectos» quede
sólo para cuando no hay ninguno.

Queda fuera de este change el sondeo que devuelve la vista a Board sin
proyectos (change propio).

## Investigation

Causa raíz, en `src/viewer/public/app.js`: el `catch` de la carga del repo
pinta el mensaje del error sólo en `#ledger` (vista Ledger, con
`renderLedgerRouteError`) o en `#board` (cualquier otra vista), aunque la vista
activa sea Table, Graph o Metrics, cuyo contenedor queda sin el error; y no
guarda el error en el estado. Desde `20261007-135148`, `render()` empieza con
una guarda que, si `state.repo` es nulo y la vista no es `projects`, pinta
`noProjectsMessage()` en el contenedor de la vista activa; con un proyecto
seleccionado cuya carga falló, `state.repo` sigue nulo, así que esa guarda
sustituye o tapa el error. `state.repo` sólo se asigna en su valor inicial
(`null`, en `src/viewer/public/app-state.js`) y en `setRepo` con el payload
parseado, así que el caso se da mientras no se ha cargado ningún payload.

Interfaces externas: ninguna; los errores llegan de `/api/repo` (por ejemplo
`410 {"error":"project path is gone"}`).

## Specification

### CR1 — El error de carga se ve en la vista activa
- **Given** el viewer con un proyecto seleccionado cuya petición a `/api/repo` falla con el mensaje `boom` y ningún payload cargado
- **When** se activa cada una de las vistas `board`, `table`, `graph`, `ledger` y `metrics`
- **Then** el contenedor de cada vista muestra `boom` y no muestra `No projects registered`

### CR2 — Un re-render no tapa el error
- **Given** el escenario de CR1 en la vista `board`
- **When** se escribe en la búsqueda, lo que vuelve a pintar la vista
- **Then** la vista sigue mostrando `boom`

### CR3 — Una carga correcta posterior limpia el error
- **Given** el escenario de CR1
- **When** la siguiente petición a `/api/repo` responde con un payload válido
- **Then** la vista activa pinta los changes del proyecto y no muestra `boom`

### CR4 — Sin proyectos sigue el mensaje de siempre
- **Given** el viewer sin proyecto seleccionado
- **When** se activa la vista `metrics`
- **Then** muestra `No projects registered. Run changeledger init in a repo.`

### CR5 — El primer uso real
- **Given** `changeledger view` con un proyecto registrado cuya ruta ya no existe
- **When** se abre en el navegador y se recorren Board, Table, Graph, Ledger y Metrics
- **Then** cada vista muestra el error `project path is gone` y la consola no registra ningún `TypeError`

## Plan

- [ ] Escribir pruebas fallidas de la carga fallida en cada vista, el re-render y la recuperación
  - **Target:** `test/viewer-metadata.test.mjs`
  - **Verify:** `pnpm test`
  - **Criteria:** CR1, CR2, CR3, CR4
- [ ] Guardar el error de carga en el estado y pintarlo desde `render()`
  - **Target:** `src/viewer/public/app.js, src/viewer/public/app-state.js`
  - **Verify:** `pnpm test`
  - **Criteria:** CR1, CR2, CR3, CR4
- [ ] Recorrer el viewer real con un proyecto cuya ruta desapareció
  - **Target:** `src/viewer/public/app.js`
  - **Verify:** verify: manual — `changeledger view` con un `CHANGELEDGER_HOME` de prueba y cada vista en el navegador
  - **Criteria:** CR5
- [ ] Ejecutar el gate completo
  - **Verify:** `pnpm verify`
  - **Support:**

## Log
- **2026-10-07T17:23:05Z** `[version]` 0.18.0-dev
