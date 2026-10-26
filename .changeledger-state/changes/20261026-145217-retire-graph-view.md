---
id: "20261026-145217"
title: La vista Graph ocupa sitio sin ganárselo
type: change
status: in-progress
created: 2026-10-26T14:52:17Z
depends_on: ["20261026-134323"]
branch: change/20261026-145217
related_to: []
owner: raruiz-hiberuscom
release_impact: minor
---

## Request

El humano no le encuentra utilidad real a la vista Graph del viewer y pide
retirarla. No es un defecto: es una decisión de producto sobre una superficie
que se mantiene, se prueba y se documenta sin que nadie la use.

### Investigation

La superficie está acotada y vive entera en `src/viewer/public/`. Fuera del
viewer no hay nada que retirar: los usos de «graph» en `src/lifecycle.mjs`,
`src/check.mjs` y `src/commands/` nombran el grafo de dependencias y el grafo de
estados del ciclo de vida, que son estructuras de datos del núcleo y no tienen
relación con esta vista.

Lo que la compone:

- `index.html`: el botón `#view-graph` de la barra de pestañas y la sección
  `#graph`.
- `app-state.js`: la entrada `graph` de `VALID_VIEWS`.
- `app.js`: el import de `graphSvg`, el despacho `if (state.currentView ===
  'graph')`, la función `renderGraph`, la entrada de `VIEWS` y el handler
  `$('#view-graph').onclick`.
- `view-renderers.js`: `graphSvg`, que es la función más larga del módulo, y la
  referencia a ella como precedente en el comentario de `usageSectionHtml`.
- `styles.css`: el bloque `/* Graph */` con `.graph`, y las reglas `.node rect`,
  `.node:hover rect`, `.node text`, `.node .nid`, `.edge` y `.relation-edge`,
  que no usa ninguna otra vista.
- `state.js`: el comentario que nombra al grafo como uno de los consumidores de
  `passesTombstones`.

La vista tiene además pruebas propias y aparece enumerada en las pruebas que
recorren todas las vistas, en `test/viewer-metadata.test.mjs` y
`test/app-state.test.mjs`.

`mermaid` no se va con ella: lo usan los diagramas dentro de los documentos y el
lightbox de diagramas, no el grafo, que dibuja su propio SVG a mano.

El estado persistido no necesita migración: `app-state.js` ya cae a `board`
cuando `VALID_VIEWS` no reconoce la vista guardada, así que un viewer que
recuerde `view=graph` de antes de este change aterriza en Board solo.

La spec `viewer.md` es verdad persistente y queda falsa en seis sitios: la
enumeración de vistas, el reparto por módulos de `view-renderers.js`, el estado
vacío del grafo, la lista de vistas con proyecto sin cargar, la semántica de
tombstones frente al filtro `Pending graduation`, y el dibujo de dependencias y
relaciones como aristas. La corrección se redacta dentro de este change.

### Objective

El viewer deja de ofrecer la vista Graph y el repositorio deja de mantenerla:
sin pestaña, sin sección, sin render, sin CSS propio y sin pruebas que la
sostengan. Está terminado cuando ninguna de las cinco CR falla, `viewer.md` ya no
describe una vista que no existe, y la suite sigue en verde sin ninguna prueba
retirada que cubriera otra cosa.

### Frontier

Dentro: los seis ficheros de `src/viewer/public/` que componen la vista, las
pruebas que la cubren o la enumeran, y la corrección de toda spec que esta
retirada deje falsa: los seis pasajes de `viewer.md` y la línea del diagrama de
`architecture.md` que enumera las vistas del visor.

La frontera nació acotada a `viewer.md` porque la investigación barrió `src/` y
no el ledger entero; la revisión encontró `architecture.md` y el humano la
amplió explícitamente para incluirla.

Fuera: el comportamiento de las otras cinco vistas, que esta retirada no debe
cambiar; la dependencia `mermaid`, que sirve a los diagramas de los documentos;
los findings F1 y F2 que dejó abiertos `#20261026-134323`; y cualquier rediseño
de la barra de pestañas más allá de quitar un botón.

Preautorizado dentro: ajustar cualquier prueba que enumere las vistas, y retirar
las reglas CSS que solo usaba el grafo.

## Specification

### Proposal

**Un corte limpio, no un apagado.** La vista se retira entera: pestaña, sección,
render, CSS propio y pruebas. No queda ni bandera de configuración ni código
muerto comentado. Descartado ocultar la pestaña dejando el render en su sitio:
deja exactamente la superficie que esta retirada quiere dejar de mantener.

