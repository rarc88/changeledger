---
id: "20260616-151216"
title: Endurecer sl check contra documentos no implementables
type: bug
status: done
created: 2026-06-16T15:12:16Z
depends_on: []
reviewed: true
owner: Roberto Ruiz
---

## Request

Cerrar la deuda detectada en la auditoría: `sl check` acepta documentos que no
cumplen suficientemente el contrato de Definition of Ready. El contrato dice que,
con `tdd: true`, una Specification debe ser test-grade y cada tarea debe mapear a
criterios y nombrar archivos concretos; hoy la herramienta solo avisa de cruces
CR↔tarea en cambios `approved`/`in-progress`, y deja pasar formatos demasiado
vagos.

## Investigation

- `src/check.mjs` valida presencia de frontmatter, estados, etapas,
  dependencias, ciclos y algunos warnings de cobertura.
- `checkCoverage()` solo corre cuando el cambio está `approved` o
  `in-progress`, aunque un `draft` ya puede estar incompleto de forma evidente.
- El contrato requiere criterios `CRn` con líneas `Given`/`When`/`Then`, pero el
  checker solo detecta encabezados `### CRn`.
- El contrato exige que tareas de implementación nombren archivos objetivo y test
  file; el checker no lo valida.
- La solución debe endurecer el contrato sin volver inutilizable la fase de
  borrador: los errores duros deben aplicarse cuando el cambio se aprueba o
  entra en progreso; en `draft` pueden seguir siendo warnings accionables.

## Specification

### CR1 — Criterios con estructura Given/When/Then
- **Given** un change `approved` de tipo `bug` con `tdd: true`
- **When** su `## Specification` contiene `### CR1 — Caso` sin líneas `- **Given**`, `- **When**` y `- **Then**`
- **Then** `sl check` falla con `CR1 is not test-grade: missing Given/When/Then`

### CR2 — Tareas de implementación nombran archivos
- **Given** un change `approved` de tipo `feature` con `tdd: true`
- **When** una tarea del `## Plan` referencia `(CR1)` pero no menciona ningún archivo `src/...` ni `test/...`
- **Then** `sl check` falla con `Plan task for CR1 must name target and test files`

### CR3 — Draft solo avisa
- **Given** un change `draft` con criterios o tareas incompletas
- **When** se ejecuta `sl check`
- **Then** los problemas de Definition of Ready se reportan como warnings
- **And** el comando no falla solo por esos problemas

### CR4 — tdd false conserva comportamiento laxo
- **Given** un repo con `tdd: false`
- **When** un change `approved` tiene criterios sin Given/When/Then y tareas sin archivos
- **Then** `sl check` no reporta errores ni warnings de Definition of Ready

## Plan

- [x] Añadir tests de criterios incompletos en `test/check.test.mjs` y validación en `src/check.mjs` (CR1) — 2026-06-16T15:25:00Z
- [x] Añadir tests de tareas sin archivo objetivo/test en `test/check.test.mjs` y validación en `src/check.mjs` (CR2) — 2026-06-16T15:25:00Z
- [x] Añadir cobertura de severidad `draft` vs `approved` en `test/check.test.mjs` y ajustar `checkCoverage()` en `src/check.mjs` (CR3) — 2026-06-16T15:25:00Z
- [x] Mantener la exclusión `tdd:false` con test en `test/check.test.mjs` y lógica en `src/check.mjs` (CR4) — 2026-06-16T15:25:00Z
- [x] Ejecutar `pnpm verify` y registrar el resultado en `## Log` — 2026-06-16T15:25:00Z

## Log
- **2026-06-16T15:15:14Z** — status: draft → approved
- **2026-06-16T15:22:27Z** — status: approved → in-progress
- **2026-06-16T15:22:27Z** — owner → Roberto Ruiz (auto)
- **2026-06-16T15:25:01Z** — Implemented DoR test-grade and file-reference checks; pnpm verify passed with expected support-task warnings.
- **2026-06-16T15:25:01Z** — status: in-progress → in-review
- **2026-06-16T15:26:22Z** — review → done (delegated subagent, clean context)
- **2026-06-16T15:26:22Z** — graduado a spec `architecture.md`
