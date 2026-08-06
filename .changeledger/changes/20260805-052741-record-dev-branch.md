---
id: "20260805-052741"
title: Registrar la rama de desarrollo en el change
type: feature
status: in-validation
created: 2026-08-05T05:27:41Z
depends_on: []
branch: claude/changeledger-global-state-077d7e
related_to: ["20260726-124836"]
owner: Carlos Rodríguez
---

## Request

Hoy la rama en la que se implementa un change no se persiste en ningún sitio.
Lo único que existe es una inferencia en caliente: `gitRefs()` en `src/git.mjs`
corre `git branch --all` y filtra por **substring del id** en el nombre de la
rama (`refs.branches`), que el viewer muestra junto a los commits. Es una
convención de nombre, no un dato del change.

Se pide un campo explícito `branch` en el frontmatter, escrito
**automáticamente** al pasar el change a `in-progress` — capturando la rama
real desde la que se hace el `changeledger status <id> in-progress` — salvo que
el usuario ya la haya fijado explícitamente, en cuyo caso esa asignación manual
prevalece y no se sobreescribe.

## Investigation

Precedente directo ya implementado para `owner` (`20260726-124836`). Ese
precedente asigna `owner` en **dos** puntos: por defecto en `changeledger new`
(`src/commands/new.mjs:31-35`, identidad git local salvo `--owner` explícito) y,
como red de seguridad, en la transición a `in-progress` si sigue vacío
(`.changeledger/specs/lifecycle.md:313-317` lo documenta como tal). Este change
replica **solo la segunda mitad** — la de `in-progress` —, no la primera:

- **Por qué no hay equivalente en `changeledger new`.** Al crear el draft
  normalmente no existe todavía una rama de trabajo — el change nace antes de
  `approved`, y el checkout donde se redacta el draft puede no ser el checkout
  donde luego se implemente. Capturar "la rama actual" en ese momento sería con
  frecuencia el checkout equivocado. `owner` sí tiene sentido al crear porque la
  identidad de quien redacta es un dato válido desde el minuto uno; `branch` no
  lo es hasta que empieza la implementación real, que es justo lo que marca
  `in-progress`. Por eso este change no propone un `changeledger new --branch`.
- `status()` en `src/commands/agent.mjs` (líneas 87-102) ya autoasigna `owner`
  al entrar en `in-progress`, solo si `!fm.owner`, resolviendo la identidad con
  `ownerHandle()` de `src/git.mjs` — tolerante: si no hay identidad resoluble
  devuelve `''` sin lanzar, y en ese caso no se escribe la línea ni se emite
  evento de Log. `ownerHandle` es un parámetro inyectable de `status()`, lo que
  mantiene deterministas los tests (`test/agent.test.mjs`).
- No existe ningún helper equivalente para "rama actual" en `src/git.mjs`. Los
  helpers existentes (`gitTopLevel`, `gitPrefix`, `gitUser`, `defaultBaseBranch`)
  siguen el mismo patrón: reciben `run` inyectable y toleran fallo devolviendo
  `''` o lanzando según el caso; `defaultBaseBranch` ya usa
  `symbolic-ref --short` como referencia de sintaxis.
- `src/writer.mjs` expone `setOwner`/`setArchived`/`setReviewed`, las tres
  construidas sobre el mismo `patchOptionalPair(fm, doc, <key>, <value>)`
  genérico: añadir `setBranch` es mecánico y no toca el parser YAML.
- El Log usa eventos tipados; `LOG_EVENT_TYPES` en `src/lifecycle.mjs` (línea 70)
  enumera `status, review, validation, owner, graduation, archive, note`. El
  evento `owner` (líneas 104-111 parse, 141-143 serialize) tiene la forma
  `set: <value>[ (auto)]` / `cleared`; es el molde directo para un nuevo tipo
  `branch`.
