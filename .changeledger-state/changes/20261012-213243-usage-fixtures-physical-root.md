---
id: "20261012-213243"
title: "Los fixtures de usage anuncian la forma lógica del temporal y el CLI no los casa en macOS"
type: bug
status: in-progress
created: 2026-10-12T21:32:43Z
depends_on: []
branch: bug/20261012-213243
related_to: ["20261002-133728", "20261001-155612", "20260812-022248"]
owner: rarc88
---

## Request

En GitHub Actions macOS (node 24 y 26) falla el test
`20261002-133728 CR1: with the state ref, the snapshot is its own commit that only adds its record`
de `test/agent.test.mjs`; en Linux y Windows pasa. El CI dice:

```
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ 'usage: no sessions matched this repository\n'
- ''
```

Se pide:

1. Encontrar la causa raíz sin una máquina macOS y decidir si el defecto está en
   el producto (un usuario de macOS cuyo repo vive bajo una ruta con symlink,
   como `/tmp` → `/private/tmp`, perdería sesiones) o sólo en el fixture.
2. Explicar el fallo de `20261001-155612 CR9` que reportó un contribuidor en
   macOS por el mismo `/var` frente a `/private/var`, por qué pasa en este CI y
   si está relacionado.
3. Arreglarlo de forma mínima y dejar una guarda que Linux CI ejecute.

Mapa: el punto 1 lo cubren CR1, CR2, CR3 y CR4 (CR4 fija el comportamiento del
producto); el punto 2 queda resuelto en Investigation y no lleva criterio porque
el test reportado ya no existe; el punto 3 lo cubren CR1 a CR4.

Excluido explícitamente: casar sesiones que el harness haya registrado con la
forma lógica (`$PWD`) cuando el CLI sólo conoce la física (ver Investigation,
«Lo que no se pudo determinar»), y cualquier normalización de mayúsculas o letra
de unidad en Windows: `encodeProjectPath` y la igualdad exacta no se tocan y no
hay ningún fallo observado ahí.

## Investigation

### Cómo se casan las sesiones con el repo

- `collectUsage` (`src/usage-collector.mjs`) construye
  `targets = new Set(projectPaths.map(encodeProjectPath))` y conserva una sesión
  sólo si `targets.has(session.projectPath)`: igualdad exacta sobre la cadena
  codificada (cada carácter no alfanumérico pasa a `-`, se conservan mayúsculas).
- Lado sesión: `session.projectPath` es lo que informa `ccusage`; para Claude
  Code es el nombre del directorio de proyecto ya codificado (el fixture usa
  `-home-user-repositories-demo`). La codificación es con pérdida y no es una
  ruta: no se puede pasar por `realpath`. Por eso «normalizar con realpath en
  ambos lados» no aplica; el único punto normalizable es el lado del repo.
- Lado repo: `gitContext(repoRoot, gitRun)` devuelve
  `projectPaths = [repoRoot, ...]` más cada línea `worktree <ruta>` de
  `git worktree list --porcelain`. `repoRoot` sale de `locate(cwd, id)` →
  `findChangeledgerDir(path.resolve(cwd))` → `path.dirname`: sin `realpath`. El
  módulo no usa `git rev-parse --show-toplevel`.

### De dónde sale cada forma de la ruta

Medido en Linux con `<real>` un directorio y `<link>` un symlink a él (el gemelo
POSIX de `/var` → `/private/var` en macOS):

| Fuente | Forma |
|---|---|
| `os.tmpdir()` / `fs.mkdtempSync` con `TMPDIR=<link>` | lógica (`<link>/…`) |
| `process.cwd()` de un hijo lanzado con `cwd: <link>/repo` (getcwd) | física (`<real>/repo`) |
| `process.cwd()` tras `cd <link>/repo` en la shell | física (`<real>/repo`) |
| `git worktree list --porcelain` desde `<link>/repo` | física para el principal y para un worktree añadido como `<link>/repo-wt` |
| `git rev-parse --git-common-dir` desde `<link>/repo` | `.git` (relativa) |
| `git rev-parse --git-common-dir` desde el worktree enlazado | `<real>/repo/.git` (absoluta, física) |

