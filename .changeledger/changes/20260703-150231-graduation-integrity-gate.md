---
id: "20260703-150231"
title: Bloquear cierre y graduación inconsistentes
type: bug
status: in-progress
created: 2026-07-03T15:02:31Z
depends_on: []
release_impact: patch
owner: Roberto Ruiz
---

## Request

Impedir que un change sea aceptado o graduado cuando conserva tareas sin
completar o cuando su Log contradice el status y la secuencia canónica. El fallo
debe ocurrir antes de escribir el change o la spec.

## Investigation

`src/check.mjs` ya reconstruye el lifecycle desde `## Log` y reporta como error
transiciones inválidas, repeticiones y divergencia con frontmatter. Sin embargo,
un change `done` con tareas pendientes solo produce un warning.

`validation(..., pass)` comprueba el estado y el grafo, pero no valida tareas ni
la secuencia completa antes de escribir `done`. Los caminos de graduación
`--new`, `--into` y `--skip` solo exigen status `done`; no reutilizan el check
scoped. Por eso una inconsistencia detectable puede atravesar aceptación y
graduación.

Bloquear únicamente en `graduate` dejaría un estado `done` inválido y trasladaría
el error demasiado tarde. La misma invariante debe proteger primero la aceptación
humana y repetirse en graduación como defensa en profundidad. Los errores de
otros changes no deben impedir resolver el seleccionado y warnings no
relacionados no deben convertirse accidentalmente en gates.

## Specification

### CR1 — Tareas incompletas son error en done
- **Given** un change con status `done` y al menos una tarea `todo` o `blocked`
- **When** `changeledger check <id>` lo valida
- **Then** devuelve un error que indica cuántas tareas no están completas
- **And** no lo presenta únicamente como warning

### CR2 — Aceptación protegida
- **Given** un change en `in-validation` con tareas incompletas o un Log inconsistente
- **When** el humano intenta aceptarlo desde el viewer
- **Then** la operación falla con un diagnóstico concreto
- **And** el archivo permanece byte por byte en `in-validation`

### CR3 — Aceptación consistente
- **Given** un change en `in-validation` con todas las tareas completas y un Log canónico coherente
- **When** el humano lo acepta desde el viewer
- **Then** escribe una única transición `validation → done (human accepted)`
- **And** el resultado pasa `changeledger check <id>`

### CR4 — Preflight en todos los modos de graduación
- **Given** un change `done` con tareas incompletas o una inconsistencia de Log
- **When** se intenta `graduate --new`, `graduate --into` o `graduate --skip`
- **Then** el comando falla antes de resolver la graduación
- **And** informa los errores scoped del change seleccionado

### CR5 — Fallo sin escrituras parciales
- **Given** una graduación rechazada por el preflight
- **When** el comando termina con error
- **Then** el change conserva exactamente sus bytes originales
- **And** ninguna spec nueva, actualización de `updated`, marca de graduación ni `reviewed: true` queda escrita

### CR6 — Gate scoped y estable
- **Given** un change seleccionado válido y errores o warnings pertenecientes a otros changes del repositorio
- **When** se acepta o gradúa el seleccionado
- **Then** los errores ajenos no bloquean esa operación scoped
- **And** warnings del propio change tampoco bloquean salvo que una invariante de cierre los reclasifique explícitamente como error

## Plan

- [ ] Promote unfinished tasks in `done` to an error and expose reusable selected-change validation in `src/check.mjs`; verify: `node --test test/check.test.mjs` (CR1, CR6)
- [ ] Guard human acceptance in `src/commands/agent.mjs` and `src/viewer/domain.mjs`; verify: `node --test test/agent.test.mjs test/view.test.mjs` (CR2, CR3, CR6)
- [ ] Add no-write preflight to all paths in `src/commands/graduate.mjs`; verify: `node --test test/graduate.test.mjs` (CR4, CR5, CR6)
- [ ] Record closure integrity in `.changeledger/specs/lifecycle.md` and `.changeledger/specs/validation.md`; verify: `node bin/changeledger.mjs check 20260703-150231` (CR1, CR2, CR3, CR4, CR5, CR6)
- [ ] Run the complete quality gate after implementation; verify: `pnpm verify` (support)

## Log

- 2026-07-03T15:02:31Z — La petición de bloquear graduación se amplió al gate
  anterior de aceptación para evitar crear primero un `done` inválido.
- **2026-07-03T15:12:03Z** — status: draft → approved
- **2026-07-03T17:02:24Z** — status: approved → in-progress
- **2026-07-03T17:02:24Z** — owner → Roberto Ruiz (auto)