- `bin/changeledger.mjs` registra un comando `owner <id> <name>` (con `-` para
  limpiar) que llama a `owner()` en `src/commands/agent.mjs` (línea 276) y
  escribe el mismo tipo de evento. Es el molde para un comando `branch <id>
  <name>` de asignación explícita.
- `src/check.mjs` no valida `owner` como campo requerido ni restringe claves de
  frontmatter desconocidas (`REQUIRED` en línea 77 no lo incluye); un `branch`
  opcional no necesita ningún cambio de validación para que `check` siga en
  verde en changes existentes que no lo tengan.
- `src/viewer/domain.mjs` (`serialize()`, línea 38) expone `owner:
  c.frontmatter.owner ?? null` en el JSON que consume el viewer; `branch` se
  añade en el mismo punto.
- `src/viewer/public/app.js` (línea 698) renderiza un pill `@owner` en la
  tarjeta del change. Un pill equivalente para `branch` es la superficie mínima
  de UI; no se añade un filtro dedicado (el de owner en líneas 206-265) porque
  nadie lo ha pedido y sería superficie sin uso observado.
- `.changeledger/specs/data-model.md` enumera los campos opcionales de
  frontmatter (`related_to`, `owner`, `archived`, `reviewed`,
  `release_impact`) como verdad persistente; `branch` entra en esa lista.
  `.changeledger/specs/lifecycle.md` documenta el ciclo del `owner`
  (autoasignación en `in-progress`, no pisa asignación manual); necesita la
  sección equivalente para `branch`.
- **Asunción explícita sobre el flujo real de este repo.** Buena parte del
  trabajo aquí ocurre en worktrees de agente (`.claude/worktrees/<slug>-<hash>`,
  como el propio worktree de esta sesión), donde el nombre de la rama no
  coincide con el slug del change ni con el directorio. El valor de "el nombre
  real de la rama" es más débil en ese flujo que en un desarrollo manual de una
  rama por persona: puede identificar el worktree de trabajo, pero no promete
  legibilidad humana. Se acepta igualmente porque sigue siendo estrictamente
  mejor que la inferencia ambigua por substring que existe hoy (ver más abajo),
  no porque resuelva el caso ideal de una convención de nombre legible.
- Las dos ramas abandonadas de estado global (`codex/global-state-branch`,
  `codex/state-replica-v2`) intentaron un `git.change_branch_format`
  configurable (`{type}/{id}`) que exigía que las ramas nuevas siguieran un
  patrón. Este change deliberadamente no lo reintroduce: no impone ningún
  formato, solo registra el nombre real de la rama tal y como está, igual que
  hace hoy el owner con la identidad git real sin normalizarla.

## Proposal

Un campo, escritura automática con guarda de no-pisado, más un comando
explícito para corregirlo — exactamente el modelo ya validado para `owner`.

- **Nuevo helper `currentBranch(cwd, run = defaultRun)`** en `src/git.mjs`, que
  corre `git rev-parse --abbrev-ref HEAD` y devuelve `''` si el proceso falla o
  si el resultado es `HEAD` (checkout en detached HEAD, sin rama real que
  registrar) — mismo nivel de tolerancia que `ownerHandle`.
- **`status()` en `src/commands/agent.mjs`**: en la transición a
  `in-progress`, junto al bloque existente de autoasignación de `owner`, si
  `!fm.branch` se resuelve `currentBranch(path.dirname(file))`; si devuelve un
  valor no vacío se escribe con `setBranch` y se registra un evento de Log
  `[branch]` con `automatic: true`. Un `branch` ya presente (fijado a mano o en
  una transición anterior) nunca se sobreescribe — mismo guard `!fm.owner` que
  ya existe, replicado para `branch`.
- **`setBranch(text, branch)`** en `src/writer.mjs`, construido sobre
  `patchOptionalPair` igual que `setOwner`.