Consecuencia para el conjunto `targets`:

- Llamada in-process con `cwd` lógico (lo que hacen los tests in-process):
  `{lógica (repoRoot), física (git)}`. Casa las dos formas: medido con
  `snapshotUsage({ repoRoot: <link>/demo, … })`, cero avisos anunciando la
  sesión con cualquiera de las dos.
- CLI: `repoRoot` sale de `process.cwd()`, que ya es física, y git también:
  `{física}`. Anunciando la sesión con la forma lógica, `changeledger new` en
  `<link>/demo` imprime `usage: no sessions matched this repository` y su
  registro guarda `sessions: []`; anunciándola con la física, ningún aviso y una
  sesión.

### Causa raíz

El defecto está en el fixture, no en el producto. `usageRepo` →
`repoWithChange` (`test/agent.test.mjs`) crea la raíz con
`fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-agent-'))`, que en macOS
devuelve la forma lógica `/var/folders/…/T/…`. El test anuncia la sesión con
`FAKE_CCUSAGE_ROOT: encodeProjectPath(root)` (forma lógica) y lanza el CLI con
`runUsageBin([...], root)`; el hijo ve `process.cwd()` = `/private/var/folders/…`
y git también devuelve `/private/…`, así que ningún target es igual al
`projectPath` anunciado. `collectUsage` añade
`usage: no sessions matched this repository`, `snapshotUsage` lo escribe en
stderr y `assert.equal(out.err, '')` falla.

- Linux: `/tmp` no es symlink; las dos formas coinciden.
- Windows: `os.tmpdir()` es `C:\Users\RUNNER~1\AppData\Local\Temp` (forma corta
  8.3, visible en el log del job Windows) y el cwd de Windows conserva la forma
  con la que se lanzó el hijo, así que `repoRoot` del CLI coincide con la forma
  anunciada y el test pasa.
- Los tests in-process (`20261001-155612 CR3`, `CR4`, …) pasan en macOS porque
  `repoRoot` es la misma forma lógica que el test anuncia.

### Gemelo enmascarado

`20261002-133728 CR2: in the worktree layout the record lands in .changeledger/usage`
monta exactamente lo mismo por CLI pero no comprueba ni stderr ni
`record.sessions`, así que pasa en macOS con un registro vacío. Medido en una
copia con `assert.equal(record.sessions.length, 1)` añadido y `TMPDIR=<link>`:
falla con `actual: 0`; con la raíz realpath-eada, pasa.

### El fallo reportado de `20261001-155612 CR9`

El test original (commit `88a3ee01`,
`20261001-155612 CR9: records of root and worktree share the git common dir, outside the ledger`)
comparaba
`path.join(gitCommonDir(worktree), 'changeledger', 'usage', id)` con
`path.join(path.resolve(root, common), …)`, donde `common` era
`git rev-parse --git-common-dir` desde la raíz. Según la tabla, desde la raíz
git responde `.git` (relativa, se resuelve contra la forma lógica) y desde el
worktree enlazado responde la ruta absoluta física: en macOS
`/var/…/.git` ≠ `/private/var/…/.git`. Es la misma clase (forma cruda del
temporal frente a la forma física de git/getcwd) con otra aserción.
`20261002-133728` (commit `93d00baf`) movió los registros al ledger y sustituyó
ese test por
`20261002-133728: a linked worktree records into the ledger it works on`, que
lee los registros por `ledgerUsageRecords` y no compara cadenas de ruta: por eso
pasa en este CI. No requiere acción.

### Precedente

`20260812-022248` (CR2, «Los fixtures nacen en realpath») puso
`fs.realpathSync.native` en el asiento único `initStateRepo` de
`test/helpers/state-repo.mjs` por esta misma clase (symlink en macOS, 8.3 en
Windows). `repoWithChange` de `test/agent.test.mjs` es un segundo asiento que no
lo adoptó. El comentario de `gitTopLevelDir` en `src/state-store.mjs` documenta
la misma diferencia `/var` frente a `/private/var`.

