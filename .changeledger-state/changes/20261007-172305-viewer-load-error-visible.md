---
id: "20261007-172305"
title: El viewer muestra el error de carga de un proyecto en la vista activa
type: bug
status: done
created: 2026-10-07T17:23:05Z
depends_on: []
archived: true
reviewed: true
branch: bug/20261007-172305
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
- **Given** `changeledger view` con un proyecto registrado que existe pero cuya carga falla (su `.changeledger/config.yml` no es YAML válido, así que `/api/repo` responde `500` con `Internal server error`)
- **When** se selecciona en el navegador, se recorren Board, Table, Graph, Ledger y Metrics, se escribe en la búsqueda y después se repara la config
- **Then** cada vista muestra `Internal server error`, la búsqueda no lo tapa, la consola no registra ningún `TypeError` y el sondeo siguiente vuelve a pintar el proyecto

## Plan

- [x] Escribir pruebas fallidas de la carga fallida en cada vista, el re-render y la recuperación
  - **Target:** `test/viewer-metadata.test.mjs`
  - **Verify:** `pnpm test`
  - **Criteria:** CR1, CR2, CR3, CR4
  - **Resolved:** `2026-10-12T12:07:40Z`
- [x] Guardar el error de carga en el estado y pintarlo desde `render()`
  - **Target:** `src/viewer/public/app.js, src/viewer/public/app-state.js`
  - **Verify:** `pnpm test`
  - **Criteria:** CR1, CR2, CR3, CR4
  - **Resolved:** `2026-10-12T12:07:41Z`
- [x] Recorrer el viewer real con un proyecto cuya carga falla
  - **Target:** `src/viewer/public/app.js`
  - **Verify:** verify: manual — `changeledger view` con un proyecto temporal de config rota y cada vista en el navegador
  - **Criteria:** CR5
  - **Resolved:** `2026-10-12T12:07:41Z`
- [x] Ejecutar el gate completo
  - **Verify:** `pnpm verify`
  - **Support:**
  - **Resolved:** `2026-10-12T12:07:41Z`

