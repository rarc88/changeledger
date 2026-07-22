---
id: "20260722-181234"
title: El export de recuperación no es idempotente
type: bug
status: draft
created: 2026-07-22T18:12:34Z
depends_on: []
related_to: ["20260721-193103", "20260722-163405", "20260722-163406"]
release_impact: patch
---

## Request

La re-auditoría integral post-fixes (contexto limpio, capa de migración)
confirmó que los fixes de `20260722-163405` y `20260722-163406` están completos,
pero encontró que `state export --recovery-branch` no es idempotente: un
reintento del operador con estado idéntico falla con un error factualmente
falso, en el peor momento posible — el camino de disaster recovery.

## Investigation

Causa raíz: `exportStateRecovery` (`src/state-migration.mjs:1331`) llama a
`createBranchCommit` sin `allowExactReuse`, a diferencia de
`prepareStateActivation` (`src/state-migration.mjs:1050`) que sí pasa
`allowExactReuse: true`. El commit de recuperación es determinista (verificado
empíricamente por el auditor: dos exports con confirmed/observed/integración
idénticos producen el mismo commit), así que un segundo export mientras la rama
`changeledger/recover-<oid12>` ya existe entra en la rama de error de
`createBranchCommit` (`src/state-migration.mjs:961`) y lanza `branch … already
exists with different content` aunque el contenido sea byte-idéntico. Además la
transacción guardada de refs (re-verificación de confirmed/observed/pending e
integración) se salta en el reintento, cuando en la reutilización exacta de la
activación sí se ejecuta.

Sin pérdida de datos — la rama existente ya contiene el contenido correcto —
pero el mensaje contradice la realidad y la garantía de idempotencia que la
activación ofrece deliberadamente. Ningún test cubre el reintento idéntico de
recuperación.

## Specification

### CR1 — El reintento idéntico de recuperación se reutiliza en silencio
- **Given** un clon activado v2 con una rama de recuperación ya exportada y
  confirmed/observed/integración sin cambios
- **When** se ejecuta de nuevo `state export --recovery-branch`
- **Then** reutiliza la rama existente reportando el mismo commit, ejecutando
  la transacción guardada de verificación de refs igual que la activación
- **And** un reintento donde la rama existente sí difiere del contenido
  esperado sigue fallando con `branch … already exists with different content`

## Plan

- [ ] Añadir test fallido del reintento idéntico (y conservar el del conflicto real) en `test/state-migration.test.mjs`; pasar `allowExactReuse: true` en la llamada a `createBranchCommit` de `exportStateRecovery` en `src/state-migration.mjs`; verify: `node --test test/state-migration.test.mjs` (CR1)
- [ ] Ejecutar el gate completo; verify: `pnpm verify` (support)

## Log

- **2026-07-22T18:12:34Z** `[note]` Draft creado desde la re-auditoría integral post-fixes (agente adversarial de contexto limpio sobre la capa de migración/recuperación). Riesgo medio operacional; el fix es de una línea más test, mismo mecanismo que ya usa la activación.