- **Nuevo tipo de evento de Log `branch`** en `src/lifecycle.mjs`:
  `LOG_EVENT_TYPES` gana `'branch'`; parse/serialize replican exactamente la
  forma de `owner` (`set: <value>[ (auto)]` / `cleared`).
- **Comando explícito `changeledger branch <id> <name>`** (y `changeledger
  branch <id> -` para limpiar), en `src/commands/agent.mjs` y registrado en
  `bin/changeledger.mjs`, mismo patrón que `owner()`. Es la única vía para
  corregir el valor tras un rename de rama o un cherry-pick a otra rama: no hay
  detección automática de rename, igual que `owner` no detecta reasignaciones.
- **`src/viewer/domain.mjs`**: `serialize()` añade `branch: c.frontmatter.branch
  ?? null` junto a `owner`.
- **`src/viewer/public/app.js`**: pill `⎇ <branch>` junto al pill de owner en la
  tarjeta del change, sin filtro dedicado (ver Investigation).
- **`.changeledger/specs/data-model.md`**: `branch` se añade a la lista de
  campos opcionales de frontmatter, con una aclaración de una línea de que es
  un dato **por change** (la rama de implementación de ese change) y no debe
  confundirse con `config.git.integration_branch`, que es la rama de
  integración del repositorio entero.
- **`.changeledger/specs/lifecycle.md`**: nueva subsección "Log y branch",
  simétrica a la de owner: se autoasigna al pasar a `in-progress` desde la rama
  real del checkout que ejecuta la transición, no pisa un valor ya fijado
  (manual o automático), y se corrige con `changeledger branch <id> <name>`.

### Alternativas descartadas

- **Seguir derivando la rama por substring del id (`gitRefs`).** Descartado:
  ambiguo si dos ramas contienen el id (una vigente, otra abandonada), no
  sobrevive a un rename de rama, y no distingue "la" rama vigente de una
  coincidencia casual.
- **Imponer un formato de nombre de rama (`{type}/{id}`).** Descartado
  explícitamente por decisión humana (2026-08-04): fue exactamente la pieza
  que hizo perder el control en `codex/global-state-branch`. Este change
  registra el nombre real, sea cual sea, sin normalizarlo ni validarlo contra
  un patrón.
- **Detectar rename automáticamente (comparar `branch` guardado contra
  `git branch --contains <sha>` del último commit marcado).** Descartado por
  ahora: añade heurística y superficie de fallo (rebases, múltiples ramas
  conteniendo el mismo commit) para un caso que el comando explícito ya cubre
  sin ambigüedad.
- **Reescribir `branch` en cada mutación agent-owned, no solo al entrar en
  `in-progress`.** Descartado por la misma razón por la que `owner` no lo hace:
  escritura silenciosa de frontmatter en cada comando, y mentiría si el trabajo
  continúa en una rama distinta a la del arranque sin que nadie lo pida.

## Specification

### CR1 — `in-progress` sin `branch` asigna la rama git local
- **Given** un change en `approved` sin `branch` en frontmatter, y
  `currentBranch` inyectada devolviendo `'feature/x'`
- **When** se ejecuta `status(id, 'in-progress', cwd, { currentBranch: fake })`
- **Then** el frontmatter resultante contiene `branch: feature/x`
- **And** el Log gana un evento `` `[branch]` `` con payload `set:
  feature/x (auto)`

### CR2 — un `branch` ya asignado no se sobreescribe
- **Given** un change `approved` con `branch: manual-branch` ya en frontmatter
- **When** se ejecuta la transición a `in-progress` con `currentBranch`
  inyectada devolviendo `'otra-rama'`
- **Then** el frontmatter conserva `branch: manual-branch`
- **And** no se emite ningún evento `[branch]` nuevo

### CR3 — HEAD desacoplado o rama no resoluble no falla la transición
- **Given** `currentBranch` inyectada devolviendo `''` (detached HEAD o fallo
  del subproceso git)
