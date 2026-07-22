---
id: "20260722-163406"
title: Archivos no inventariados bloquean la rama de recovery
type: bug
status: done
created: 2026-07-22T16:34:06Z
depends_on: []
owner: raruiz-hiberuscom
related_to: ["20260721-193103", "20260721-193106"]
release_impact: patch
---

## Request

Una auditoría adversarial externa encontró que `state export
--recovery-branch` — el único camino de reversa después de la primera mutación
global — queda permanentemente inutilizable en un layout de repo común: basta
un archivo que no sea `.md`/`.yml` dentro de los directorios del ledger (por
ejemplo `.changeledger/changes/.gitkeep`) para que la recovery falle siempre.

## Investigation

Causa raíz: el inventario y el guard de recovery usan criterios asimétricos
sobre los mismos directorios.

- `inventorySource` (`src/state-migration.mjs:264`) salta cualquier entrada que
  no termine en la extensión esperada: `if (!entry.path.endsWith(extension))
  continue;`. Un `.gitkeep` o cualquier archivo auxiliar nunca entra al
  inventario.
- `state activate --prepare` elimina solo los blobs legacy inventariados y
  conserva todo lo demás; el archivo extraño sobrevive en la rama de
  integración bajo el root legacy.
- `assertRecoveryTargetsEmpty` (`src/state-migration.mjs:1241-1252`) lanza
  `legacy recovery target is occupied: <path>` ante **cualquier** entrada de los
  roots legacy distinta de `authority.yml`, sin distinguir colisión real de
  archivo inerte.

Resultado: fail-closed en la dirección equivocada — el archivo inerte no
colisiona con nada de lo que la recovery materializa, pero desactiva para
siempre el mecanismo prometido por CR9 de `20260721-193103`. Según la escala
de `20260721-193106` es un hallazgo alto: recuperación segura no disponible
para un ledger soportado.

Dirección del fix, dos frentes coherentes:

1. Visibilidad en adopción: preview y el receipt de activación nombran los
   archivos de los roots legacy que quedan fuera del inventario, para que el
   humano decida antes del cutover.
2. Recovery precisa: el guard falla solo ante colisiones de path reales con los
   archivos que la recovery va a escribir, no ante cualquier entrada.

## Specification

### CR1 — Preview nombra los archivos no inventariados
- **Given** una source cuyo `changes_dir` contiene `changes/.gitkeep` además de
  changes válidos
- **When** se ejecuta `state migrate --preview`
- **Then** el plan y la salida listan `changes/.gitkeep` como no inventariado
  con su OID y path
- **And** el preview no falla por su mera presencia

### CR2 — Recovery falla solo ante colisión real
- **Given** integración activada donde sobrevive `.changeledger/changes/.gitkeep`
  y un estado confirmado `S1` sin ningún documento llamado `.gitkeep`
- **When** se ejecuta `state export --recovery-branch`
- **Then** crea la rama de recovery materializando `S1` en layout legacy
- **And** conserva `.changeledger/changes/.gitkeep` intacto en el commit

### CR3 — La colisión de path exacta sigue fallando cerrada
- **Given** el head de integración contiene
  `.changeledger/changes/20260722-000000-demo.md` y `S1` confirma un change
  con ese mismo path destino
- **When** se ejecuta `state export --recovery-branch`
- **Then** falla con `legacy recovery target is occupied:
  .changeledger/changes/20260722-000000-demo.md`
- **And** no crea rama ni escribe ningún objeto

## Plan

- [x] Restringir `assertRecoveryTargetsEmpty` en `src/state-migration.mjs` a colisiones reales de path (construir `writes` antes del guard y comparar contra ese set), escribiendo antes los tests fallidos de `.gitkeep` superviviente y de colisión exacta; verify: `node --test test/state-migration.test.mjs` (CR2, CR3)
  - **Resolved:** `2026-07-22T17:25:00Z`
- [x] Recolectar entradas no inventariadas en `inventorySource` y exponerlas en `plan.uninventoried` / receipt del preview en `src/state-migration.mjs` y `bin/changeledger.mjs`, escribiendo antes el test fallido; verify: `node --test test/state-migration.test.mjs test/state-command.test.mjs test/cli-bin.test.mjs` (CR1)
  - **Resolved:** `2026-07-22T17:25:00Z`
- [x] Ejecutar el gate completo; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-22T17:30:00Z`

## Log

- **2026-07-22T16:34:06Z** `[note]` Draft creado desde una auditoría adversarial externa pre-producción sobre codex/state-replica-v2; hallazgo alto: el único camino de reversa post-mutación muere ante un archivo inerte en los roots legacy.
- **2026-07-22T16:48:59Z** `[status]` draft → approved
- **2026-07-22T16:59:41Z** `[status]` approved → in-progress
- **2026-07-22T16:59:41Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-22T17:30:00Z** `[note]` `assertRecoveryTargetsEmpty` ahora recibe el set de targets exactos que la recovery va a escribir y solo rechaza colisiones reales; un `.gitkeep` u otro archivo no inventariado sobrevive intacto. `inventorySource` recolecta esas entradas y `previewStateMigration` las expone en `plan.uninventoried` y en el receipt CLI. Reproducido el bug exacto en rojo (mismo mensaje "legacy recovery target is occupied") antes del fix. Gate completo: 907/907 tests, lint y 218 changes válidos.
- **2026-07-22T17:08:02Z** `[status]` in-progress → in-review
- **2026-07-22T17:20:39Z** `[review]` in-review → in-progress (retry): Reviewer observed pnpm verify red due to a race with unrelated concurrent 163409 edits sitting unformatted in the same working tree, not a defect in this commit (verified: ec1d9b50's test file alone is biome-clean). Also fixing a cosmetic CR3 spec/test path drift the reviewer flagged as LOW.
- **2026-07-22T17:50:00Z** `[note]` Aislado `test/state-migration.test.mjs` del commit ec1d9b50 vía stash y corrido `biome check` solo: limpio, confirmando que el gate rojo era ruido del trabajo concurrente de 163409, no un defecto de este commit. Corregido el path de ejemplo del CR3 para que coincida con el id real del fixture. Gate completo re-ejecutado con el árbol de trabajo despejado: 911/911 tests, lint y 218 changes válidos.
- **2026-07-22T17:21:11Z** `[status]` in-progress → in-review
- **2026-07-22T17:25:34Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-22T17:59:09Z** `[validation]` in-validation → done (human accepted)
