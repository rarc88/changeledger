---
id: "20260810-120457"
title: Anclar la propiedad del ledger en authority.yml
type: feature
status: done
created: 2026-08-10T12:04:57Z
depends_on: ["20260809-194234"]
reviewed: true
branch: feature/20260810-120457
related_to: ["20260808-234920", "20260809-113242"]
owner: rarc88
---

## Request

Decisión humana del 2026-08-10 (opción 2 del bloqueo de `20260809-194234`):
sustituir las heurísticas de propiedad del ledger (ubicación + identidad de
`project_id`) por un ancla real — `authority.yml` registra, al cortar o
activar, la ruta del ledger que la activación posee — y enrutar con ella la
costura de CONTENIDO que `194234` dejó explícitamente fuera: `loadRepo`/
`resolveActivation` y las escrituras desde directorios anidados.

Excluido: cualquier soporte multi-ledger por activación (una activación posee
exactamente un ledger, como fija `global-state-scope`).

## Investigation

Hechos ejecutados por los reviews de `194234` (no razonados):

- **Costura de contenido sin cerrar:** `resolveActivation` (`src/repo.mjs`)
  enruta por ascendencia git; un proyecto anidado sin `.git` propio bajo un
  host activado ve el snapshot del host (`list` vacío, `show` "No change with
  id" para sus propios documentos) y `new` desde el anidado **escribe el
  documento en la ref del host**. Incoherente con la costura de config, que
  `194234` ya enruta por identidad+ubicación.
- **Punto ciego de la heurística de ubicación:** un repo activado cuyo
  `.changeledger` vive por debajo del top-level (forma declarada soportada en
  `architecture.md`) con marker de `project_id` stale sirve el worktree stale
  donde dev servía la ref. Ninguna heurística de contenido/ubicación puede
  distinguir "mi ledger con marker corrupto" de "ledger ajeno": falta un
  ancla.
- **Momento del cambio de formato:** `authority.yml` (formato de
  `readActivation`/`writeActivation`, `src/state-store.mjs`) no tiene
  consumidores externos — la 0.15.0 publicada es pre-adopción y este repo aún
  no está activado. Evolucionar el formato ahora no rompe a nadie.
- Consumidores actuales de las heurísticas: `claimsAnotherLedger` +
  `isGitTopLevelMarker` en `src/config.mjs`, consumidos por
  `loadEffectiveConfig` y `config migrate` (`src/config-migration.mjs`).

## Proposal

`cutover` y `activate` escriben en `authority.yml` un campo nuevo
`ledger_dir`: la ruta del directorio `.changeledger` que la activación posee,
relativa al top-level de git (`.changeledger` en el caso canónico). La
pregunta "¿es mío este ledger?" pasa a ser una comparación exacta de rutas:

- `loadEffectiveConfig` y `config migrate`: el marker descubierto es propio
  si y solo si su ruta relativa coincide con `ledger_dir`; las heurísticas
  `isGitTopLevelMarker` y la comparación de `project_id` se retiran (corte
  limpio, sin compat).
- `resolveActivation` (`src/repo.mjs`): la activación aplica solo si el
  `changeledgerDir` descubierto es el anclado; en otro caso el repo se carga
  inactivo desde su worktree — con esto `list`/`show`/`new` desde un anidado
  operan sobre su propio ledger, y las escrituras dejan de aterrizar en la
  ref del host.
- `readActivation` exige el campo: una activación sin `ledger_dir` (formato
  previo, solo alcanzable en fixtures o repos activados durante el desarrollo
  de la etapa 2) falla explícito pidiendo re-ejecutar `activate` — sin
  fallback heurístico, sin segunda verdad.

Alternativas descartadas:

- Mantener las heurísticas como fallback del ancla: dos políticas de
  propiedad conviviendo — la clase de deriva que este change existe para
  retirar.
- Registrar la ruta en el snapshot (manifest) en vez de en la activación: el
  snapshot es contenido compartido entre clones; la propiedad es una
  declaración del checkout/repo local, que es exactamente lo que
  `authority.yml` representa.

Escenarios: cutover y activate escriben el ancla; anidado bajo host activado
(config, contenido y escritura van al ledger propio); `.changeledger` bajo el
top-level con marker stale (vuelve a servir la ref, como dev); activación sin
ancla (error explícito con remedio); re-activate repara; los tests de
`194234` sobre las heurísticas se retargetan al ancla.

## Specification

### CR1 — El corte y la activación escriben el ancla
- **Given** un repo de fixture con su ledger en `.changeledger` (canónico) y otro con el ledger en `packages/app/.changeledger`
- **When** se ejecuta `changeledger cutover` en cada uno (y `changeledger activate` en un clon con la ref presente)
- **Then** `authority.yml` de la activación contiene `ledger_dir` con la ruta relativa exacta del ledger cortado (`.changeledger` y `packages/app/.changeledger` respectivamente)

### CR2 — El contenido anidado opera sobre su propio ledger
- **Given** un host activado y un proyecto anidado sin `.git` propio con su `.changeledger` y un change propio
- **When** se ejecutan `list`, `show <id propio>` y `new` desde el directorio anidado
- **Then** los tres operan sobre el ledger del worktree anidado: `list` muestra su change, `show` lo resuelve y `new` escribe el documento en `nested/.changeledger/changes/`, con la ref del host inmóvil

### CR3 — El below-top-level con marker stale vuelve a servir la ref
- **Given** un repo activado cuyo `ledger_dir` anclado es `packages/app/.changeledger` y cuyo marker en esa ruta declara un `project_id` stale
- **When** se resuelve config y se ejecuta `config migrate` desde ese checkout
- **Then** ambas rutas usan la autoridad de la ref (el comportamiento que dev tenía antes de `194234`), con el marker byte a byte intacto

### CR4 — El repo activado canónico no cambia
- **Given** los fixtures activados canónicos de `194234` (marker divergente con id coincidente, malformado, sin project_id, y el top-level con id stale)
- **When** se resuelve config, contenido y `config migrate`
- **Then** todo sirve la ref exactamente como hoy, y los tests existentes de `194234` y `20260809-113242` CR11 pasan retargetados al ancla sin debilitar ninguna aserción

### CR5 — Una activación sin ancla falla explícito
- **Given** una activación escrita con el formato previo (sin `ledger_dir`)
- **When** cualquier lectura consulta la activación
- **Then** falla con exit distinto de cero explicando que la activación no declara su ledger y que `changeledger activate` la re-escribe; re-ejecutar `activate` la repara y todo vuelve a operar

### CR6 — El anidado con ledger ajeno no hereda la activación ni con id coincidente
- **Given** un host activado y un anidado cuyo marker declara (maliciosa o accidentalmente) el MISMO `project_id` que el snapshot del host
- **When** se resuelve config o contenido desde el anidado
- **Then** el anidado opera sobre su worktree: la ruta no coincide con `ledger_dir` y la identidad ya no participa en la decisión

## Plan

- [x] `ledger_dir` en `authority.yml`: escritura en `writeActivation`
  y exigencia en `readActivation` con el error accionable
  - **Target:** `src/state-store.mjs`, `src/commands/activate.mjs`
  - **Verify:** `node --test test/state-store.test.mjs test/cutover.test.mjs test/activate.test.mjs`
  - **Criteria:** CR1, CR5
  - **Resolved:** `2026-08-10T14:10:29Z`
- [x] Propiedad por comparación exacta en la costura de config, retirando
  `isGitTopLevelMarker` y la comparación de `project_id`
  - **Target:** `src/config.mjs`, `src/config-migration.mjs`
  - **Verify:** `node --test test/config.test.mjs test/config-migration.test.mjs`
  - **Criteria:** CR3, CR4, CR6
  - **Resolved:** `2026-08-10T14:14:58Z`
- [x] Enrutado de la costura de contenido por el ancla en `resolveActivation`
  - **Target:** `src/repo.mjs`, `src/change-store.mjs`
  - **Verify:** `node --test test/repo.test.mjs test/change-store.test.mjs test/cli.test.mjs`
  - **Criteria:** CR2, CR4
  - **Resolved:** `2026-08-10T14:17:45Z`
- [x] Suite completa y gate del repo
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-08-10T14:22:52Z`

## Log
- **2026-08-10T12:13:10Z** `[status]` draft → approved
- **2026-08-10T13:57:43Z** `[status]` approved → in-progress
- **2026-08-10T13:57:43Z** `[branch]` set: feature/20260810-120457 (auto)
- **2026-08-10T14:10:29Z** `[note]` Ancla derivada en writeActivation desde repoRoot (invariante: repoRoot = dirname del .changeledger descubierto) con un walk fs-only del top-level, no con rev-parse --show-toplevel: git responde el realpath y las rutas que sostienen los callers no lo son (/var vs /private/var), así escritura y lectura derivan el ancla igual. initState no cambia: el ancla vive solo en authority.yml
- **2026-08-10T14:22:53Z** `[note]` La costura de contenido y la de config comparten resolveOwnedActivation (state-store): repoIsActivated y readBootstrap/loadRepoWithConfig preguntan lo mismo. Retirados isGitTopLevelMarker, claimsAnotherLedger/claimsLedgerId, readProjectId/projectIdOf, readMarkerText y effectiveConfigFromSnapshot, más los dos walks isInsideGitRepo duplicados en repo.mjs y change-store.mjs
- **2026-08-10T14:22:53Z** `[note]` El test 194235 de equivalencia entre las dos rutas de identidad se retarget a CR4/CR6: al quedar una sola decisión de propiedad no hay segunda implementación contra la que sostener la equivalencia; sus mismas formas de marker se afirman ahora contra la respuesta (host sirve la ref, anidado su worktree). architecture.md sigue describiendo las heurísticas retiradas y nombra este change como su sucesor: pendiente de graduación
- **2026-08-10T14:28:53Z** `[status]` in-progress → in-review
- **2026-08-10T14:28:54Z** `[note]` Mandato del review: auditoría completa del diff baseline..HEAD (3 commits, 13 archivos) — pieza de diseño de la etapa 2, semántica de propiedad nueva en 3 costuras
- **2026-08-10T14:37:51Z** `[review]` in-review → in-progress (retry): F1: la desambiguación CAS endurecida de writeActivation (current===null ? now!==null : now!==current.oid) no tiene test; mutarla a now!==null reintroduce el bug de relabel por .lock stale y la suite queda verde. Falta el pin gemelo de CORRECTION 2a/2b cubriendo ambos brazos (creación fresca y repair sobre oid existente)
- **2026-08-10T14:41:22Z** `[note]` Corrección F1: la desambiguación CAS de writeActivation queda fijada con el gemelo de CORRECTION 2a/2b, un pin por brazo (creación y reparación). Un .lock stale no se relabela como escritura concurrente en ninguno de los dos, y el mensaje 'was written concurrently' queda pinneado como lo que NO debe aparecer
- **2026-08-10T14:42:22Z** `[note]` F3 del review plegado en la corrección: el Target de la tarea 1 nombraba initState y src/commands/cutover.mjs, que no necesitaron edición (el ancla se deriva dentro de writeActivation y cutover ya lo invoca con el repoRoot correcto) — Plan corregido a lo realmente tocado. Edición del orquestador
- **2026-08-10T14:43:23Z** `[status]` in-progress → in-review
- **2026-08-10T14:43:23Z** `[note]` Mandato de la confirmación: mínimo — F1 cerrado (pin CORRECTION 2c en ambos brazos, mutantes muertos) + ausencia de regresión en el diff sin commitear; la edición F3 del orquestador al Plan bajo el mismo escrutinio
- **2026-08-10T14:47:17Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-08-10T17:27:05Z** `[validation]` in-validation → done (human accepted via conversation)
- **2026-08-10T17:29:40Z** `[graduation]` spec: `architecture.md`
