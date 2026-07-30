---
id: "20260730-202005"
title: Ordenar las columnas del board por código
type: feature
status: in-validation
created: 2026-07-30T20:20:05Z
depends_on: []
related_to: ["20260627-111219", "20260728-141643"]
owner: rarc88
release_impact: minor
---

## Request

Mejorar la contribución de [rarc88/changeledger#1](https://github.com/rarc88/changeledger/pull/1)
para que cada columna del Board pueda ordenarse por código en ambas direcciones. La
contribución debe quedar gobernada por ChangeLedger, ser independiente del orden de la
respuesta del servidor, conservar la preferencia y mantener las acciones del Board
accesibles.

## Investigation

El PR propone guardar en un `Set` las columnas invertidas, convertir el título de cada
columna en un botón y aplicar `reverse()` porque actualmente el servidor entrega los
changes por código ascendente. No incluye change, pruebas ni checks, y por ello deja como
contrato implícito tanto el orden de entrada como la semántica accesible del control.

La persistencia del viewer ya está documentada por `20260627-111219`, y
`20260728-141643` establece la accesibilidad de las acciones y navegación del Board. Son
antecedentes relacionados, no prerrequisitos de ejecución porque ambos están cerrados.
La spec `viewer` conserva el snapshot global y el Board, pero todavía no declara la
ordenación independiente por columna.

## Proposal

Mantener un conjunto de estados cuyas columnas están en dirección descendente; una
columna ausente usa dirección ascendente. Antes de renderizar, una función pura crea una
copia y compara explícitamente los códigos, sin confiar en el orden del servidor ni mutar
la colección recibida. El botón de cada columna expone estado, columna y acción siguiente
en su nombre accesible; el icono queda decorativo.

Persistir el conjunto en el snapshot v1 existente, restaurando solo strings y eliminando
estados que no existan en el repositorio cargado. Se descarta reutilizar el sort global
de Table porque el Board necesita dirección independiente por estado, y se descarta
limitarse a `reverse()` porque convertiría un detalle actual del transporte en requisito
del cliente.

## Specification

### CR1 — Orden determinista por columna
- **Given** una columna `draft` recibe changes con códigos `20260730-120000`, `20260728-090000` y `20260729-150000` en ese orden
- **When** el Board obtiene los elementos de la columna sin una preferencia descendente
- **Then** devuelve `20260728-090000`, `20260729-150000`, `20260730-120000`
- **And** no modifica el array recibido

### CR2 — Alternancia independiente
- **Given** las columnas `draft` y `approved` están en dirección ascendente
- **When** el humano activa el control de orden de `draft`
- **Then** `draft` queda en dirección descendente
- **And** `approved` permanece en dirección ascendente
- **And** una segunda activación de `draft` recupera la dirección ascendente

### CR3 — Preferencia persistente y normalizada
- **Given** el snapshot v1 contiene `boardSortColumns: ["draft", "removed", 7]`
- **When** se restaura el snapshot y se normaliza contra los estados `draft` y `done`
- **Then** la única columna descendente es `draft`
- **And** la siguiente serialización contiene `boardSortColumns: ["draft"]`

### CR4 — Control accesible
- **Given** la columna `draft` está ordenada ascendentemente
- **When** se renderiza su encabezado
- **Then** contiene un botón con `aria-pressed="false"` cuyo nombre identifica `draft`, la dirección ascendente actual y la acción para ordenar de más nuevo a más antiguo
- **And** después de activarlo `aria-pressed` es `true` y el nombre anuncia la dirección descendente actual y la acción para ordenar de más antiguo a más nuevo
- **And** el icono de dirección tiene `aria-hidden="true"`

### CR5 — Verdad persistente del viewer
- **Given** la ordenación por columna está implementada
- **When** se actualiza la spec `viewer`
- **Then** documenta el orden ascendente predeterminado, la alternancia independiente, la comparación explícita por código y la persistencia normalizada

## Plan

- [x] Probar primero la ordenación pura, la alternancia, la persistencia y el control accesible
  - **Target:** `test/app-state.test.mjs`, `test/viewer-metadata.test.mjs`
  - **Verify:** `node --test test/app-state.test.mjs test/viewer-metadata.test.mjs`
  - **Criteria:** CR1, CR2, CR3, CR4
  - **Resolved:** `2026-07-30T20:30:58Z`
- [x] Implementar el estado, la comparación por código y el encabezado interactivo del Board
  - **Target:** `src/viewer/public/app-state.js`, `src/viewer/public/app.js`, `src/viewer/public/view-parts.js`, `src/viewer/public/styles.css`
  - **Verify:** `node --test test/app-state.test.mjs test/viewer-metadata.test.mjs`
  - **Criteria:** CR1, CR2, CR3, CR4
  - **Resolved:** `2026-07-30T20:31:05Z`
- [x] Graduar el comportamiento durable en la spec del viewer
  - **Target:** `.changeledger/specs/viewer.md`
  - **Verify:** `node bin/changeledger.mjs check`
  - **Criteria:** CR5
  - **Resolved:** `2026-07-30T20:31:46Z`
- [x] Ejecutar la verificación completa
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-07-30T20:33:00Z`

## Log

- **2026-07-30T20:20:05Z** `[note]` Draft creado para gobernar y reforzar la contribución del PR #1.
- **2026-07-30T20:24:56Z** `[status]` draft → approved (human via conversation)
- **2026-07-30T20:26:14Z** `[status]` approved → in-progress
- **2026-07-30T20:31:12Z** `[note]` TDD verificado: las pruebas fallaron inicialmente por ausencia de estado, comparación y controles; después pasaron 126/126. Mutantes de dirección, normalización, alternancia y nombre accesible fueron detectados y restaurados.
- **2026-07-30T20:33:56Z** `[status]` in-progress → in-review
- **2026-07-30T20:34:06Z** `[note]` La implementación parte de la contribución de Carlos Rodríguez Fernández en el PR #1; el commit de implementación conserva su autoría y añade la especificación, robustez, accesibilidad y cobertura exigidas por el proyecto.
- **2026-07-30T20:35:47Z** `[note]` Mandato de revisión: auditoría completa de change/workflow-core-drafts..57cba0f4, incluyendo criterios, tests, accesibilidad, persistencia, spec y disciplina de commits.
- **2026-07-30T20:41:07Z** `[review]` in-review → in-progress (retry): El commit baseline 9a682681 tiene un subject de 51 caracteres; el estándar global exige un máximo de 50.
- **2026-07-30T20:43:51Z** `[status]` in-progress → in-review
- **2026-07-30T20:44:13Z** `[note]` Mandato de re-revisión: spot check de la corrección de disciplina en change/workflow-core-drafts..70e32f07; confirmar subjects ≤50, markers válidos y que el árbol 38d922fb es idéntico al candidato funcional ya auditado.
- **2026-07-30T20:46:28Z** `[review]` in-review → in-validation (delegated subagent, clean context)
