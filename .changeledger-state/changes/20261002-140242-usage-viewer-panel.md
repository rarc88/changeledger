---
id: "20261002-140242"
title: Mostrar el análisis de consumo en el viewer
type: feature
status: in-progress
created: 2026-10-02T14:02:42Z
depends_on: ["20261002-140038"]
branch: feature/20261002-140242
related_to: ["20261002-133728", "20260711-155721"]
owner: rarc88
release_impact: minor
---

## Request

El humano quiere ver en el viewer el análisis del consumo de tokens y coste de
los changes, con las mismas cifras que `changeledger analyze` entrega al agente:
totales, por tramo, por modelo y por versión de ChangeLedger, sus avisos, y el
desglose de cada change, todo sobre el conjunto que filtra en la vista.

Quedan fuera de este change: cualquier cálculo distinto del que hace el módulo
de `20261002-140038`, la edición o exportación de registros, umbrales y alertas
configurables, y gráficas nuevas más allá de las barras que ya usa la vista de
métricas.

## Investigation

La vista `metrics` del viewer (change `20260711-155721`) se calcula en el
navegador: `app.js` importa dinámicamente `src/metrics.mjs`, que el router sirve
en sólo lectura porque figura en `SHARED_MODULES` de
`src/viewer/server/router.mjs`, y `metricsHtml` en
`src/viewer/public/view-renderers.js` pinta el resultado, con barras de
`barRows` y tablas de `metricsTable`, en inglés como el resto de la interfaz.
El navegador recibe los changes por `/api/repo`.

`20261002-133728` carga los registros de consumo con el resto del ledger en
ambos layouts, y `20261002-140038` define el módulo puro
`src/usage-analysis.mjs`, que no hace IO y produce
`{ schema: 1, changes, groups, hints }`.

Interfaces externas: ninguna.

## Proposal

`/api/repo` incluye los registros de consumo del proyecto, y `SHARED_MODULES`
añade `usage-analysis.mjs`. La vista `metrics` gana una sección `Usage`
calculada en el navegador con ese módulo sobre los changes que pasan los filtros
y sus registros:

- totales de tokens, coste y `unpriced tokens`;
- barras por tramo, por modelo y por versión;
- la lista de avisos.

La vista de detalle de un change muestra sus tramos (tokens, coste, modelos y
versión) cuando tiene registros, y `No usage records for this change.` cuando
no.

El viewer no calcula nada por su cuenta: las cifras de la sección y del detalle
son las de `changeledger analyze --json` para el mismo conjunto de changes.

Alternativa descartada: calcular en el servidor y enviar el resultado, porque
obliga a una petición por cada cambio de filtro y rompe el patrón de
`metrics.mjs`.

## Specification

### CR1 — `/api/repo` entrega los registros de consumo
- **Given** un proyecto activado y uno inactivo, cada uno con registros de consumo de un change
- **When** el viewer pide `/api/repo` de cada proyecto
- **Then** la respuesta incluye esos registros, asociados al id de su change, y un proyecto sin registros entrega una colección vacía

### CR2 — El router sirve el módulo de análisis y sólo los módulos declarados
- **Given** el viewer en marcha
- **When** el navegador pide `usage-analysis.mjs` y un archivo de `src/` que no figura en `SHARED_MODULES`
- **Then** el primero se sirve en sólo lectura como módulo JavaScript y el segundo se rechaza igual que hoy

### CR3 — La sección Usage coincide con `changeledger analyze`
- **Given** un proyecto con registros de dos changes
- **When** se abre la vista `metrics` sin filtros
- **Then** la sección `Usage` muestra los totales de tokens, coste y `unpriced tokens`, y las barras por tramo, por modelo y por versión, con los mismos valores que `changeledger analyze --json`, `--by segment`, `--by model` y `--by version` para ese proyecto
- **And** muestra cada aviso de `hints` en una lista

### CR4 — Los filtros acotan la sección
- **Given** el proyecto de CR3, con un change `feature` y uno `bug`
- **When** se filtra la vista por el tipo `bug`
- **Then** la sección `Usage` muestra sólo las cifras del change `bug`, iguales a las de `changeledger analyze --json` restringido a ese change

### CR5 — El detalle de un change muestra sus tramos
- **Given** un change con registros y otro sin ellos
- **When** se abre el detalle de cada uno
- **Then** el primero muestra sus tramos con tokens, coste, modelos y versión iguales a `changeledger analyze <id> --json`, y el segundo muestra `No usage records for this change.`

### CR6 — Sin registros, la sección lo dice
- **Given** un proyecto cuyos changes filtrados no tienen registros de consumo
- **When** se abre la vista `metrics`
- **Then** la sección `Usage` muestra `No usage records for the current filters.` y las métricas existentes no cambian

### CR7 — El primer uso real en el navegador
- **Given** este repo con registros reales de al menos un change
- **When** el humano abre `changeledger view .`, entra en la vista `metrics` y en el detalle de ese change
- **Then** ve las mismas cifras que `changeledger analyze` y `changeledger analyze <id>` muestran en la terminal

## Plan

- [ ] Probar y servir los registros en `/api/repo` y el módulo en `SHARED_MODULES`
  - **Target:** `src/viewer/domain.mjs, src/viewer/server/router.mjs, test/view.test.mjs, test/viewer-routing.test.mjs`
  - **Verify:** `node --test test/view.test.mjs test/viewer-routing.test.mjs`
  - **Criteria:** CR1, CR2
- [ ] Probar y pintar la sección Usage con filtros y su estado vacío
  - **Target:** `src/viewer/public/app.js, src/viewer/public/view-renderers.js, test/view.test.mjs`
  - **Verify:** `node --test test/view.test.mjs`
  - **Criteria:** CR3, CR4, CR6
- [ ] Probar y pintar los tramos en el detalle de un change
  - **Target:** `src/viewer/public/app.js, src/viewer/public/view-renderers.js, test/view.test.mjs`
  - **Verify:** `node --test test/view.test.mjs`
  - **Criteria:** CR5
- [ ] Recorrer el primer uso real en el navegador
  - **Target:** `src/viewer/public/app.js`
  - **Verify:** verify: manual — vista metrics y detalle de un change frente a `changeledger analyze`
  - **Criteria:** CR7
- [ ] Ejecutar el gate completo
  - **Verify:** `pnpm verify`
  - **Support:**

## Log
- **2026-10-02T15:24:43Z** `[status]` draft → approved (human via conversation)
- **2026-10-07T13:20:32Z** `[version]` 0.18.0-dev
- **2026-10-07T13:20:32Z** `[status]` approved → in-progress
- **2026-10-07T13:20:32Z** `[branch]` set: feature/20261002-140242 (auto)
