---
id: "20261012-174310"
title: "Un tipo de release sin rama de release declarada se puede crear y check no lo ve"
type: bug
status: in-progress
created: 2026-10-12T17:43:10Z
depends_on: []
branch: bug/20261012-174310
related_to: ["20261002-181346", "20261002-181428", "20261002-204623"]
owner: rarc88
---

## Request

Un repo recién inicializado con `changeledger init` trae el tipo `hotfix`
(`integrates_into: release`) y `git.release_branch` vacío. En ese repo
`changeledger new hotfix x "X"` crea el change sin error y `changeledger check`
da el repo por válido, pero `changeledger context <id>` falla con
`type "hotfix" integrates into git.release_branch, which is not declared`: el
change queda atascado, sin contexto cargable, y nada avisó antes.

Decisión del humano:

- `check` debe reportar un ERROR cuando exista un change de un tipo cuyo
  `integrates_into` es `release` mientras `git.release_branch` no está declarada.
- `new` debe REHUSAR crear un change de ese tipo en ese estado, con un mensaje
  que diga qué configurar.
- La plantilla de `init` conserva el tipo `hotfix`.

Fuera de alcance: el mensaje de `context`/`agent-context` (el de
`changeIntegrationBranch`, fijado por `20261002-181346` CR4) no cambia; tampoco
la guarda de arranque de ramas (`20261002-204623`).

## Investigation

**Causa raíz.** La condición «tipo de release sin `git.release_branch`» se valida
en un único sitio, y sólo cuando se pide la rama de un change concreto:

- `changeIntegrationBranch(config, type)` en `src/config.mjs` lanza
  `type "<type>" integrates into git.release_branch, which is not declared`.
  Sus únicos consumidores son `transversalPolicy` en `src/commands/context.mjs`
  (`changeledger context <id>`) y la guarda de arranque en `src/commands/agent.mjs`.
- `checkConfig` en `src/check.mjs` valida el rol (`integrationRoleError`) y que
  `git.release_branch`, si existe, sea una cadena no vacía (`releaseBranch`), pero
  deliberadamente no trata su ausencia como defecto de configuración (test
  `181346 CR2/CR4: valid roles pass, and an undeclared release branch is not a
  config error`). El bucle por change de `checkRepo` no relaciona el `type` de
  cada change con la rama.
- `newChange` y `scaffoldChange` (`src/commands/new.mjs`) sólo llaman a
  `requireType` (tipo conocido); no miran `integrates_into`.
- `newChangeFrom`/`prepareNewChange` (usado también por `apply`) y `edit`
  (`prepareChangeEdit`) ejecutan `checkRepo` sobre el repo candidato y rechazan
  sólo los errores *nuevos* (`newErrors`, clave `archivo + mensaje`). Por eso un
  error por-change de `check` cierra también `new --from`, `apply` y el cambio de
  tipo vía `edit` sin código adicional, y no bloquea editar un change que ya
  estaba atascado (su error ya existía).

**Medido** (repo fresco: `git init`, `AGENTS.md`, `changeledger init`;
`git.release_branch:` vacío en `config.yml`):

| Orden | Resultado actual |
| --- | --- |
| `changeledger check` | salida `✓ 0 change(s) valid`, código 0 |
| `changeledger new hotfix x "X"` | `Created …/.changeledger/changes/<id>-x.md`, código 0 |
| `changeledger check` (con ese change) | `✓ 1 change(s) valid`, código 0 |
| `changeledger new hotfix y "Y" --print` | imprime el scaffold (`type: hotfix`), código 0 |
| `changeledger context <id>` | `Error: type "hotfix" integrates into git.release_branch, which is not declared`, código 1 |
| `changeledger context` (core) | cabecera `Effective policy: language=en — tdd=on` (sin `release_types=`) |

Tras `release_branch: main` en `config.yml`: `check` da `✓ 1 change(s) valid`,
`context <id>` imprime `Effective policy: language=en — tdd=on —
release_types=hotfix — integration_branch=main — change_branch=hotfix/<id> —
review_required(hotfix)=yes`, y `new hotfix z "Z"` crea el change.
Formato de un error por-change en `check`: `  error  <nombre-de-archivo>.md:
<mensaje>`, resumen `1 error(s), 0 warning(s) — 1 change(s)`, código 1.

