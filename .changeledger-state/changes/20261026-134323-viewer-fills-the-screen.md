---
id: "20261026-134323"
title: El board desaprovecha la pantalla y el viewer arrastra dos scrolls
type: change
status: in-progress
created: 2026-10-26T13:43:23Z
depends_on: []
branch: change/20261026-134323
related_to: ["20260703-220013", "20261018-131621"]
owner: raruiz-hiberuscom
---

## Request

Tras la migración a 1.0.0 el viewer quedó con tres defectos de layout que se ven
en cuanto se abre en una pantalla grande: las columnas del board dejan una
franja vacía a la derecha, aparece una segunda barra de scroll vertical, y el
control para devolver un change al implementador sale deformado.

### Investigation

Los tres defectos están medidos sobre el viewer en ejecución (`changeledger view .`),
no inferidos.

**Ancho de columna cableado a seis carriles.** `.board` y `.column` en
`src/viewer/public/styles.css` repiten la misma expresión
`clamp(190px, calc((100vw - 140px) / 6), 400px)`: un divisor fijo de seis y un
techo de 400px. El número de carriles es dinámico — sale de `statuses` en
`config.yml` y de los filtros activos — así que el divisor casi nunca coincide
con los carriles que hay. Medido a 1920px con cinco carriles: 5 × 297px más
huecos y padding suman 1573px de 1920, con 347px desaprovechados. La expresión
viene de `#20260703-220013`, que la introdujo para evitar el desbordamiento
horizontal; aquel objetivo sigue siendo válido y el suelo de 190px lo sostiene
sin el divisor.

**Dos modelos de altura compitiendo.** Cada vista fija
`height: calc(100dvh - var(--header-height))`, y `--header-height` lo sincroniza
un `ResizeObserver` en `src/viewer/public/app.js` desde `topbar.offsetHeight`,
que es entero. Cuando la barra superior mide una altura fraccionaria — medido:
94,5px rendidos frente a 95 publicados en la variable — el documento desborda
por esa fracción y el navegador pinta la barra de la página además de la de la
vista. El modelo de altura es el defecto; la variable y su observador son el
parche que lo sostiene.

**El fondo conserva su scroll con el detalle abierto.** Al abrir el detalle no
se bloquea el scroll del contenedor de debajo: con el board más alto que la
ventana quedan dos barras verticales a la vez, la del `#detail` y la del
`.board`.

**Pista de grid huérfana en el panel de veredicto.** `.validation-controls`
declara tres pistas (`auto minmax(190px, 1fr) auto`), pero `rejectionPanel` en
`src/viewer/public/view-parts.js` renderiza dos hijos desde que
`#20261018-131621` (CR23) retiró el botón de aceptar. El campo de razón cae en
la pista `auto` y el botón en la `1fr`. Medido: input 169px — por debajo de su
propio mínimo declarado —, botón 669px, tercera pista 0px.

### Objective

El viewer usa el ancho disponible en pantallas grandes, presenta una sola barra
de scroll vertical en cada situación, y el control de rechazo del veredicto
reparte su fila entre campo y botón. Está terminado cuando las cuatro CR se
cumplen con el viewer en ejecución y la suite sigue en verde.

### Frontier

Dentro: el layout del board y sus columnas, el modelo de altura de las vistas y
el bloqueo de scroll del overlay, y la fila de controles del panel de rechazo.
Los ficheros son `src/viewer/public/styles.css`, `src/viewer/public/app.js` y
`src/viewer/public/view-parts.js`.

Fuera: retirar la vista Graph, que es una decisión de producto y va en su propio
change; cualquier otro rediseño visual del viewer; y el trabajo sin commitear de
otra sesión, que vive en otro worktree y no se toca.

Preautorizado dentro: eliminar la variable `--header-height` y su
`ResizeObserver` si el modelo de altura que los sustituye los deja sin uso, y
ajustar los tests que afirmen sobre el CSS o el DOM que esta frontera cambia.

## Specification

### Proposal

