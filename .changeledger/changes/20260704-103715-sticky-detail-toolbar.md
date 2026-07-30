---
id: "20260704-103715"
title: Barra de herramientas fija en el detalle
type: feature
status: done
created: 2026-07-04T10:37:15Z
depends_on: []
release_impact: minor
owner: Roberto Ruiz
reviewed: true
archived: true
---

## Request

Al leer un change o spec largo, los controles de modo y ancho permanecen
visibles, pero el cierre queda fuera de alcance al hacer scroll y la navegación
entre etapas del change desaparece con el contenido inicial. Además, abrir otro
documento reutiliza la posición de scroll del anterior en vez de comenzar desde
su inicio.

Se quiere reunir las acciones persistentes del detalle en una barra de
herramientas fija: presentación, navegación entre secciones y cierre. Cada
change o spec recién abierto debe comenzar arriba.

## Investigation

`#detail` es el contenedor que hace scroll y se reutiliza para renderizar tanto
changes como specs. `litRender` reemplaza su contenido, pero el navegador
conserva el `scrollTop` del elemento; por eso `openDetail`, los enlaces entre
dependencias y `openSpec` heredan la posición de lectura anterior.

Los controles de presentación ya usan `position: sticky`, mientras el botón de
cierre usa posición absoluta y la navegación `.pipeline` forma parte del flujo
del change después de sus metadatos y acciones de lifecycle. Son tres zonas con
el mismo alcance operativo pero distinto comportamiento al desplazarse. Los
specs no generan una navegación de etapas, por lo que su barra no debe reservar
un hueco vacío para ella.

El comportamiento persistente definido en `viewer.md` exige que cambiar modo o
ancho no reconstruya el detalle ni pierda la posición de lectura. Reiniciar el
scroll al abrir otro documento es compatible con esa garantía: el reset ocurre
en una navegación de documento, no al ajustar su presentación.

La primera entrega ató la fila apilada de la navegación a un `@media` de
viewport, por lo que el preset `Compact` (720 px de `--detail-width`) seguía
mostrando el pipeline con scroll horizontal en pantallas anchas: el ancho
disponible es el del panel `.detail`, no el de la ventana. Con `container-type:
inline-size` en `.detail`, un `@container` reacciona al ancho real del panel y
cubre viewport estrecho y preset `Compact` con la misma regla.

## Proposal

Reemplazar la cabecera sticky parcial por una toolbar compartida para changes y
specs. La barra contendrá los grupos de layout y ancho, el cierre y, en changes,
los chips existentes de navegación entre etapas. Permanecerá fijada al borde
superior del scroll interno con fondo translúcido, separación visual y un
`z-index` suficiente para que el contenido pase por debajo sin competir con los
controles.

En escritorio la navegación aprovechará el espacio central disponible. En
anchos reducidos ocupará una segunda fila con desplazamiento horizontal propio,
manteniendo siempre visibles y alcanzables los controles de presentación y el
cierre. Los destinos de etapa compensarán la altura de la barra para que su
título no quede oculto tras navegar.

Centralizar el inicio de cada apertura para asignar `scrollTop = 0` al contenedor
antes de presentar el nuevo documento. La misma regla se aplicará a changes,
specs, dependencias y enlaces internos entre specs. No se reiniciará el scroll
al cambiar únicamente el modo o el ancho.

Se descarta hacer sticky el bloque de navegación actual como una segunda barra:
duplicaría superficies fijas, consumiría más altura y mantendría separado el
cierre. También se descarta generar en este change un índice automático de
headings para specs; es una capacidad nueva distinta de reorganizar la
navegación que ya existe.

## Specification

### CR1 — Toolbar fija compartida
- **Given** un change o spec abierto cuyo contenido excede la altura disponible
- **When** la persona desplaza el contenido verticalmente
- **Then** una única barra de herramientas permanece fijada al borde superior del detalle
- **And** los controles de layout, ancho y cierre siguen visibles y operables

### CR2 — Navegación de etapas integrada
- **Given** un change con etapas `Request`, `Investigation` y `Plan`
- **When** se muestra su barra de herramientas
- **Then** la barra incluye acciones para `Request`, `Investigation` y `Plan` en el orden del documento
- **And** al activar `Plan` se desplaza hasta esa etapa sin ocultar su encabezado bajo la barra fija

### CR3 — Toolbar de specs sin espacio vacío
- **Given** un spec abierto, que no dispone de la navegación por etapas de un change
- **When** se muestra su barra de herramientas
- **Then** contiene los controles de layout, ancho y cierre
- **And** no renderiza una zona de navegación vacía

### CR4 — Adaptación a panel estrecho
- **Given** un detalle abierto cuyo panel no tiene ancho suficiente para presentación, navegación y cierre en una fila, ya sea por viewport estrecho o por el preset `Compact`
- **When** la toolbar contiene todas las etapas de un change
- **Then** layout, ancho y cierre permanecen visibles en la zona fija
- **And** la navegación pasa a su propia fila con scroll horizontal propio sin ensanchar el viewport ni cubrir el contenido

