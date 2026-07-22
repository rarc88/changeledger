---
id: "20260721-193103"
title: Migrar al estado global mediante un cutover recuperable
type: feature
status: in-validation
created: 2026-07-21T19:31:03Z
depends_on: ["20260721-193101", "20260721-193102"]
owner: Roberto Ruiz
related_to: ["20260628-113219", "20260711-210115", "20260721-193104", "20260721-193106"]
release_impact: major
---

## Request

Los repositorios existentes tienen changes y specs distribuidos entre ramas.
La adopción del snapshot global debe inventariar esa verdad sin pérdida,
resolver duplicados de forma humana y cambiar la autoridad sin dejar un estado
intermedio que clientes nuevos interpreten de una forma y clientes antiguos de
otra. La migración debe ser revisable y reversible antes de la primera mutación
global.

## Investigation

El prototipo de `codex/global-state-branch@6ac08826` realiza el cutover mediante
varias escrituras y borrados del worktree, además de actualizar configuración.
Un fallo intermedio puede dejar archivos y autoridad desalineados. También usa
la presencia de dos campos configurables para activar el almacén, lo que amplía
los estados parciales posibles.

La migración de configuración de `20260628-113219` aporta preview y preservación
de claves; la rama de integración de `20260711-210115` define dónde debe
integrarse una activación. Ninguna resuelve el problema multi-ref: Git no ofrece
una transacción atómica entre la rama de estado y la rama de integración en un
remoto común. La solución debe publicar primero un baseline inerte y hacer que
la activación sea un único commit normal de código, revisable antes de merge.

Se descarta activar por la mera existencia de `changeledger/state`: una rama
candidata no publicada o incompleta no puede convertirse accidentalmente en
autoridad. También se descarta modificar directamente `dev`; el cutover debe
seguir el mismo review/merge que cualquier cambio major.

La auditoría de readiness contra la implementación de `20260721-193101` y
`20260721-193102` encontró fronteras que el primer draft no fijaba:

- El snapshot usa claves lógicas distintas del path de origen: change por `id`,
  spec por slug, release por versión y config como singleton. Deduplicar solo por
  path permitiría dos documentos distintos para la misma identidad.
- Preview y create están separados en el tiempo. El plan debe fijar OIDs,
  blobs, output names y reemplazos; create debe volver a observar cada fuente y
  fallar por TOCTOU antes de escribir objetos publicables.
- La primera publicación no puede reutilizar el push normal de una réplica ya
  inicializada. Necesita CAS de ref ausente y debe adoptar idempotentemente un
  baseline remoto existente solo si árbol, proyecto y digest del plan coinciden.
- `state migrate` y `state activate` deben funcionar precisamente antes de que
  exista authority v2; no pueden pasar por `replicaStore()`, que la exige.
- Un tree Git puede contener symlinks, submodules, paths con saltos de línea y
  OIDs SHA-1 o SHA-256. La migración no puede asumir archivos del worktree ni
  framing por líneas.
- Revertir activación solo es seguro mientras el estado confirmado sea `S0`.
  Después se necesita una rama inversa basada en el head de integración y en el
  snapshot confirmado, sin pending y sin checkout.
- `state doctor` necesita procedencia durable para comparar fuentes y versión
  mínima. Esa evidencia debe vivir en el manifest del baseline y su digest en
  `authority.yml`, no depender del plan local que puede borrarse.

## Proposal

La adopción tendrá tres fases y una única frontera de autoridad:

1. `state migrate --preview --source <source>... [--output <plan>]` inventaría
   changes, specs, releases y config. Una fuente es
   `<remote>:<full-ref>` —por ejemplo `origin:refs/heads/dev`— o
   `local:<full-ref>`. Las fuentes remotas usan el remoto de estado resuelto por
   `changeledger.remote`/`origin`, traen solo los objetos solicitados y no
   actualizan branches ni remote-tracking refs de usuario. El plan YAML
   `format_version: 1` es determinista: proyecto, OID, path, mode, blob,
   identidad lógica, basename destino, resolución y digest de cada candidato.
2. El humano resuelve cada identidad divergente seleccionando un candidato o
   declarando un replacement local con basename y SHA-256 de contenido.
   `state migrate --create --plan <plan>` vuelve a observar todas las fuentes,
   verifica OIDs, blobs y replacements, construye el tree canónico completo y
   lo valida antes de publicar. La publicación inicial usa CAS contra ausencia
   de `refs/heads/changeledger/state`; jamás force-push. Si ya existe un estado,
   solo lo adopta cuando project_id, tree y digest del plan coinciden.
