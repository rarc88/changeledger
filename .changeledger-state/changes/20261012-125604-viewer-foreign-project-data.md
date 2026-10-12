---
id: "20261012-125604"
title: El viewer no presenta datos de otro proyecto mientras carga el seleccionado
type: bug
status: draft
created: 2026-10-12T12:56:04Z
depends_on: []
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

### CR4 — El primer uso real
- **Given** `changeledger view` con un proyecto válido A y un proyecto B cuya config está rota
- **When** se carga A, se selecciona B, se busca y se cambia de vista, y se vuelve a A
- **Then** con B seleccionado no aparecen changes ni filtros de A, y al volver a A se ven los suyos

## Plan

- [ ] Escribir pruebas fallidas de la carga en vuelo y de los filtros tras un fallo
  - **Target:** `test/viewer-metadata.test.mjs`
  - **Verify:** `pnpm test`
  - **Criteria:** CR1, CR2, CR3
- [ ] Pintar el estado de carga y no reutilizar el payload ni los filtros de otro proyecto
  - **Target:** `src/viewer/public/app.js, src/viewer/public/app-state.js`
  - **Verify:** `pnpm test`
  - **Criteria:** CR1, CR2, CR3
- [ ] Recorrer el viewer real con dos proyectos, uno de ellos roto
  - **Target:** `src/viewer/public/app.js`
  - **Verify:** verify: manual — `changeledger view` con dos proyectos temporales y cambio entre ellos en el navegador
  - **Criteria:** CR4
- [ ] Ejecutar el gate completo
  - **Verify:** `pnpm verify`
  - **Support:**

## Log
- **2026-10-12T12:56:04Z** `[version]` 0.18.0-dev
