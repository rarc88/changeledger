---
id: "20260615-210508"
title: Estado terminal para descartar changes conservando el porqué
type: feature
status: in-progress
created: 2026-06-15T21:05:08Z
depends_on: []
owner: raruiz-hiberuscom
---

## Request

Dar al lifecycle un estado terminal para **descartar** un change conservando su
razonamiento. Hoy no existe: un change que se decide no hacer solo puede
borrarse (`rm`) —perdiendo el porqué, rompiendo `depends_on` y desapareciendo de
métricas— o quedarse en `draft` para siempre ensuciando el board. Borrar
contradice la tesis del tool ("los documentos son la verdad"): descartar es una
**decisión** y debe quedar registrada.

## Investigation

- El grafo en `src/lifecycle.mjs` (`CANONICAL_STATUSES`, `TRANSITIONS`) no tiene
  estado terminal de descarte; `done` es el único terminal y no aplica.
- `archive` (flag booleano en `src/writer.mjs`) oculta un change del visor pero
  semánticamente es "ocultar", no "decidimos que no" — no lleva razón ni cambia
  el lifecycle.
- `src/check.mjs:38` valida `fm.status` contra `config.statuses`; cualquier
  estado nuevo debe estar en esa lista o `check` falla con `unknown status`.
- `checkCoverage` (`src/check.mjs:189`) solo corre para `approved`/`in-progress`,
  así que un descartado queda exento de cobertura CR↔task de forma natural.
- El visor deriva las columnas del board de `repo.statuses` y ya filtra los
  archivados por defecto (`visibleChanges` en `src/viewer/public/app.js`); un
  descartado debe ocultarse igual y **no** generar una columna nueva.
- En esta misma sesión borré un change (`mermaid-optional-...`) con `rm` y perdí
  su análisis: evidencia directa del hueco.

## Proposal

Añadir un estado terminal `discarded` y un verbo dedicado `sl discard`.

- **Lifecycle:** `discarded` entra en `CANONICAL_STATUSES`. Transiciones de
  entrada desde estados activos no terminales: `draft`, `approved`,
  `in-progress`, `blocked` → `discarded`. **No** desde `done` ni `in-review`
  (este último debe salir antes vía retry/block). Sin transiciones de salida:
  es terminal; resucitar es edición manual del archivo (igual que reabrir un
  `done`, ver §5 del contrato).
- **Verbo dedicado** `sl discard <id> "<reason>"` (no un `sl status ... discarded`
  suelto), por simetría con `sl review fail` que ya exige razón. La razón es
  **obligatoria** y se escribe al Log. Una sola autoridad: el verbo delega en la
  misma maquinaria de transición/log que el resto.
- **Visor:** los descartados se ocultan por defecto y aparecen con un toggle
  "Discarded" que espeja el de "Archived"; no se renderiza columna para el
  estado.
- **KISS:** un único estado terminal con razón en texto. **Descartado**:
  `rejected`/`superseded`/`wontfix` separados — el texto de la razón cubre el
  matiz sin proliferar estados.

Alternativa descartada: reutilizar `archive`. Rechazada porque mezcla dos
conceptos (ocultar vs decidir-no-hacer), no lleva razón y no es terminal.

## Specification

### CR1 — Descartar exige una razón
- **Given** un change en `draft` con id `20260613-120000`
- **When** se ejecuta `sl discard 20260613-120000` sin razón
- **Then** sale con código ≠ 0 y el mensaje literal `discard requires a reason — sl discard <id> "<reason>"`
- **And** el archivo queda byte a byte sin cambios

### CR2 — Descartar fija el estado terminal y registra la razón
- **Given** un change en `draft` y la razón `superseded by 20260613-120001`
- **When** se ejecuta `sl discard 20260613-120000 "superseded by 20260613-120001"`
- **Then** `frontmatter.status` pasa a `discarded`
- **And** se añade al Log una entrada `status: draft → discarded: superseded by 20260613-120001` con timestamp UTC

### CR3 — Solo se descarta desde estados activos no terminales
- **Given** changes en `draft`, `approved`, `in-progress` y `blocked`
- **When** se descarta cada uno
- **Then** la transición se acepta
- **And** desde `done` o `in-review` falla con `invalid lifecycle transition: <from> → discarded` sin escribir

### CR4 — `discarded` es terminal en el CLI
- **Given** un change en `discarded`
- **When** se intenta cualquier `sl status <id> <otro>`
- **Then** falla con `invalid lifecycle transition: discarded → <otro>`
- **And** resucitar requiere editar el archivo a mano (documentado, no es trabajo del CLI)

### CR5 — Un change descartado pasa `sl check`
- **Given** un change descartado (stages activos presentes aunque vacíos, como los deja `sl new`)
- **When** se ejecuta `sl check`
- **Then** no se reporta error por `unknown status` ni por cobertura CR↔task
- **And** los warnings de cobertura siguen aplicando solo a `approved`/`in-progress`

### CR6 — El visor oculta los descartados por defecto
- **Given** un change en `discarded`
- **When** renderizan board, tabla y grafo
- **Then** no aparece por defecto y no se crea columna para el estado `discarded`
- **And** un toggle "Discarded" (espejo de "Archived") lo revela

### CR7 — Una dependencia a un change descartado sigue resolviéndose
- **Given** un change B con `depends_on` a A, y A pasa a `discarded`
- **When** se ejecuta `sl check`
- **Then** A no se reporta como dependencia colgante o inexistente (el archivo sigue ahí)

## Plan

- [x] Añadir `discarded` a `CANONICAL_STATUSES` y a `TRANSITIONS` en `src/lifecycle.mjs` (entrada desde draft/approved/in-progress/blocked; sin salida) con tests en `test/lifecycle.test.mjs` (CR3, CR4) — 2026-06-15T21:26:49Z
- [x] Añadir `discarded` a `statuses` en `templates/config.yml` y `.sl/config.yml`, y exentar el estado terminal de los requisitos de stage/cobertura en `src/check.mjs`, con tests en `test/check.test.mjs` (CR5, CR7) — 2026-06-15T21:26:49Z
- [x] Implementar `discard(id, reason, cwd)` en `src/commands/agent.mjs` (razón obligatoria con el error literal, transición vía `assertTransition`, razón al Log) y cablear `sl discard` en `bin/sl.mjs`, con tests en `test/agent.test.mjs` (CR1, CR2) — 2026-06-15T21:26:49Z
- [x] Ocultar descartados por defecto y añadir el toggle "Discarded" sin columna nueva en `src/viewer/public/app.js` e `index.html`, con tests en `test/viewer-metadata.test.mjs` (CR6) — 2026-06-15T21:26:50Z
- [x] Documentar el estado `discarded` y la resurrección manual en `templates/AGENTS.md` §5 y `README.md`, y ejecutar `pnpm verify` (CR1–CR7) — 2026-06-15T21:26:50Z

## Log
- **2026-06-15T21:16:06Z** — status: draft → approved
- **2026-06-15T21:21:20Z** — status: approved → in-progress
- **2026-06-15T21:21:21Z** — owner → raruiz-hiberuscom (auto)
- **2026-06-15T21:27:48Z** — Implementado: discarded en lifecycle (terminal, entrada desde draft/approved/in-progress/blocked), sl discard con razón obligatoria, status rechaza discarded, statuses en ambos config, visor oculta + toggle sin columna, docs §5/README. 218 tests, visor verificado en navegador.
