---
id: "20261012-174407"
title: "check --commits sin base usa la rama de integración del change de la rama actual"
type: bug
status: approved
created: 2026-10-12T17:44:07Z
depends_on: []
related_to: ["20261012-174310", "20261002-181346", "20261002-181428", "20260711-210115", "20260805-052741", "20260808-141944", "20261002-204623"]
owner: rarc88
---

## Request

`changeledger check --commits` sin `<base>` lintea siempre `git.integration_branch..HEAD`, sin mirar de qué change es la rama que está checked out. En una rama de hotfix creada desde la rama de release (`main`), el rango `dev..HEAD` arrastra los commits de `main` que no están en `dev` y que no pertenecen al change, y el lint falla por commits ajenos.

Hoy el agente evita el fallo porque `templates/contract/implement.md` le manda pasar a mano la rama de integración del change como `<base>`, mientras `templates/contract/core.md` sigue diciendo `check --commits [<base>]` sin esa condición. `#20261002-181346` dejó este punto fuera de su alcance a propósito («que `changeledger check --commits` sin base deduzca la base del change de la rama actual»).

Se pide:

- Que sin `<base>` el comando use la rama de integración efectiva del change cuya rama está checked out, con vuelta a `git.integration_branch` cuando no se resuelve ningún change.
- Que el contrato deje de pedir al agente esa elección manual cuando el CLI ya la hace.

Fuera de alcance: cambiar el formato de la salida del lint, el resultado de `check --commits <base>` con base explícita y cualquier otro consumidor de la rama de integración (guarda de `status in-progress`, `context`, `cutover`).

## Investigation

**Causa raíz.** `checkCommits` (`src/commands/check.mjs`) resuelve la base como `base ?? configuredIntegrationBranch(cwd) ?? defaultBaseBranch(cwd)`. `configuredIntegrationBranch` lee `integrationBranch(config)`, es decir `git.integration_branch` del repo, sin tipo y sin change. La rama integra por tipo (`changeIntegrationBranch(config, type)` en `src/config.mjs`, de `#20261002-181346`) nunca se consulta aquí. El comando ni siquiera carga el ledger: sólo necesita git y, a lo sumo, la config.

**Medido en un fixture** (`.../scratchpad/fixtures/commits-1`: `git.integration_branch: dev`, `git.release_branch: main`, tipo `hotfix` con `integrates_into: release`, `main` con un commit sin marcador que no está en `dev`, change hotfix `20261012-174140` con `branch: hotfix/20261012-174140` creada desde `main` y un commit con marcador):

- `check --commits` en la rama del hotfix: `error  (commits): 853ab79 missing [#id] marker: "fix(y): earlier hotfix shipped on main, no marker"` y `1 error(s) — commits dev..HEAD`, exit 1. El commit ajeno es el de `main`.
- `check --commits main` en la misma rama: `✓ commits main..HEAD valid`, exit 0.
- `context 20261012-174140` publica `integration_branch=main — back_merge_branch=dev`; el de un `bug` publica `integration_branch=dev`. La información correcta ya existe, sólo falta usarla aquí.
- Con un change `bug` en `bug/20261012-174141` (creada desde `dev`): `✓ commits dev..HEAD valid`. En `main` y con HEAD desacoplado (sin change): `commits dev..HEAD` con el mismo error, que es el comportamiento de vuelta que se quiere conservar.
- Un documento de change malformado (`Change is missing its frontmatter block`) no afecta hoy a `check --commits` (no lee el ledger); `changeledger list` y `check` sí fallan con ese mensaje.

**Cómo se identifica el change de la rama actual.** No hay un helper rama→change. Piezas disponibles:

