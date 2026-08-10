---
id: "20260731-161652"
title: Bloquear escrituras con schemas futuros
type: bug
status: done
created: 2026-07-31T16:16:52Z
depends_on: []
archived: true
reviewed: true
related_to: ["20260613-205853", "20260628-113219", "20260628-113924", "20260730-183807"]
owner: Roberto Ruiz
release_impact: patch
---

## Request

Una versión antigua de ChangeLedger puede leer parcialmente una configuración
creada por una versión futura y hoy varios comandos mutadores continúan
escribiendo con las reglas antiguas. Eso puede eliminar o reinterpretar verdad
que el cliente no comprende. Toda escritura sobre el ledger debe fallar antes
de modificar archivos cuando `schema_version` sea mayor que la versión
soportada; las consultas y los previews deben seguir disponibles para diagnosticar
y migrar con una versión compatible.

## Investigation

`buildMigration` ya rechaza schemas futuros y el editor de configuración del
viewer protege sus escrituras, pero la precondición no vive en una frontera
compartida. `newChange` carga la config y crea un documento sin comparar la
versión; las mutaciones de lifecycle resuelven el change y escriben directamente;
`fix`, `graduate` y releases también escriben después de `loadRepo` sin un guard
común. Por tanto, un repo con `schema_version: 5` puede ser modificado por el
cliente actual, cuyo `SUPPORTED_SCHEMA_VERSION` es 4.

La rama histórica `codex/state-replica-v2` demostró una solución reutilizable:
un guard puro compartido aplicado antes de cada familia de escritura y una
matriz de regresión sobre los puntos de entrada. La implementación histórica no
se copiará junto con el almacén de estado; se portará únicamente esta
precondición al modelo de ficheros actual.

`20260628-113219` y `20260628-113924` establecieron la migración segura y el
fail-closed del editor; `20260613-205853` define que `check` valida la config y
`20260730-183807` prohíbe reescrituras silenciosas ante entrada de consumidor.
Son contexto terminado, no dependencias de ejecución.

## Specification

### CR1 — Guard compartido de schema futuro
- **Given** una config con `schema_version: 5` y un cliente cuyo `SUPPORTED_SCHEMA_VERSION` es 4
- **When** una frontera mutadora valida la config
- **Then** falla exactamente con `config schema 5 is newer than supported schema 4; update ChangeLedger before writing`
- **And** no crea, reemplaza ni elimina ningún archivo

### CR2 — Mutaciones de changes bloqueadas antes de escribir
- **Given** un repo con `schema_version: 5` y un change resoluble
- **When** se ejecuta cualquiera de las operaciones mutadoras de lifecycle, owner, task, log, archive o discard expuestas por `src/commands/agent.mjs`
- **Then** la operación falla mediante el guard compartido antes de adquirir un lock o modificar el change
- **And** el change queda byte por byte intacto

### CR3 — Resto de familias mutadoras bloqueadas
- **Given** un repo con `schema_version: 5`
- **When** se intenta crear un change, aplicar `fix` sin `--dry-run`, graduar o saltar graduación, o iniciar/registrar historial de release
- **Then** cada comando falla mediante el mismo guard antes de su primera escritura
- **And** no deja directorios, locks ni archivos parciales

### CR4 — Lecturas y previews permanecen disponibles
- **Given** un repo con `schema_version: 5`
- **When** se ejecutan consultas que no escriben, `changeledger check`, `fix --dry-run` o el preview de migración
- **Then** la operación conserva su comportamiento de lectura o diagnóstico
- **And** no se bloquea por el guard destinado exclusivamente a escrituras

### CR5 — El viewer reutiliza la misma regla
- **Given** un repo con `schema_version: 5`
- **When** el viewer intenta guardar, parchear o migrar su configuración
- **Then** responde con el diagnóstico del guard compartido y no modifica `config.yml`
- **And** no mantiene una segunda implementación divergente del cálculo de versión

## Plan

- [x] Escribir primero las regresiones del guard puro y extraer la precondición compartida de schema soportado
  - **Target:** `src/config-migration.mjs`, `test/config-migration.test.mjs`
  - **Verify:** `node --test test/config-migration.test.mjs`
  - **Criteria:** CR1
  - **Resolved:** `2026-07-31T16:40:55Z`
