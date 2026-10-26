---
id: "20261026-165839"
title: El bloqueo de scroll del detalle no ve todo lo que puede scrollear
type: change
status: in-progress
created: 2026-10-26T16:58:39Z
depends_on: []
reviewed: true
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

### CR6 — Una at-rule de sentencia no se traga la regla siguiente

- **Given** una hoja con `@import url("x");` o `@layer base;` seguido de una regla que declara desbordamiento vertical
- **When** el test deriva su conjunto de scrollers
- **Then** esa regla aparece en el conjunto, en vez de absorberse en el selector de la at-rule y perderse

### CR7 — Una regla con anidamiento conserva sus propias declaraciones

- **Given** una regla que declara desbordamiento vertical y contiene además una regla anidada
- **When** el test deriva su conjunto de scrollers
- **Then** la regla externa aparece en el conjunto por su propia declaración
- **And** la regla anidada se examina por separado, sin heredar ni destruir el cuerpo de la externa

### CR8 — Lo que vive delante del overlay se excluye por lista, no por prefijo

- **Given** un selector con desbordamiento vertical cuyo nombre empieza por `detail` o `diagram-` pero que no es ni el detalle ni el lightbox
- **When** el test compara los scrollers con la lista de bloqueo
- **Then** ese selector se exige bloqueado, en vez de excluirse por parecerse de nombre a los que van delante
- **And** la exclusión nombra exactamente los dos que hoy van delante, `.detail` y `.diagram-canvas`, de modo que añadir un tercero es un acto deliberado y no un efecto del prefijo

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
- [x] Comprobar el invariante en el viewer en ejecución y anotar las cifras en el Log
  - **Support:** el layout computado no lo cubre la suite; se mide con el navegador
  - **Resolved:** `2026-10-26T17:06:28Z`
- [ ] Reescribir el scanner para que lleve el cuerpo de cada regla por su propio nivel y corte el selector en `;`
  - **Target:** `test/viewer-metadata.test.mjs`
  - **Verify:** `pnpm test test/viewer-metadata.test.mjs`
  - **Criteria:** CR6, CR7
- [x] Sustituir el prefijo de exclusión por la lista exacta de lo que va delante
  - **Target:** `test/viewer-metadata.test.mjs`
  - **Verify:** `pnpm test test/viewer-metadata.test.mjs`
  - **Criteria:** CR8
  - **Resolved:** `2026-10-26T17:37:59Z`
- [x] Pasar la puerta local completa
  - **Support:** `pnpm verify`
  - **Resolved:** `2026-10-26T17:09:13Z`

## Log
- **2026-10-26T16:58:39Z** `[version]` 1.0.0
- **2026-10-26T17:01:05Z** `[status]` draft → approved (human via conversation)
- **2026-10-26T17:01:14Z** `[status]` approved → in-progress
- **2026-10-26T17:01:14Z** `[branch]` set: change/20261026-165839 (auto)
- **2026-10-26T17:06:21Z** `[note]` Derivacion endurecida: el scanner desciende a las at-rules, acepta overflow scroll y falla nombrando cualquier selector con desbordamiento vertical que no sepa normalizar, en vez de descartarlo. Medido sobre la hoja: catorce selectores con desbordamiento vertical, doce detras del overlay y dos delante (.detail y .diagram-canvas). El test en rojo senalo .projects-list antes de tocar el CSS.
- **2026-10-26T17:06:22Z** `[note]` Faltaban cuatro en la lista, no dos: .projects-list, .project-editor, .ledger-source y .config-migration-yaml. Los dos ultimos probablemente no desborden hoy, pero se bloquean igual porque juzgar caso por caso lo que no scrollea en la practica es lo que dejo pasar los dos defectos de 20261026-134323.
- **2026-10-26T17:06:22Z** `[note]` El bloque de bloqueo se movio al final de la hoja: .config-migration-yaml se declara en la linea 1976, despues de donde estaba, y biome marcaba especificidad descendente. La cascada no dependia del orden, pero la hoja ahora cumple la regla del linter.
- **2026-10-26T17:06:28Z** `[note]` CR5 medido a 1440x900 en el proyecto backend-laravel: board 17825 sobre 834 con scrollTop 1200, table 5375 sobre 845 con scrollTop 600, y ledger-content con scrollTop 500. En los tres, con el detalle abierto la unica barra vertical es la de #detail, y el scrollTop se conserva al cerrar.
- **2026-10-26T17:09:14Z** `[status]` in-progress → in-review
- **2026-10-26T17:21:06Z** `[review]` in-review → done (delegated subagent, clean context)
- **2026-10-26T17:21:13Z** `[finding]` El scanner de reglas tiene dos cegueras de parseo que hoy no se alcanzan: una at-rule terminada en punto y coma (@import, @layer base;, @charset) se absorbe en el selector siguiente y se traga esa regla, y el anidamiento CSS nativo (& .child) parte la regla padre y pierde sus declaraciones en silencio. La hoja no usa ninguna de las dos construcciones. Es la misma clase de punto ciego que este change vino a quitar.
- **2026-10-26T17:21:14Z** `[finding]` IN_FRONT excluye por prefijo (.detail, .diagram-), asi que un panel futuro que se llamara .detail-algo y viviera detras del overlay quedaria excluido en silencio. Las trece clases actuales con ese prefijo son todas parte del detalle o del lightbox, verificado; es riesgo de convencion de nombres, no defecto.
- **2026-10-26T17:21:21Z** `[note]` La revision senalo que el conjunto locked no filtraba por overflow hidden y que .detail-open suelto entraba en el. Comprobado: el filtro si exige overflow hidden en el cuerpo, y el conjunto sale con los doce selectores exactos, sin .detail-open. La observacion no se registra como finding.
- **2026-10-26T17:21:47Z** `[graduation]` spec: `viewer.md`
- **2026-10-26T17:35:30Z** `[status]` done → in-progress (agent)
- **2026-10-26T17:35:37Z** `[finding]` 1 dropped: absorbido en este mismo change: la frontera aprobada ya cubre el scanner de reglas
- **2026-10-26T17:35:38Z** `[finding]` 2 dropped: absorbido en este mismo change: la frontera aprobada ya cubre el patron de scrollers
- **2026-10-26T17:41:25Z** `[note]` Absorbidos los dos findings que dejo la revision: la frontera aprobada ya cubria el scanner de reglas y el patron de scrollers, asi que se arreglan aqui en vez de en un change aparte. El scanner pasa a llevar el cuerpo de cada regla en su propio nivel —una regla anidada ya no destruye las declaraciones de la externa— y corta el selector en punto y coma, de modo que @import o @layer base; no se tragan la regla siguiente.
- **2026-10-26T17:41:25Z** `[note]` IN_FRONT deja de ser un prefijo y pasa a ser la lista exacta de los dos que van delante. Verificado en rojo revirtiendo el prefijo: con el, .detail-sidebar, .detail-notes y .diagram-index se excluian en silencio pese a vivir detras del overlay.
- **2026-10-26T17:41:32Z** `[status]` in-progress → in-review
- **2026-10-26T17:51:55Z** `[status]` in-review → in-progress