- `checkoutBranch(cwd)` (`src/git.mjs`): rama del checkout, `''` con HEAD desacoplado o fallo; tolerante a propósito.
- `frontmatter.branch`: la rama real registrada al pasar a `in-progress` (`#20260805-052741`), fijada una vez y que `#20260808-141944` sólo avisa si queda obsoleta.
- `renderChangeBranch(config, change)` (`src/config.mjs`): la rama que `git.change_branch_format` asigna al change; la guarda de `status in-progress` exige que coincida con el checkout antes de registrar `branch`, así que ambas coinciden en el flujo normal.
- `changeIntegrationBranch(config, change.type)`: ya resuelve la base efectiva y ya lanza `type "<t>" integrates into git.release_branch, which is not declared`.
- `changeledger commit` resuelve el único change `in-progress`, pero ese criterio no sirve aquí: en una rama sin change `in-progress` (revisión, validación) o con varios en curso daría una base arbitraria.

**Decisiones de diseño.**

1. Resolver por rama, no por estado. Un change decide la base si no es terminal (`done`, `discarded`) y su `branch` registrado es la rama checked out, o, si no tiene `branch` registrada, `renderChangeBranch` da esa rama. Los terminales se ignoran para que un nombre de rama reutilizado (sin `change_branch_format`) no secuestre el lint.
2. Un solo valor decide. Si varios changes casan y sus bases efectivas son la misma, se usa; si difieren, el comando falla y pide `<base>`: una base elegida al azar es el defecto que se corrige.
3. Sin change que case (rama de integración, rama de release, HEAD desacoplado, rama sin registrar), se conserva la cadena actual: `git.integration_branch`, y si no existe, `defaultBaseBranch`. Tampoco hay lectura de ledger cuando ningún tipo declara `integrates_into: release`: entonces la base efectiva de cualquier change es `git.integration_branch` y el resultado no puede cambiar. Así los repos sin tipos de release no cambian de comportamiento ni dependen de que el ledger se pueda cargar (mantiene la propiedad medida arriba).
4. Con tipos de release, un ledger ilegible (`loadRepo` falla) o un change cuyo tipo necesita una `git.release_branch` sin declarar hacen fallar el comando con el mensaje del cargador o del resolutor, en el formato de error existente (`error  (commits): <mensaje>`, exit 1). No se cae en silencio a `dev`: es exactamente el rango erróneo que se corrige. La base explícita sigue siendo la salida y nunca carga el ledger.
5. Contrato: con el CLI haciendo la elección, la cláusula «use it as the `<base>` when checking the change's commits» de `implement.md` es un duplicado que puede desincronizarse (hoy ya contradice a `core.md`). Se retira de `implement.md`; el nuevo hogar de la obligación es el CLI, descrito en el texto de `--help` de `check --commits`, y `core.md` conserva `check --commits [<base>]` sin cambios (el `[<base>]` opcional pasa a ser cierto). No se añade ni una frase al contrato. `implement.md` no lleva el literal `check --commits` (`124837 CR3`), así que no hay otra mención que mover. Efecto en tests: `CONCEPT_GUARDS` entrada 20 (`test/context.test.mjs`) tiene una cuarta aserción sobre esa base; se elimina junto con su mención en la obligación y el comentario, y las tres aserciones de ramas se conservan. Es una retirada de obligación con hogar nombrado y comprobable (CR10), no un pin nuevo, y presupuestos de `budgets.yml` sólo bajan.
6. Fuera de decisión, para el humano: mostrar en la línea final qué change decidió la base (p. ej. `(base de #id)`). No se incluye: la salida del lint no cambia y el rango ya aparece en `commits <base>..HEAD`.

Verificación previa: `changeledger search` (varias consultas) sólo encuentra `#20260711-210115` (la base desde config), `#20261002-181346` (que excluyó este punto), `#20261002-181428` (tipo hotfix), `#20261002-204623` (guarda de arranque con la misma pareja integración/release), `#20260805-052741` y `#20260808-141944` (campo `branch`). Todos están `done`; ninguno cubre este comportamiento. Al graduar, `git-traceability` debe cambiar dos frases: «`check --commits` usa `git.integration_branch` como base por defecto, sin mirar el tipo de ningún change» y la que dice que la `<base>` con que se comprueban los commits es la rama de integración del contexto.

## Specification

