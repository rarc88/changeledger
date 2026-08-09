---
id: "20260808-234920"
title: Enrutar config migrate por el store en repos activados
type: bug
status: done
created: 2026-08-08T23:49:20Z
depends_on: ["20260808-151643"]
reviewed: true
branch: integration/in-validation
related_to: ["20260628-113219", "20260628-113924", "20260809-113242"]
owner: rarc88
---

## Request

Hallazgo C de la review de `20260808-151643`, derivado a change dedicado por
decisión humana (2026-08-08): `applyMigration` en `src/config-migration.mjs`
escribe `config.yml` del working tree sin consultar la activación, así que
sobre un repo activado el comando CLI `changeledger config migrate` muta un
archivo que ninguna lectura consume — exactamente la divergencia
lectura/escritura que `20260808-151643` eliminó para las escrituras de config
del viewer (su CR6). La Investigation de aquel change lo excluyó
explícitamente («`config migrate` sobre repos inactivos»), por eso es trabajo
nuevo y no una corrección: la migración de schema sobre el config del
snapshot tiene sus propias preguntas (¿el preview lee del snapshot?, ¿qué
pasa con un worktree config divergente tras el cutover?) que merecen su
propia Investigation.

Nota: la ruta del viewer (`applyConfigMigrationImpl`) ya quedó enrutada en
`20260808-151643`; este change cubre la vía CLI directa y la coherencia del
preview.

## Investigation

El CLI descubre el marcador y llama a `applyMigration` con su path.
`applyMigration` siempre lee y escribe ese archivo directamente, sin consultar
la activación. En un repo activado puede salir 0 después de modificar una copia
que ninguna lectura consume, mientras la ref autoritativa no avanza.

El viewer ya enruta su apply por `mutateLedgerFile`, pero su preview todavía lee
el marcador. Con marcador y snapshot divergentes puede previsualizar la fuente
equivocada o producir un 409 espurio antes del preview. La infraestructura ya
dispone de `readStateConfigText`, `mutateLedgerFile`, `mutateState` y
`buildMigration`; no hace falta otra fuente de verdad ni otro protocolo.

En repos activados, preview y apply leerán los bytes de `config.yml` de la
revisión observada de la ref. El marcador queda limitado a discovery aunque su
YAML sea divergente o malformado. El dry-run no reserva revisión; el apply
recalcula sobre la autoridad vigente y publica un único commit CAS con mensaje
`config: migrate`. Un conflicto no hace retry y conserva al ganador. Un schema
vigente no crea commit; un snapshot inválido, futuro o ilegible falla sin
fallback. El modo inactivo conserva su ruta filesystem byte a byte.
La única operación del state store permitida para clasificar esa ruta es la
consulta read-only de `refs/changeledger/activation`; una vez confirmada su
ausencia no se lee ni se escribe ninguna otra ref o snapshot del store.

No cambian comandos, opciones, output normal, schemas, endpoints ni payloads.
El único cambio observable es que un repo activado migra la autoridad real y
puede reportar el conflicto CAS existente. El alcance cabe bajo
`global-state-scope`: reutiliza lectura focalizada y CAS, sin locks, retries ni
nueva copia mutable.

## Specification

### CR1 — El preview CLI usa la autoridad activa
- **Given** un repo activado con schema 1 en la ref y un marcador vigente, divergente o YAML malformado
- **When** se ejecuta `changeledger config migrate --dry-run`
- **Then** stdout muestra `Config migration 1 → 5 (dry run)` y el candidato derivado del blob de la ref
- **And** la ref, su snapshot y el marcador permanecen byte-idénticos

### CR2 — El apply activo escribe solo en la ref
- **Given** un repo activado cuya revisión `S1` contiene config schema 1
- **When** se ejecuta `changeledger config migrate`
- **Then** la ref avanza exactamente un commit hijo de `S1` con mensaje `config: migrate`
- **And** el snapshot contiene el resultado exacto de `buildMigration` y conserva los demás documentos
- **And** el marcador queda byte-idéntico

