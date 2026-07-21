---
id: "20260721-195318"
title: Rechazar toda escritura con schemas futuros
type: bug
status: in-review
created: 2026-07-21T19:53:18Z
depends_on: []
owner: raruiz-hiberuscom
related_to: ["20260628-113219", "20260628-113924"]
release_impact: patch
---

## Request

Una versión antigua de ChangeLedger puede leer parcialmente una configuración
creada por una versión futura y, hoy, la mayoría de comandos mutadores continúan
escribiendo con las reglas antiguas. Esto puede eliminar o reinterpretar verdad
que el cliente no comprende. Toda escritura de ledger debe fallar cerrada cuando
`schema_version` sea mayor que la versión soportada, manteniendo disponibles las
consultas que no necesitan reinterpretar el formato.

## Investigation

`buildMigration` ya rechaza schemas futuros y el editor de configuración del
viewer repite una comprobación equivalente. Sin embargo, la protección no vive
en una frontera compartida:

- `newChange` carga config y crea archivos sin comparar la versión;
- las mutaciones de lifecycle resuelven el change y llaman directamente a
  `mutateFileAtomic`;
- `fix`, `graduate` y releases escriben después de `loadRepo` sin un guard
  común;
- las acciones de lifecycle del viewer delegan en esos mismos comandos y por
  tanto heredan el hueco.

En el prototipo `codex/global-state-branch@6ac08826` se introdujo
`assertSupportedSchema` y se aplicó a esas familias como parte del feature de
estado global. La protección es independiente de ese feature y debe existir en
`dev` antes de construir otro formato de almacén.

`20260628-113219` define la migración segura de config y
`20260628-113924` el editor/migración del viewer. Ambos están terminados y son
contexto: este bug no cambia el mecanismo de migración ni autoriza a un cliente
antiguo a modificar un schema futuro.

La causa raíz es una regla de compatibilidad implementada en consumidores
aislados en lugar de una precondición compartida de toda mutación. No se
modificará `SUPPORTED_SCHEMA_VERSION` ni se portará el schema 4 del prototipo.

## Specification

### CR1 — Creación fail-closed
- **Given** una configuración válida salvo por `schema_version: 4` y un binario cuyo `SUPPORTED_SCHEMA_VERSION` es `3`
- **When** se ejecuta `changeledger new feature future "Future"`
- **Then** falla con `config schema 4 is newer than supported schema 3; update ChangeLedger before writing`
- **And** no crea directorios, locks ni archivos de change

### CR2 — Lifecycle fail-closed
- **Given** el mismo repositorio futuro y un change existente
- **When** se intenta cualquiera de `status`, `approve`, `review`, `validation`, `reopen`, `owner`, `discard`, `archive`, `archive --graduated`, `log` o `task`
- **Then** cada comando falla con el mismo error de schema antes de escribir
- **And** change, specs y releases permanecen byte-for-byte iguales

### CR3 — Reparación y graduación fail-closed
- **Given** el mismo repositorio futuro con defectos reparables o un change `done`
- **When** se ejecuta cualquier variante mutadora de `fix`, `graduate --new`, `graduate --into` o `graduate --skip`
- **Then** falla con el mismo error de schema antes de crear, reparar o enlazar archivos
- **And** `fix --dry-run` continúa disponible porque no escribe

### CR4 — Releases fail-closed
- **Given** el mismo repositorio futuro
- **When** se ejecuta `release init` o `release record`
- **Then** falla con el mismo error de schema antes de crear el directorio, lock o manifest de releases

### CR5 — Lecturas y migración conservan su contrato
- **Given** el mismo repositorio futuro
- **When** se ejecuta `list`, `show`, `search`, `context`, el viewer de solo lectura o `config migrate --dry-run`
- **Then** ninguna consulta modifica archivos
- **And** la migración informa que el schema es futuro en vez de degradarlo
- **And** el editor de config continúa bloqueando sus escrituras con la misma incompatibilidad

### CR6 — Un único guard compartido
- **Given** una nueva familia de mutación que usa la frontera compartida del repositorio
- **When** recibe una config con schema futuro
- **Then** obtiene el mismo error sin reimplementar la comparación de versiones
- **And** schemas ausentes, anteriores o iguales a `3` conservan el comportamiento actual

## Plan

- [x] Añadir tests fallidos del guard puro y exportar `assertSupportedSchema` desde `src/config-migration.mjs` sin cambiar `SUPPORTED_SCHEMA_VERSION`; verify: `node --test test/config-migration.test.mjs` (CR1, CR6)
  - **Resolved:** `2026-07-21T20:09:07Z`
- [x] Añadir una matriz de lifecycle futuro en `test/agent.test.mjs` y aplicar el guard compartido en la resolución mutadora de `src/commands/agent.mjs`; verify: `node --test test/agent.test.mjs` (CR2, CR6)
  - **Resolved:** `2026-07-21T20:09:08Z`
- [x] Añadir regresiones de creación, fix y graduación en `test/cli.test.mjs`, `test/fix.test.mjs` y `test/graduate.test.mjs`; aplicar el guard en `src/commands/new.mjs`, `src/commands/fix.mjs` y `src/commands/graduate.mjs`; verify: `node --test test/cli.test.mjs test/fix.test.mjs test/graduate.test.mjs` (CR1, CR3, CR6)
  - **Resolved:** `2026-07-21T20:09:08Z`
- [x] Añadir regresiones de releases y aplicar el guard antes de cualquier mkdir/lock en `src/commands/release.mjs`; verify: `node --test test/release.test.mjs` (CR4, CR6)
  - **Resolved:** `2026-07-21T20:09:08Z`
- [x] Cubrir lecturas, dry-run y acciones del viewer en `test/context.test.mjs` y `test/view.test.mjs`, reutilizando el guard desde `src/viewer/domain.mjs`; verify: `node --test test/context.test.mjs test/view.test.mjs` (CR2, CR5, CR6)
  - **Resolved:** `2026-07-21T20:09:08Z`
- [x] Ejecutar el gate completo; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-21T20:10:03Z`

## Log

- **2026-07-21T19:53:18Z** `[note]` Extraído del prototipo de estado como bug general: se porta la invariante y su cobertura, no el schema 4 ni los adaptadores de estado v1.
- **2026-07-21T20:03:17Z** `[status]` draft → approved (human via conversation)
- **2026-07-21T20:03:52Z** `[status]` approved → in-progress
- **2026-07-21T20:03:52Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-21T20:10:03Z** `[status]` in-progress → in-review
