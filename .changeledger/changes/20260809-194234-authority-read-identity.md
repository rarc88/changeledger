---
id: "20260809-194234"
title: Enrutar la lectura de autoridad por identidad
type: bug
status: done
created: 2026-08-09T19:42:34Z
depends_on: ["20260808-234920", "20260809-113242"]
archived: true
reviewed: true
branch: bug/20260809-194234
related_to: ["20260809-140157"]
owner: rarc88
---

## Request

Extiende a la LECTURA la corrección de identidad que `20260808-234920` aplicó
a la escritura de `config migrate` (autorizado por el humano el 2026-08-09):
un proyecto ChangeLedger anidado sin `.git` propio bajo un repo activado
sigue leyendo la autoridad del host en todas las superficies que enrutan por
`loadEffectiveConfig`, y quedan dos degradaciones menores de la misma familia
detectadas por los post-reviews.

## Investigation

- **Costura de lectura.** `loadEffectiveConfig` (`src/config.mjs`) decide por
  `repoIsActivated(repoRoot)`, que camina hacia arriba buscando `.git`: un
  `.changeledger` anidado hereda la activación del ancestro y sirve el config
  del host en toda la superficie de lectura (register, check, capturas sin
  id, viewer, registry, `loadRepo*`). Ejecutado por el post-review de
  `20260808-234920`, que corrigió solo la escritura de `config migrate`
  (`claimsAnotherLedger`, comparación de `project_id` marker↔snapshot) y dejó
  la lectura como follow-up explícito. El discriminador ya existe y está
  probado; falta subirlo a la costura común.
- **Residuales del enrutado de escritura** (confirmación de `234920`,
  ejecutados): un anidado cuyo marker no declara `project_id` o es
  inparseable no puede reclamar identidad y sigue enrutando al host; decidir
  si esa forma merece aviso (como `20260809-140157` hizo en el import) o
  queda documentada como está.
- **EACCES en el registry** (confirmación de `20260809-113242`, ejecutado):
  con un ancestro `chmod 000`, `statSync` lanza EACCES y `listProjects`
  aborta el listado entero, donde el `existsSync` pre-113242 degradaba al
  nombre cacheado. Fix sugerido por el confirmador: mover el probe
  `repoIsActivated` dentro del `try` para que cualquier fallo de probe sobre
  una entrada no activada degrade al cache en vez de tumbar el listado.

**Decisión humana (2026-08-10, desbloqueo):** la regla de identidad sola
colisiona con `20260809-113242` CR11 (el modo local y la reparación de ruta
del viewer resuelven la identidad del propio root activado desde la ref
aunque el marker declare otro `project_id`). Se resuelve con un discriminador
de ubicación: un `.changeledger` cuyo padre es el TOP-LEVEL de git es siempre
el ledger propio (ruta ref, CR11 preservado, id stale tolerado); la identidad
decide solo por debajo del top-level. El mismo tiebreak se aplica a
`config migrate` para que lectura y escritura enruten idéntico — ajuste
consciente sobre lo shipped en `20260808-234920`, que clasificaba el marker
del propio root con id distinto como ajeno.

## Specification

### CR1 — La lectura anidada de config sirve su propio ledger
- **Given** un repo activado y un proyecto anidado sin `.git` propio cuyo `.changeledger/config.yml` declara otro `project_id`
- **When** la autoridad de CONFIG se resuelve desde el directorio anidado vía `loadEffectiveConfig` (`register`, las capturas sin id de `context`/`agent-context`, las lecturas de config del visor y el registry)
- **Then** la autoridad efectiva es el archivo del worktree anidado, no la ref del host, y el host no se ve afectado
- **And** la costura de CONTENIDO (`loadRepo`/`resolveActivation`) queda explícitamente fuera de este change: hasta el follow-up del ancla de propiedad, `list`/`show`/`new` desde un anidado bajo host activado siguen resolviendo el snapshot del host (incoherencia conocida, documentada y acotada)

### CR2 — El repo activado no cambia
- **Given** el mismo repo activado consultado desde su propio checkout, con marker divergente pero de `project_id` coincidente, y también con marker malformado
- **When** se resuelve config por las mismas superficies
- **Then** la autoridad sigue siendo la ref, byte a byte igual que hoy

### CR3 — Un fallo de probe en el registry degrada al cache
- **Given** un registry con una entrada cuya ruta no puede sondearse (ancestro sin permisos que hace lanzar a `statSync` o al probe de activación)
- **When** se ejecuta `listProjects`
- **Then** esa entrada conserva su nombre cacheado y el resto del listado se sirve completo, sin abortar
- **And** una entrada activada con store roto sigue lanzando fail-closed (`state is not initialized`), como fija `20260809-113242` CR12

### CR4 — El marker del top-level de git es siempre el ledger propio
- **Given** un repo activado cuyo `.changeledger` vive en el top-level de git y cuyo marker parseable declara un `project_id` distinto al del snapshot (la forma del fixture de `20260809-113242` CR11)
- **When** se resuelve config por lectura desde su propio checkout y se ejecuta `changeledger config migrate` ahí
- **Then** ambas rutas usan la autoridad de la ref: la lectura devuelve la identidad de la ref y la migración aplica su commit CAS sobre la ref dejando el marker byte a byte intacto
- **And** el test `20260809-113242 CR11` existente pasa sin modificación

