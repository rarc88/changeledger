---
id: "20260710-105206"
title: El visor limita type y owner a una sola selección
type: feature
status: done
created: 2026-07-10T10:52:06Z
depends_on: []
owner: Roberto Ruiz
reviewed: true
archived: true
---

## Request

Convertir los filtros de `type` y `owner` del viewer en multiselección, con la
misma semántica inclusiva del filtro de estados. El filtro de owner debe incluir
una opción explícita para changes sin owner asignado.

## Investigation

El viewer usa dos `<select>` de selección única. Su estado persiste `type` y
`owner` como strings (`all` o un único valor), mientras que `statuses` es un
`Set` persistido como array. `isVisible` compara igualdad exacta, por lo que no
puede combinar tipos/owners. Al hidratar owners se descartan los valores falsy,
de modo que ni siquiera puede elegirse el conjunto sin owner. Esta restricción
se refleja igual en board, table y graph porque todos usan el predicado puro.

El owner es texto libre en frontmatter. Por ello no es seguro usar una cadena
sentinela como `__unassigned__`: un owner real podría coincidir. La selección
persistida debe modelar por separado el conjunto de nombres y el booleano
"include unassigned", validar ambos contra el repo actual y mantener
compatibilidad de lectura con snapshots existentes de selección única.

## Proposal

Reemplazar ambos selects por popovers con checkboxes, resumen y Clear, siguiendo
el patrón accesible ya usado por Status. Type usa un conjunto de tipos; Owner usa
un conjunto de nombres más la casilla `Unassigned`. Las selecciones se combinan
por OR dentro de cada filtro y por AND con texto, status y visibilidad. La
migración de estado preservará snapshots antiguos como una selección de un
elemento y actualizará las pruebas de persistencia, predicado y UI.

## Specification

### CR1 — Selección múltiple de tipos
- **Given** un repo con varios tipos configurados
- **When** el usuario marca uno o más tipos en el popover Type
- **Then** board, table y graph muestran changes de cualquiera de los tipos marcados
- **And** ninguna marca equivale a todos los tipos y Clear restaura esa condición

### CR2 — Selección múltiple de owners e inexistencia de owner
- **Given** changes con owners distintos y al menos uno sin owner
- **When** el usuario marca owners y/o `Unassigned` en el popover Owner
- **Then** se muestran changes de cualquiera de esos owners y los sin owner cuando corresponda
- **And** `Unassigned` se representa como un booleano separado, nunca como un nombre sentinela
- **And** el control sigue visible aunque todos los changes carezcan de owner

### CR3 — Composición de filtros y estado persistido
- **Given** filtros de texto, type, owner, status y visibilidad activos
- **When** se calcula visibilidad o se cambia/restaura proyecto
- **Then** cada conjunto usa OR internamente y los filtros distintos usan AND
- **And** la selección se persiste por proyecto como arrays de type/owner más `includeUnassigned`
- **And** snapshots v1 con `type` u `owner` de selección única se restauran como una selección equivalente

### CR4 — Interfaz equivalente y accesible
- **Given** los filtros Type, Owner y Status
- **When** se navegan con teclado o lector de pantalla
- **Then** Type y Owner usan el mismo patrón de `details`, resumen, checkboxes etiquetados y acción Clear que Status
- **And** el resumen informa All, una selección o el número de selecciones sin ocultar la opción Unassigned

## Plan

- [x] Añadir en `test/viewer-metadata.test.mjs` pruebas para `src/viewer/public/state.js`: predicado OR/AND, owners sin asignar y ausencia de colisión; verify: `node --test test/viewer-metadata.test.mjs` (CR1, CR2, CR3)
  - **Resolved:** `2026-07-10T17:16:45Z`
- [x] Migrar `src/viewer/public/app-state.js` a sets por proyecto, `includeUnassigned` y lectura compatible de snapshots v1; verify: `node --test test/app-state.test.mjs` (CR3)
  - **Resolved:** `2026-07-10T17:16:46Z`
- [x] Reemplazar los selects de `src/viewer/public/index.html`/`app.js` por popovers accesibles y conectarlos; verify: `node --test test/viewer-metadata.test.mjs` (CR1, CR2, CR4)
  - **Resolved:** `2026-07-10T17:16:46Z`
- [x] Ajustar `src/viewer/public/styles.css` y `.changeledger/specs/viewer.md`, y ejecutar el gate completo; verify: `node --test test/viewer-metadata.test.mjs && pnpm verify` (CR4)
  - **Resolved:** `2026-07-10T17:25:41Z`

## Log
- **2026-07-10T12:03:54Z** `[status]` draft → approved
- **2026-07-10T14:30:25Z** `[status]` approved → in-progress
- **2026-07-10T14:30:25Z** `[owner]` set: Roberto Ruiz (auto)
- **2026-07-10T17:16:57Z** `[status]` in-progress → in-review
- **2026-07-10T17:18:03Z** `[review]` in-review → in-progress (retry): Faltan pruebas específicas y el resumen de Owner no representa Unassigned seleccionado.
- **2026-07-10T17:18:49Z** `[status]` in-progress → in-review
- **2026-07-10T17:20:03Z** `[review]` in-review → in-progress (retry): El resumen no cuenta Unassigned combinado y faltan pruebas de migración/semántica.
- **2026-07-10T17:24:01Z** `[status]` in-progress → in-review
- **2026-07-10T17:25:41Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-10T17:58:07Z** `[validation]` in-validation → in-progress (agent rejected): Type y Owner deben reutilizar el patrón completo de Status: iconos y cierre al hacer clic fuera.
- **2026-07-10T18:38:07Z** `[status]` in-progress → in-review
- **2026-07-10T18:40:11Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-10T20:16:16Z** `[validation]` in-validation → done (human accepted)
- **2026-07-10T20:19:47Z** `[graduation]` spec: `viewer.md`
- **2026-07-10T20:19:48Z** `[archive]` archived
