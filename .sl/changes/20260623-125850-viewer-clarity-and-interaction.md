---
id: "20260623-125850"
title: Mejorar legibilidad e interacción del viewer
type: feature
status: in-review
created: 2026-06-23T12:58:50Z
depends_on: []
owner: Roberto Ruiz
---

## Request

El viewer acumuló estados hasta convertir la barra superior en una fila de
chips difícil de recorrer y que compite con la navegación principal. Además,
varias interacciones no representan fielmente el estado actual: activar
`Discarded` revela los changes en Table pero no crea su columna en Board, y las
acciones de validación siguen disponibles en el detalle después de aceptar o
rechazar correctamente un change.

La lectura del contenido también tiene fricciones visibles. El bloque de
validación parece un formulario sin diseñar, el botón de cierre del panel lateral
no pertenece al lenguaje visual del resto del viewer, los diagramas Mermaid
complejos se encogen hasta resultar ilegibles, el historial de graduaciones al
inicio de una spec ocupa una pared de texto y la tabla parte valores cortos en
varias líneas. Se solicita una revisión coherente de estas superficies, no solo
correcciones puntuales.

## Investigation

- `hydrateFilters()` crea un chip por cada estado dentro de `#status-filter` y
  `styles.css` fuerza `flex-wrap: nowrap`; al sumar los toggles separados de
  archivados y descartados, la barra deja poco espacio para las vistas.
- `passesTombstones()` permite ver un change descartado cuando
  `showDiscarded` está activo, pero `boardStatuses()` elimina siempre
  `discarded`. Por eso Table y Graph lo reciben y Board no tiene una columna
  donde renderizarlo.
- Tras un `POST /api/status` exitoso, `moveStatus()` recarga los datos del board
  pero no cierra ni vuelve a renderizar el detalle abierto. Su formulario queda
  vivo con el snapshot anterior y permite repetir la acción. Tampoco existe un
  estado pendiente que evite un doble submit.
- `.validation-actions` usa controles HTML prácticamente nativos y `.close`
  solo posiciona el carácter `×`, sin fondo, borde, tamaño de hit target ni
  estado de foco coherentes.
- `renderMermaid()` reemplaza los bloques con un SVG dentro del ancho del panel;
  no registra una interacción para verlo a mayor tamaño.
- Las specs guardan su procedencia como líneas consecutivas de blockquote
  `Graduado del change …`. Markdown las fusiona visualmente en un único bloque
  largo sin jerarquía ni resumen.
- `tableRow()` imprime el status como texto plano y todas las celdas heredan el
  wrapping normal. En un viewport estrecho se parten ID, status y progreso,
  aunque la única columna que necesita varias líneas es `Deps`.
- El viewer ya usa `lit-html`, `marked`, `DOMPurify` y Mermaid; estas mejoras no
  requieren una nueva dependencia de runtime.

## Proposal

Mantener la estética oscura, compacta y utilitaria del viewer, pero ordenar su
densidad con controles deliberados y estados explícitos:

1. Sustituir la fila de chips por un único control `Status` que abra un popover
   accesible de checkboxes. El trigger mostrará `All statuses`, el nombre del
   único estado seleccionado o `N statuses`; el popover ofrecerá limpiar la
   selección. `Archived` y `Discarded` vivirán en una sección `Visibility` del
   mismo menú porque modifican la visibilidad, aunque no sean filtros de estado.
2. Mantener `discarded` fuera del Board por defecto y añadir su columna al final
   únicamente cuando se active `Discarded`. La columna también aparecerá vacía,
   para que la activación tenga feedback inequívoco.
3. Convertir la validación humana en una tarjeta compacta con título, explicación
   breve y dos acciones claramente jerarquizadas. Durante el request se
   deshabilitan todos los controles; al éxito se cierra el detalle y se recarga
   el repositorio, y al error se conservan los datos y se rehabilitan controles.
4. Usar un botón de cierre circular con icono SVG, hit target de 32 px y estados
   hover/focus. El mismo patrón cerrará tanto detalle como diagramas expandidos.
5. Marcar cada Mermaid renderizado como ampliable. Click o teclado abrirán un
   lightbox sobre el viewer con el SVG completo, scroll en ambos ejes, cierre por
   botón, `Escape` o backdrop y retorno de foco al diagrama de origen.
6. Al renderizar una spec, reconocer solo el bloque inicial contiguo de líneas
   `> Graduado del change …` y presentarlo como un `<details>` colapsado con
   contador y lista legible. El resto del Markdown conservará exactamente su
   semántica y sanitización actuales; otros blockquotes no se reinterpretan.
