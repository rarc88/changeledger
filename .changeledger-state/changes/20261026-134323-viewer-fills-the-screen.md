---
id: "20261026-134323"
title: El board desaprovecha la pantalla y el viewer arrastra dos scrolls
type: change
status: approved
created: 2026-10-26T13:43:23Z
depends_on: []
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

### CR1 — El board reparte el ancho entre los carriles que hay

- **Given** el viewer abierto en una ventana de 1920px con cinco carriles visibles
- **When** se renderiza el board
- **Then** las columnas reparten el ancho del contenedor sin dejar franja vacía a la derecha, en lugar de los 1573px de 1920 que ocupan hoy
- **And** cada columna mide 190px o más, y el board solo scrollea en horizontal cuando los carriles ya no caben a ese mínimo
- **And** `src/viewer/public/styles.css` no contiene ningún divisor fijo de carriles ni `max-width` de columna

### CR2 — La página no scrollea

- **Given** el viewer abierto en cualquiera de sus vistas, con la barra superior en una o en dos filas
- **When** se mide el documento
- **Then** `document.documentElement.scrollHeight` no supera su `clientHeight`
- **And** ninguna regla de `styles.css` calcula una altura restando `--header-height`

### CR3 — Con el detalle abierto solo scrollea el detalle

- **Given** un board con más cards de las que caben en la ventana
- **When** se abre el detalle de un change, en modo panel lateral o en modal flotante
- **Then** el único contenedor con scroll vertical es `#detail`
- **And** al cerrarlo, el board recupera su scroll en la posición en la que estaba

### CR4 — El control de rechazo reparte su fila

- **Given** un change en `done` no incluido en ninguna release
- **When** se abre su detalle y se mide la fila de controles
- **Then** el campo de razón mide 190px o más, frente a los 169px de hoy
- **And** el botón `Send back with reason` mide su contenido, no los 669px de hoy
- **And** `.validation-controls` declara tantas pistas de grid como hijos renderiza `rejectionPanel`

## Specification

## Plan

## Log
- **2026-10-26T13:47:14Z** `[version]` 1.0.0
- **2026-10-26T13:47:14Z** `[status]` draft → approved (human via conversation)
