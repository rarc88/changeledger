---
id: "20260722-181235"
title: Las lecturas v2 exigen un remoto resoluble
type: bug
status: done
created: 2026-07-22T18:12:35Z
depends_on: []
owner: raruiz-hiberuscom
related_to: ["20260721-193102", "20260722-163407"]
release_impact: patch
---

## Request

La re-auditoría integral post-fixes (contexto limpio, capa de réplica/sync)
verificó el fix de `20260722-163407` y no encontró pérdida de datos en el
protocolo ante crashes, concurrencia ni rewinds del remoto. Pero encontró dos
desviaciones del principio local-first: toda lectura del ledger en un clon v2
se bloquea si el remoto no resuelve, y un `changeledger.remote` explícitamente
vacío cae en silencio a `origin`. Se agrupan por módulo único
(`src/state-store.mjs`); divisibles antes de aprobar si el humano lo prefiere.

## Investigation

Dos causas raíz en la misma superficie:

1. **Lecturas acopladas a la resolución del remoto.** `loadStateSnapshot`
   (`src/ledger-store.mjs:314`) llama incondicionalmente a
   `stateReplicaStatus` (`src/state-store.mjs:374`), cuya primera línea es
   `stateRemote(repoRoot)` — que lanza si el remoto configurado no existe.
   `stateReplicaStatus` usa el remoto solo como campo informativo del retorno;
   nunca hace fetch. Consecuencia: con `origin` renombrado/eliminado, o con
   `changeledger.remote` ambiguo, **todo comando de lectura** falla — incluso
   totalmente offline con las refs `confirmed/observed/pending` completas en
   local. Falla ruidoso y recuperable por config, sin pérdida silenciosa, pero
   contradice el core local-first de `INTENT.md`: leer el estado ya replicado
   no debería exigir configuración de red válida.
2. **Valor vacío tratado como ausencia.** `stateRemote`
   (`src/state-store.mjs:198-212`) filtra líneas vacías
   (`.split('\n').filter(Boolean)`), así que `git config changeledger.remote ""`
   produce `[]` y cae al fallback `origin` — tragándose una misconfiguración
   explícita, contra la intención fail-closed de `20260722-163407`. Un valor de
   solo espacios sí falla cerrado (verificado empíricamente por el auditor).

## Specification

### CR1 — Leer estado replicado no exige remoto resoluble
- **Given** un clon activado v2 con refs de réplica locales completas y sin
  ningún remoto resoluble (remoto borrado o `changeledger.remote` inválido)
- **When** se ejecuta cualquier comando de solo lectura del ledger
- **Then** la lectura funciona con el estado local replicado y reporta la
  frescura/confirmación calculadas desde las refs locales
- **And** los comandos que sí requieren red (`state sync`, publicación) siguen
  fallando cerrado nombrando el remoto irresoluble

### CR2 — Un remoto explícitamente vacío falla cerrado
- **Given** `changeledger.remote` configurado con valor vacío
- **When** se resuelve el remoto de estado
- **Then** falla nombrando el valor inválido en lugar de caer a `origin`
- **And** la ausencia real de la clave conserva el fallback documentado

## Plan

- [x] Añadir test fallido de lectura offline sin remoto resoluble; desacoplar la resolución del remoto de `stateReplicaStatus` (o del camino de lectura de `loadStateSnapshot`) en `src/state-store.mjs`/`src/ledger-store.mjs` manteniendo el fail-closed en sync/publicación; verify: `node --test test/state-store.test.mjs test/state-command.test.mjs` (CR1)
  - **Resolved:** `2026-07-22T18:40:00Z`
- [x] Añadir test fallido del valor vacío y rechazarlo en `stateRemote` de `src/state-store.mjs` conservando el fallback por ausencia; verify: `node --test test/state-store.test.mjs` (CR2)
  - **Resolved:** `2026-07-22T18:40:00Z`
- [x] Ejecutar el gate completo; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-22T18:45:00Z`

## Log

- **2026-07-22T18:12:35Z** `[note]` Draft creado desde la re-auditoría integral post-fixes (agente adversarial de contexto limpio sobre la capa de réplica/sync). CR1 riesgo medio de disponibilidad local-first; CR2 borde bajo de fail-closed. Divisible antes de aprobar si el humano lo prefiere.
- **2026-07-22T18:16:47Z** `[status]` draft → approved
- **2026-07-22T18:17:16Z** `[status]` approved → in-progress
- **2026-07-22T18:17:16Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-22T18:40:00Z** `[note]` CR1: `stateRemote` acepta `{ required: false }`; `stateReplicaStatus` la usa así, así que ya no lanza si el remoto no resuelve — devuelve `remote: null` y calcula frescura/confirmación solo desde las refs locales. `syncStateReplica` y el resto de llamadas (migración, activación) conservan el default estricto. CLI `state status` imprime `(unresolved)` en vez de `null`, igual que el resto de valores en inglés de ese comando (`(none)`, `unknown`). CR2: `stateRemote` usa `git config --null --get-all` para distinguir valor-presente-vacío de clave-ausente; un valor vacío explícito falla cerrado nombrando el problema, la ausencia real conserva el fallback a `origin`. Rojo confirmado para ambos tests antes del fix; verde después: 13/13 en `state-store.test.mjs`, sin regresión en `state-command.test.mjs`/`state-migration.test.mjs`/`ledger-mutations.test.mjs`/`cli-bin.test.mjs` (139/139). Gate completo: 920/920 tests, lint y 220 changes válidos.
- **2026-07-22T18:26:49Z** `[status]` in-progress → in-review
- **2026-07-22T18:32:39Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-22T18:34:41Z** `[validation]` in-validation → done (human accepted)
