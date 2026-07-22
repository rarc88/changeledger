---
id: "20260722-203031"
title: Limpiar diagnósticos engañosos de la réplica
type: chore
status: draft
created: 2026-07-22T20:30:31Z
depends_on: []
related_to: ["20260721-193106"]
release_impact: patch
---

## Request

La ejecución paralela de la auditoría `20260721-193106` dejó siete hallazgos
LOW de diagnóstico/ergonomía, sin riesgo de pérdida. Se agrupan aquí los seis
de código para decisión única del humano (aprobar el paquete, dividirlo o
aceptarlos explícitamente como riesgo asumido); el séptimo (documentación de
cleanup del baseline publicado antes del cutover) queda en el runbook si se
considera necesario. Tipo chore a propósito: cambios de mensajes/señalización
sin semántica nueva; si el humano prefiere review, se re-tipa a bug antes de
aprobar.

## Plan

- [ ] Etiquetar fallos de IO (EACCES/ENOSPC) en replay/sync con su causa real en vez del encabezado `state replica conflict` en `src/state-store.mjs`; verify: `node --test test/state-store.test.mjs` (support)
- [ ] Envolver el fallo de CAS del sync con el mismo error accionable de reintento que usa la ruta de mutación, en vez del `cannot lock ref` crudo de Git (`src/state-store.mjs`); verify: `node --test test/state-store.test.mjs` (support)
- [ ] Señalizar en el receipt de `state abort --pending` cuándo la réplica queda `stale` y hace falta un `state sync` posterior (`src/commands/state.mjs`/`bin/changeledger.mjs`); verify: `node --test test/state-command.test.mjs` (support)
- [ ] Dar a `state doctor` un modo de triage de réplica (o mensaje que dirija a `state status`) en vez de exigir `--activation-ref` y fallar con un error de manifest ajeno (`src/commands/state.mjs`); verify: `node --test test/state-command.test.mjs` (support)
- [ ] Rechazar el borrado de la integration ref con un mensaje específico de borrado en vez de `integration protection is not active` (`src/state-validation.mjs`); verify: `node --test test/state-validation.test.mjs` (support)
- [ ] Reformular el error de divergencia cuando el `confirmed` local es el corrupto, sin culpar al remoto (`src/state-store.mjs`); verify: `node --test test/state-store.test.mjs` (support)

## Log

- **2026-07-22T20:30:31Z** `[note]` Draft creado por la revisión cruzada de los drafts de remediación de 20260721-193106: agrupa los seis LOW de código de la ejecución paralela (FLT/THR/CONV) para una decisión única; divisible o re-tipable a bug antes de aprobar.