**El estado persistido no se migra.** `restoreState` en `app-state.js` ya cae a
`board` cuando `VALID_VIEWS` no reconoce la vista guardada, así que sacar `graph`
del conjunto es toda la migración que hace falta. Descartado escribir un paso de
migración del `localStorage`: añadiría código con fecha de caducidad para algo
que la validación existente ya cubre.

**`passesTombstones` se queda.** Lo compartían el grafo y `isVisible`; retirar el
grafo no lo deja sin consumidor, solo corrige el comentario de `state.js` que lo
nombra.

**La spec se corrige dentro del change.** `viewer.md` describe la vista en seis
pasajes y es verdad persistente: quedarse falsa es peor que no existir.

### CR1 — El viewer ofrece cinco vistas y ninguna se llama Graph

- **Given** el viewer cargado con un proyecto
- **When** se inspecciona la barra de pestañas
- **Then** hay cinco pestañas —Board, Table, Ledger, Metrics y Projects— y no existe ningún elemento `#view-graph` ni `#graph`
- **And** `VIEWS` en `src/viewer/public/app.js` y `VALID_VIEWS` en `src/viewer/public/app-state.js` declaran las mismas cinco vistas

### CR2 — Una ruta o un estado guardado que pide Graph aterriza en Board

- **Given** un `localStorage` escrito por una versión anterior con `currentView: "graph"`, o una URL con `?view=graph`
- **When** el viewer arranca
- **Then** la vista activa es `board` y no se lanza ningún error
- **And** la pestaña Board queda marcada como activa

### CR3 — No queda código ni estilo que solo sirviera al grafo

- **Given** el árbol de fuentes tras la retirada
- **When** se busca la superficie del grafo en `src/viewer/public/`
- **Then** no existen `graphSvg` ni `renderGraph`, ni la regla `.graph`, ni las reglas `.node rect`, `.node:hover rect`, `.node text`, `.node .nid`, `.edge` y `.relation-edge`
- **And** `src/viewer/public/view-renderers.js` no exporta `graphSvg` y nadie lo importa
- **And** `mermaid` sigue cargándose en `index.html` y el lightbox de diagramas sigue funcionando, porque sirven a los diagramas de los documentos y no al grafo

### CR4 — Las cinco vistas que quedan no cambian de comportamiento

- **Given** un proyecto sin seleccionar, uno seleccionado sin payload cargado, y uno cuya carga falla
- **When** se recorren Board, Table, Ledger y Metrics en cada uno de esos tres estados
- **Then** siguen mostrando `No projects registered. Run changeledger init in a repo.`, `Loading project…` y el error de carga respectivamente, igual que antes de la retirada
- **And** el filtro `Pending graduation` sigue combinándose con búsqueda, type, owner y statuses sobre Board, Table y Metrics

### CR5 — La spec deja de describir una vista que no existe

- **Given** `spec:viewer`
- **When** se lee entera
- **Then** ninguno de sus seis pasajes sobre el grafo —la enumeración de vistas, el reparto de `view-renderers.js`, el estado vacío, la lista de vistas sin payload, la semántica de tombstones frente a `Pending graduation` y el dibujo de dependencias y relaciones como aristas— describe ya la vista Graph
- **And** lo que sigue siendo cierto de las otras vistas se conserva, en vez de borrarse con el pasaje

### CR7 — Ninguna spec del ledger nombra ya la vista

- **Given** el ledger completo —specs, documentos de proyecto y fragmentos de contrato—
- **When** se busca la vista retirada
- **Then** `spec:architecture` ya no la nombra en la línea `SRV --> UI[...]` de su diagrama, que enumera las vistas del visor
- **And** ninguna otra spec la nombra, y los usos restantes de «graph» en el ledger son el grafo de dependencias, el grafo de estados del ciclo de vida, `subgraph` de mermaid y `gitGraph`

### CR6 — Recorrido completo del día después

- **Given** un viewer arrancado contra un repo real, con el estado guardado pidiendo `graph`
- **When** se abre, se recorren las cinco pestañas una por una y se abre el detalle de un change desde Board y desde Table
- **Then** arranca en Board, cada pestaña rinde su contenido sin error de consola, y el detalle abre y cierra en ambas
- **And** la única barra de scroll vertical con el detalle abierto sigue siendo la de `#detail`, como fijó `#20261026-134323`

## Plan

- [x] Retirar la vista de las pruebas que la enumeran y las que solo la cubren a ella
  - **Target:** `test/viewer-metadata.test.mjs`
  - **Verify:** `pnpm test test/viewer-metadata.test.mjs`
  - **Criteria:** CR1, CR3, CR4
  - **Resolved:** `2026-10-26T15:08:01Z`