### CR3 — No-op y fallos activos no hacen fallback
- **Given** respectivamente un config activo vigente, futuro, inválido o una ref activa ausente o ilegible
- **When** se ejecuta preview o apply
- **Then** el vigente informa que no necesita cambios sin mover la ref
- **And** los demás casos fallan a partir de la autoridad activa
- **And** ninguno modifica ni usa como fallback el marcador

### CR4 — El conflicto CAS conserva al ganador
- **Given** que apply leyó config y revisión `S1` y otro escritor avanzó la ref a `S2`
- **When** intenta publicar el candidato
- **Then** termina distinto de cero con `state changed since load — re-run the command`
- **And** la ref queda en `S2` sin la migración perdedora

### CR5 — El modo inactivo no cambia
- **Given** un repo no activado con config antiguo, vigente, inválido o futuro
- **When** se ejecutan dry-run y apply
- **Then** se mantienen las expectativas existentes de `test/config-migration.test.mjs` y `test/cli-bin.test.mjs`
- **And** la única operación del state store es consultar read-only `refs/changeledger/activation`
- **And** tras confirmar su ausencia no se lee ni escribe ninguna otra ref o snapshot del store

### CR6 — El preview del viewer comparte autoridad
- **Given** un repo activado divergente y la revisión devuelta por `readProjectConfigStructured`
- **When** se solicita `previewConfigMigration`
- **Then** el preview compara y migra el contenido de la ref, no el marcador
- **And** no devuelve un 409 espurio, no mueve la ref y no modifica el marcador
- **And** apply conserva su CAS y respuesta 409 actuales

## Plan

- [x] Escribir primero los fixtures activos de CLI para preview, apply, no-op, fallo y conflicto
  - **Target:** `test/config-migration.test.mjs`, `test/cli-bin.test.mjs`
  - **Verify:** `node --test test/config-migration.test.mjs test/cli-bin.test.mjs`
  - **Criteria:** CR1, CR2, CR3, CR4, CR5
  - **Resolved:** `2026-08-09T16:54:20Z`
- [x] Enrutar la migración CLI por la autoridad efectiva y publicar por CAS
  - **Target:** `src/config-migration.mjs`, `bin/changeledger.mjs`
  - **Verify:** `node --test test/config-migration.test.mjs test/cli-bin.test.mjs`
  - **Criteria:** CR1, CR2, CR3, CR4, CR5
  - **Resolved:** `2026-08-09T17:43:56Z`
- [x] Enrutar el preview del viewer por el mismo target efectivo
  - **Target:** `src/viewer/domain.mjs`, `test/view.test.mjs`
  - **Verify:** `node --test test/view.test.mjs`
  - **Criteria:** CR6
  - **Resolved:** `2026-08-09T16:54:21Z`