Fixture común de los CR (salvo que se diga otra cosa): repo con `git.integration_branch: dev`, `git.release_branch: main`, `git.change_branch_format: "{type}/{id}"`, tipo `hotfix` con `integrates_into: release` y tipo `bug` sin él. `main` tiene un commit `fix(y): earlier hotfix shipped on main, no marker` (853ab79 en el fixture medido) que no está en `dev`. `dev` tiene otro commit sin marcador que no está en `main`.

### CR1 — Primer uso: hotfix creado desde la rama de release
- **Given** un change `hotfix` `20261012-174140` con `branch: hotfix/20261012-174140` registrada, la rama `hotfix/20261012-174140` creada desde `main`, un commit `fix(x): hotfix work [#20261012-174140]` encima y esa rama checked out
- **When** se ejecuta `changeledger context 20261012-174140` y después `changeledger check --commits` sin base
- **Then** la política efectiva de `context` contiene `integration_branch=main — back_merge_branch=dev`
- **And** `check --commits` imprime `✓ commits main..HEAD valid` y sale con 0
- **And** el commit sin marcador de `main` no se reporta

### CR2 — Un change de tipo integración conserva su base
- **Given** un change `bug` `20261012-174141` con `branch: bug/20261012-174141` registrada y esa rama, creada desde `dev`, checked out
- **When** se ejecuta `changeledger check --commits` sin base
- **Then** imprime `✓ commits dev..HEAD valid` y sale con 0

### CR3 — Sin change resuelto se usa `git.integration_branch`
- **Given** el fixture con la rama `main` checked out, y por separado con HEAD desacoplado en `hotfix/20261012-174140`; ningún change registra esa rama ni la renderiza como `change_branch`
- **When** se ejecuta `changeledger check --commits` sin base en cada caso
- **Then** ambos imprimen `  error  (commits): 853ab79 missing [#id] marker: "fix(y): earlier hotfix shipped on main, no marker"` seguido de `1 error(s) — commits dev..HEAD` y salen con 1

### CR4 — La base explícita tiene precedencia
- **Given** la rama de CR1 checked out
- **When** se ejecuta `changeledger check --commits dev`
- **Then** imprime `error  (commits)` por 853ab79 y `1 error(s) — commits dev..HEAD`, y sale con 1
- **And** no se lee el ledger: `changeledger check --commits dev` con un documento de change malformado en `changes_dir` produce el mismo resultado

### CR5 — Change sin rama registrada: la rama renderizada decide
- **Given** un change `hotfix` aprobado `20261012-174140` sin campo `branch`, y checked out `hotfix/20261012-174140` creada desde `main`
- **When** se ejecuta `changeledger check --commits` sin base
- **Then** imprime `✓ commits main..HEAD valid` (lo medido hoy con `check --commits main` en esa rama) y sale con 0

### CR6 — Los changes terminales no deciden
- **Given** un change `hotfix` en `done` cuya `branch` registrada es `shared/work`, ningún otro change con esa rama, y `shared/work` checked out
- **When** se ejecuta `changeledger check --commits` sin base
- **Then** el rango es `dev..HEAD`: la salida contiene `commits dev..HEAD` y no `commits main..HEAD`

### CR7 — Dos changes con bases distintas en la misma rama no se resuelven en silencio
- **Given** el hotfix `20261012-174140` (base `main`) y el bug `20261012-174141` (base `dev`), ambos `in-progress` con `branch: shared/work`, y `shared/work` checked out
- **When** se ejecuta `changeledger check --commits` sin base
- **Then** imprime `  error  (commits): branch "shared/work" is recorded by changes #20261012-174140 (integrates into main) and #20261012-174141 (integrates into dev); pass <base> explicitly`, sale con 1 y no imprime ninguna línea `commits <base>..HEAD`
- **And** con `--json` la salida es `{"errors":[{"file":"(commits)","message":"branch \"shared/work\" is recorded by changes #20261012-174140 (integrates into main) and #20261012-174141 (integrates into dev); pass <base> explicitly"}],"warnings":[]}`
- **And** si ambos changes fueran de tipo integración (base `dev` los dos), se usa `dev` sin error