3. `state activate --prepare --baseline <S0>` crea mediante objetos Git una ref
   local normal `refs/heads/changeledger/activate-<baseline-abbrev>`, basada en
   el head exacto de la rama de integración. Su único commit elimina los blobs
   legacy importados, conserva código/contrato/archivos no inventariados y añade
   `.changeledger/authority.yml` con `format_version: 2`, `state_ref`, `baseline`,
   `project_id`, `inventory_digest` y `minimum_client_version`. No hace checkout,
   no actualiza ni publica integración y no reemplaza una branch distinta.

Una rama se considera activada únicamente cuando su historia contiene el
`authority.yml` válido. Desde allí el CLI exige que el head observado de estado
descienda de `baseline` y nunca cae al contenido legacy. El archivo de autoridad
es un recibo de cutover pequeño e inmutable; toda configuración mutable vive en
el snapshot global.

El inventario agrupa por clave lógica: `change:<id>`, `spec:<slug>`,
`release:<version>` y `config`. Solo deduplica candidatos con blob y basename
destino idénticos, conservando todos los orígenes. Un mismo id con contenido o
filename distinto, config incompatible, release duplicado, project_id distinto,
path inválido o documento que no pasa parser/check queda sin resolver. No existe
elección por fecha, rama, lifecycle ni orden de argumentos. El plan es local; el
manifest del baseline conserva el digest normalizado, source heads, decisiones
y versión mínima para auditoría posterior.

La lectura usa `ls-tree -z`/`cat-file`, solo acepta blobs regulares dentro de los
directorios declarados por la config de cada source y normaliza al layout cerrado
`.changeledger-state`. Rechaza symlinks, gitlinks, escapes, NUL y nombres que el
snapshot no puede representar. Toda comparación de paths usa framing NUL y todo
OID acepta exactamente el formato del repositorio, SHA-1 o SHA-256.

Antes de fusionar activación, `state doctor --activation-ref <ref>` valida
localmente commit único, parent de integración, authority/manifest y ausencia de
pending. Con `--online` además observa baseline remoto, source heads y capacidad
de fetch/push sin mutar refs públicas. Si baseline o integración avanzaron, se
genera otra branch; no se reescribe la anterior. Los clientes antiguos se tratan
como compatibilidad de despliegue: el CLI publica versión mínima; el enforcement
remoto de `20260721-193104` puede rechazar paths legacy, pero el core no promete
bloquear binarios antiguos en todos los proveedores. La calificación/rollout de
`20260721-193106` consume esta evidencia, sin formar parte del cutover.

Antes de la primera mutación posterior al baseline, rollback consiste en
revertir el commit de activación; restaura exactamente sus blobs legacy. Después
de avanzar el estado, `state export --recovery-branch` exige sync fresco y cero
pending, crea `changeledger/recover-<confirmed-abbrev>` desde el head exacto de
integración y añade un único commit que materializa el snapshot confirmado en
layout legacy y elimina authority. No modifica worktree/integración ni publica
la branch; nunca reabre copias anteriores al head confirmado.

## Specification

### CR1 — Preview explícito, actualizado y determinista
- **Given** sources repetibles `origin:refs/heads/dev`, `origin:refs/heads/feature/a` y `local:refs/heads/private` con estado legacy
- **When** se ejecuta `state migrate --preview --source ... [--output plan.yml]`
- **Then** obtiene solo los objetos de sources explícitas sin modificar worktree, branches, remote-tracking refs, authority ni estado público
- **And** el plan `format_version: 1` enumera source, OID, path, mode, blob, identidad lógica, basename y resolución
- **And** dos ejecuciones sobre los mismos OIDs producen bytes idénticos, salvo que `--output` escribe esos mismos bytes en el path solicitado

### CR2 — Identidad lógica impide deduplicación falsa
- **Given** dos candidates para `change:20260716-124623` con contenido o basename distinto
- **When** se genera o consume el plan
- **Then** la identidad queda unresolved con todos sus orígenes
- **And** `--create` falla con `migration conflict: change:20260716-124623 has divergent candidates`
- **And** solo blob y basename idénticos se deduplican automáticamente

### CR3 — Entradas Git hostiles fallan cerradas
- **Given** una source con symlink, gitlink, path fuera del directorio configurado, NUL imposible o documento inválido
- **When** preview inspecciona el tree mediante Git
- **Then** rechaza la source nombrando OID y path sin checkout ni lectura del filesystem objetivo
- **And** nombres con saltos de línea válidos se preservan mediante framing NUL en SHA-1 y SHA-256

