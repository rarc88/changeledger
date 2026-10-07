---
id: "20261007-172311"
title: El sondeo del viewer sin proyectos no cambia la vista elegida
type: bug
status: draft
created: 2026-10-07T17:23:11Z
depends_on: []
related_to: ["20261007-135148"]
owner: rarc88
---

## Request

En el viewer global sin proyectos registrados, al elegir Table, Graph, Ledger o
Metrics la vista vuelve sola a Board en cinco segundos o menos. Lo observó la
revisión de `20261007-135148` y ya pasaba antes de ese change. Se pide que la
vista elegida se mantenga mientras no haya proyectos.

## Investigation

Causa raíz, en `src/viewer/public/app.js`: `setInterval(load, 5000)` llama a la
carga del repo cada cinco segundos; sin proyecto seleccionado, la carga llama a
`showNoProjects()` salvo en la vista `projects`, y `showNoProjects` hace
`setView('board')` y pinta el mensaje en `#board`. Desde `20261007-135148`,
`render()` ya pinta el estado vacío en el contenedor de cada vista cuando
`state.repo` es nulo, así que el sondeo no necesita cambiar de vista para
mostrarlo. El test de `test/viewer-metadata.test.mjs` que llama a
`showNoProjects` comprueba que la vista inicial vuelve a Board, y el test
`111219 CR4` cubre una vista `table` restaurada al arrancar.

Interfaces externas: ninguna.

## Specification

### CR1 — El sondeo no cambia la vista elegida
- **Given** el viewer sin proyectos con la vista `metrics` activa
- **When** se ejecuta la carga periódica
- **Then** la vista activa sigue siendo `metrics` y muestra `No projects registered. Run changeledger init in a repo.`

### CR2 — El arranque sin proyectos conserva su comportamiento
- **Given** el viewer sin proyectos al arrancar
- **When** termina la primera carga
- **Then** la vista activa es `board` y muestra el mismo mensaje, como hoy

### CR3 — El primer uso real
- **Given** `changeledger view` con un `CHANGELEDGER_HOME` cuyo registro está vacío
- **When** se abre en el navegador, se elige Metrics y se esperan diez segundos
- **Then** la vista sigue en Metrics con el estado vacío

## Plan

- [ ] Escribir pruebas fallidas del sondeo sin proyectos y del arranque
  - **Target:** `test/viewer-metadata.test.mjs`
  - **Verify:** `pnpm test`
  - **Criteria:** CR1, CR2
- [ ] Dejar que el sondeo sin proyectos repinte la vista activa sin cambiarla
  - **Target:** `src/viewer/public/app.js`
  - **Verify:** `pnpm test`
  - **Criteria:** CR1, CR2
- [ ] Recorrer el viewer real sin proyectos durante diez segundos
  - **Target:** `src/viewer/public/app.js`
  - **Verify:** verify: manual — `changeledger view` con un registro vacío, Metrics y espera
  - **Criteria:** CR3
- [ ] Ejecutar el gate completo
  - **Verify:** `pnpm verify`
  - **Support:**

## Log
- **2026-10-07T17:23:11Z** `[version]` 0.18.0-dev