- [x] Escribir primero una matriz fallida de mutaciones de change y aplicar el guard en su frontera común
  - **Target:** `src/commands/agent.mjs`, `test/agent.test.mjs`
  - **Verify:** `node --test test/agent.test.mjs`
  - **Criteria:** CR2
  - **Resolved:** `2026-07-31T16:42:30Z`
- [x] Escribir primero regresiones de creación, fix, graduación y releases y bloquear cada familia antes de escribir
  - **Target:** `src/commands/new.mjs`, `src/commands/fix.mjs`, `src/commands/graduate.mjs`, `src/commands/release.mjs`, `test/cli.test.mjs`, `test/fix.test.mjs`, `test/graduate.test.mjs`, `test/release.test.mjs`
  - **Verify:** `node --test test/cli.test.mjs test/fix.test.mjs test/graduate.test.mjs test/release.test.mjs`
  - **Criteria:** CR3, CR4
  - **Resolved:** `2026-07-31T16:43:44Z`
- [x] Sustituir los guards locales del viewer por la precondición compartida y preservar sus respuestas HTTP
  - **Target:** `src/viewer/domain.mjs`, `test/view.test.mjs`
  - **Verify:** `node --test test/view.test.mjs`
  - **Criteria:** CR5
  - **Resolved:** `2026-07-31T16:45:29Z`
- [x] Ejecutar el gate completo después del ciclo red-green-refactor
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-07-31T16:47:31Z`

## Log
- **2026-07-31T16:30:55Z** `[status]` draft → approved (human via conversation)
- **2026-07-31T16:33:41Z** `[status]` approved → in-progress
- **2026-07-31T16:40:55Z** `[note]` CR1 red→green: el import inexistente de assertSupportedSchema falló antes de la implementación; tras extraer el guard, test/config-migration.test.mjs pasa. Mutante >= rechazó schema 4 y la regresión lo detectó; restaurado por edición.
- **2026-07-31T16:42:30Z** `[note]` CR2 verde: la matriz de mutaciones de changes preserva bytes y no deja locks. Mutante sin guard en locate permitió status y el test falló con Missing expected exception; guard restaurado por edición.
- **2026-07-31T16:43:44Z** `[note]` CR3/CR4 verde: new, fix de escritura, graduación y releases fallan antes de escribir; fix --dry-run permanece disponible. Mutante sin guard en new creó el change y la regresión falló con Missing expected exception; restaurado por edición.
- **2026-07-31T16:45:29Z** `[note]` CR5 verde: preview, guardado, patch y migración comparten el diagnóstico y rechazan antes del lock. Mutante sin preflight en applyConfigMigration intentó adquirir el lock; la regresión lo detectó y fue restaurado por edición.
- **2026-07-31T16:47:31Z** `[note]` Gate completo verde fuera del sandbox: Biome, 1057/1057 tests y changeledger check (5 válidos). La primera ejecución confinada tuvo sólo dos fallos ambientales: escritura de logs npm y listen EPERM en 127.0.0.1.
- **2026-07-31T16:47:32Z** `[status]` in-progress → in-review
- **2026-07-31T16:50:02Z** `[note]` Mandato de revisión: auditoría completa del cambio y de dev..HEAD dentro del alcance autorizado, incluyendo criterios, ausencia de escrituras/locks y preservación de lecturas/previews.
- **2026-07-31T16:55:59Z** `[review]` in-review → in-progress (retry): El rango dev..HEAD incluye los cuatro changes pendientes 20260731-161653..161656; aislar este candidato para que contenga únicamente 20260731-161652.
- **2026-07-31T16:57:57Z** `[note]` Corrección de revisión: candidato aislado en codex/rescue-future-schema-guard desde dev; dev..HEAD contiene 7 commits y 15 rutas, todas pertenecientes a 20260731-161652. Los cuatro changes pendientes permanecen preservados en codex/rescue-proven-fixes.
- **2026-07-31T16:57:57Z** `[note]` Mandato de revisión de confirmación: comprobar únicamente el defecto reportado de aislamiento del rango y cualquier regresión introducida al trasladar los commits.
- **2026-07-31T16:57:57Z** `[status]` in-progress → in-review
- **2026-07-31T17:01:03Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-31T21:24:42Z** `[validation]` in-validation → done (human accepted via conversation)
- **2026-07-31T21:25:28Z** `[graduation]` spec: `architecture.md`
- **2026-07-31T21:25:28Z** `[archive]` archived
