---
id: "20261026-165839"
title: El bloqueo de scroll del detalle no ve todo lo que puede scrollear
type: change
status: approved
created: 2026-10-26T16:58:39Z
depends_on: []
related_to: ["20261026-134323"]
owner: raruiz-hiberuscom
---

## Request

Promueve los findings F1 y F2 de `#20261026-134323`, que son el mismo defecto
visto por sus dos caras: hay scrollers detrás del overlay que la lista de
bloqueo no cubre, y el test que debería impedirlo no los ve.

### Investigation

`#20261026-134323` estableció el invariante: mientras hay un detalle abierto, el
único contenedor con barra de scroll vertical es el propio detalle. Todo lo que
scrollea detrás se bloquea con `overflow: hidden`, que conserva el
desplazamiento para restituirlo al cerrar.

Aquel change falló dos rondas de revisión por la misma causa —dar dimensionado
elástico a una vista sin atarla a la lista de bloqueo— y la segunda corrección
sustituyó la lista escrita a mano por un test que deriva de la propia hoja de
estilos dos conjuntos: lo que declara `overflow: auto` detrás del overlay y lo
que está bloqueado, exigiendo que el primero esté contenido en el segundo.

La derivación tiene tres puntos ciegos, y uno de ellos deja pasar un caso real:

- **Dos paneles quedan fuera.** `.projects-list` y `.project-editor` declaran
  `overflow-y: auto` en `src/viewer/public/styles.css:181-185` y no aparecen en
  el bloque de bloqueo de `src/viewer/public/styles.css:1692-1699`. El test no lo
  denuncia porque su patrón `VIEW_SCROLLER` no reconoce esos nombres.
- **El scanner ignora los `@media`.** `topLevelRules` registra una regla solo
  cuando su llave de cierre devuelve la profundidad a cero, así que el contenido
  de los bloques `@media` nunca llega a examinarse. Medido con un escáner de
  llaves sobre la hoja actual: hoy hay **cero** declaraciones
  `overflow: auto|scroll` dentro de un `@media`. Pero el defecto que tumbó la
  primera ronda de aquel change nació precisamente de un bloque `@media`, el de
  `max-width: 900px`, que retiraba el scroll a los paneles internos de Projects.
- **Solo reconoce `auto`.** El patrón de scroller busca `overflow: auto`, no
  `overflow: scroll`. Hoy la hoja no usa `scroll` en ningún sitio, pero nada lo
  impide.

El agujero de los dos paneles no es alcanzable hoy: la vista Projects no abre
ningún detalle, y `activateView` cierra el que hubiera al cambiar de pestaña
(`src/viewer/public/app.js:2187`). Es decir, el invariante no está roto; lo que
está roto es la guarda que debería mantenerlo cuando alguien añada ese
disparador.

### Objective

El invariante del bloqueo de scroll queda guardado por un test que ve todo lo
que puede scrollear detrás del overlay —incluidos los paneles de Projects, el
contenido de los bloques `@media` y `overflow: scroll`— y la lista de bloqueo
cubre lo que ese test encuentre. Está terminado cuando el test endurecido falla
en rojo señalando los paneles que faltan, la lista los incluye, y la suite
completa sigue en verde.

### Frontier

Dentro: la derivación del test del bloqueo en `test/viewer-metadata.test.mjs`
—su scanner de reglas y su patrón de scrollers— y el bloque de bloqueo de
`.detail-open` en `src/viewer/public/styles.css`.

Fuera: dar a la vista Projects un disparador de detalle, que es trabajo de
producto y no lo pide nadie; cualquier otro cambio de layout del viewer; y el
finding de `architecture.md`, que va en su propio change.

Preautorizado dentro: añadir a la lista de bloqueo cualquier otro scroller que
el test endurecido denuncie, aunque hoy no sea alcanzable.

## Specification

## Plan

## Log
- **2026-10-26T16:58:39Z** `[version]` 1.0.0
- **2026-10-26T17:01:05Z** `[status]` draft → approved (human via conversation)