**Un solo modelo de altura, sin variable intermedia.** El `body` pasa a ser un
contenedor flex en columna de `100dvh` con `overflow: hidden`; la barra superior
es un item rígido y la vista visible es `flex: 1 1 auto` con `min-height: 0` y su
propio `overflow`. Las cuatro reglas que hoy restan `--header-height` desaparecen,
y con ellas la variable y el `ResizeObserver` que la sincronizaba, que eran el
parche de un modelo que el navegador ya resuelve. Descartado subir la precisión
de la variable — con `getBoundingClientRect().height` en vez de `offsetHeight` —
porque deja en pie dos fuentes de verdad para la misma altura y el error vuelve
en cuanto la barra cambie de filas.

El bloque móvil de `max-width: 680px` devuelve el `body` a `height: auto` y
`overflow: visible`: ahí la página scrollea a propósito, con los carriles
apilados, y ese comportamiento se conserva.

**El carril se dimensiona por la pista de grid, no por sí mismo.** `.board`
declara `grid-auto-columns: minmax(190px, 1fr)` y `.column` deja de declarar
`width`, `min-width`, `max-width` y `flex`: las pistas implícitas reparten el
ancho libre del contenedor sea cual sea su número, y el suelo de 190px mantiene
el scroll horizontal de `#20260703-220013` cuando ya no caben. Descartado
calcular el divisor en JavaScript a partir de los carriles renderizados: añade
una sincronización que el grid hace solo.

**El fondo deja de ofrecer una segunda barra.** `.detail-open` ya bloquea el
scroll del documento, pero el board es un contenedor de scroll propio y
sobrevive al bloqueo. Se le añade el bloqueo del scroller de la vista mientras el
detalle está abierto, preservando la posición de scroll al cerrarlo, y
`overscroll-behavior: contain` en `.detail` para que la rueda no encadene al
fondo.

**La fila de veredicto declara las pistas que renderiza.**
`.validation-controls` pasa de tres pistas a `minmax(190px, 1fr) auto`, la misma
forma que ya tiene `.reopen-controls`: el campo de razón se lleva el espacio
libre y el botón mide su contenido.

### CR1 — El board reparte el ancho entre los carriles que hay

- **Given** el viewer abierto en una ventana de 1920px de ancho con cinco carriles visibles
- **When** se renderiza el board
- **Then** las columnas y sus huecos ocupan el ancho del contenedor sin dejar franja vacía a la derecha, frente a los 1573px de 1920 que ocupan hoy
- **And** cada columna mide 190px o más, y `.board` solo desborda en horizontal cuando los carriles ya no caben a ese mínimo
- **And** la regla `.board` de `src/viewer/public/styles.css` declara `grid-auto-columns: minmax(190px, 1fr)`, y la regla `.column` no declara `width`, `min-width`, `max-width` ni `flex`

### CR2 — La página no scrollea en el layout de escritorio

- **Given** el viewer abierto por encima de 680px de ancho, en cualquiera de sus vistas y con la barra superior en una o en dos filas
- **When** se mide el documento
- **Then** `document.documentElement.scrollHeight` no supera su `clientHeight`
- **And** ninguna regla de `src/viewer/public/styles.css` calcula una altura restando `--header-height`, la variable no se declara y `src/viewer/public/app.js` no contiene ningún `ResizeObserver` que la escriba

### CR3 — Por debajo de 680px el layout apilado conserva el scroll de página

- **Given** el viewer abierto en una ventana de 375px de ancho
- **When** se renderiza el board
- **Then** los carriles se apilan en vertical a ancho completo y la página es la que scrollea
- **And** el bloque `@media (max-width: 680px)` devuelve al `body` `height: auto` y `overflow: visible`

### CR4 — Con el detalle abierto solo scrollea el detalle

- **Given** un board con más cards de las que caben en la ventana, por encima de 680px de ancho
- **When** se abre el detalle de un change, en modo panel lateral y en modal flotante
- **Then** el único contenedor con barra de scroll vertical es `#detail`
- **And** al cerrar el detalle, `.board` recupera el `scrollTop` que tenía antes de abrirlo
- **And** `.detail` declara `overscroll-behavior: contain`

