---
id: "20260809-113240"
title: Cutover one-shot y activación con undo
type: feature
status: in-review
created: 2026-08-09T11:32:40Z
depends_on: ["20260808-151640"]
branch: feature/20260809-113240
related_to: ["20260808-151643", "20260809-113242"]
owner: rarc88
release_impact: minor
---

## Request

Herramienta de adopción de la etapa 2 del estado global: un cutover de un solo
tiro que construye el snapshot inicial desde la rama de integración, publica la
ref de estado y activa el repo, más la UX de activación con vuelta atrás
mientras el corte siga siendo reversible. Resuelve el pendiente declarado de la
etapa 1: `writeActivation` no es CAS. La primera ejecución real de la
herramienta es el experimento de activar este mismo repositorio, que se ejecuta
como acto final de la etapa, después de cerrar `20260809-113242` (las fronteras
de resolución rompen el viewer y el guard de commit en un repo cortado).

Excluido explícitamente (techo de `global-state-scope`): adopción multi-fuente
y su maquinaria de resolución de conflictos; la absorción incremental por ref
es `20260809-113241`.

## Investigation

Estado actual (verificado en dev):

- Este repo no está activado: no existen `refs/heads/changeledger/state` ni
  `refs/changeledger/activation`.
- El store de la etapa 1 (`src/state-store.mjs`) ya aporta las primitivas:
  `initState` publica la ref con CAS must-not-exist, `mutateState` escribe con
  CAS sobre la revisión observada, y `readSnapshot`/`loadActiveContent` sirven
  `changes/`, `specs/`, `releases/` y `config.yml` desde la ref cuando hay
  activación.
- `writeActivation` es un `update-ref` sin old-value: force-update deliberado
  sin CLI, documentado en `20260808-151640` como pendiente para la UX de
  adopción de la etapa 2. Este change le pone la semántica CAS encima.
- Superficie del ledger en el worktree hoy: `changes/` (272 documentos),
  `specs/` (14), `releases/` (21) y `config.yml` (schema 5). No hay más
  contenido de ledger bajo `.changeledger/`. (Conteos re-medidos el
  2026-08-09 durante la implementación; la captura inicial traía 260/24.)
- Qué queda en el worktree tras el corte (decisión confirmada por el humano):
  solo `.changeledger/config.yml`, que es el marcador de descubrimiento de
  `findChangeledgerDir`; la autoridad sobre el contenido de config en activo es
  la copia de la ref. El commit de limpieza elimina `changes/`, `specs/` y
  `releases/`.
- Superficies que se rompen con el ledger fuera del worktree (viewer
  `changeStatusImpl` vía `resolveChange` sin gate de activación, y el guard de
  staged de `src/commands/commit.mjs`): son ámbito de `20260809-113242`, no de
  este change; de ahí el orden del experimento.

Referencia de inventario del migrador v2 (`codex/state-replica-v2`,
`src/state-migration.mjs` — referencia, no port):

- Orden de validación reutilizable: snapshot cerrado → `checkRepo` completo
  (reglas locales y globales) → solo entonces construir tree/commit y publicar.
- Publicación idempotente por igualdad de tree contra lo ya publicado, nunca
  re-ejecutando el pipeline; toda mutación de refs con transacción CAS.
- Bugs heredados como criterios: MIG-04 (asertar que una ref resuelve a un
  commit, nunca peel de un tag anotado) y RECOV-01 (el undo debe ser un camino
  de primera clase, no un procedimiento manual).
- No se arrastra: protocolo de dos fases con `authority.yml`, plan-file YAML
  editable, y todo lo derivado de `sources[]` multi-fuente.

## Proposal

Dos comandos nuevos sobre las primitivas de la etapa 1:

- `changeledger cutover`: en un repo no activado y con el worktree limpio bajo
  `.changeledger/`, lee el ledger del commit HEAD de la rama de integración
  (fuente única y explícita), lo valida entero con las reglas de `checkRepo`,
  publica la ref de estado con `initState`, escribe la activación con CAS y
  crea en la rama de integración el commit de limpieza que elimina `changes/`,
  `specs/` y `releases/` conservando `config.yml`. Re-ejecutado sobre un corte
  idéntico es un no-op por igualdad de tree; ante divergencia falla explícito.
