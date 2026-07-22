---
id: "20260722-163408"
title: Cerrar los huecos del validador remoto de la auditoría externa
type: bug
status: done
created: 2026-07-22T16:34:08Z
depends_on: []
owner: raruiz-hiberuscom
related_to: ["20260721-193104"]
release_impact: patch
---

## Request

Una auditoría adversarial externa del enforcement remoto (`20260721-193104`)
confirmó que ninguna ruta acepta un update inválido de una ref protegida, pero
dejó tres riesgos de disponibilidad y consistencia en `src/state-validation.mjs`
que conviene cerrar antes de instalar el hook en un servidor real. Los tres
tocan el mismo módulo y la misma superficie de review, por eso se agrupan; si
el humano prefiere separarlos, se dividen antes de aprobar.

## Investigation

Tres causas raíz independientes en el mismo validador:

1. **Validación sobre-alcanzada.** `validateReceiveBatch` filtra las refs
   relevantes (`src/state-validation.mjs:396`) pero llama a
   `assertProtectedRefs` (`:400`) incondicionalmente, incluso con `relevant`
   vacío. Con el hook instalado repo-wide, cada push de una feature branch paga
   la validación completa del snapshot state y es rechazado con `integration
   protection is not active` si el contexto state/integración está
   momentáneamente incompleto, aunque el push no toque refs protegidas.
   Saltar la comprobación por completo, sin embargo, abriría un hueco real: si
   el nombre de integration ref configurado en el hook queda desalineado del
   `integration_branch` real de la config confirmada (drift operacional, no
   ataque), la rama de integración verdadera quedaría sin protección de forma
   silenciosa, sin que ningún push la revele, hasta que alguien empuje
   justamente a esa rama o al state ref. El fix debe evitar la validación cara
   sin perder esa detección temprana.
2. **Filtro legacy sin case-folding.** `legacyRoots`
   (`src/state-validation.mjs:192`) normaliza slashes y `./` pero la
   comparación de `protectedPath` (`:198-202`) es case-sensitive. En un
   servidor con filesystem case-insensitive, `.changeledger/CHANGES/x.md`
   elude el bloqueo de paths legacy de CR3. Impacto acotado — `LedgerStore`
   lee paths canónicos y el archivo sombra es inerte — pero la garantía
   prometida es de exclusión, no de inercia.
3. **Drift de `integration_branch` autoinfligido.** `validateStateRef`
   (`src/state-validation.mjs:221`) valida cada commit state nuevo como
   snapshot cerrado pero no verifica que su `config.integration_branch` siga
   resolviendo a la integration ref protegida. Un state update que reescribe
   esa clave se acepta; después `readConfirmedConfig` (`:167-176`) lee la
   config nueva y todo push de integración posterior falla con `integration
   ref … does not match confirmed state config`: lockout de integración sin
   camino de vuelta desde el propio hook.

## Specification

### CR1 — Un push sin refs protegidas no paga la validación completa, pero no ciega la desconfiguración del hook
- **Given** un hook instalado con state e integration refs configuradas, contexto
  sano, y un batch que solo actualiza `refs/heads/feature/x`
- **When** se ejecuta `validateReceiveBatch`
- **Then** acepta el batch sin ejecutar la validación completa del snapshot
  state (sin recorrer changes/specs/releases ni `checkRepo`)
- **And** el receipt registra cero commits y cero bytes inspeccionados
- **Given** el mismo batch con un contexto state incompleto (integración sin
  authority activa)
- **Then** el batch se acepta igualmente; `integration protection is not
  active` solo puede rechazar batches que tocan refs protegidas
- **Given** el mismo batch con el integration ref configurado en el hook
  distinto del `integration_branch` real de la config confirmada (autoridad sí
  activa)
- **Then** rechaza igual que antes con `integration ref … does not match
  confirmed state config`, mediante una lectura barata de solo `config.yml`
  sin ejecutar la validación completa del snapshot

### CR2 — El filtro legacy es case-insensitive
- **Given** protección de integración activa con root legacy
  `.changeledger/changes`