7. En Table, aplicar una política explícita: ID, Title, Type, Status y Progress
   permanecen en una línea y la tabla usa scroll horizontal cuando hace falta;
   únicamente `Deps` puede envolver. Status se mostrará como badge delineado con
   punto de color y texto en formato humano, visualmente distinto del badge
   sólido y en mayúsculas de Type.

No se cambiará el formato persistente de changes/specs ni se añadirá una
preferencia guardada: el alcance es presentación e interacción de la sesión
actual.

## Specification

### CR1 — Selector compacto de estados
- **Given** un repositorio con los estados `draft`, `approved`, `in-progress`, `in-review`, `in-validation`, `blocked`, `done` y `discarded`
- **When** abro el control `Status` y marco `draft` e `in-validation`
- **Then** el trigger muestra `2 statuses` y solo son visibles los changes de esos dos estados
- **And** el menú incluye una acción `Clear` que devuelve el trigger a `All statuses`
- **And** `Archived` y `Discarded` aparecen como checkboxes en una sección `Visibility`

### CR2 — Discarded tiene columna condicional en Board
- **Given** un repositorio con al menos un change `discarded` y la visibilidad `Discarded` desactivada
- **When** activo `Discarded` desde el selector y estoy en Board
- **Then** aparece al final una columna `Discarded` con el número y las tarjetas correspondientes
- **And** al desactivarlo la columna y sus tarjetas desaparecen
- **And** la misma selección conserva la visibilidad actual en Table y Graph

### CR3 — Validación de una sola ejecución
- **Given** un detail abierto para un change `in-validation`
- **When** acepto el change o lo rechazo con un motivo no vacío
- **Then** los botones y el input quedan deshabilitados mientras el request está pendiente
- **And** un éxito cierra el detail, elimina el formulario obsoleto y refresca Board/Table con el nuevo estado
- **And** un error mantiene abierto el detail, muestra el error actual y vuelve a habilitar los controles sin perder el motivo escrito

### CR4 — Formulario y cierre coherentes
- **Given** un detail abierto para un change `in-validation`
- **When** observo y recorro con teclado su cabecera y tarjeta de validación
- **Then** el cierre es un botón circular con icono, nombre accesible `Close detail`, hit target mínimo de 32 por 32 px y foco visible
- **And** la tarjeta separa visualmente la acción primaria `Accept change` de la acción destructiva `Reject with reason`
- **And** el input de rechazo tiene label accesible y error visible cuando el motivo está vacío

### CR5 — Mermaid ampliable
- **Given** una spec o change cuyo Markdown contiene un diagrama Mermaid renderizado
- **When** hago click en el diagrama o lo activo con teclado
- **Then** se abre un lightbox con una copia ampliada del SVG y scroll horizontal y vertical cuando excede el viewport
- **And** puedo cerrarlo con su botón `Close diagram`, con `Escape` o con click en el backdrop
- **And** al cerrar, el foco regresa al diagrama que lo abrió

### CR6 — Historial de graduaciones legible
- **Given** una spec cuyo body comienza con 28 líneas contiguas `> Graduado del change …`
- **When** abro su detalle
- **Then** veo un bloque colapsado `Graduation history · 28` seguido por el contenido normal de la spec
- **And** al expandirlo las 28 entradas aparecen como una lista, una por línea
- **And** un blockquote posterior que no coincide con ese prefijo sigue renderizándose como Markdown normal

### CR7 — Tabla sin cortes accidentales
- **Given** la vista Table en un ancho donde antes se partían `#20260613-134548`, `done` y `8/8 (100%)`
- **When** se renderiza la fila
- **Then** ID, Title, Type, Status y Progress permanecen cada uno en una sola línea
- **And** únicamente la celda Deps puede ocupar varias líneas
- **And** el contenedor ofrece scroll horizontal en vez de comprimir esas celdas

### CR8 — Status distinguible de Type
- **Given** filas con type `feature` y statuses `in-validation`, `done` y `discarded`
- **When** observo la tabla
- **Then** Type conserva su badge sólido en mayúsculas
- **And** Status usa un badge delineado con punto de color, texto en formato `In validation`, `Done` o `Discarded` y contraste legible
- **And** valores no configurados usan el color neutral sin producir CSS inseguro

