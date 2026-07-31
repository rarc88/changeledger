---
id: "20260731-161652"
title: Bloquear escrituras con schemas futuros
type: bug
status: in-progress
created: 2026-07-31T16:16:52Z
depends_on: []
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
- [ ] Escribir primero una matriz fallida de mutaciones de change y aplicar el guard en su frontera común
  - **Target:** `src/commands/agent.mjs`, `test/agent.test.mjs`
  - **Verify:** `node --test test/agent.test.mjs`
  - **Criteria:** CR2
- [ ] Escribir primero regresiones de creación, fix, graduación y releases y bloquear cada familia antes de escribir
  - **Target:** `src/commands/new.mjs`, `src/commands/fix.mjs`, `src/commands/graduate.mjs`, `src/commands/release.mjs`, `test/cli.test.mjs`, `test/fix.test.mjs`, `test/graduate.test.mjs`, `test/release.test.mjs`
  - **Verify:** `node --test test/cli.test.mjs test/fix.test.mjs test/graduate.test.mjs test/release.test.mjs`
  - **Criteria:** CR3, CR4
- [ ] Sustituir los guards locales del viewer por la precondición compartida y preservar sus respuestas HTTP
  - **Target:** `src/viewer/domain.mjs`, `test/view.test.mjs`
  - **Verify:** `node --test test/view.test.mjs`
  - **Criteria:** CR5
- [ ] Ejecutar el gate completo después del ciclo red-green-refactor
  - **Support:**
  - **Verify:** `pnpm verify`

## Log
- **2026-07-31T16:30:55Z** `[status]` draft → approved (human via conversation)
- **2026-07-31T16:33:41Z** `[status]` approved → in-progress
- **2026-07-31T16:40:55Z** `[note]` CR1 red→green: el import inexistente de assertSupportedSchema falló antes de la implementación; tras extraer el guard, test/config-migration.test.mjs pasa. Mutante >= rechazó schema 4 y la regresión lo detectó; restaurado por edición.
