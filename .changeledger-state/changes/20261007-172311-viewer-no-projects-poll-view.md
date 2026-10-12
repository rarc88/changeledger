---
id: "20261007-172311"
title: El sondeo del viewer sin proyectos no cambia la vista elegida
type: bug
status: in-validation
created: 2026-10-07T17:23:11Z
depends_on: []
branch: bug/20261007-172311
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

- [x] Escribir pruebas fallidas del sondeo sin proyectos y del arranque
  - **Target:** `test/viewer-metadata.test.mjs`
  - **Verify:** `pnpm test`
  - **Criteria:** CR1, CR2
  - **Resolved:** `2026-10-12T12:25:45Z`
- [x] Dejar que el sondeo sin proyectos repinte la vista activa sin cambiarla
  - **Target:** `src/viewer/public/app.js`
  - **Verify:** `pnpm test`
  - **Criteria:** CR1, CR2
  - **Resolved:** `2026-10-12T12:25:46Z`
- [x] Recorrer el viewer real sin proyectos durante diez segundos
  - **Target:** `src/viewer/public/app.js`
  - **Verify:** verify: manual — `changeledger view` con un registro vacío, Metrics y espera
  - **Criteria:** CR3
  - **Resolved:** `2026-10-12T12:25:46Z`
- [x] Ejecutar el gate completo
  - **Verify:** `pnpm verify`
  - **Support:**
  - **Resolved:** `2026-10-12T12:25:47Z`

## Log
- **2026-10-07T17:23:11Z** `[version]` 0.18.0-dev
- **2026-10-12T11:14:30Z** `[status]` draft → approved (human via conversation)
- **2026-10-12T12:21:58Z** `[status]` approved → in-progress
- **2026-10-12T12:21:58Z** `[branch]` set: bug/20261007-172311 (auto)
- **2026-10-12T12:25:47Z** `[note]` Implementación delegada (subagente, tier medio), tareas 1, 2 y 4: load() gana la opción { polling }; el intervalo de 5 s la pasa y, sin proyecto, el sondeo llama a syncViewerShell() y no a showNoProjects(), así que no cambia la vista; el arranque y los demás llamadores de load() conservan showNoProjects(). Red de CR1 con actual board, expected metrics; CR2 verde antes y después. Mutantes: if (false), if (true) y sin syncViewerShell; cada uno falla su test. pnpm verify en verde con 1816/1816. Decisiones no especificadas: opción explícita polling; la rama devuelve false; repinta con syncViewerShell. Residuos: el cableado del setInterval no tiene test unitario (lo cubre CR3); en modo global con una búsqueda escrita, el sondeo sin proyectos vuelve a lanzar searchAllProjects cada 5 s en lugar de salir del modo global; un state.repo antiguo no se limpia si el proyecto desaparece; una carrera entre un getProjects lento y el primer sondeo no se ejecutó.
- **2026-10-12T12:25:47Z** `[note]` CR3 recorrido por el orquestador en el navegador del preview con el registro vaciado temporalmente (copia guardada y restaurada después): tras el arranque la vista activa es Board; al elegir Metrics y esperar 11 s, la vista activa sigue siendo Metrics con No projects registered. Run changeledger init in a repo., Board sigue oculto (clase hidden, display none) y la consola no registra ningún TypeError.
- **2026-10-12T12:25:48Z** `[status]` in-progress → in-review
- **2026-10-12T12:25:53Z** `[note]` Mandato del review: la superficie que el change gobierna — dev..HEAD contra CR1-CR3 y el Plan, con las decisiones no especificadas y residuos del Log como puntos de escrutinio. Frases cuantificadas informadas: ninguna en comentarios ni documentación; los títulos de test se limitan al caso metrics que ejecutan.
- **2026-10-12T12:31:08Z** `[review]` in-review → in-validation (delegated subagent, clean context)