### Reproducción en Linux

Con `<link>` → `<real>` bajo el scratchpad:

```
TMPDIR=<link> CHANGELEDGER_NO_GH=1 node scripts/run-tests.mjs
```

da `ℹ tests 2000`, `ℹ pass 1999`, `ℹ fail 1`, y el único fallo es
`20261002-133728 CR1: with the state ref, the snapshot is its own commit that only adds its record`
con `actual: 'usage: no sessions matched this repository\n'`: el mismo resultado
que el job macOS. Sin `TMPDIR`, el test pasa. Con `repoWithChange` cambiado a
`fs.realpathSync.native(fs.mkdtempSync(…))` en una copia de `HEAD`,
`node --test test/agent.test.mjs` da `ℹ pass 181`, `ℹ fail 0` con y sin
`TMPDIR=<link>`.

### Lo que no se pudo determinar

- Qué forma escribe Claude Code (u otra fuente de `ccusage`) en macOS cuando la
  sesión arranca bajo un symlink. Si toma el cwd de `process.cwd()` (getcwd),
  escribe la física y el CLI ya la casa (CR4). Si escribiera la lógica (`$PWD`),
  el CLI la perdería y haría falta otro change con un caso observado; la
  comprobación es `ls ~/.claude/projects | grep -- -private-` en un Mac tras
  abrir Claude Code en `/tmp/<dir>`.
- No se ejecutó en Windows. El asiento `initStateRepo` ya usa
  `fs.realpathSync.native` y pasa en Windows CI; se asume lo mismo para
  `repoWithChange`, que hereda el mismo patrón.
- El commit que ejecutó el CI (`abac9266…`, merge de la PR 8) no está en este
  clon; el test falla en la línea 3048 allí y en la 3542 aquí, pero el cuerpo y
  el mecanismo son los mismos.

Interfaces externas: la codificación de `projectPath` de `ccusage`/Claude Code
sigue sin documentarse en upstream y este change no depende de nada nuevo; los
tests usan el fake `test/fixtures/ccusage/fake-ccusage.mjs`.

## Specification

En los criterios, `<real>` es un directorio creado por el test y `<link>` un
symlink a él; `<id>` es el id del change del fixture.

### CR1 — El asiento de repoWithChange nace en realpath nativo
- **Given** `os.tmpdir()` devuelve `<link>` porque `TMPDIR=<link>`
- **When** `repoWithChange` de `test/agent.test.mjs` (y por tanto `usageRepo`) crea un repo
- **Then** la raíz devuelta es igual a `fs.realpathSync.native(root)` y empieza por `<real>`, no por `<link>`

### CR2 — El CLI casa la sesión que el test anuncia aunque el temporal sea un symlink
- **Given** `TMPDIR=<link>` y el test `20261002-133728 CR1: with the state ref, the snapshot is its own commit that only adds its record`
- **When** se ejecuta `TMPDIR=<link> CHANGELEDGER_NO_GH=1 node --test --test-name-pattern="20261002-133728 CR(1|2): (with the state ref|in the worktree layout)" test/agent.test.mjs`
- **Then** los dos tests salen `✔` y la línea de resumen es `ℹ fail 0`
- **And** sin el cambio de CR1 el mismo comando da `✖` en CR1 con `actual: 'usage: no sessions matched this repository\n'`

### CR3 — El test de la capa worktree ya no enmascara una sesión perdida
- **Given** `20261002-133728 CR2: in the worktree layout the record lands in .changeledger/usage`
- **When** `changeledger status <id> in-progress` corre por CLI con `FAKE_CCUSAGE_ROOT: encodeProjectPath(root)`
- **Then** el test exige `out.err === ''` y `record.sessions.length === 1`
- **And** con `TMPDIR=<link>` y sin el cambio de CR1 el test falla con `actual: 0`