- **When** un commit nuevo añade `.changeledger/CHANGES/x.md` o
  `.CHANGELEDGER/config.yml`
- **Then** rechaza el batch nombrando commit y path, igual que la variante en
  minúsculas

### CR3 — Un state update no puede desanclar la integration ref protegida
- **Given** state confirmado cuya config resuelve `integration_branch` a la
  integration ref protegida del hook
- **When** un state update introduce un commit cuya config resuelve a otra
  rama
- **Then** rechaza el update con `state update changes integration_branch away
  from protected ref <ref>`
- **And** un update que conserva la clave sigue aceptándose

## Plan

- [x] Añadir tests fallidos de batch sin refs protegidas (contexto sano, contexto sin autoridad activa, y ref de integración desalineado con autoridad activa) en `test/state-validation.test.mjs`; introducir `assertConfiguredIntegrationRefCheap` en `src/state-validation.mjs` (lee solo `config.yml` vía `git show`, sin recorrer cambios/specs/releases ni `checkRepo`) y usarla cuando `relevant.length === 0`, preservando `assertProtectedRefs` completo para batches que sí tocan refs protegidas; verify: `node --test test/state-validation.test.mjs test/state-receive.test.mjs` (CR1)
  - **Resolved:** `2026-07-22T18:35:00Z`
- [x] Añadir tests fallidos de variantes de mayúsculas y aplicar case-folding en `legacyRoots`/`protectedPath` de `src/state-validation.mjs`; verify: `node --test test/state-validation.test.mjs` (CR2)
  - **Resolved:** `2026-07-22T18:35:00Z`
- [x] Añadir test fallido de reescritura de `integration_branch` y validar la clave contra la ref protegida en `validateStateRef` de `src/state-validation.mjs`; verify: `node --test test/state-validation.test.mjs` (CR3)
  - **Resolved:** `2026-07-22T18:35:00Z`
- [x] Ejecutar el gate completo; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-22T18:40:00Z`

## Log

- **2026-07-22T16:34:08Z** `[note]` Draft creado desde una auditoría adversarial externa pre-producción sobre codex/state-replica-v2; tres riesgos medios de disponibilidad/consistencia, ninguno fail-open. Agrupados por módulo único; divisible antes de aprobar si el humano lo prefiere.
- **2026-07-22T16:49:02Z** `[status]` draft → approved
- **2026-07-22T17:31:15Z** `[status]` approved → in-progress
- **2026-07-22T17:31:15Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-22T18:20:00Z** `[note]` Durante la implementación de CR1 se detectó que saltar `assertProtectedRefs` por completo para batches sin refs protegidas rompía un test existente de `20260721-193104` ("correction CR1") que depende de detectar cuanto antes un integration ref mal configurado (nombre de rama distinto del `integration_branch` real). El humano decidió en conversación: mantener el skip de CR1 para autoridad no activa, pero añadir una verificación barata adicional (`assertConfiguredIntegrationRefCheap`) que lee solo `config.yml` cuando la autoridad sí está activa, preservando la detección de desconfiguración sin pagar la validación completa del snapshot.
- **2026-07-22T18:35:00Z** `[note]` Implementadas las tres correcciones. CR1: `assertConfiguredIntegrationRefCheap` en `src/state-validation.mjs` — batches sin refs protegidas se aceptan sin validación completa; con autoridad activa hace una lectura barata de `config.yml` para seguir detectando drift de ref mal configurado (test existente de 193104 preservado sin cambios). CR2: `legacyRoots`/`protectedPath` case-fold a minúsculas. CR3: `validateStateRef` verifica `integration_branch` en cada commit nuevo del rango, no solo en los extremos. Rojo confirmado para los 4 tests nuevos antes del fix; verde después, sin regresión en la suite existente (20/20 en state-validation, 59/59 en capabilities/command/cli-bin). Gate completo: 917/917 tests, lint y 218 changes válidos.
- **2026-07-22T17:46:38Z** `[status]` in-progress → in-review
- **2026-07-22T17:55:39Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-22T17:59:12Z** `[validation]` in-validation → done (human accepted)