- `changeledger cutover --undo`: vuelta atrás integral mientras la ref de
  estado siga apuntando al baseline publicado (comparación trivial de commit):
  borra activación y ref de estado con guardas CAS y revierte el commit de
  limpieza. Con mutaciones posteriores al baseline, rechaza y devuelve la
  decisión al humano.
- `changeledger activate`: para clones/worktrees que ya tienen la ref de estado
  (activación independiente del checkout, lección de `20260723-202646`): crea
  `refs/changeledger/activation` con CAS create; re-activar sobre un estado
  idéntico es no-op; una activación existente divergente se rechaza, nunca se
  fuerza. `writeActivation` adquiere esta semántica (deja de ser force-update).

Alternativas descartadas:

- Protocolo de dos fases estilo v2 (`--prepare`/`install` con `authority.yml`):
  más piezas móviles sin beneficio en el modelo de ref directa de la etapa 1.
- Plan-file editable como UX de revisión previa: la fuente es única y ya pasa
  `checkRepo`; el conflicto por variantes no existe sin multi-fuente.
- `deactivate` suelto (borrar solo la activación): tras el corte dejaría el
  repo sirviendo un worktree sin documentos (fail-closed inutilizable); la
  única vuelta atrás segura es el undo integral.

Escenarios: cutover feliz; ledger inválido; worktree sucio; re-ejecución;
divergencia; activación en clon (nueva, idéntica, divergente); undo reversible;
undo bloqueado tras mutaciones; ref que resuelve a tag anotado.

## Specification

### CR1 — Cutover publica el baseline y activa
- **Given** un repo de fixture no activado, con ledger válido committeado en la rama de integración (al menos un change, un spec, un release y `config.yml`) y worktree limpio
- **When** se ejecuta `changeledger cutover`
- **Then** existe `refs/heads/changeledger/state` y su snapshot contiene exactamente los documentos de `changes/`, `specs/`, `releases/` y el `config.yml` del commit de integración
- **And** `refs/changeledger/activation` queda escrita y `loadRepo` sirve el contenido desde la ref
- **And** la rama de integración recibe un commit que elimina `changes/`, `specs/` y `releases/` del worktree conservando `.changeledger/config.yml`

### CR2 — Valida todo antes de publicar nada
- **Given** el mismo fixture con un documento inválido (un change sin heading `## Log`)
- **When** se ejecuta `changeledger cutover`
- **Then** el comando falla con exit distinto de cero nombrando el documento y el problema
- **And** no existe ninguna ref de estado ni de activación y la rama de integración no recibe ningún commit

### CR3 — Worktree sucio bajo el ledger se rechaza
- **Given** el fixture válido con un cambio sin commitear bajo `.changeledger/`
- **When** se ejecuta `changeledger cutover`
- **Then** el comando falla con exit distinto de cero explicando que el cutover exige el ledger limpio, sin publicar refs ni crear commits

### CR4 — Re-ejecución idéntica es no-op
- **Given** un repo donde `changeledger cutover` ya se ejecutó con éxito
- **When** se vuelve a ejecutar `changeledger cutover`
- **Then** exit 0 informando de que el corte ya está hecho, la revisión de la ref de estado no cambia y no se crea ningún commit nuevo

### CR5 — Divergencia existente se rechaza sin tocar nada
- **Given** un repo con `refs/heads/changeledger/state` existente cuyo contenido no es igual (por tree) al que produciría el cutover del ledger actual
- **When** se ejecuta `changeledger cutover`
- **Then** el comando falla con exit distinto de cero nombrando la divergencia y no modifica refs, worktree ni historia

### CR6 — Activación con CAS: create, no-op e intento divergente
- **Given** un clon con `refs/heads/changeledger/state` presente y sin activación
- **When** se ejecuta `changeledger activate`
- **Then** `refs/changeledger/activation` queda creada apuntando al estado
- **And** re-ejecutar `changeledger activate` con el mismo estado devuelve exit 0 como no-op sin mover la ref
- **And** con una activación previa apuntando a otro commit, el comando falla con exit distinto de cero y la ref existente queda intacta