### CR4 — Plan stale no publica
- **Given** un plan resuelto que fija source head `A`, candidate blobs y replacement SHA-256
- **When** una source avanza a `B`, un blob desaparece o cambia el replacement antes de `--create`
- **Then** falla con `migration plan is stale` y el expected/actual correspondiente
- **And** no crea ni actualiza state ref, authority, integration branch o worktree

### CR5 — Baseline inicial usa CAS e idempotencia por contenido
- **Given** un plan vigente cuyo snapshot completo pasa `changeledger check`
- **When** `state migrate --create --plan plan.yml` observa ausencia remota de state
- **Then** publica el OID candidato a `refs/heads/changeledger/state` con CAS de ausencia y sin force
- **And** manifest conserva project_id, inventory_digest, source heads, decisiones y minimum_client_version
- **And** config, changes, specs y releases completos son legibles por `LedgerStore`
- **When** el remoto ya contiene el mismo tree, project_id e inventory_digest
- **Then** adopta su OID sin reemplazarlo; cualquier diferencia falla con `state baseline already exists with different content`

### CR6 — Activación es un commit y una ref local CAS-safe
- **Given** baseline publicado `S0`, integración exacta `I0` y blobs legacy importados
- **When** se ejecuta `state activate --prepare --baseline S0`
- **Then** crea `changeledger/activate-<abbr>` en un único commit hijo de `I0`
- **And** añade authority v2 con baseline/digest/version, elimina solo blobs legacy importados y conserva todo archivo ajeno
- **And** no hace checkout, push, merge ni actualización de integración
- **And** una branch existente se reutiliza solo si apunta al mismo commit; en otro caso falla sin sobrescribirla

### CR7 — Authority incompleta o incompatible falla cerrada
- **Given** una rama con authority v2 cuyo project_id, baseline, inventory_digest, minimum_client_version o state_ref no coincide con el baseline/cliente
- **When** cualquier lectura o mutación carga el repo
- **Then** falla con un diagnóstico de authority antes de leer archivos legacy
- **And** no crea confirmed/pending, baseline ni fallback local

### CR8 — Revert pre-mutation restaura exactamente legacy
- **Given** activación fusionada y estado confirmado todavía igual a `S0`
- **When** el humano revierte el commit de activación
- **Then** el inverse diff restaura byte por byte config y documentos legacy eliminados
- **And** elimina authority sin modificar el baseline público inerte

### CR9 — Recovery post-mutation exporta el head confirmado
- **Given** estado confirmado `S1` descendiente de `S0`, observación fresca y ausencia de pending
- **When** se ejecuta `state export --recovery-branch`
- **Then** crea `changeledger/recover-<S1-abbrev>` desde integración con un único commit que materializa exactamente `S1` en layout legacy y elimina authority
- **And** no toca worktree, integración, remoto ni blobs de `S0`
- **And** con pending, estado stale o colisión de branch falla sin escritura parcial

### CR10 — Doctor separa evidencia local y online
- **Given** una activation ref preparada o fusionada
- **When** se ejecuta `state doctor --activation-ref <ref>`
- **Then** verifica parent de integración, commit único, authority, baseline, inventory_digest, snapshot y pending sin red
- **When** se añade `--online`
- **Then** observa baseline/source heads y reporta compatibilidad de cliente, divergencia de datos, permisos no comprobables y enforcement remoto ausente como categorías distintas
- **And** no publica ni muta refs públicas

### CR11 — Comandos existen en ambos lados de la frontera
- **Given** un repo legacy sin authority o con authority v1
- **When** usa `state migrate`, `state activate` o doctor sobre una candidata
- **Then** los comandos funcionan sin pasar por el guard que exige replica v2
- **Given** un repo activado v2
- **When** usa `state status`, `sync`, `abort`, doctor o export
- **Then** cada comando usa la autoridad efectiva y mantiene red explícita

### CR12 — CLI, ayuda y receipts son completos
- **Given** cualquier preview/create/activate/doctor/export exitoso o fallido
- **When** termina el comando
- **Then** la salida y `--json` identifican sources, OIDs, baseline, branch/ref afectada, inventory_digest y si hubo red o escritura
- **And** `--help`, README y contexto describen la misma sintaxis y límites sin prometer enforcement de `20260721-193104`

## Plan

- [x] Añadir fixtures de sources remotas/locales y plan determinista en `test/state-migration.test.mjs`; implementar parser/inventario lógico puro en `src/state-migration.mjs`; verify: `node --test test/state-migration.test.mjs` (CR1, CR2, CR4)
  - **Resolved:** `2026-07-22T13:04:33Z`
- [x] Añadir repos Git reales SHA-1/SHA-256 con paths hostiles antes de implementar lectura NUL-framed de trees en `src/state-migration.mjs`; verify: `node --test test/state-migration.test.mjs` (CR1, CR3)
  - **Resolved:** `2026-07-22T13:15:56Z`
