---
id: "20261002-152923"
title: sync avisa cuando el remoto publica estado global y el clon no está activado
type: feature
status: done
created: 2026-10-02T15:29:23Z
depends_on: []
reviewed: true
branch: feature/20261002-152923
related_to: ["20260811-151426", "20261002-113320", "20261002-113435"]
owner: Carlos Rodríguez
release_impact: patch
---

## Request

En un clon sin activar de un repo que ya hizo el cutover, `git fetch` deja la
copia de seguimiento `refs/remotes/<remote>/changeledger/state`, pero no la ref
local `refs/heads/changeledger/state`. En ese caso `changeledger sync` dice
*"Nothing to sync: this repo is not activated and refs/heads/changeledger/state
does not exist here."*, aunque el remoto sí publica estado global.

El agente que abre la sesión con `sync`, como manda el contrato, concluye que
el repo no usa estado global. Así sigue escribiendo el ledger en ficheros de
la rama. Le pasó a este repo al crear `#20261002-113320` y `#20261002-113435`,
que hubo que llevar al journal con `changeledger import`.

El humano descartó que los comandos rechacen escribir en ese caso, porque
choca con la regla 6 de `global-state-scope` («Inactivo por defecto»). Pide que
sea `sync` quien lo avise.

Se pide que `sync` y `sync --status`, en un clon sin activar sin la ref local
pero con la copia de seguimiento del remoto, digan que el remoto publica estado
global y que se ejecute `changeledger activate`.

Fuera de alcance:

- Cambiar cualquier otro comando: siguen comportándose igual en un repo sin
  activar.
- Hacer `fetch` desde un clon sin activar: el aviso usa sólo lo que ya hay en
  local.
- Activar automáticamente.

## Investigation

Estado actual, verificado en `dev`:

- **Rama sin activar de `sync`.** En `src/commands/sync.mjs`, `sync()` lee
  `local = readStateRef(repoRoot, run)`. Si
  `resolveOwnedActivation(repoRoot, run) === null`, escribe uno de estos dos
  mensajes y devuelve 0:
  - con `local === null`: `Nothing to sync: this repo is not activated and ${STATE_REF} does not exist here.`;
  - si no: `${STATE_REF} is present but this checkout is not activated — run \`changeledger activate\` to adopt it. sync changed nothing.`

  Esta rama va antes de la de `--status`, así que `sync --status` escribe lo
  mismo. Aquí no se consulta ninguna ref de seguimiento.
- **`activate` ya usa la copia de seguimiento.** En
  `src/commands/activate.mjs`, si falta la ref local, se resuelve el remoto con
  `resolveRemote(repoRoot, run)` y se lee
  `refs/remotes/<remote>/changeledger/state` con `optionalRefOid`. Si existe,
  siembra la ref local con `seedStateRef` y escribe
  `Seeded ${STATE_REF} from refs/remotes/<remote> at <oid>`. El aviso nuevo
  remite a un paso que ya funciona.
- **Límites.** La spec `global-state-scope` dice en su regla 6 que un repo sin
  activación explícita se comporta idéntico a uno sin la capacidad, y excluye la
  frescura automática en código. La spec `architecture` dice que un fetch nunca
  cambia el modo de operación. El aviso no cambia el modo ni hace red, y `sync`
  ya avisa hoy cuando la ref local existe sin activación.
- **Contrato.** La sección «Synchronizing the global state» de
  `templates/contract/core.md` dice que `sync` lo recuerda cuando la ref está
  presente pero el repo no está activado.
- **Tests.** `test/sync.test.mjs` cubre ese recordatorio
  (`20260811-151426 CR5`). `test/activate.test.mjs` cubre la siembra desde la
  copia de seguimiento. Los helpers están en `test/helpers/state-repo.mjs`
  (`seedLedgerRepo`, `commitTree`, `buildTree`, `updateRef`).

El recordatorio actual lo introdujo `#20260811-151426` (sincronización de la ref
de estado con el remoto). Ese change ya está cerrado, así que no se reabre.

## Proposal

En la rama sin activar de `sync()`, cuando `local === null`, se resuelve el
remoto con `resolveRemote` y se lee su copia de seguimiento con
`optionalRefOid`, igual que hace `activate`. Si existe, se escribe:

`refs/remotes/<remote>/changeledger/state exists: the remote "<remote>" publishes global state, but this checkout is not activated — run \`changeledger activate\` to adopt it. sync changed nothing.`

Y se devuelve 0. Si no existe, o no hay remoto, se mantiene el mensaje actual.

`core.md` pasa a decir que `sync` también lo recuerda cuando sólo existe la copia
de seguimiento del remoto.

**Alternativas descartadas**

- **Rechazar escrituras en los comandos.** Choca con la regla 6 de
  `global-state-scope`; lo descartó el humano.
- **Avisar en todos los comandos de lectura.** También cambia el comportamiento
  de un repo sin activar, y `sync` es el punto que el contrato manda ejecutar al
  abrir sesión.

## Specification

### CR1 — Aviso con la copia de seguimiento del remoto
- **Given** un repo con el remoto `origin`, sin `refs/changeledger/activation`, sin `refs/heads/changeledger/state` y con `refs/remotes/origin/changeledger/state`
- **When** se ejecuta `changeledger sync`
- **Then** termina con código 0 y escribe `refs/remotes/origin/changeledger/state exists: the remote "origin" publishes global state, but this checkout is not activated — run \`changeledger activate\` to adopt it. sync changed nothing.`
- **And** no crea `refs/heads/changeledger/state` ni `refs/changeledger/activation`, ni cambia ningún fichero del worktree