**Decisión: ¿`check` falla por declarar `hotfix` sin usarlo?**

- *Opción A — error de configuración siempre que un tipo de release esté
  declarado sin `git.release_branch`.* Previene el estado atascado de raíz, pero
  todo `init` fresco falla `check` (la plantilla trae `hotfix` y la rama vacía).
  Rompe el test `181428 CR1: init declares the hotfix type after bug and check
  stays clean` y la decisión de que la plantilla conserve `hotfix`; obligaría a
  todo repo que no usa hotfix a declarar una rama que no necesita, o a borrar el
  tipo.
- *Opción B (elegida) — error sólo cuando existe un change no terminal de un tipo
  de release.* El `init` fresco sigue limpio (`hotfix` declarado y sin usar no es
  un defecto: ya la cabecera de contexto omite `release_types=` en ese estado). El
  estado atascado se previene en la creación (`new` rehúsa) y se detecta si se
  llega por otra vía (edición directa del archivo, rama de release retirada de la
  configuración después, merge): `check` lo marca en el change afectado. Coste:
  el defecto aparece al crear/validar un change, no al declarar el tipo; un
  repo con un tipo de release y sin rama no se queja hasta que alguien lo usa,
  que es justo cuando se puede actuar.
- Variante descartada: advertencia (no error) por tipo declarado sin rama.
  Ensucia el `check` de todo `init` fresco con un aviso que el humano no puede
  resolver sin decidir una rama.

Un change `done` o `discarded` no se reporta: ya no se carga ni se arranca, y
retirar `release_branch` después no debe volver rojo el historial. «No terminal»
es todo estado de `config.statuses` salvo `done` y `discarded`.

**Mensaje.** Se mantiene intacto el de `changeIntegrationBranch` (lo fijan
`test/config.test.mjs`, `test/agent.test.mjs`, `test/context.test.mjs`, CR4/CR6 de
`20261002-181346`) y el nuevo lo extiende con la acción a realizar, construido
desde el mismo tramo para que no diverjan:

`type "<type>" integrates into git.release_branch, which is not declared — set git.release_branch in .changeledger/config.yml, for example "main"`

**Changes relacionados** (clasificados): `20261002-181346` (introduce
`git.release_branch`/`integrates_into` y el fallo de `context`),
`20261002-181428` (tipo `hotfix` de la plantilla y su test de `check` limpio) y
`20261002-204623` (guarda de arranque de ramas de release): los tres ya están
`done`, ninguno es prerrequisito de ejecución, por eso van como `related_to`.
Sin `depends_on`.

**No determinado.** Si `changeledger approve` rechaza hoy un draft atascado: con
el error nuevo, que no depende del estado, lo rechazaría por la misma vía que
cualquier error de `check`; no se midió.

## Specification

### CR1 — Un init fresco sigue limpio
- **Given** un repo recién inicializado con `changeledger init`, cuyo `config.yml` declara `types.hotfix.integrates_into: release` y `git.release_branch` vacío, sin ningún change
- **When** se ejecuta `changeledger check`
- **Then** termina con código 0 y la salida es `✓ 0 change(s) valid`
- **And** el test `181428 CR1: init declares the hotfix type after bug and check stays clean` de `test/cli-bin.test.mjs` sigue pasando sin cambios

### CR2 — check marca un change de tipo de release sin rama de release
- **Given** una config con `types.hotfix: { stages: [request, plan, log], integrates_into: release }` y sin `git.release_branch` (ausente, o `null` como en el `init`), y un change de `type: hotfix` en cada estado de `config.statuses` salvo `done` y `discarded`
- **When** se ejecuta `checkRepo` sobre cada uno (y `changeledger check` en el repo)
- **Then** `errors` contiene exactamente un error con `file` igual al nombre del change y `message` igual a `type "hotfix" integrates into git.release_branch, which is not declared — set git.release_branch in .changeledger/config.yml, for example "main"`
- **And** `changeledger check` termina con código 1 e imprime `  error  <id>-<slug>.md: type "hotfix" integrates into git.release_branch, which is not declared — set git.release_branch in .changeledger/config.yml, for example "main"`
- **And** tras declarar `git.release_branch: main`, `changeledger check` vuelve a imprimir `✓ 1 change(s) valid` con código 0