- [x] Implementar revalidación TOCTOU, construcción del snapshot y publicación CAS/idempotente en `src/state-migration.mjs`; verify: `node --test test/state-migration.test.mjs test/ledger-store.test.mjs` (CR4, CR5)
  - **Resolved:** `2026-07-22T13:15:57Z`
- [x] Añadir tests de Git real para commit/ref de activación y revert antes de implementar prepare en `src/state-migration.mjs`; verify: `node --test test/state-migration.test.mjs` (CR6, CR8)
  - **Resolved:** `2026-07-22T13:15:57Z`
- [x] Endurecer parsing fail-closed de authority/provenance en `src/ledger-store.mjs`; verify: `node --test test/ledger-store.test.mjs test/repo.test.mjs` (CR7)
  - **Resolved:** `2026-07-22T13:15:57Z`
- [x] Añadir tests de pending/stale/colisión antes de implementar recovery branch en `src/state-migration.mjs`; verify: `node --test test/state-migration.test.mjs test/state-store.test.mjs` (CR9)
  - **Resolved:** `2026-07-22T13:15:57Z`
- [x] Implementar doctor local/online y categorías de compatibilidad en `src/state-migration.mjs`; verify: `node --test test/state-migration.test.mjs` (CR10)
  - **Resolved:** `2026-07-22T13:15:58Z`
- [x] Cablear migrate/activate/doctor/export y `--json` en `src/commands/state.mjs` y `bin/changeledger.mjs`, separados del guard replica-only; verify: `node --test test/state-command.test.mjs test/cli-bin.test.mjs` (CR11, CR12)
  - **Resolved:** `2026-07-22T13:15:58Z`
- [x] Actualizar `README.md` y `templates/contract/` con sintaxis, receipts y frontera con enforcement/rollout; verify: `node --test test/context.test.mjs && changeledger check` (CR10, CR11, CR12)
  - **Resolved:** `2026-07-22T13:21:41Z`
- [x] Ejecutar el gate completo; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-22T13:25:22Z`

## Log

- **2026-07-21T19:31:03Z** `[note]` Draft v2 reemplaza el cutover multiarchivo por un baseline inerte y un único commit normal de activación.
- **2026-07-22T12:57:04Z** `[note]` Readiness end-to-end cerró identidad lógica, fuentes explícitas, TOCTOU, CAS inicial, paths/OIDs portables, provenance durable, comandos pre-authority y rollback antes/después de la primera mutación.
- **2026-07-22T12:57:36Z** `[status]` draft → approved (human via conversation)
- **2026-07-22T12:58:42Z** `[status]` approved → in-progress
- **2026-07-22T12:58:42Z** `[owner]` set: Roberto Ruiz (auto)
- **2026-07-22T13:25:28Z** `[status]` in-progress → in-review
- **2026-07-22T13:38:19Z** `[review]` in-review → in-progress (retry): Activation inventory, doctor tree verification, recovery CAS, hostile Git entries, authority guards and JSON receipts are incomplete
- **2026-07-22T14:02:16Z** `[note]` Correction makes the full source inventory durable, reconstructs exact activation trees, guards integration and replica refs atomically, validates authority before replica operations, and emits complete JSON receipts
- **2026-07-22T14:02:22Z** `[status]` in-progress → in-review
- **2026-07-22T14:13:30Z** `[review]` in-review → in-progress (retry): Recovery does not require matching active authority on integration, and failure receipts infer network intent instead of reporting actual execution
- **2026-07-22T14:24:25Z** `[note]` Correction now requires exact active authority on the guarded integration head and derives complete success/failure receipts from progressively recorded network and write activity
- **2026-07-22T14:24:26Z** `[status]` in-progress → in-review
- **2026-07-22T14:31:34Z** `[review]` in-review → in-progress (retry): Failure receipts lose source OIDs observed before a later source fails
- **2026-07-22T14:33:09Z** `[note]` Failure receipts now preserve each source OID immediately when observed, including partial multi-source failures
- **2026-07-22T14:33:10Z** `[status]` in-progress → in-review
- **2026-07-22T14:39:04Z** `[review]` in-review → in-progress (retry): Required state options fail in Commander before complete JSON receipts can be emitted
- **2026-07-22T14:40:32Z** `[note]` Required activate and doctor options now validate inside stateAction so JSON and human failures retain complete receipts
- **2026-07-22T14:40:32Z** `[status]` in-progress → in-review
- **2026-07-22T14:44:05Z** `[review]` in-review → in-validation (delegated subagent, clean context)
