---
id: "20261026-165839"
title: El bloqueo de scroll del detalle no ve todo lo que puede scrollear
type: change
status: in-progress
created: 2026-10-26T16:58:39Z
depends_on: []
branch: change/20261026-165839
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

### Proposal

**La derivación se invierte: en vez de reconocer scrollers, excluye el frente.**
El patrón `VIEW_SCROLLER` enumeraba a mano las familias de nombres que sabía
reconocer, así que cualquier scroller con otro nombre —los dos paneles de
Projects— se descartaba **en silencio**. El silencio es el defecto: un test que
no ve algo y no se queja no es una guarda. La derivación pasa a recoger todo
selector cuya regla declare desbordamiento vertical y a excluir solo lo que vive
**delante** del overlay: el propio `.detail` y el lightbox de diagramas.

**Lo que no sepa normalizar, lo denuncia.** Hoy los catorce scrollers
verticales son clases simples, con o sin selector de atributo. Si alguien
introduce una forma distinta —un descendente, una clase compuesta— el test
falla nombrándola, en vez de saltársela. Descartado ampliar el patrón con más
familias de nombres: es la misma lista a mano con otra cara, y vuelve a fallar
en silencio con el siguiente nombre que nadie previó.

**El scanner desciende a las at-rules.** `topLevelRules` registra una regla solo
cuando su llave de cierre devuelve la profundidad a cero, de modo que nada
dentro de un `@media` se examina. Pasa a registrar también las reglas anidadas
en un bloque `@media` o `@supports`.

**La lista de bloqueo se completa con lo que la derivación encuentre, sin
juzgar si en la práctica scrollea.** Medido sobre la hoja actual: doce
scrollers verticales detrás del overlay y ocho en la lista. Faltan
`.projects-list`, `.project-editor`, `.ledger-source` y
`.config-migration-yaml`. Los dos últimos probablemente no lleguen a desbordar
hoy —un `<pre>` sin `max-height` y un panel que solo aparece migrando el
esquema—, pero declaran desbordamiento vertical y la derivación no puede saber
que no lo usarán. Razonar caso por caso sobre lo que «no scrollea en la
práctica» es exactamente lo que dejó pasar dos defectos en
`#20261026-134323`: se bloquean los doce.

### CR1 — La derivación examina las reglas dentro de las at-rules

- **Given** una hoja con una regla que declara desbordamiento vertical dentro de un bloque `@media`
- **When** el test deriva su conjunto de scrollers
- **Then** esa regla aparece en el conjunto
- **And** sobre la hoja actual el conjunto incluye los catorce selectores que declaran `overflow` u `overflow-y` en `auto` o `scroll`

### CR2 — La derivación reconoce `scroll`, no solo `auto`

- **Given** una regla que declara `overflow: scroll` u `overflow-y: scroll`
- **When** el test deriva su conjunto de scrollers
- **Then** esa regla aparece en el conjunto, igual que si declarara `auto`

### CR3 — Ningún scroller vertical se descarta en silencio

- **Given** un selector con desbordamiento vertical cuya forma el test no sabe normalizar a una clase simple
- **When** el test se ejecuta
- **Then** falla nombrando ese selector, en vez de omitirlo del conjunto
- **And** sobre la hoja actual no hay ninguno, así que el test pasa por cumplirse la regla y no por no mirar

### CR4 — Todo lo que scrollea detrás del overlay está bloqueado

- **Given** la hoja de estilos actual
- **When** se comparan los scrollers verticales de detrás del overlay con la lista de `.detail-open`
- **Then** los doce están en la lista, incluidos `.projects-list`, `.project-editor`, `.ledger-source` y `.config-migration-yaml`
- **And** `.detail` y `.diagram-canvas` quedan fuera del conjunto por vivir delante del overlay, no por una excepción que los nombre uno a uno en la comparación

### CR5 — El invariante sigue en pie en el viewer

- **Given** el viewer en ejecución con un board más alto que la ventana
- **When** se abre el detalle de un change y se recorren las vistas que tienen disparador
- **Then** la única barra de scroll vertical sigue siendo la de `#detail`
- **And** al cerrarlo, el board recupera el `scrollTop` que tenía

## Plan

- [x] Endurecer la derivación: descender a las at-rules, aceptar `scroll` y denunciar lo que no sepa normalizar
  - **Target:** `test/viewer-metadata.test.mjs`
  - **Verify:** `pnpm test test/viewer-metadata.test.mjs`
  - **Criteria:** CR1, CR2, CR3
  - **Resolved:** `2026-10-26T17:04:29Z`
- [x] Completar la lista de bloqueo con los cuatro selectores que faltan
  - **Target:** `src/viewer/public/styles.css`
  - **Verify:** `pnpm test test/viewer-metadata.test.mjs`
  - **Criteria:** CR4
  - **Resolved:** `2026-10-26T17:04:29Z`
- [ ] Comprobar el invariante en el viewer en ejecución y anotar las cifras en el Log
  - **Support:** el layout computado no lo cubre la suite; se mide con el navegador
- [ ] Pasar la puerta local completa
  - **Support:** `pnpm verify`

## Log
- **2026-10-26T16:58:39Z** `[version]` 1.0.0
- **2026-10-26T17:01:05Z** `[status]` draft → approved (human via conversation)
- **2026-10-26T17:01:14Z** `[status]` approved → in-progress
- **2026-10-26T17:01:14Z** `[branch]` set: change/20261026-165839 (auto)
- **2026-10-26T17:06:21Z** `[note]` Derivacion endurecida: el scanner desciende a las at-rules, acepta overflow scroll y falla nombrando cualquier selector con desbordamiento vertical que no sepa normalizar, en vez de descartarlo. Medido sobre la hoja: catorce selectores con desbordamiento vertical, doce detras del overlay y dos delante (.detail y .diagram-canvas). El test en rojo senalo .projects-list antes de tocar el CSS.