### CR3 — Los changes terminales no se reportan
- **Given** la config de CR2 y un change de `type: hotfix` en estado `done` y otro en `discarded`
- **When** se ejecuta `checkRepo`
- **Then** `errors` no contiene el mensaje de CR2 para ninguno de los dos

### CR4 — Con la rama declarada, o con un tipo normal, no hay error
- **Given** (a) la config de CR2 con `git.release_branch: main` y un change `hotfix` en `draft`; (b) la config de CR2 sin `git.release_branch` y un change `bug` en `draft` (`bug` no declara `integrates_into`); (c) un tipo con `integrates_into: integration` y sin `git.release_branch`
- **When** se ejecuta `checkRepo` en cada caso
- **Then** `errors` no contiene ningún mensaje que contenga `which is not declared`
- **And** el test `181346 CR2/CR4: valid roles pass, and an undeclared release branch is not a config error` de `test/check.test.mjs` sigue pasando sin cambios

### CR5 — new rehúsa y no escribe nada
- **Given** un repo no activado con la config de CR2 (sin `git.release_branch`)
- **When** se ejecuta `changeledger new hotfix x "X"`
- **Then** termina con código 1 y stderr es `Error: type "hotfix" integrates into git.release_branch, which is not declared — set git.release_branch in .changeledger/config.yml, for example "main"`
- **And** el directorio `.changeledger/changes` no contiene ningún archivo nuevo
- **And** `changeledger new bug x "X"` en ese mismo repo sigue creando el change (código 0)

### CR6 — Todas las vías de creación comparten la negativa
- **Given** el repo de CR5
- **When** se ejecuta `changeledger new hotfix y "Y" --print`
- **Then** termina con código 1 con el mismo `Error: …` de CR5 y no imprime scaffold
- **And** `changeledger new hotfix y "Y" --from draft.md` con un `draft.md` válido de `type: hotfix` termina con código 1, stderr contiene `the incoming document is invalid, nothing was written:` y `  <id>-y.md: type "hotfix" integrates into git.release_branch, which is not declared — set git.release_branch in .changeledger/config.yml, for example "main"`, y no escribe archivo
- **And** una entrada `new` de `changeledger apply` con ese mismo documento falla con el mismo mensaje y no aplica nada del manifiesto

### CR7 — Primer uso real de extremo a extremo
- **Given** un repo recién inicializado (`git init`, `AGENTS.md`, `changeledger init`), con `hotfix` declarado y `git.release_branch` vacío
- **When** el humano ejecuta `changeledger new hotfix x "X"`
- **Then** recibe el `Error: …` de CR5 y no se crea el change
- **When** declara `release_branch: main` bajo `git:` en `.changeledger/config.yml` y repite `changeledger new hotfix x "X"`
- **Then** `new` imprime `Created …/.changeledger/changes/<id>-x.md` con código 0
- **And** `changeledger check` imprime `✓ 1 change(s) valid` con código 0
- **And** `changeledger context <id>` imprime una línea `Effective policy: language=en — tdd=on — release_types=hotfix — integration_branch=main — change_branch=hotfix/<id> — review_required(hotfix)=yes`
- **And** `changeledger context` (core) imprime `Effective policy: language=en — tdd=on — release_types=hotfix`

### CR8 — El mensaje de context no cambia
- **Given** la config de CR2 sin `git.release_branch`
- **When** se llama a `changeIntegrationBranch(config, 'hotfix')` o se ejecuta `changeledger context <id>` sobre un change `hotfix` ya existente
- **Then** el mensaje sigue siendo exactamente `type "hotfix" integrates into git.release_branch, which is not declared`
- **And** el helper nuevo comparte con él el tramo común, de modo que no pueden divergir

