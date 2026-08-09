---
id: "20260809-194234"
title: Enrutar la lectura de autoridad por identidad
type: bug
status: draft
created: 2026-08-09T19:42:34Z
depends_on: ["20260808-234920", "20260809-113242"]
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

## Specification

### CR1 — La lectura anidada sirve su propio ledger
- **Given** un repo activado y un proyecto anidado sin `.git` propio cuyo `.changeledger/config.yml` declara otro `project_id`
- **When** cualquier superficie de lectura resuelve config desde el directorio anidado (al menos: `register`, la captura sin id de `context`, `loadRepo`)
- **Then** la autoridad efectiva es el archivo del worktree anidado, no la ref del host, y el host no se ve afectado

### CR2 — El repo activado no cambia
- **Given** el mismo repo activado consultado desde su propio checkout, con marker divergente pero de `project_id` coincidente, y también con marker malformado
- **When** se resuelve config por las mismas superficies
- **Then** la autoridad sigue siendo la ref, byte a byte igual que hoy

### CR3 — Un fallo de probe en el registry degrada al cache
- **Given** un registry con una entrada cuya ruta no puede sondearse (ancestro sin permisos que hace lanzar a `statSync` o al probe de activación)
- **When** se ejecuta `listProjects`
- **Then** esa entrada conserva su nombre cacheado y el resto del listado se sirve completo, sin abortar
- **And** una entrada activada con store roto sigue lanzando fail-closed (`state is not initialized`), como fija `20260809-113242` CR12

## Plan

- [ ] Subir el discriminador de identidad de `claimsAnotherLedger` a
  `loadEffectiveConfig`, compartido con `config migrate`
  - **Target:** `src/config.mjs`, `src/config-migration.mjs`
  - **Verify:** `node --test test/config.test.mjs test/config-migration.test.mjs`
  - **Criteria:** CR1, CR2
- [ ] Degradación al cache ante fallo de probe en `listProjects`, conservando
  el fail-closed de entradas activadas
  - **Target:** `src/registry.mjs`
  - **Verify:** `node --test test/registry.test.mjs`
  - **Criteria:** CR3
- [ ] Suite completa y gate del repo
  - **Support:**
  - **Verify:** `pnpm verify`

## Log