## Log
- **2026-10-07T17:23:05Z** `[version]` 0.18.0-dev
- **2026-10-12T11:14:26Z** `[status]` draft → approved (human via conversation)
- **2026-10-12T11:59:11Z** `[status]` approved → in-progress
- **2026-10-12T11:59:11Z** `[branch]` set: bug/20261007-172305 (auto)
- **2026-10-12T12:07:39Z** `[note]` El orquestador corrige el Given de CR5: al recorrerlo, un proyecto registrado cuya ruta ya no existe aparece como gone-project (missing), deshabilitado en el selector, y el viewer no lo selecciona al cargar; si la ruta desaparece con el proyecto ya cargado, state.repo sigue con el último payload y el error sólo se ve en Ledger, el caso que el implementador dejó fuera de CR1-CR4. El caso alcanzable de una primera carga fallida con proyecto seleccionado es un proyecto que existe y cuya carga falla, y CR5 pasa a describir ese.
- **2026-10-12T12:07:39Z** `[note]` Implementación delegada (subagente, tier medio), tareas 1, 2 y 4: state.loadError en app-state.js, que selectProject limpia; el catch de la carga lo guarda y lo pinta salvo en projects; una carga correcta lo limpia y reaplica el payload aunque su texto coincida con el anterior; la guarda de render() pinta el error si hay proyecto seleccionado y error, y si no el mensaje de sin proyectos. Red de CR1-CR3 con No projects registered donde se esperaba boom; CR4 verde antes y después. Mutantes M1-M6 (no guardar el error, no limpiarlo, guarda que lo ignora, catch que no pinta, selectProject que lo conserva y sin reaplicar un payload idéntico); todos fallan. pnpm verify en verde con 1780/1780. Decisiones no especificadas: en projects un fallo no pinta nada; CR2 se prueba con setTextFilter y render porque oninput sólo se enlaza en bootstrap(); un fallo con el repo ya cargado sigue siendo pasajero. Residuos: mientras la primera carga está en vuelo, render() muestra No projects registered; el sondeo que devuelve la vista a Board es de 20261007-172311; renderGlobal no se toca.
- **2026-10-12T12:07:40Z** `[note]` CR5 recorrido por el orquestador en el navegador del preview, con el registro guardado y restaurado después: proyecto temporal walk-proj con su config.yml roto (/api/repo responde 500); tras seleccionarlo, Board, Table, Graph, Ledger y Metrics muestran Internal server error, la búsqueda no lo tapa y la consola no registra ningún TypeError; al restaurar la config, el sondeo siguiente vuelve a pintar el board vacío del proyecto. También se quitaron del registro tres entradas ctx-* que había dejado la revisión de 20261007-135159 apuntando a carpetas ya borradas.
- **2026-10-12T12:07:49Z** `[status]` in-progress → in-review
- **2026-10-12T12:07:53Z** `[note]` Mandato del review: la superficie que el change gobierna — dev..HEAD contra CR1-CR5 (con CR5 corregido por el orquestador, ver Log) y el Plan, con las decisiones no especificadas y residuos del Log como puntos de escrutinio. Frases cuantificadas informadas: el título del test «CR1: a failed project load shows its error in board, table, graph, ledger and metrics» (el test recorre las cinco vistas) y el comentario «The search box re-renders through the same render() that activateView calls» (leído en el código, no ejecutado en JSDOM; el recorrido de CR5 lo ejecutó en el navegador).
- **2026-10-12T12:14:03Z** `[review]` in-review → in-progress (retry): F1: selectProject limpia lastJson y loadError pero no state.repo, y la guarda de render() sólo pinta el error con !state.repo; al pasar de un proyecto cargado A a uno B cuya carga falla, la siguiente búsqueda o cambio de vista pinta los changes de A con B seleccionado (ejecutado en un navegador real con alpha válido y beta con config rota). F2: la nota del orquestador que justifica la corrección de CR5 afirma que el viewer no selecciona al cargar un proyecto cuya ruta ya no existe, pero un enlace profundo de Ledger con exact:true sí lo selecciona, y que con el proyecto ya cargado el error sólo se ve en Ledger, pero el sondeo lo pinta también en Table. F3: el título de la tarea 3 del Plan sigue nombrando un proyecto cuya ruta desapareció.
- **2026-10-12T12:14:07Z** `[note]` Corrección del orquestador a su nota que justifica el cambio de CR5 (hallazgo F2), acotando sin sustituir: al abrir el viewer sin enlace profundo, un proyecto cuya ruta ya no existe aparece como (missing) y deshabilitado y no se seleccionó en el recorrido; con un enlace profundo de Ledger sí se selecciona, según la revisión. La frase de que con el proyecto ya cargado el error sólo se ve en Ledger se retira. La nota del recorrido de CR5 queda acotada a lo ejecutado: el proyecto roto se seleccionó con los demás proyectos deshabilitados, así que no había otro payload cargado. Frases cuantificadas de esta corrección: ninguna universal; «no se seleccionó en el recorrido» y «no había otro payload cargado» se refieren al recorrido ya registrado.
- **2026-10-12T12:15:58Z** `[note]` Corrección del retry (subagente corrector, sin commitear): F1, la guarda de render() pinta el error de carga cuando hay proyecto seleccionado con error y state.repo es nulo o su project_id no es el del proyecto seleccionado (toda carga exige project_id por matchesProjectProvenance); app-state.js no cambia. Test nuevo: alpha cargado, se selecciona beta cuya carga falla, re-render por búsqueda y por las seis activaciones de vista, el error de beta sigue y no aparecen los changes de alpha; volver a alpha con carga válida lo recupera. Rojo con board keeps the selected project error; mutante con la condición antigua falla; el mutante que deja ganar siempre al error sobrevive porque un fallo del mismo proyecto con su payload cargado sigue siendo pasajero (residuo ya declarado). pnpm verify en verde con 1781/1781. Mandato de la confirmación (ronda 2): sólo el diff sin commitear frente a 6f08546 y las notas del orquestador posteriores al review, limitado a F1, F2 y F3 y a cualquier regresión. Frases cuantificadas informadas: los mensajes de assert keeps the selected project error y hides the previous project, sobre las seis activaciones del bucle del test.
- **2026-10-12T12:15:59Z** `[status]` in-progress → in-review
- **2026-10-12T12:21:40Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-10-12T12:21:45Z** `[note]` Seguimientos del review de confirmación: en el test F1 el filtro 'anything' deja sin poder de detección el assert hides the previous project en board y table; con A cargado, B fallido y C en carga, un re-render pinta los changes de A con C seleccionado (variante previa del residuo de carga en vuelo); los filtros y el shell pueden seguir mostrando valores de A tras fallar B (no verificado).
- **2026-10-12T12:51:43Z** `[validation]` in-validation → done (human accepted via conversation)
- **2026-10-12T12:52:11Z** `[graduation]` spec: `viewer.md`
- **2026-10-12T12:52:13Z** `[archive]` archived