### CR5 — Cada documento comienza arriba
- **Given** el detalle desplazado verticalmente en un change o spec
- **When** la persona abre otro change o spec mediante una card, dependencia o enlace entre specs
- **Then** el nuevo documento se presenta con `#detail.scrollTop` igual a `0`
- **And** cambiar solamente `Side panel`/`Floating modal` o `Compact`/`Wide`/`Full` conserva la posición actual

## Plan

- [x] Añadir pruebas fallidas de estructura compartida y navegación en `test/viewer-metadata.test.mjs`, luego implementar la toolbar en `src/viewer/public/app.js` y `src/viewer/public/view-parts.js`
  - **Verify:** `node --test test/viewer-metadata.test.mjs`
  - **Criteria:** CR1, CR2, CR3
  - **Resolved:** `2026-07-04T10:57:36Z`
- [x] Añadir pruebas fallidas del reset por apertura en `test/view.test.mjs`, luego centralizarlo en `src/viewer/public/app.js`
  - **Verify:** `node --test test/view.test.mjs`
  - **Criteria:** CR5
  - **Resolved:** `2026-07-04T10:57:36Z`
- [x] Añadir aserciones fallidas de hooks de estilo en `test/viewer-metadata.test.mjs`, luego implementar sticky layout, compensación de destinos y overflow responsive en `src/viewer/public/styles.css`
  - **Verify:** `node --test test/viewer-metadata.test.mjs` y comprobación manual a 1280 px y 680 px
  - **Criteria:** CR1, CR2, CR4
  - **Resolved:** `2026-07-04T10:57:36Z`
- [x] Actualizar `.changeledger/specs/viewer.md` con el comportamiento durable
  - **Verify:** `node bin/changeledger.mjs check 20260704-103715`
  - **Criteria:** CR1, CR2, CR3, CR4, CR5
  - **Resolved:** `2026-07-04T10:57:36Z`
- [x] Ejecutar el quality gate completo al terminar
  - **Verify:** `pnpm verify`
  - **Support:**
  - **Resolved:** `2026-07-04T11:23:31Z`
- [x] Corregir CR4 en `src/viewer/public/styles.css` con `container-type: inline-size` en `.detail` y un `@container` que apile la navegación por ancho de panel, no de viewport, cubriendo el preset `Compact`
  - **Verify:** `node --test test/viewer-metadata.test.mjs` y comprobación manual en `Compact` a 1280 px
  - **Criteria:** CR4
  - **Resolved:** `2026-07-04T11:23:41Z`

## Log

- **2026-07-04T10:37:15Z** `[note]` Se autorizó documentar la barra fija a partir del
  problema observado de scroll heredado y de la captura del detalle flotante.
- **2026-07-04T10:40:52Z** `[status]` draft → approved
- **2026-07-04T10:41:46Z** `[status]` approved → in-progress
- **2026-07-04T10:41:46Z** `[owner]` set: Roberto Ruiz (auto)
- **2026-07-04T10:57:36Z** `[note]` Toolbar y reset verificados con tests y manualmente a 1280 px, 680 px y 375 px; la prueba real detectó y corrigió scroll anchoring y navegación pendiente.
- **2026-07-04T10:59:14Z** `[note]` Quality gate completo: Biome validó 64 archivos, 539/539 pruebas pasaron y 159 changes resultaron válidos.
- **2026-07-04T10:59:14Z** `[status]` in-progress → in-review
- **2026-07-04T11:01:55Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-04T11:12:40Z** `[validation]` in-validation → in-progress (human rejected): Cuando configuro el modal en modo "Compact" la navegación se hace scrollable y no es una buena experiencia, debería pasar a la segunda linea cuando no tiene espacio.
- **2026-07-04T11:23:47Z** `[note]` Corrección tras rechazo humano: CR4 usaba @media de viewport; el preset Compact (720px) seguía scrolleando el pipeline en pantallas anchas. Se cambió a container-type: inline-size en .detail + @container, verificado con tests y manualmente en Compact a 1280px/1400px (nav apila) y Wide (nav en línea).
- **2026-07-04T11:24:14Z** `[status]` in-progress → in-review
- **2026-07-04T11:26:02Z** `[review]` in-review → in-validation (delegated subagent, clean context): CR4 fix confirmed — container query matches Compact (668px content) not Wide/Full; 56/56 + 539/539 tests pass; check clean.
- **2026-07-04T11:33:51Z** `[validation]` in-validation → done (human accepted)
- **2026-07-04T11:35:33Z** `[graduation]` spec: `viewer.md`
- **2026-07-04T11:36:03Z** `[archive]` archived
