---
id: "20260722-202057"
title: Bloquear el downgrade local de authority v2
type: bug
status: in-review
created: 2026-07-22T20:20:57Z
depends_on: []
owner: raruiz-hiberuscom
related_to: ["20260721-193106", "20260721-193101", "20260722-203030"]
release_impact: patch
---

## Request

La ejecución paralela de la auditoría `20260721-193106` (fila UPG-3c) encontró y
el auditor principal confirmó de forma independiente un hallazgo crítico: en un
repo activado v2 y ya mutado, revertir localmente `authority.yml` a forma v1
hace que el CLI sirva un snapshot obsoleto como verdad actual, con exit 0 y sin
ningún aviso, aunque `refs/changeledger/confirmed` siga presente y actualizado
en el mismo repo. Es la misma clase de defecto (fallback de authority) que
descalificó al prototipo v1. Según los gates del audit, bloquea cualquier
perfil de release mientras siga abierto.

## Investigation

Causa raíz: `gitStateRevision` (`src/ledger-store.mjs:202`), en la rama
`format_version !== 2`, resuelve `authority.state_ref` — una rama local
libremente reescribible — sin ningún cross-check contra las refs de réplica v2
(`refs/changeledger/confirmed`/`observed`) que puedan existir en el mismo repo.
El check de ancestría (baseline is-ancestor revision) pasa porque el commit
obsoleto desciende del baseline.

Reproducción en vivo (evidencia de la ejecución paralela, área upgrade): repo
avanzado a `in-progress` (`refs/changeledger/confirmed` en la revisión nueva);
tras escribir un `authority.yml` v1 y apuntar `refs/heads/changeledger/state`
al commit anterior (`approved`), `list --json` y `show` devolvieron el estado
`approved` como actual, exit 0; `ledger_freshness: "local"` no alarma.

Mitigante verificado: el hook remoto rechaza el downgrade vía push (`protected
path changed: .changeledger/authority.yml`). Pero el camino local de lectura no
tiene defensa análoga y es alcanzable con cualquier checkout/rebase/edición
manual o remoto sin hook. La documentación de este alcance (protección de
authority es push/hook, no local) pertenece a `20260722-203030`, no a este fix.

## Specification

### CR1 — La presencia de refs v2 invalida el modo v1
- **Given** un repo cuyo `authority.yml` declara una forma distinta de
  `format_version: 2` mientras existe cualquiera de las refs de réplica v2
  locales (`refs/changeledger/confirmed`, `observed` o `pending`)
- **When** cualquier comando lee o muta el ledger
- **Then** falla cerrado con un error que nombra el conflicto (authority v1 con
  réplica v2 presente) y cómo resolverlo
- **And** nunca sirve el contenido de `authority.state_ref` como verdad

### CR2 — Un repo v1 genuino no se ve afectado
- **Given** un repo v1 sin ninguna ref de réplica v2
- **When** se lee o muta el ledger
- **Then** el comportamiento v1 actual se conserva sin cambios

## Plan

- [x] Añadir tests fallidos del downgrade con refs v2 presentes (lectura y mutación) y del repo v1 genuino intacto, y añadir la detección en `gitStateRevision` de `src/ledger-store.mjs`; verify: `node --test test/ledger-store.test.mjs test/state-command.test.mjs` (CR1, CR2)
  - **Resolved:** `2026-07-22T21:10:00Z`
- [x] Ejecutar el gate completo; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-22T21:12:00Z`

## Log

- **2026-07-22T20:20:57Z** `[note]` Draft creado desde la unión de las dos ejecuciones de 20260721-193106: hallado por la ejecución paralela (UPG-3c) y confirmado independientemente por el auditor principal. Crítico por los gates del audit: bypass/fallback de authority sirviendo verdad obsoleta en silencio.
- **2026-07-22T20:56:25Z** `[status]` draft → approved (human via conversation)
- **2026-07-22T20:56:26Z** `[status]` approved → in-progress
- **2026-07-22T20:56:26Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-22T21:12:00Z** `[note]` `gitStateRevision` (`src/ledger-store.mjs`) detecta, en la rama de authority v1, la presencia de cualquiera de `refs/changeledger/{confirmed,observed,pending}` y falla cerrado antes de resolver `authority.state_ref`, en lectura y mutación (ambas pasan por la misma función). Un repo v1 genuino sin esas refs no cambia de comportamiento. Rojo confirmado antes del fix (CR1 fallaba, CR2 ya pasaba por no tocar código); verde después: 32/32 en `ledger-store.test.mjs`, 111/111 en la suite ampliada (`state-command`/`state-store`/`ledger-mutations`). Gate completo: 922/922 tests, lint y 234 changes válidos.
- **2026-07-22T21:03:27Z** `[status]` in-progress → in-review