### CR7 — Undo mientras el corte es reversible
- **Given** un repo recién cortado cuya ref de estado sigue apuntando al baseline publicado
- **When** se ejecuta `changeledger cutover --undo`
- **Then** la activación y la ref de estado quedan borradas y el commit de limpieza revertido: `changes/`, `specs/` y `releases/` vuelven al worktree con contenido idéntico al previo al corte
- **And** re-ejecutar `changeledger cutover --undo` falla con exit distinto de cero indicando que no hay corte que deshacer

### CR8 — Undo bloqueado tras mutaciones
- **Given** un repo cortado con al menos una mutación posterior al baseline (una transición de status escrita vía `mutateState`)
- **When** se ejecuta `changeledger cutover --undo`
- **Then** el comando falla con exit distinto de cero explicando que el corte ya no es reversible y que la decisión es del humano, sin tocar refs ni worktree

### CR9 — Una ref que no es commit se rechaza
- **Given** un repo cuya `refs/heads/changeledger/state` apunta a un tag anotado en lugar de a un commit
- **When** se ejecuta `changeledger activate`
- **Then** el comando falla con exit distinto de cero indicando que la ref no resuelve a un commit, sin escribir la activación

## Plan

- [x] Semántica CAS de `writeActivation`: create con old-value cero, no-op
  sobre commit idéntico y rechazo explícito ante activación divergente
  - **Target:** `src/state-store.mjs`
  - **Verify:** `node --test test/state-store.test.mjs`
  - **Criteria:** CR6
  - **Resolved:** `2026-08-09T12:19:11Z`
- [x] Construcción y validación del snapshot de cutover desde el commit de la
  rama de integración, con precondiciones de repo no activado y ledger limpio
  - **Target:** `src/commands/cutover.mjs`
  - **Verify:** `node --test test/cutover.test.mjs`
  - **Criteria:** CR1, CR2, CR3
  - **Resolved:** `2026-08-09T12:19:11Z`
- [x] Idempotencia por igualdad de tree y rechazo de divergencia en cutover
  - **Target:** `src/commands/cutover.mjs`
  - **Verify:** `node --test test/cutover.test.mjs`
  - **Criteria:** CR4, CR5
  - **Resolved:** `2026-08-09T12:19:11Z`
- [x] Comando `activate` sobre la nueva semántica, con aserción de commit
  - **Target:** `src/commands/activate.mjs`, `bin/changeledger.mjs`
  - **Verify:** `node --test test/activate.test.mjs`
  - **Criteria:** CR6, CR9
  - **Resolved:** `2026-08-09T12:19:11Z`
- [x] `cutover --undo`: reversión integral guardada por CAS y bloqueo tras
  mutaciones
  - **Target:** `src/commands/cutover.mjs`
  - **Verify:** `node --test test/cutover.test.mjs`
  - **Criteria:** CR7, CR8
  - **Resolved:** `2026-08-09T12:19:11Z`
- [x] Suite completa y gate del repo
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-08-09T12:19:12Z`

## Log
- **2026-08-09T11:55:07Z** `[status]` draft → approved (human via conversation)
- **2026-08-09T11:57:59Z** `[status]` approved → in-progress
- **2026-08-09T11:57:59Z** `[branch]` set: feature/20260809-113240 (auto)
- **2026-08-09T12:19:37Z** `[note]` Investigation corregida con conteos re-medidos (272 changes, 21 releases; la captura inicial del explorador traía 260/24 — cifras verificadas antes de escribirlas en el Log).
- **2026-08-09T12:19:37Z** `[status]` in-progress → in-review
- **2026-08-09T12:19:37Z** `[note]` Mandato del review: auditoría completa del diff cerrado baseline..HEAD (superficie de refs/CAS y dos comandos nuevos), con la lista de 13 decisiones no especificadas del implementador como puntos de escrutinio explícito, en particular: divergencia de activación keyed en state_ref declarado y no en el oid del commit; config.yml republicado byte a byte vía mutateState tras initState; orden del undo worktree-first; igualdad de tree implementada como igualdad de contenido.