- **When** se ejecuta la transición a `in-progress` sin `branch` previo
- **Then** la llamada retorna la ruta del archivo sin lanzar excepción
- **And** el frontmatter no contiene ninguna clave `branch`
- **And** no se emite ningún evento `[branch]`

### CR4 — `changeledger branch <id> <name>` fija el valor explícito
- **Given** cualquier change existente, con o sin `branch` previo
- **When** se ejecuta `changeledger branch <id> hotfix/y`
- **Then** el frontmatter contiene `branch: hotfix/y`
- **And** el Log gana un evento `[branch]` con payload `set: hotfix/y` (sin
  `(auto)`)

### CR5 — `changeledger branch <id> -` limpia el campo
- **Given** un change con `branch: feature/x`
- **When** se ejecuta `changeledger branch <id> -`
- **Then** el frontmatter deja de contener la clave `branch`
- **And** el Log gana un evento `[branch]` con payload `cleared`

### CR6 — un change preexistente sin `branch` pasa `check` sin error
- **Given** un change válido en cualquier stage activo, sin clave `branch` en
  su frontmatter
- **When** se ejecuta `changeledger check <id>`
- **Then** el comando termina con código de salida `0`
- **And** no reporta ningún warning ni error relacionado con `branch`

### CR7 — el viewer expone `branch` en el JSON serializado
- **Given** un change con `branch: feature/x` en frontmatter
- **When** se llama a `serialize(repo)` en `src/viewer/domain.mjs`
- **Then** el objeto del change en `changes[]` incluye `branch: 'feature/x'`
- **And** un change sin `branch` incluye `branch: null`

### CR8 — la verdad persistente documenta el ciclo completo
- **Given** `.changeledger/specs/data-model.md` y
  `.changeledger/specs/lifecycle.md` tras el cambio
- **When** se leen la lista de campos opcionales de frontmatter y la sección de
  Log y owner/branch
- **Then** `data-model.md` lista `branch` entre los campos opcionales de
  frontmatter
- **And** `lifecycle.md` documenta que se autoasigna al pasar a `in-progress`
  desde la rama real del checkout, que no pisa un valor ya fijado, y que se
  corrige con `changeledger branch <id> <name>`

## Plan

- [x] Añadir `currentBranch(cwd, run = defaultRun)` a `src/git.mjs` (tolerante a
      fallo y a detached HEAD) con tests unitarios
  - **Target:** `src/git.mjs`
  - **Verify:** `node --test test/git.test.mjs`
  - **Criteria:** CR1, CR3
  - **Resolved:** `2026-08-06T07:05:24Z`
- [x] Añadir `setBranch` a `src/writer.mjs` sobre `patchOptionalPair`
  - **Target:** `src/writer.mjs`
  - **Verify:** `node --test test/writer.test.mjs`
  - **Criteria:** CR1, CR2, CR4, CR5
  - **Resolved:** `2026-08-06T07:17:41Z`
- [x] Añadir tipo de evento `branch` a `LOG_EVENT_TYPES`, parse y serialize en
      `src/lifecycle.mjs`, replicando la forma de `owner`
  - **Target:** `src/lifecycle.mjs`
  - **Verify:** `node --test test/lifecycle.test.mjs`
  - **Criteria:** CR1, CR4, CR5
  - **Resolved:** `2026-08-06T07:26:50Z`
- [x] Extender `status()` en `src/commands/agent.mjs` con el parámetro
      inyectable `currentBranch` y el bloque de autoasignación con guard
      `!fm.branch`
  - **Target:** `src/commands/agent.mjs`
  - **Verify:** `node --test test/agent.test.mjs`
  - **Criteria:** CR1, CR2, CR3
  - **Resolved:** `2026-08-06T07:50:03Z`