### CR5 — El control de rechazo reparte su fila

- **Given** un change en `done` no incluido en ninguna release, abierto en su detalle a 1920px
- **When** se mide la fila `.validation-controls`
- **Then** el campo de razón mide 190px o más, frente a los 169px de hoy
- **And** el botón `Send back with reason` mide su contenido, no los 669px de hoy
- **And** `.validation-controls` declara exactamente dos pistas de grid, las mismas que hijos renderiza `rejectionPanel` en `src/viewer/public/view-parts.js`

## Plan

- [x] Retargetear el test que fija el mecanismo retirado del board
  - **Target:** `test/viewer-metadata.test.mjs`
  - **Verify:** `pnpm test test/viewer-metadata.test.mjs`
  - **Criteria:** CR1, CR2
  - **Resolved:** `2026-10-26T13:55:30Z`
- [x] El board reparte el ancho entre las pistas de grid
  - **Target:** `src/viewer/public/styles.css`
  - **Verify:** `pnpm test test/viewer-metadata.test.mjs`
  - **Criteria:** CR1
  - **Resolved:** `2026-10-26T13:55:31Z`
- [x] El body es el contenedor flex de altura y las vistas son su item elástico
  - **Target:** `src/viewer/public/styles.css`
  - **Verify:** `pnpm test test/viewer-metadata.test.mjs`
  - **Criteria:** CR2, CR3
  - **Resolved:** `2026-10-26T13:55:32Z`
- [x] Retirar `--header-height` y el `ResizeObserver` que la escribía
  - **Target:** `src/viewer/public/app.js`
  - **Verify:** `pnpm test test/viewer-metadata.test.mjs`
  - **Criteria:** CR2
  - **Resolved:** `2026-10-26T13:55:33Z`
- [x] Bloquear el scroller de la vista mientras el detalle está abierto
  - **Target:** `src/viewer/public/styles.css`
  - **Verify:** `pnpm test test/viewer-metadata.test.mjs`
  - **Criteria:** CR4
  - **Resolved:** `2026-10-26T13:55:33Z`
- [x] La fila de veredicto declara dos pistas
  - **Target:** `src/viewer/public/styles.css`
  - **Verify:** `pnpm test test/viewer-metadata.test.mjs`
  - **Criteria:** CR5
  - **Resolved:** `2026-10-26T13:55:34Z`
- [x] Medir las cinco CR en el viewer en ejecución y anotar las cifras en el Log
  - **Support:** el layout computado no lo cubre la suite; se mide con el navegador contra `changeledger view .`
  - **Resolved:** `2026-10-26T13:58:57Z`
- [x] Pasar la puerta local completa
  - **Support:** `pnpm verify`
  - **Resolved:** `2026-10-26T14:03:08Z`