## Plan

- [x] Subir el discriminador de identidad de `claimsAnotherLedger` a
  `loadEffectiveConfig`, compartido con `config migrate`
  - **Target:** `src/config.mjs`, `src/config-migration.mjs`
  - **Verify:** `node --test test/config.test.mjs test/config-migration.test.mjs`
  - **Criteria:** CR1, CR2
  - **Resolved:** `2026-08-10T01:27:20Z`
- [x] Degradación al cache ante fallo de probe en `listProjects`, conservando
  el fail-closed de entradas activadas
  - **Target:** `src/registry.mjs`
  - **Verify:** `node --test test/registry.test.mjs`
  - **Criteria:** CR3
  - **Resolved:** `2026-08-10T01:27:20Z`
- [x] Discriminador de ubicación compartido: en el top-level de git el marker
  es propio; la identidad decide solo por debajo — aplicado a
  `loadEffectiveConfig` y a `config migrate`
  - **Target:** `src/config.mjs`, `src/config-migration.mjs`
  - **Verify:** `node --test test/config.test.mjs test/config-migration.test.mjs test/view.test.mjs`
  - **Criteria:** CR4
  - **Resolved:** `2026-08-10T01:27:20Z`
- [x] Suite completa y gate del repo
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-08-10T01:27:21Z`

## Log
- **2026-08-10T00:38:57Z** `[status]` draft → approved (human via conversation)
- **2026-08-10T00:49:35Z** `[status]` approved → in-progress
- **2026-08-10T00:49:35Z** `[branch]` set: bug/20260809-194234 (auto)
- **2026-08-10T01:04:56Z** `[status]` in-progress → blocked
- **2026-08-10T01:04:56Z** `[note]` BLOCKED: CR1 (enrutado por identidad en lectura) colisiona con 20260809-113242 CR11, que fija que el modo local y la reparación de ruta del viewer resuelven la identidad del propio root activado desde la REF aunque el marker declare otro project_id (fixture stale-id). La regla de identidad clasificaría ese marker como ledger ajeno y serviría el worktree. El camino de ESCRITURA ya enruta identity-first (234920, shipped). Decisión humana pendiente: retirar CR11 como superado, o añadir discriminador de ubicación (marker en el top-level git = propio) manteniendo lectura y escritura consistentes.
- **2026-08-10T01:20:35Z** `[status]` blocked → in-progress
- **2026-08-10T01:20:35Z** `[note]` Desbloqueado con la decisión humana registrada en Investigation: discriminador de ubicación (top-level git = ledger propio; identidad decide por debajo), CR4 añadido (enmienda estrictamente más fuerte) y tarea de Plan para aplicar el mismo tiebreak a config migrate manteniendo lectura/escritura consistentes.
- **2026-08-10T01:27:21Z** `[status]` in-progress → in-review
- **2026-08-10T01:27:21Z** `[note]` Mandato del review: superficie que gobierna (config.mjs, config-migration.mjs, registry.mjs y sus tres tests, diff cerrado del carril), con las decisiones del implementador como escrutinio: isGitTopLevelMarker por fs.existsSync(.git) sin subproceso (¿válido en worktrees linked donde .git es archivo? ¿y en el propio marker bajo submódulo?); keyed en configFile y no repoRoot; firma de claimsAnotherLedger cambiada (dos call sites); decisión sin aviso para el anidado sin project_id; y re-derivar los mutantes del tiebreak y de la degradación EACCES. Commit con --no-verify por la fuga GIT_DIR (gate manual completo antes).
- **2026-08-10T01:41:36Z** `[review]` in-review → blocked: CR1 nombra loadRepo y su Then no se cumple ahí: el contenido del anidado se sirve de la ref del host (resolveActivation enruta por ascendencia) y new desde el anidado escribe en la ref del host — cerrar la costura de contenido exige src/repo.mjs, fuera de la superficie autorizada, y decide el camino de escritura anidado. Además, punto ciego del discriminador de ubicación: un repo activado con .changeledger por debajo del top-level (forma declarada soportada) y marker con id stale sirve el worktree stale, donde dev servía la ref. Decisión humana: extender el change a repo.mjs, o acotar CR1 a la costura de config con follow-up para la costura de contenido + ancla de propiedad.
- **2026-08-10T12:04:11Z** `[status]` blocked → in-progress
- **2026-08-10T12:04:12Z** `[status]` in-progress → in-review
- **2026-08-10T12:04:12Z** `[note]` Mandato de confirmación: verificar la coherencia documento↔código tras la enmienda autorizada (CR1 acotado a la costura de config; el diff committeado da7ed19 no cambia) — el CR1 acotado se cumple con la evidencia ya ejecutada del review (loadEffectiveConfig, register, capturas sin id), CR2/CR3/CR4 quedaron en PASS con mutantes exactos, y la exclusión de la costura de contenido está declarada honestamente en el documento con su follow-up nombrado. Sin re-litigar lo confirmado.
- **2026-08-10T12:10:43Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-08-10T12:37:18Z** `[validation]` in-validation → done (human accepted via conversation)
- **2026-08-10T12:39:21Z** `[graduation]` spec: `architecture.md`
- **2026-08-10T17:39:45Z** `[archive]` archived
