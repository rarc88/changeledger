---
id: "20260809-194235"
title: Un solo snapshot por loadRepo activado
type: refactor
status: in-review
created: 2026-08-09T19:42:35Z
depends_on: ["20260809-113242"]
branch: refactor/20260809-194235
related_to: []
owner: rarc88
---

## Request

Eliminar la doble enumeración del snapshot que `20260809-113242` introdujo en
`loadRepo`/`loadRepoAsync` sobre repos activados (autorizado por el humano el
2026-08-09). Medido por el post-review con un shim de PATH contando procesos:
18 spawns de git donde dev gastaba 9 — la secuencia completa probe de
activación + `ls-tree -r` + `cat-file --batch-check` + `cat-file --batch`
corre dos veces, porque `loadEffectiveConfig` enumera el árbol para config y
la rama activada de `loadRepoWithConfig` ignora ese argumento y relee todo
vía `readSnapshot`. Todo comando del CLI que carga el repo lo paga en modo
activado — incluido el experimento de activar este mismo repo.

## Proposal

Que la rama activada de `loadRepoWithConfig`/`loadRepoAsync` reutilice la
lectura que el bootstrap ya hizo (pasar el snapshot o la revisión observada
junto al config, o invertir el orden: resolver activación una vez y derivar
config del mismo `readSnapshot`), sin cambiar ningún comportamiento
observable: mismos resultados, misma autoridad, mismos errores fail-closed.
El invariante de cero subprocesos fuera de un repo git se conserva.

Alternativa descartada: cachear por proceso — introduce estado global y
riesgo de servir un snapshot obsoleto tras una mutación en el mismo proceso
(el viewer muta y relee).

## Specification

### CR1 — Una sola enumeración del árbol de estado
- **Given** un repo activado y un `loadRepo` instrumentado contando procesos git (shim de PATH)
- **When** se carga el repo
- **Then** la secuencia probe + `ls-tree` + `cat-file --batch-check` + `cat-file --batch` aparece exactamente una vez (9 spawns, no 18)

### CR2 — Comportamiento observable intacto
- **Given** las suites existentes de `repo`, `config`, `context`, `agent-context`, `view` y `cli-bin`
- **When** se ejecutan tras el refactor
- **Then** pasan sin modificar ninguna aserción, y en un directorio fuera de todo repo git la carga sigue costando cero subprocesos

## Plan

- [x] Reutilizar la lectura del bootstrap en la rama activada de
  `loadRepoWithConfig` y `loadRepoAsync`
  - **Target:** `src/repo.mjs`, `src/config.mjs`
  - **Verify:** `node --test test/repo.test.mjs test/config.test.mjs`
  - **Criteria:** CR1, CR2
  - **Resolved:** `2026-08-10T13:06:33Z`
- [x] Suite completa y gate del repo
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-08-10T13:06:33Z`

## Log
- **2026-08-10T00:38:57Z** `[status]` draft → approved (human via conversation)
- **2026-08-10T12:42:45Z** `[status]` approved → in-progress
- **2026-08-10T12:42:45Z** `[branch]` set: refactor/20260809-194235 (auto)
- **2026-08-10T13:06:34Z** `[status]` in-progress → in-review
- **2026-08-10T13:06:34Z** `[note]` Mandato del review: superficie que gobierna (repo.mjs, config.mjs y sus tests, diff cerrado del carril) con las decisiones del implementador como escrutinio: readBootstrap con contrato tri-estado de options.snapshot (ausente/null/objeto — ¿algún caller directo del viewer queda en 18?); effectiveConfigFromSnapshot y el split de claimsAnotherLedger sin tocar config-migration; la computación de config deliberadamente conservada en la rama foreign (asimetría señalada por el propio implementador); y re-derivar al menos los mutantes de re-lectura sync/async. Commit con --no-verify por la fuga GIT_DIR (gate manual completo antes).