### CR4 — Primer uso real de un repo alcanzado por un symlink
- **Given** en POSIX (el test se salta en `win32`) un repo git con ChangeLedger iniciado en `<link>/demo`, `git config changeledger.usage.collector ccusage`, `CHANGELEDGER_USAGE_COMMAND` apuntando a `test/fixtures/ccusage/fake-ccusage.mjs` y `FAKE_CCUSAGE_ROOT` igual a `encodeProjectPath` de `<real>/demo` (la forma que getcwd da a un proceso arrancado en `<link>/demo`)
- **When** desde `<link>/demo` se ejecuta `changeledger new quick second-step "Segundo paso" --owner t`, se rellena `## Request`, `changeledger approve <id>`, `git checkout -b quick/<id>` y `changeledger status <id> in-progress`
- **Then** los tres comandos salen con código 0 y ninguno escribe una línea que empiece por `usage:`
- **And** `approve` imprime `#<id> → approved (human via conversation)` y `status` imprime `#<id> → in-progress` en stdout con stderr vacío
- **And** `.changeledger/usage/` guarda tres registros de `<id>`: `created` `null` → `draft`, `status` `draft` → `approved` y `status` `approved` → `in-progress`, cada uno con `sessions.length === 1` y `error: null`

## Plan

- [x] Escribir en rojo la aserción de sesiones y stderr del test de la capa
  worktree y comprobar que falla con `TMPDIR=<link>`
  - **Target:** `test/agent.test.mjs`
  - **Verify:** `TMPDIR=<link> CHANGELEDGER_NO_GH=1 node --test --test-name-pattern="20261002-133728 CR(1|2): (with the state ref|in the worktree layout)" test/agent.test.mjs`
  - **Criteria:** CR3
  - **Resolved:** `2026-10-12T21:43:45Z`
- [ ] Realpath nativo en el asiento de `repoWithChange`, con un comentario que
  cite `20260812-022248` CR2 como en `initStateRepo`
  - **Target:** `test/agent.test.mjs`
  - **Verify:** `TMPDIR=<link> CHANGELEDGER_NO_GH=1 node --test test/agent.test.mjs`
  - **Criteria:** CR1, CR2, CR3
- [ ] Test de extremo a extremo por CLI en un repo bajo un symlink propio del
  test (no a través de `os.tmpdir()`), saltado en `win32`
  - **Target:** `test/agent.test.mjs`
  - **Verify:** `CHANGELEDGER_NO_GH=1 node --test --test-name-pattern="CR4" test/agent.test.mjs`
  - **Criteria:** CR4
- [ ] Ejecutar la suite completa con el temporal por symlink y la puerta de
  calidad
  - **Support:**
  - **Verify:** `pnpm verify`

## Log
- **2026-10-12T21:32:43Z** `[version]` 0.18.0-dev
- **2026-10-12T21:35:32Z** `[status]` draft → approved (human via conversation)
- **2026-10-12T21:35:37Z** `[status]` approved → in-progress
- **2026-10-12T21:35:37Z** `[branch]` set: bug/20261012-213243 (auto)
- **2026-10-12T21:43:44Z** `[note]` Implementación: repoWithChange nace en fs.realpathSync.native; el test 20261002-133728 CR2 (capa worktree) afirma ahora una sesión y stderr vacío; tests nuevos 20261012-213243 CR1 (guard del asiento, saltado en win32) y CR4 (extremo a extremo por CLI desde un symlink propio, saltado en win32). Reproducción en Linux con TMPDIR=<symlink>: antes 179 pass y 2 fail en agent.test.mjs con «usage: no sessions matched this repository», después 181/181; suite completa con TMPDIR por symlink 2002/2002; pnpm verify en verde (2002). Mutantes M1-M3 caen. Decisiones: CR4 compara los tres registros como conjunto ordenado porque los registros del mismo segundo comparten instante; se añadió el guard de CR1 como test propio. Residuos: una sesión registrada con la forma lógica (/home/rarc88/repositories/changeledger) sigue sin casar (exclusión del Request); no ejecutado en macOS ni Windows reales; otros fixtures con fs.mkdtempSync(os.tmpdir()) no se auditaron.
