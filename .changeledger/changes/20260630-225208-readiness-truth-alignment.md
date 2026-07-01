---
id: "20260630-225208"
title: Alinear la verdad persistente de readiness con el comportamiento real
type: bug
status: in-progress
created: 2026-06-30T22:52:08Z
depends_on: []
owner: raruiz-hiberuscom
---

## Request

Restaurar una única verdad sobre la Definition of Ready. La spec persistente
afirma que el cruce de criterios y tareas solo produce warnings y que los drafts
no se evalúan, mientras el contrato, los tests y el comportamiento actual
distinguen warnings durante autoría de errores que bloquean trabajo aprobado.

## Investigation

`.changeledger/specs/readiness.md` conserva la semántica anterior a los cambios
que endurecieron `checkCoverage`: describe todos los diagnósticos como warnings,
excluye `draft` y dice que no se comprueba si un criterio es test-grade.

En `src/check.mjs`, `draft` sí se evalúa con warnings. En `approved` e
`in-progress`, la ausencia de Given/When/Then, las referencias a CR inexistentes
y las tareas CR-bearing sin target/verificación son errores; la cobertura
incompleta y las tareas no-support sin CR permanecen como warnings. Los
comentarios inmediatamente anteriores a `checkCoverage` también describen el
comportamiento antiguo y compiten con el código.

## Specification

### CR1 — La spec persistente describe la severidad real
- **Given** la política `tdd: true`
- **When** se consulta `.changeledger/specs/readiness.md`
- **Then** documenta que los gaps de un draft son warnings
- **And** documenta qué defectos de readiness son errores en `approved` e `in-progress`
- **And** distingue esos errores de los gaps de cobertura que continúan siendo warnings

### CR2 — Código, contrato y comentarios no compiten
- **Given** `checkCoverage` y el fragmento canónico `templates/contract/readiness.md`
- **When** se comparan con la spec persistente y los comentarios del código
- **Then** todos describen la misma matriz de estados y severidades
- **And** ningún comentario afirma que readiness nunca bloquea

### CR3 — El comportamiento validado no cambia accidentalmente
- **Given** fixtures `draft`, `approved`, `in-progress` y `done`
- **When** se ejecutan los tests de `checkCoverage`
- **Then** conservan la severidad vigente para cada clase de diagnóstico
- **And** `tdd: false` continúa desactivando los checks de readiness

## Plan

- [ ] Corregir `.changeledger/specs/readiness.md` con la matriz exacta de estados y severidades; verify: `node bin/changeledger.mjs check` (CR1, CR2)
- [ ] Alinear los comentarios de `src/check.mjs` sin modificar la semántica; verify: `node --test test/check.test.mjs` (CR2, CR3)
- [ ] Completar en `test/check.test.mjs` la cobertura explícita de `src/check.mjs` y ejecutar el gate; verify: `pnpm test` (CR1, CR2, CR3)

## Log

- **2026-06-30T22:52:08Z** — Draft creado tras auditar la divergencia entre spec, contrato, comentarios y comportamiento de readiness.
- **2026-07-01T21:51:09Z** — status: draft → approved
- **2026-07-01T22:04:33Z** — status: approved → in-progress
- **2026-07-01T22:04:33Z** — owner → raruiz-hiberuscom (auto)
