---
id: "20261026-145217"
title: La vista Graph ocupa sitio sin ganárselo
type: change
status: draft
created: 2026-10-26T14:52:17Z
depends_on: ["20261026-134323"]
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
pruebas que la cubren o la enumeran, y la corrección de `viewer.md` en los seis
pasajes que quedan falsos.

Fuera: el comportamiento de las otras cinco vistas, que esta retirada no debe
cambiar; la dependencia `mermaid`, que sirve a los diagramas de los documentos;
los findings F1 y F2 que dejó abiertos `#20261026-134323`; y cualquier rediseño
de la barra de pestañas más allá de quitar un botón.

Preautorizado dentro: ajustar cualquier prueba que enumere las vistas, y retirar
las reglas CSS que solo usaba el grafo.

## Specification

## Plan

## Log
- **2026-10-26T14:52:17Z** `[version]` 1.0.0