## Plan

- [x] Helper `releaseBranchRequirementError(config, type)` en `src/config.mjs`: devuelve el mensaje de CR2 si `config.types[type].integrates_into === 'release'` y `releaseBranch(config)` es `undefined`, si no `undefined`; `changeIntegrationBranch` conserva su mensaje y ambos construyen el tramo común con una función compartida
  - **Target:** `src/config.mjs`
  - **Verify:** `node --test test/config.test.mjs`
  - **Criteria:** CR4, CR8
  - **Resolved:** `2026-10-12T18:28:29Z`
- [x] `checkRepo` reporta el error por change no terminal de un tipo de release sin rama (mensaje de CR2), sin tocar `checkConfig`; un `git.release_branch` mal formado no lo duplica (ya lo reporta `checkConfig`)
  - **Target:** `src/check.mjs`
  - **Verify:** `node --test test/check.test.mjs`
  - **Criteria:** CR2, CR3, CR4
  - **Resolved:** `2026-10-12T18:28:30Z`
- [x] `newChange` y `scaffoldChange` lanzan el mensaje de CR2 tras `requireType` y antes de reservar id o escribir; `new --from` y `apply` lo heredan del gate de candidato de `prepareNewChange`, con test que lo fije
  - **Target:** `src/commands/new.mjs`
  - **Verify:** `node --test test/cli.test.mjs test/apply.test.mjs`
  - **Criteria:** CR5, CR6
  - **Resolved:** `2026-10-12T18:28:30Z`
- [x] Test de extremo a extremo junto a `181428 CR1` en `test/cli-bin.test.mjs`: init fresco, `new hotfix` rehusado, declarar `release_branch: main`, `new`, `check` y `context <id>`; el test existente de `init` limpio no se toca
  - **Target:** `test/cli-bin.test.mjs`
  - **Verify:** `node --test test/cli-bin.test.mjs`
  - **Criteria:** CR1, CR7
  - **Resolved:** `2026-10-12T18:28:31Z`
- [x] Actualizar el comentario del tipo `hotfix` en `templates/config.yml` («until then `new` and `check` refuse a change of this type, as do `context <id>` and `agent-context`») sin añadir una pin de prosa a ningún test, y correr la puerta completa
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-10-12T18:28:31Z`

## Log
- **2026-10-12T17:43:10Z** `[version]` 0.18.0-dev
- **2026-10-12T17:58:04Z** `[status]` draft → approved (human via conversation)
- **2026-10-12T18:15:46Z** `[status]` approved → in-progress
- **2026-10-12T18:15:46Z** `[branch]` set: bug/20261012-174310 (auto)
- **2026-10-12T18:28:28Z** `[note]` Implementación: releaseBranchRequirementError en src/config.mjs (comparte el tramo del mensaje con changeIntegrationBranch, que no cambia), error por change no terminal en checkRepo, y requireCreatableType en newChange/scaffoldChange antes de reservar id; new --from y apply lo heredan del gate de candidato. Ajuste necesario fuera de los Target del Plan: el fixture de test/agent.test.mjs que construía changes fix atascados con newChange declara release_branch: main al crearlos y la retira después, porque new ya rehúsa crearlos; el test 181346 CR4 conserva su aserción. Respuesta al «No determinado»: un draft atascado no pasa a approved (falla la validación acotada con el mensaje de CR2). Mutantes M1-M6 caen en sus tests; M3b (quitar discarded de los terminales) es equivalente porque frozenReason ya omite los discarded. pnpm verify en verde (1952 tests).
- **2026-10-12T18:28:29Z** `[note]` Decisiones no especificadas: un git.release_branch mal formado hace lanzar al helper; check lo silencia (ya lo reporta checkConfig una vez) y new falla con él. check sólo marca changes cuyo status está en config.statuses. Residuos: un change ya atascado sigue editable (edit sólo rechaza errores nuevos), como preveía la Investigation.