- [x] Retirar `graph` del estado de vistas y de su validación
  - **Target:** `src/viewer/public/app-state.js`
  - **Verify:** `pnpm test test/app-state.test.mjs`
  - **Criteria:** CR1, CR2
  - **Resolved:** `2026-10-26T15:08:02Z`
- [x] Retirar la pestaña y la sección del documento
  - **Target:** `src/viewer/public/index.html`
  - **Verify:** `pnpm test test/viewer-metadata.test.mjs`
  - **Criteria:** CR1
  - **Resolved:** `2026-10-26T15:08:03Z`
- [x] Retirar el render, el despacho, el import y el handler
  - **Target:** `src/viewer/public/app.js`
  - **Verify:** `pnpm test test/viewer-metadata.test.mjs`
  - **Criteria:** CR1, CR3
  - **Resolved:** `2026-10-26T15:08:04Z`
- [x] Retirar `graphSvg` y corregir el comentario que lo citaba como precedente
  - **Target:** `src/viewer/public/view-renderers.js`
  - **Verify:** `pnpm test test/viewer-metadata.test.mjs`
  - **Criteria:** CR3
  - **Resolved:** `2026-10-26T15:08:04Z`
- [x] Retirar el bloque CSS del grafo y sus reglas de nodo y arista
  - **Target:** `src/viewer/public/styles.css`
  - **Verify:** `pnpm test test/viewer-metadata.test.mjs`
  - **Criteria:** CR3
  - **Resolved:** `2026-10-26T15:08:05Z`
- [x] Corregir el comentario de `state.js` que nombra al grafo
  - **Target:** `src/viewer/public/state.js`
  - **Verify:** `pnpm lint`
  - **Criteria:** CR3
  - **Resolved:** `2026-10-26T15:08:12Z`
- [x] Corregir los seis pasajes de `viewer.md`
  - **Target:** `spec:viewer`
  - **Verify:** `changeledger check`
  - **Criteria:** CR5
  - **Resolved:** `2026-10-26T15:09:16Z`
- [x] Recorrer las cinco vistas en el viewer en ejecución y anotar el resultado en el Log
  - **Support:** el recorrido de CR6 no lo cubre la suite; se mide con el navegador
  - **Resolved:** `2026-10-26T15:10:50Z`
- [ ] Corregir la línea del diagrama de `architecture.md`
  - **Target:** `spec:architecture`
  - **Verify:** `changeledger check`
  - **Criteria:** CR7
- [x] Pasar la puerta local completa
  - **Support:** `pnpm verify`
  - **Resolved:** `2026-10-26T15:13:53Z`

## Log
- **2026-10-26T14:52:17Z** `[version]` 1.0.0
- **2026-10-26T14:57:49Z** `[status]` draft → approved (human via conversation)
- **2026-10-26T14:58:21Z** `[status]` approved → in-progress
- **2026-10-26T14:58:21Z** `[branch]` set: change/20261026-145217 (auto)
- **2026-10-26T15:10:43Z** `[note]` CR1 y CR2 medidos en el viewer en ejecucion: la barra ofrece cinco pestanas (board, table, ledger, metrics, projects), no existen #view-graph ni #graph, y arrancar con el estado guardado en graph y la URL ?view=graph aterriza en Board; el snapshot se reescribe a board.
- **2026-10-26T15:10:44Z** `[note]` CR6 medido: las cinco vistas rinden contenido sin un solo error de consola, el detalle abre y cierra desde Board y desde Table, y en ambos casos la unica barra vertical es la de #detail. CR3: mermaid sigue cargado y un change con diagrama rinde su SVG y su expandible.
- **2026-10-26T15:13:54Z** `[status]` in-progress → in-review
- **2026-10-26T15:24:50Z** `[review]` in-review → done (delegated subagent, clean context)
- **2026-10-26T15:24:54Z** `[finding]` La spec architecture.md sigue nombrando la vista en la linea 43 de su diagrama mermaid: SRV --> UI[visor: board / table / graph / Ledger / metrics]. Este change la volvio falsa al retirar la vista, pero la frontera aprobada acota la correccion de specs a viewer.md, asi que ampliarla es decision humana. El resto del ledger quedo barrido: ninguna otra spec, doc de proyecto ni fragmento de contrato nombra la vista.
- **2026-10-26T15:44:18Z** `[status]` done → in-progress (agent)
- **2026-10-26T15:46:07Z** `[finding]` 1 dropped: el humano amplio la frontera para incluir architecture.md y la linea quedo corregida dentro de este mismo change