## Log
- **2026-10-26T13:47:14Z** `[version]` 1.0.0
- **2026-10-26T13:47:14Z** `[status]` draft → approved (human via conversation)
- **2026-10-26T13:47:31Z** `[status]` approved → in-progress
- **2026-10-26T13:47:31Z** `[branch]` set: change/20261026-134323 (auto)
- **2026-10-26T13:58:41Z** `[note]` CR1 medido a 1920px: 7 carriles de 256px, borde derecho en 1893 (1920 menos padding y barra); antes 5 carriles de 297px dejaban 347px vacios. A 1024px los carriles caen al suelo de 190px y el board desborda en horizontal, como pedia 20260703-220013.
- **2026-10-26T13:58:41Z** `[note]` CR2 medido con la barra superior en una fila (1280px, 55px) y en dos (1024px y 1101px, 94,5px fraccionarios: el caso que rompia): scrollHeight igual a clientHeight en los tres, la pagina no scrollea.
- **2026-10-26T13:58:42Z** `[note]` CR3 medido a 403px: carriles apilados a ancho completo, body en overflow visible, la pagina scrollea 16636 sobre 812.
- **2026-10-26T13:58:50Z** `[note]` CR4 medido con el board a 12606px de alto: con el detalle abierto el unico contenedor con scroll vertical es #detail, en panel lateral y en modal flotante a tamano full; el scrollTop del board (1500 y 2000) se conserva antes, durante y despues de cerrarlo.
- **2026-10-26T13:58:51Z** `[note]` CR5 medido a 1920px en un change done: campo de razon 691px y boton 157px, frente a los 169px y 669px de antes; grid de dos pistas.
- **2026-10-26T13:58:52Z** `[note]` Decision no especificada en el documento: el bloqueo del fondo se hace con overflow hidden sobre los scrollers de la vista, no ocultando su barra, porque se midio que el motor conserva el scrollTop al alternar hidden y auto. Residuo no tocado, fuera de frontera: .reopen-controls en styles.css es CSS muerto desde que se retiro el comando reopen.
- **2026-10-26T14:03:13Z** `[status]` in-progress → in-review
- **2026-10-26T14:03:53Z** `[note]` changeledger commit sin --id resolvio el unico change in-progress, que era 20261026-135523 de otra sesion, y estampo ese id en el commit; se corrigio con git commit --amend al id correcto y changeledger check --commits quedo en verde.
- **2026-10-26T14:11:23Z** `[review]` in-review → in-progress: CR2 roto en la vista Projects entre 681px y 900px: .projects-view quedo como item flex elastico sin overflow propio, y el bloque de max-width 900px retira los scrollers internos; medido a 800x700 el contenedor mide 566px con 6316px de contenido y overflow visible, con el body bloqueado, asi que el contenido es inalcanzable. Regresion introducida por este change.
- **2026-10-26T14:15:57Z** `[note]` Correccion del fail: .projects-view declara overflow auto y el bloque de max-width 900px deja de fijarle height auto; .graph se alinea al mismo modelo. Medido a 700, 800 y 899px la vista Projects scrollea por dentro (6334 sobre 566) y la pagina no; a 901px sigue cabiendo. Barrido de las seis vistas a 800px: ninguna recorta contenido.
- **2026-10-26T14:15:58Z** `[note]` Decision: el min-height de .ledger-view en el bloque movil, que restaba --header-height, se retira sin sustituto en vez de reintroducir una variable; por debajo de 680px la vista puede quedar mas corta que la pantalla y el fondo lo pone el body.
- **2026-10-26T14:15:59Z** `[note]` El test 134323 CR2 pasa a exigir a las siete vistas flex, min-height y overflow propio: la regresion fue dar a una de ellas el dimensionado elastico sin scroller.
- **2026-10-26T14:16:06Z** `[status]` in-progress → in-review
- **2026-10-26T14:28:30Z** `[review]` in-review → in-progress: CR4 roto en Graph: .graph recibio flex 1 1 auto y min-height 0 en la correccion anterior, lo que lo convirtio en contenedor de scroll, pero no se anadio a la lista de bloqueo de .detail-open; medido a 1920 con el detalle abierto pinta su barra (gutter 15px) junto a la del detalle (13px). Misma clase de agujero que la ronda anterior. Ademas .ledger-content sigue scrolleando bajo el overlay en la categoria Specs (15px junto a 13px), que CR4 tampoco admite.
- **2026-10-26T14:34:01Z** `[note]` Segunda correccion: la lista de bloqueo de .detail-open se consolida en un unico bloque al final de la hoja, despues de todas las reglas que sobreescribe, y pasa a cubrir .graph, .projects-view y .ledger-content ademas del board y las tres vistas que ya cubria. Medido a 1920 en board, table, graph y ledger-Specs: con el detalle abierto la unica barra vertical es la de #detail (13px); el scrollTop del board (1500) y el de .ledger-content (800) se conservan al cerrar.
- **2026-10-26T14:34:02Z** `[note]` La causa de las dos rondas fallidas es la misma: hacer una vista elastica sin atarla a la lista de bloqueo. El test nuevo deriva ambos conjuntos de la propia hoja de estilos y exige que todo lo que declara overflow auto detras del overlay este en la lista, en vez de enumerarla a mano.