### CR8 — Tipo de release sin `git.release_branch` declarada
- **Given** el fixture sin la clave `git.release_branch`, el hotfix `20261012-174140` con `branch: hotfix/20261012-174140` y esa rama checked out
- **When** se ejecuta `changeledger check --commits` sin base
- **Then** imprime `  error  (commits): type "hotfix" integrates into git.release_branch, which is not declared` y sale con 1, sin caer en `dev`
- **And** con `main` checked out (ningún change resuelto), el mismo repo imprime el resultado de CR3 (`commits dev..HEAD`)

### CR9 — Sólo se lee el ledger cuando hay tipos de release
- **Given** un documento `20261012-999999-bad.md` con el contenido `not a change` en `changes_dir`, y la rama de CR1 checked out
- **When** se ejecuta `changeledger check --commits` sin base en el repo sin ningún tipo con `integrates_into: release`
- **Then** imprime `commits dev..HEAD` y no falla por el documento (lo medido hoy: no lo lee)
- **And** en el repo con el tipo `hotfix` el comando imprime `  error  (commits): <ruta>/20261012-999999-bad.md: Change is missing its frontmatter block` (el mensaje de `loadRepo`, el mismo que `changeledger list`) y sale con 1

### CR10 — Ayuda y contrato: el hogar de la obligación es el CLI
- **Given** el CLI y el pack `implement` de este repo
- **When** se ejecuta `changeledger check --help` y `changeledger context implement`
- **Then** la ayuda describe `--commits [base]` como `lint commit subjects on <base>..HEAD for the [#id] marker (base defaults to the integration branch of the change on the current branch, else git.integration_branch, else auto-detected)`
- **And** la captura de `implement` ya no contiene la obligación de pasar la rama de integración como `<base>` de la comprobación de commits, y conserva las otras tres obligaciones de ramas de `CONCEPT_GUARDS` entrada 20 (no implementar sobre integración ni release; ramas del change desde y hacia la `integration_branch` del contexto; release reservada a releases y a los tipos que se integran en ella)
- **And** `core.md` conserva `changeledger check --commits [<base>]` sin cambios y el literal `check --commits` sigue sin aparecer en `implement` (`124837 CR3`)

### CR11 — Sin `git.integration_branch` declarada, la autodetección sigue
- **Given** un repo sin `git.integration_branch`, con un tipo `hotfix` integrado en release, `main` como rama por defecto, un change `bug` con su rama registrada y esa rama checked out
- **When** se ejecuta `changeledger check --commits` sin base
- **Then** la base es la que devuelve `defaultBaseBranch` (`main`) y el resultado es el mismo que hoy sin este change: `commits main..HEAD`

## Plan

- [ ] Resolver la base por defecto por el change de la rama checked out, con vuelta a `git.integration_branch` y precedencia de la base explícita
  - **Target:** `src/commands/check.mjs`
  - **Verify:** `node --test test/check.test.mjs`
  - **Criteria:** CR1, CR2, CR3, CR4, CR5, CR6, CR11
- [ ] Fallar sin elegir en silencio con bases ambiguas, release sin declarar o ledger ilegible, y leer el ledger sólo con tipos de release
  - **Target:** `src/commands/check.mjs`
  - **Verify:** `node --test test/check.test.mjs`
  - **Criteria:** CR7, CR8, CR9
- [ ] Actualizar el texto de ayuda de `--commits [base]`
  - **Target:** `bin/changeledger.mjs`
  - **Verify:** `node --test test/cli-bin.test.mjs`
  - **Criteria:** CR10
- [ ] Retirar de `implement.md` la instrucción manual de `<base>` y reorientar la entrada 20 de `CONCEPT_GUARDS`
  - **Target:** `templates/contract/implement.md`
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR10
- [ ] Ejecutar la puerta de calidad completa
  - **Support:** `pnpm verify`

## Log
- **2026-10-12T17:44:07Z** `[version]` 0.18.0-dev
- **2026-10-12T17:58:12Z** `[status]` draft → approved (human via conversation)
