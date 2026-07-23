---
id: "20260722-204131"
title: Diagnosticar el borrado de la integration ref
type: bug
status: approved
created: 2026-07-22T20:41:31Z
depends_on: []
related_to: ["20260721-193106", "20260721-193104", "20260722-203031"]
release_impact: patch
---

## Request

La ejecución paralela de la auditoría `20260721-193106` confirmó que el hook
rechaza correctamente el borrado de la integration ref protegida, pero lo hace
con `integration protection is not active`. El rechazo es fail-closed y no
pierde verdad, aunque atribuye el fallo a configuración ausente en vez de a la
operación destructiva observada.

## Investigation

La validación resuelve la ref nueva antes de distinguir el update de borrado
(OID nuevo cero). Al no encontrar el tip nuevo, `assertProtectedRefs` cae en el
guard genérico de protección inactiva. La información necesaria ya está en la
línea de pre-receive; el borrado debe clasificarse antes de intentar resolver el
nuevo OID, sin relajar el rechazo existente.

## Specification

### CR1 — El borrado recibe un diagnóstico específico
- **Given** un update de pre-receive que intenta borrar la integration ref
  protegida con OID nuevo cero en SHA-1 o SHA-256
- **When** se valida el update
- **Then** se rechaza con un mensaje que nombra la ref y declara que su borrado
  está prohibido
- **And** no usa `integration protection is not active`

### CR2 — Protección ausente conserva su diagnóstico
- **Given** un update que no es borrado y cuya integration ref protegida no
  puede resolverse por una configuración realmente ausente o inconsistente
- **When** se valida el update
- **Then** conserva el diagnóstico `integration protection is not active`

## Plan

- [ ] Añadir tests fallidos de borrado SHA-1/SHA-256 y clasificar el OID nuevo cero antes de resolver la ref en `src/state-validation.mjs`; verify: `node --test test/state-validation.test.mjs test/state-receive.test.mjs` exige ref y prohibición de borrado (CR1)
- [ ] Conservar en `src/state-validation.mjs` el guard de protección realmente ausente y añadir su regresión; verify: `node --test test/state-validation.test.mjs` conserva el diagnóstico existente para updates no destructivos (CR2)
- [ ] Ejecutar el gate completo; verify: `pnpm verify` (support)

## Log

- **2026-07-22T20:41:31Z** `[note]` Draft separado de 20260722-203031 porque el borrado de integration ref pertenece al validador remoto y requiere una regresión propia SHA-1/SHA-256.
- **2026-07-23T09:28:31Z** `[status]` draft → approved