- [x] Añadir `owner()`-equivalente `branch(id, name, cwd)` en
      `src/commands/agent.mjs` y registrar el comando `branch <id> <name>` en
      `bin/changeledger.mjs`
  - **Target:** `bin/changeledger.mjs`
  - **Verify:** `node --test test/cli-bin.test.mjs`
  - **Criteria:** CR4, CR5
  - **Resolved:** `2026-08-06T07:55:11Z`
- [x] Confirmar que `check` no exige `branch` ni falla en su ausencia
  - **Target:** `test/check.test.mjs`
  - **Verify:** `node --test test/check.test.mjs`
  - **Criteria:** CR6
  - **Resolved:** `2026-08-06T07:55:56Z`
- [x] Añadir `branch: c.frontmatter.branch ?? null` a `serialize()` en
      `src/viewer/domain.mjs`
  - **Target:** `src/viewer/domain.mjs`
  - **Verify:** `node --test test/view.test.mjs`
  - **Criteria:** CR7
  - **Resolved:** `2026-08-06T08:00:06Z`
- [x] Añadir pill `⎇ <branch>` en `src/viewer/public/app.js` junto al pill de
      owner, sin filtro dedicado
  - **Target:** `src/viewer/public/app.js`
  - **Support:**
  - **Resolved:** `2026-08-06T08:03:31Z`
- [x] Actualizar `.changeledger/specs/data-model.md` y
      `.changeledger/specs/lifecycle.md` con la sección de `branch`
  - **Target:** `.changeledger/specs/data-model.md`
  - **Verify:** `node bin/changeledger.mjs check`
  - **Criteria:** CR8
  - **Resolved:** `2026-08-06T08:59:33Z`
- [x] Gate completo
  - **Target:** `test/**`
  - **Verify:** `pnpm verify`
  - **Support:**
  - **Resolved:** `2026-08-06T10:07:07Z`

## Log

- **2026-08-05T05:27:41Z** `[note]` Draft creado a partir de la conversación:
  hoy la rama de un change se infiere por substring del id vía `gitRefs()`, sin
  persistirse. Se pide un campo `branch` explícito, autoasignado al pasar a
  `in-progress` desde la rama real del checkout (sin pisar un valor ya fijado)
  y corregible con un comando explícito — replicando exactamente el modelo ya
  validado para `owner` en `20260726-124836`. Deliberadamente no se reintroduce
  el formato de nombre de rama configurable (`{type}/{id}`) que hizo perder el
  control en `codex/global-state-branch`.
- **2026-08-05T06:05:00Z** `[note]` Ajustes tras revisión de un agente fresco de
  contexto limpio, sin hallazgos bloqueantes: (1) Investigation explica ahora
  por qué `branch` replica solo la mitad de `owner` que autoasigna en
  `in-progress` y deliberadamente no añade un `--branch` a `changeledger new`
  — la rama de trabajo típicamente no existe todavía al redactar el draft. (2)
  Corregida la cita de línea del bloque de autoasignación de owner en
  `agent.mjs` (87-102, no ~86-96). (3) Investigation deja explícita la
  asunción sobre el flujo real de worktrees de agente de este repo, donde el
  nombre de rama no es legible por humano pero sigue siendo mejor que la
  inferencia ambigua actual. (4) Proposal aclara que `branch` es un dato por
  change, distinto de `config.git.integration_branch`.
- **2026-08-05T09:26:14Z** `[status]` draft → approved (human via conversation)
- **2026-08-06T06:16:57Z** `[status]` approved → in-progress
- **2026-08-06T10:33:24Z** `[branch]` set: claude/changeledger-global-state-077d7e
- **2026-08-06T10:45:48Z** `[status]` in-progress → in-review
- **2026-08-06T12:03:41Z** `[note]` Review mandate: full audit of the entire diff (10 commits, baseline 3da3639..5a03c81) implementing the branch frontmatter field per the approved Specification (CR1-CR8).
- **2026-08-06T12:09:31Z** `[review]` in-review → in-validation (delegated subagent, clean context)