### CR2 — El mismo aviso en sync --status
- **Given** el repo de CR1
- **When** se ejecuta `changeledger sync --status`
- **Then** termina con código 0 y escribe el mismo mensaje que CR1

### CR3 — Sin copia de seguimiento se mantiene el mensaje actual
- **Given** un repo sin activar, sin ref local y sin `refs/remotes/<remote>/changeledger/state`, con remoto y sin remoto
- **When** se ejecuta `changeledger sync`
- **Then** escribe `Nothing to sync: this repo is not activated and refs/heads/changeledger/state does not exist here.` y termina con código 0

### CR4 — Sin red
- **Given** el repo de CR1 con la URL de `origin` apuntando a un destino inalcanzable
- **When** se ejecuta `changeledger sync`
- **Then** escribe el mensaje de CR1 y termina con código 0, sin intentar `fetch`

### CR5 — Los demás comandos no cambian
- **Given** el repo de CR1
- **When** se ejecuta `changeledger list`
- **Then** termina con código 0 y sirve los changes del worktree, igual que sin la copia de seguimiento

### CR6 — Primer uso de extremo a extremo
- **Given** un repo con el cutover hecho y su ref de estado publicada en un remoto
- **When** se clona, se ejecuta `changeledger sync`, después `changeledger activate` y después `changeledger sync --status`
- **Then** `sync` escribe el mensaje de CR1, `activate` siembra la ref local desde la copia de seguimiento y `sync --status` informa que el journal local y la última copia descargada coinciden

### CR7 — El contrato lo describe
- **Given** el pack `core`
- **When** se ejecuta `changeledger context`
- **Then** la sección «Synchronizing the global state» dice que `sync` recuerda activar también cuando sólo existe la copia de seguimiento del remoto
- **And** el core queda dentro de sus techos de tokens y líneas de `templates/contract/budgets.yml`, sin quitar prosa normativa

## Plan

- [x] Aviso de la copia de seguimiento en la rama sin activar de `sync()`
  - **Target:** `src/commands/sync.mjs`
  - **Verify:** `node --test test/sync.test.mjs`
  - **Criteria:** CR1, CR2, CR3, CR4, CR5
  - **Resolved:** `2026-10-02T15:47:42Z`
- [x] Recorrido clonar → sync → activate → sync --status
  - **Target:** `test/sync.test.mjs`
  - **Verify:** `node --test test/sync.test.mjs`
  - **Criteria:** CR6
  - **Resolved:** `2026-10-02T15:47:43Z`
- [x] Frase de `sync` en la sección de estado global del core, dentro de
  presupuesto
  - **Target:** `templates/contract/core.md`
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR7
  - **Resolved:** `2026-10-02T15:47:44Z`
- [x] Gate completo: `biome check`, `node --test` y `changeledger check`
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-10-02T15:47:45Z`

## Log
- **2026-10-02T15:33:41Z** `[status]` draft → approved (human via conversation)
- **2026-10-02T15:33:51Z** `[status]` approved → in-progress
- **2026-10-02T15:33:51Z** `[branch]` set: feature/20261002-152923 (auto)
- **2026-10-02T15:47:41Z** `[note]` La tarea 4 (pnpm verify) se cumple con sus tres gates equivalentes —biome check, node --test (1541/1541) y changeledger check— porque el pnpm instalado (v11.13.0) no cumple el >=12.6.0 del proyecto. Decisión no especificada: si resolveRemote no puede decidir el remoto (varios, ninguno origin), la rama sin activar conserva el mensaje anterior en vez de fallar.
- **2026-10-02T15:47:52Z** `[status]` in-progress → in-review
- **2026-10-02T15:48:00Z** `[note]` Mandato de revisión: la superficie que gobierna el change — CR1–CR7 sobre dev..c82be00 (src/commands/sync.mjs, templates/contract/core.md, test/sync.test.mjs).
- **2026-10-02T15:53:05Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-10-02T15:53:06Z** `[note]` Seguimientos de la revisión (no bloquean): el catch alrededor de resolveRemote también absorbe un fallo de 'git remote' (vuelve al mensaje anterior, como antes del change), así que su comentario se queda corto; con varios remotos sin origin, o con la copia sólo en un remoto distinto del que resuelve sync, no hay aviso (activate tampoco funcionaría ahí); la frase del core se lee como «el remoto que resuelve sync». La fuente del test CR6 se construye a mano, sin cutover real; el revisor confirmó el recorrido con un cutover real.
- **2026-10-02T16:27:53Z** `[validation]` in-validation → done (human accepted via conversation)
- **2026-10-02T16:36:34Z** `[note]` graduation-review ronda 1 de la reconciliación de architecture: recomienda corregir — faltaba la condición «sin activar», el respaldo ante resolveRemote era más estrecho que el catch real, y la frase de sync --status «offline puro… sin resolver ningún remoto» no quedaba acotada a repos activados. Corregido el borrador; se delega a un revisor nuevo.
- **2026-10-02T16:37:25Z** `[note]` graduation-review ronda 2 de la reconciliación de architecture: recomienda aplicar; las tres peticiones de la ronda 1 quedan cerradas. Matiz opcional no aplicado: «sólo leen refs locales» sería más exacto como «sólo leen estado local», porque resolveRemote lee la configuración de remotos con git remote.
- **2026-10-02T16:37:26Z** `[graduation]` spec: `architecture.md`