### CR9 — Ajustes finos de controles, tabla y Board
- **Given** el selector de estados abierto, una Table ordenada y un Board con la visibilidad `Discarded` activa
- **When** hago click fuera del selector y observo los controles y filas resultantes
- **Then** el selector se cierra y su chevron derecho usa el mismo lenguaje SVG que el resto de iconos
- **And** el indicador de orden ocupa como máximo 10 por 10 px
- **And** el contenido de todas las celdas queda centrado verticalmente
- **And** añadir la columna `Discarded` conserva el ancho de las siete columnas normales y añade scroll horizontal en vez de comprimirlas

## Plan

- [x] Escribir tests de comportamiento para el selector compacto, su resumen, Clear y visibilidad en `test/app-state.test.mjs` y/o un nuevo test DOM del viewer; implementar el estado y templates en `src/viewer/public/app-state.js`, `src/viewer/public/app.js` e `src/viewer/public/index.html`; verificar con `node --test test/app-state.test.mjs test/viewer-metadata.test.mjs` (CR1) — 2026-06-23T13:53:58Z
- [x] Escribir el test de columna condicional y hacer que `src/viewer/public/state.js` y `src/viewer/public/app.js` incluyan `discarded` solo al activarlo; verificar con `node --test test/viewer-metadata.test.mjs` (CR2) — 2026-06-23T13:53:59Z
- [x] Escribir tests DOM del estado pending/success/error de validación y rediseñar el flujo en `src/viewer/public/app.js`, `src/viewer/public/view-parts.js` y `src/viewer/public/styles.css`; verificar con `node --test test/viewer-metadata.test.mjs test/view.test.mjs` (CR3, CR4) — 2026-06-23T13:53:59Z
- [x] Escribir tests DOM de apertura y cierre accesible y añadir el lightbox Mermaid en `src/viewer/public/app.js`, `src/viewer/public/security.js`, `src/viewer/public/index.html` y `src/viewer/public/styles.css`; verificar con `node --test test/viewer-sanitize.test.mjs test/viewer-metadata.test.mjs` (CR5) — 2026-06-23T13:53:59Z
- [x] Escribir tests de separación del historial inicial y crear el renderer de spec en `src/viewer/public/view-parts.js` y `src/viewer/public/app.js` sin relajar la sanitización; verificar con `node --test test/viewer-sanitize.test.mjs test/viewer-metadata.test.mjs` (CR6) — 2026-06-23T13:53:59Z
- [x] Escribir tests de clases/estructura de celdas y badge seguro, actualizar `src/viewer/public/view-parts.js` y `src/viewer/public/styles.css`, y verificar con `node --test test/viewer-metadata.test.mjs` (CR7, CR8) — 2026-06-23T13:53:59Z
- [x] Ejecutar `pnpm verify` y comprobar manualmente Board, Table, detail, spec y Mermaid a 1920 px y 680 px en el viewer local (support) — 2026-06-23T13:54:00Z
- [x] Añadir tests y ajustar cierre exterior, iconos, alineación de Table y ancho estable del Board en `src/viewer/public/app.js` y `src/viewer/public/styles.css`; verificar con `node --test test/viewer-metadata.test.mjs` y comprobación visual a 1920 px (CR9) — 2026-06-23T14:08:33Z

## Log

- **2026-06-23T12:58:50Z** — Draft creado a partir de los siete defectos visuales reportados y de la inspección de sus rutas actuales en el viewer.
- **2026-06-23T13:42:13Z** — status: draft → approved
- **2026-06-23T13:43:31Z** — status: approved → in-progress
- **2026-06-23T13:43:31Z** — owner → Roberto Ruiz (auto)
- **2026-06-23T13:54:00Z** — Implementación completa: selector compacto, columna Discarded condicional, validación con estado pending, cierre coherente, lightbox Mermaid, historial de graduaciones colapsable y tabla sin wrapping accidental. pnpm verify pasa con 343 tests; verificación visual completada a 1920 px y 680 px.
- **2026-06-23T13:54:57Z** — status: in-progress → in-review
- **2026-06-23T13:57:46Z** — Ajustes solicitados por validación visual: coherencia de chevron, cierre exterior del selector, escala de ordenamiento, centrado vertical y scroll sin compresión al mostrar Discarded.
- **2026-06-23T14:03:54Z** — status: in-review → in-progress
- **2026-06-23T14:08:33Z** — Ajustes visuales verificados: chevron SVG coherente, cierre exterior del selector, sort icon 10×10, celdas centradas y ocho columnas de Board mantienen 257.7 px a 1920 px con scrollWidth 2192 px. pnpm verify pasa con 345 tests.
- **2026-06-23T14:09:03Z** — status: in-progress → in-review
