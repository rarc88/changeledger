---
id: "20260925-130844"
title: activate adopta una ref de estado cuyo mínimo supera la CLI instalada
type: bug
status: done
created: 2026-09-25T13:08:44Z
depends_on: ["20260924-184354"]
branch: bug/20260925-130844
related_to: ["20260811-163203"]
owner: Roberto Ruiz
release_impact: patch
---

## Request

El review de `20260924-184354` observó que, en un clon nuevo, una CLI por
debajo del `min_cli_version` publicado puede ejecutar `changeledger activate`:
adopta la ref de estado y escribe la activación, y sólo después el resto de
comandos se niegan a trabajar. `activate` debe comprobar el mínimo de la ref que
va a adoptar y fallar sin efectos cuando la CLI instalada está por debajo, con
el mismo diagnóstico que el resto de la CLI.

Queda fuera de este bug que `check --json` devuelva texto plano cuando corta el
guard, y la migración a schema 6 de la config de este repositorio.

## Investigation

Reproducido con la CLI `0.17.0-dev`, un remoto bare y clones reales. En el repo
A, `init` y `cutover` publican la ref de estado; el mínimo de la config de esa
ref se eleva a `99.0.0` con `mutateState` y se publica, mientras el
`.changeledger/config.yml` de la rama sigue declarando `0.17.0-dev`. En el clon B
sólo existen `refs/heads/main` y `refs/remotes/origin/{main,changeledger/state}`.
`changeledger activate` sale con código 0 e imprime
`Seeded refs/heads/changeledger/state from refs/remotes/origin at <oid>` y
`Activated refs/changeledger/activation → refs/heads/changeledger/state at <oid>`;
después existen `refs/heads/changeledger/state` y `refs/changeledger/activation`.
El siguiente `changeledger list` sale con código 1 y
`Error: ChangeLedger CLI 0.17.0-dev is below this repository's minimum 99.0.0; update the global installation.`
Con la ref de estado ya presente en local y sin activación, `activate` también
sale con 0 y escribe `refs/changeledger/activation`.

Causa raíz: el hook `preAction` de `bin/changeledger.mjs` evalúa
`repoCliVersionError`, que lee la config efectiva con `loadEffectiveConfig`.
Mientras el clon no está activado, esa config es el archivo del worktree, no la
ref. `activate` es justamente el comando que cambia esa autoridad:
`activate()` en `src/commands/activate.mjs` llama a `seedStateRef` y después a
`writeActivation` sin comparar la versión instalada con la config de la
revisión que adopta. El guard se evaluó antes, contra una config que deja de ser
la autoridad en cuanto la activación termina. La misma omisión alcanza la
reparación de una activación sin `ledger_dir`: esa activación rota hace que
`loadEffectiveConfig` falle, el guard se aparta a propósito y `activate` escribe
la reparación sin mirar el mínimo.

`readStateConfigText` acepta una `revision`, así que la config de la revisión a
adoptar (la ref local o la copia remota) se puede leer antes de escribir
ninguna ref; `cliVersionError` de `src/version-guard.mjs` ya produce el
diagnóstico. `test/activate.test.mjs` cubre `activate` con el fixture
`clonedRepoWithState`, y ninguno de sus tests declara `min_cli_version`.

Interfaces externas: ninguna nueva; las refs de git locales y la versión del
`package.json` distribuido ya son contratos de la herramienta.

`20260924-184354` introdujo el guard y es prerrequisito de ejecución; el siembra
desde la copia remota que se protege aquí viene de `20260811-163203`.

## Specification

### CR1 — Un clon nuevo no adopta una ref con un mínimo superior
- **Given** un clon sin activar con la CLI `0.17.0-dev`, cuyo `.changeledger/config.yml` del worktree declara `min_cli_version: 0.17.0-dev` y cuya copia `refs/remotes/origin/changeledger/state` declara schema 6 con `min_cli_version: 99.0.0`
- **When** se ejecuta `changeledger activate`
- **Then** termina con código distinto de cero y muestra `ChangeLedger CLI 0.17.0-dev is below this repository's minimum 99.0.0; update the global installation.`
- **And** no se crean `refs/heads/changeledger/state` ni `refs/changeledger/activation`: la salida de `git for-each-ref` es idéntica antes y después

### CR2 — Una ref local sin activación tampoco se activa
- **Given** un clon con la CLI `0.17.0-dev`, con `refs/heads/changeledger/state` local declarando schema 6 con `min_cli_version: 99.0.0` y sin `refs/changeledger/activation`
- **When** se ejecuta `changeledger activate`
- **Then** termina con código distinto de cero y muestra el diagnóstico de CR1
- **And** no se crea `refs/changeledger/activation` y `refs/heads/changeledger/state` conserva su oid

