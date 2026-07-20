---
id: "20260703-220013"
title: Evitar desbordamiento y ampliar columnas del board
type: bug
status: done
created: 2026-07-03T22:00:13Z
depends_on: []
owner: raruiz-hiberuscom
reviewed: true
archived: true
---

## Request

Corregir el desbordamiento de textos largos dentro de las cards del board y
dar más ancho útil a sus columnas en resoluciones de escritorio grandes. La
captura aportada muestra rutas y títulos partidos en espacios demasiado
estrechos, aunque el viewport dispone de una superficie amplia.

## Investigation

`src/viewer/public/styles.css` limita cada `.column` a un máximo de 320 px y
calcula su ancho para intentar mostrar los siete estados simultáneamente. En un
viewport de 2048 px esto mantiene todas las columnas visibles, pero comprime las
cards en vez de priorizar su lectura y usar el scroll horizontal que `.board` ya
ofrece.

Además, `.card-title`, `.card-id`, `.owner` y los hijos flex de `.card-top` y
`.card-meta` no fijan una política de contracción y wrapping para tokens sin
espacios. Rutas, identificadores o handles largos pueden superar el ancho de la
card. El breakpoint móvil ya apila columnas a ancho completo y debe conservarse.

## Specification

### CR1 — Contener textos largos
- **Given** una card con un título, id u owner de al menos 80 caracteres consecutivos sin espacios
- **When** se renderiza en el board en cualquier viewport soportado
- **Then** todo el texto permanece dentro de los límites visuales de la card
- **And** el contenido se parte en líneas sin ocultar ni solapar el type tag, progreso o metadata

### CR2 — Columnas legibles en escritorio
- **Given** un viewport de escritorio de al menos 1280 px
- **When** se renderiza el board con los siete estados
- **Then** al menos seis columnas son visibles simultáneamente sin scroll horizontal
- **And** el board usa scroll horizontal para el resto en vez de comprimir las visibles

### CR3 — Aprovechar espacio sin dejar huecos artificiales
- **Given** un board cuyas columnas caben dentro del viewport respetando su ancho mínimo
- **When** sobra espacio horizontal
- **Then** las columnas pueden crecer de forma uniforme hasta su límite legible
- **And** la separación y el padding existentes se conservan

### CR4 — Mantener el layout móvil
- **Given** un viewport de hasta 680 px
- **When** se renderiza el board con textos largos
- **Then** las columnas se apilan y ocupan el ancho disponible
- **And** ni la página ni las cards generan desbordamiento horizontal

## Plan

- [x] Add failing assertions in `test/viewer-metadata.test.mjs`, then update board sizing and card wrapping in `src/viewer/public/styles.css`; verify: `node --test test/viewer-metadata.test.mjs` (CR1, CR2, CR3, CR4)
  - **Resolved:** `2026-07-03T22:46:11Z`
- [x] Record the board layout guarantees in `.changeledger/specs/viewer.md`; verify: `node bin/changeledger.mjs check 20260703-220013` (CR1, CR2, CR3, CR4)
  - **Resolved:** `2026-07-03T22:46:11Z`
- [x] Validate the viewer manually at 2048 px, 1280 px and 680 px with an 80-character path (support)
  - **Resolved:** `2026-07-03T22:46:12Z`
- [x] Run the complete quality gate after implementation; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-03T22:46:12Z`

## Log

- **2026-07-03T22:00:13Z** `[note]` Draft autorizado a partir de la captura del board; se separó del cambio de flujo porque afecta una superficie independiente.
- **2026-07-03T22:07:19Z** `[status]` draft → approved
- **2026-07-03T22:42:39Z** `[status]` approved → in-progress
- **2026-07-03T22:42:39Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-03T22:46:20Z** `[note]` Fix es puramente CSS (markup de card sin cambios); no hay comportamiento JS que testear con node --test. Verificación: overflow-wrap:anywhere en card-title/card-id/owner probado inyectando un token de 90 chars sin espacios (no desborda la card), .column crece 320-400px con scroll horizontal en vez de comprimirse (2048px/1280px), y el layout móvil (680px) sigue apilando sin overflow horizontal.
- **2026-07-03T22:46:40Z** `[note]` pnpm verify: 532 pruebas ok, 157 changes válidos.
- **2026-07-03T22:46:45Z** `[status]` in-progress → in-review
- **2026-07-03T22:48:25Z** `[note]` Revisión (subagente, contexto limpio): PASS, sin defectos.
- **2026-07-03T22:48:25Z** `[status]` in-review → in-validation
- **2026-07-03T22:56:11Z** `[validation]` in-validation → in-progress (human rejected): Como minimo que se vea 6 columnas a la vez.
- **2026-07-03T22:59:21Z** `[note]` Corrección de rechazo: CR2 exigía min 320px, pero el humano necesita ver 6 columnas simultáneas desde 1280px. Reescrita la CR y el CSS: clamp(190px, calc((100vw - 140px)/6), 400px). Verificado en preview: 1280px → 6/7 visibles sin scroll (190px c/u), 2048px → 318px c/u, 680px → apilado sin overflow.
- **2026-07-03T23:00:45Z** `[note]` pnpm test: 534 pruebas ok. changeledger check scoped al 20260703-220013: válido (el check global reporta un error ajeno en 150232, edición en curso del humano, no tocado).
- **2026-07-03T23:00:45Z** `[status]` in-progress → in-review
- **2026-07-03T23:12:40Z** `[note]` Revisión (subagente, contexto limpio): PASS, sin defectos. Fórmula verificada aritméticamente: 6×190+5×14+32=1242px cabe en 1280px con margen para scrollbar.
- **2026-07-03T23:12:40Z** `[status]` in-review → in-validation
- **2026-07-03T23:15:27Z** `[validation]` in-validation → done (human accepted)
- **2026-07-03T23:21:51Z** `[graduation]` spec: `viewer.md`
- **2026-07-03T23:22:53Z** `[archive]` archived