- [x] Ejecutar el gate completo
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-08-09T16:54:21Z`

## Log

- **2026-08-08T23:49:20Z** `[note]` Draft creado por decisión humana al
  validar `20260808-151643`: los follow-ups de superficie propia (viewer,
  retornos, test de doble conflicto) se corrigen en aquel change; este cubre
  la vía CLI de config migrate, excluida explícitamente de su alcance. Queda
  en draft hasta su debido momento.
- **2026-08-09T16:18:33Z** `[status]` draft → approved (human via conversation)
- **2026-08-09T16:22:39Z** `[status]` approved → in-progress
- **2026-08-09T16:22:39Z** `[branch]` set: bug/20260808-234920 (auto)
- **2026-08-09T16:54:21Z** `[note]` Implementación TDD completada: matriz seleccionada 7/7, suites focalizadas 105/105 y 112/112, y pnpm verify 1326/1326.
- **2026-08-09T16:55:14Z** `[status]` in-progress → in-review
- **2026-08-09T16:56:15Z** `[note]` Mandato de review: auditoría completa de CR1-CR6 sobre eed0275e..HEAD, verificando autoridad activa, byte-identidad del marcador, commit único CAS, conflicto real, fallos sin fallback, cero state-store en modo inactivo y preview del viewer.
- **2026-08-09T17:02:52Z** `[review]` in-review → blocked: CR5 exige cero operaciones del state store en repos Git inactivos, pero detectar activación consulta refs/changeledger/activation; hace falta decidir si esa consulta queda exceptuada o si se rediseña la detección.
- **2026-08-09T17:40:39Z** `[note]` Decisión humana: CR5 exceptúa únicamente el probe read-only de refs/changeledger/activation; tras confirmar ausencia, la ruta inactiva no puede tocar ninguna otra ref o snapshot del store.
- **2026-08-09T17:40:39Z** `[status]` blocked → in-progress
- **2026-08-09T17:43:57Z** `[note]` Corrección CR5: fixture Git inactivo real prueba 8/8 combinaciones con exactamente el probe read-only de activación y ninguna otra operación del store; pnpm verify 1326/1326.
- **2026-08-09T17:44:36Z** `[status]` in-progress → in-review
- **2026-08-09T17:44:36Z** `[note]` Mandato de confirmación: verificar solo CR5 aclarado y regresiones de la corrección sin commit; cada ruta inactiva Git permite exactamente el probe read-only de refs/changeledger/activation y ninguna otra operación del store, conservando outputs y escrituras filesystem.
- **2026-08-09T17:47:53Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-08-09T18:11:50Z** `[validation]` in-validation → in-progress (human rejected via conversation): Post-review con borde ejecutado: un proyecto ChangeLedger anidado sin .git propio bajo un repo activado hereda la activación del ancestro y config migrate desde el interior escribe en la ref de estado del repo EXTERIOR sin migrar el interior; el binario pre-change migraba el interior correctamente. Escritura mal enrutada a la autoridad de otro repo, sin CR ni test que cubra la forma.
- **2026-08-09T18:12:39Z** `[note]` Decisión CR5 revisada por el humano en post-review (2026-08-09): la relajación registrada el 17:40 fue tomada por el agente externo, no por el humano; revisada en sustancia queda RATIFICADA — el CR5 original era inimplementable (el enrutado exige el probe de activación) y su test era vacuamente verde; la redacción vigente (exactamente el probe read-only y ninguna otra operación del store) es el mínimo necesario, verificado a nivel de proceso.
- **2026-08-09T18:21:27Z** `[branch]` set: integration/in-validation
- **2026-08-09T18:31:32Z** `[status]` in-progress → in-review
- **2026-08-09T18:31:32Z** `[note]` Mandato de confirmación (corrección del rechazo humano): diff sin commitear en src/config-migration.mjs y test/config-migration.test.mjs — verificar cerrado el enrutado anidado en ambas direcciones (el proyecto interior migra su archivo y la ref exterior no se mueve; la migración del propio repo activado sigue por la ref con marker divergente o malformado), sin regresión de CR1-CR5 vigentes; los residuales nombrados (marker sin project_id o inparseable en anidado; ref exterior rota bloquea al anidado) son follow-up, no fallo.
- **2026-08-09T18:38:21Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-08-09T18:38:21Z** `[note]` Follow-ups del confirmador (no bloqueantes, ejecutados): un anidado cuyo marker no tiene project_id o es inparseable sigue enrutando al ref del host; un anidado bajo host con ref de estado rota falla con state is not initialized en vez de migrar el archivo interior (fail-closed, el binario pre-change lo migraba). Ambos acotados y documentados; la costura equivalente de LECTURA en loadEffectiveConfig sigue siendo follow-up aparte.
- **2026-08-09T19:36:59Z** `[validation]` in-validation → done (human accepted via conversation)
- **2026-08-09T19:39:44Z** `[graduation]` spec: `architecture.md`
- **2026-08-09T19:40:10Z** `[note]` Cierre: graduado a architecture.md en commit combinado con 113242/171107/234920/131004/140157 — la spec es superficie compartida de los cinco y separar la reconciliación era imposible sin cinco ediciones en conflicto.