### CR3 — La reparación de una activación rota respeta el mínimo
- **Given** un clon con la CLI `0.17.0-dev`, con una activación que no declara `ledger_dir` y una ref de estado que declara schema 6 con `min_cli_version: 99.0.0`
- **When** se ejecuta `changeledger activate`
- **Then** termina con código distinto de cero y muestra el diagnóstico de CR1
- **And** `refs/changeledger/activation` conserva su oid

### CR4 — El primer uso de un clon compatible no cambia
- **Given** un clon nuevo sin activar con la CLI `0.17.0-dev`, cuya copia `refs/remotes/origin/changeledger/state` declara schema 6 con `min_cli_version: 0.1.0`
- **When** se ejecuta `changeledger activate` y después `changeledger list`
- **Then** `activate` termina con código cero e imprime `Seeded refs/heads/changeledger/state from refs/remotes/origin at <oid>` y `Activated refs/changeledger/activation → refs/heads/changeledger/state at <oid>`
- **And** `changeledger list` termina con código cero

## Plan

- [x] Escribir pruebas fallidas de activate con mínimo superior e inferior
  - **Target:** `test/activate.test.mjs`
  - **Verify:** `node --test test/activate.test.mjs`
  - **Criteria:** CR1, CR2, CR3, CR4
  - **Resolved:** `2026-10-12T11:53:10Z`
- [x] Comparar el mínimo de la revisión a adoptar antes de sembrar o activar
  - **Target:** `src/commands/activate.mjs`
  - **Verify:** `node --test test/activate.test.mjs test/version-guard.test.mjs`
  - **Criteria:** CR1, CR2, CR3, CR4
  - **Resolved:** `2026-10-12T11:53:10Z`
- [x] Ejecutar el gate completo
  - **Verify:** `pnpm test && pnpm verify`
  - **Support:**
  - **Resolved:** `2026-10-12T11:53:11Z`

## Log
- **2026-10-12T11:14:21Z** `[version]` 0.18.0-dev
- **2026-10-12T11:14:21Z** `[status]` draft → approved (human via conversation)
- **2026-10-12T11:49:10Z** `[status]` approved → in-progress
- **2026-10-12T11:49:10Z** `[branch]` set: bug/20260925-130844 (auto)
- **2026-10-12T11:53:11Z** `[note]` Implementación delegada (subagente, tier medio), tareas 1 a 3: assertCliAdmitted en src/commands/activate.mjs lee con readStateConfigText la config de la revisión a adoptar y lanza el diagnóstico de cliVersionError antes de sembrar desde la copia remota y antes de escribir la activación (también en la reparación de una activación sin ledger_dir). Defecto reproducido: activate salía con 0 e imprimía Seeded/Activated o Repaired sobre una ref con mínimo 99.0.0. CR1-CR3 rojos y verdes, CR4 verde antes y después como guarda; los tests construyen el diagnóstico con la versión de package.json (hoy 0.18.0-dev) en vez del 0.17.0-dev de los CR. Mutantes: comprobación tras sembrar, sin comprobación en la ref existente y la reparación, leyendo la config del worktree, sin comprobación al sembrar y versión instalada fija; todos fallan. pnpm verify en verde con 1778/1778. El orquestador acotó el comentario de repoCliVersionError en src/version-guard.mjs, que decía que activate debe poder reparar una activación rota sin más: ahora dice que la alcanza y compara el mínimo de la revisión que adopta. Decisiones no especificadas: la comprobación corre en cada activate con ref local, también en el no-op Already activated; una config adoptada ilegible propaga su error; una declaración defectuosa falla cerrada con el texto de check; installedVersion es una costura de activate() que los tests no usan. Residuos: check --json y la migración a schema 6 de este repo (fuera de alcance); cutover, sync e import no se examinaron frente a la misma omisión.
- **2026-10-12T11:53:12Z** `[status]` in-progress → in-review
- **2026-10-12T11:53:16Z** `[note]` Mandato del review: la superficie que el change gobierna — dev..HEAD contra CR1-CR4 y el Plan, con las decisiones no especificadas y los residuos del Log como puntos de escrutinio. Frases cuantificadas informadas: el comentario de assertCliAdmitted («before any ref is written»: test CR1 con git for-each-ref antes y después, y mutantes M1 y M4); el comentario de los tests sobre la versión instalada (bin lee package.json); el de stateFilesWithMin (CR4 list con exit 0); el de freshClone (CR1 llega a la acción de activate); y el comentario acotado de repoCliVersionError (CR3 llega a activate y da el diagnóstico).
- **2026-10-12T11:58:58Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-10-12T11:59:02Z** `[note]` Observaciones del review para la validación y seguimiento: activate sobre una ref de estado local cuya config no se puede leer (por ejemplo, sin config.yml) pasa de escribir la activación con exit 0 a fallar sin escribir nada, también en el no-op Already activated (fail-closed, no especificado en los CR); la costura installedVersion de activate() no tiene consumidores; sync podría adoptar una revisión remota con un mínimo mayor sin esta comprobación (no examinado).
- **2026-10-12T12:03:01Z** `[validation]` in-validation → done (human accepted via conversation)
