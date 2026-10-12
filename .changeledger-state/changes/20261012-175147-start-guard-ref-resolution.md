---
id: "20261012-175147"
title: La guarda de arranque resuelve las ramas por nombre ambiguo y sólo en local
type: bug
status: in-progress
created: 2026-10-12T17:51:47Z
depends_on: []
branch: bug/20261012-175147
related_to: ["20261002-204623", "20261002-181346", "20261002-181428", "20260731-161655", "20260811-151426", "20260811-163203", "20260811-163204", "20261002-152923", "20261012-174407"]
owner: rarc88
---

## Request

La guarda de `changeledger status <id> in-progress` (`#20261002-204623`) deja
arrancar ramas que llevan trabajo de integración sin publicar. Un revisor
confirmó dos agujeros, y los dos comparten superficie: cómo resuelve la guarda
las ramas que compara.

1. **Sólo mira la rama de integración local.** Con `dev` local igual a `main` y
   `origin/dev` por delante con un commit que no está en `main`, una rama
   `hotfix/<id>` creada desde `origin/dev` arranca (código 0), aunque lleva a
   producción trabajo de `dev` aún sin publicar.
2. **Resuelve nombres ambiguos.** Git resuelve `dev` como `refs/tags/dev` antes
   que `refs/heads/dev`. Una etiqueta con el nombre de una rama
   (`git tag dev main`) desvía la comparación y la guarda deja pasar la rama. Las
   comprobaciones de ascendencia previas (`must descend from integration
   branch`) tienen el mismo problema.

Se pide que la guarda compare siempre con las ramas, nunca con otra ref del mismo
nombre, y que, para un tipo que se integra en la rama de release, compare también
con la copia remote-tracking de `git.integration_branch` del remoto que ya
resuelve el repo, sin tocar la red. Cuando no pueda decidir, falla cerrada con un
mensaje que diga qué hacer, como en `#20261002-204623`.

Fuera de alcance (no se cambia, sólo se declara):

- Que la guarda entera se salte cuando `git.change_branch_format` es `null` o
  falta. Es intencionado: lo dice la spec `git-traceability` («La ausencia o
  `null` de `change_branch_format` desactivan esta comprobación entera») y lo fija
  el test `161655 CR7: integration branch alone keeps lifecycle branch checks
  disabled`. CR18 sólo asegura que el cambio nuevo no lo altera.
- La copia remote-tracking de la rama de release: la base sigue siendo
  `git.release_branch` local.
- Hacer `fetch`: la guarda sólo ve lo que dejó el último `fetch`.
- Otros consumidores de nombres de rama: la base por defecto de `check --commits`
  (la trata `#20261012-174407`), `cutover` y `checkoutBranch` (ver
  Investigation, «Fuera de este change»).
- Trabajo traído con cherry-pick: sigue sin detectarse, como declara la spec.

## Investigation

**Causa raíz.** `assertImplementationBranch` (`src/commands/agent.mjs`, llamada
desde `statusMutation`, que comparten `status` y `apply`) pasa a git los valores
de configuración tal cual:

- `isAncestor(repoRoot, baseline, 'HEAD', gitRun)`, donde `baseline =
  changeIntegrationBranch(config, change.type)` (`src/config.mjs`).
- `mergeBases(repoRoot, 'HEAD', integration, gitRun)` y
  `refExists(repoRoot, integration, gitRun)`, donde `integration =
  integrationBranch(config)`.
- `isAncestor(repoRoot, base, baseline, gitRun)` para cada base de fusión.

`isAncestor`, `mergeBases` y `refExists` (`src/git.mjs`) ejecutan
`merge-base --is-ancestor`, `merge-base --all` y `rev-parse --verify --quiet
<ref>^{commit}`. Git resuelve un nombre corto con las reglas de
`gitrevisions(7)`, en este orden: `$GIT_DIR/<n>`, `refs/<n>`, `refs/tags/<n>`,
`refs/heads/<n>`, `refs/remotes/<n>` y `refs/remotes/<n>/HEAD`. Por eso
`refs/tags/dev` y `refs/dev` tapan a `refs/heads/dev`; git sólo avisa por stderr
(`warning: refname 'dev' is ambiguous.`) y `defaultRun` descarta stderr. Además,
`integration` sólo se busca en local: nada consulta
`refs/remotes/<remoto>/<integration>`.

**Reproducción.** Hecha con la CLI en la base `dev` @ `0e7a5cc9`, con fixtures
desechables (scripts `guard-fixture.sh`, `guard-scenarios.sh` y
`guard-remote-edges.sh` del scratchpad de la investigación). Configuración:
`integration_branch: dev`, `release_branch: main`, `change_branch_format:
"{type}/{id}"`, el tipo `hotfix` de la plantilla (`integrates_into: release`), un
remoto `origin` bare y un hotfix y un bug aprobados.

| Caso | Rama | Hoy |
| --- | --- | --- |
| `dev` = `main` en local; `origin/dev` con un commit más, empujado desde otro clon y traído con `fetch` | `hotfix/<id>` desde `origin/dev` | código 0, `in-progress` (agujero 1) |
| igual | `hotfix/<id>` desde `main` | código 0 (correcto) |
| `dev` local por delante, sin etiqueta | `hotfix/<id>` desde `dev` | `contains commits of "dev" that are not in "main"` |
| igual + `git tag dev main` | desde `refs/heads/dev` | código 0 (agujero 2) |
| igual + `git tag main <punta de dev>` | desde `refs/heads/dev` | código 0 |
| `main` por delante de `dev` + `git tag main <punta de dev>` | desde `refs/heads/dev` | sin etiqueta, `must descend from integration branch "main"`; con ella, código 0 |
| `dev` por delante + `git update-ref refs/dev main` | desde `refs/heads/dev` | código 0 |
| `dev` por delante + `git tag dev main`, change `bug` | `bug/<idb>` desde `main` | sin etiqueta, `must descend from integration branch "dev"`; con ella, código 0 |
| remotos `fork` y `upstream`, sin `origin` | `hotfix/<id>` desde `main` | código 0 |
| sin `dev` local, `origin/dev` por delante | desde `main` | `cannot start: integration branch "dev" does not exist locally — …` |
| `origin/dev` sin historia común | desde `main` | código 0 (no la mira) |

**Prototipo.** Apliqué el diseño de abajo a una copia desechable de `src/`. Ahí
cada fila se comporta como dicen los CR, y `node --test test/agent.test.mjs
test/sync.test.mjs test/activate.test.mjs` pasa entero (218/218), incluidos todos
los tests `204623`, `181346` y `161655` sin tocarlos. Con `GIT_TRACE`, el
arranque sólo ejecutó `branch`, `check-ref-format`, `config`, `merge-base`,
`remote` (el listado) y `rev-parse`: ni `fetch` ni `ls-remote`.

**Inventario de nombres de rama pasados a git en `src/`.**

| Sitio | Qué pasa | Decisión |
| --- | --- | --- |
| `assertImplementationBranch` (`src/commands/agent.mjs`) | `baseline` e `integration` a `isAncestor`, `mergeBases` y `refExists` | **Cualificar** como `refs/heads/<nombre>`; la copia remota, como `refs/remotes/<remoto>/<nombre>` |
| `checkCommits` (`src/commands/check.mjs`) | `${base}..HEAD`, con `<base>` explícita, `git.integration_branch` o `defaultBaseBranch` | Fuera: una `<base>` explícita es una revisión libre y debe seguir siéndolo; la base por defecto la rediseña `#20261012-174407`. Es lint, no guarda de arranque |
| `defaultBaseBranch` (`src/git.mjs`) | `rev-parse --verify main/master` | Fuera, por el mismo motivo |
| `resolveContext` (`src/commands/cutover.mjs`) | compara el texto de `rev-parse --abbrev-ref HEAD` con el nombre configurado; no pasa el nombre a git | Fuera; ver abajo |
| `transversalPolicy` (`src/commands/context.mjs`) | sólo imprime nombres | Nada que hacer |
| `state-store`, `sync`, `cutover` (`isAncestor`) | OIDs y refs ya cualificadas | Nada que hacer |

**Diseño.**

1. **Cualificar.** Dentro de la guarda, toda rama configurada se pasa a git como
   `refs/heads/<nombre>`. Los mensajes siguen nombrando la rama corta (`"dev"`,
   `"main"`), así que los textos de `#20261002-204623` y `#20261002-181346` no
   cambian. De paso, un valor que empiece por `-` deja de poder leerse como
   opción.
2. **Copia remota.** Sólo en la comprobación de `#20261002-204623`, es decir,
   cuando `git.integration_branch` está declarada y difiere de la rama de
   integración del change. El remoto lo elige `resolveRemote`
   (`src/commands/sync.mjs`, el mismo que usan `sync` y `activate`): `origin` si
   existe, si no el único remoto, `null` sin remotos, y error si hay varios y
   ninguno es `origin`. Las candidatas son `refs/heads/<integración>` (nombre
   `"<integración>"`) y, con remoto, `refs/remotes/<remoto>/<integración>` (nombre
   `"<remoto>/<integración>"`). Se comprueban las que existen, en ese orden, con
   la regla de bases de fusión de siempre, y el primer fallo se informa con el
   nombre de esa candidata.
3. **Ausencias.**
   - Si falta la copia remote-tracking pero existe la local, se compara sólo con
     la local: un remoto puede no publicar `dev`, y exigirla bloquearía para
     siempre.
   - Si falta la local pero existe la remote-tracking, se compara con ésta. Hoy
     eso falla cerrada; con la copia hay contra qué comparar.
   - Si no existe ninguna de las dos, se mantiene el mensaje actual, sin cambios.
4. **Ambigüedad de remoto: falla cerrada.** `resolveRemote` recibe un tercer
   parámetro con lo que se busca (por defecto `the state ref`, así que el mensaje
   de `sync` y `activate` no cambia). La guarda pasa `integration branch
   "<integración>"` y antepone `branch "<rama>" cannot start: `. Los tipos de
   integración no resuelven remoto.
5. **Sin red.** Sólo se leen refs locales. Residual declarado: el trabajo empujado
   al remoto después del último `fetch` no se ve.

Alternativas descartadas:

- `fetch` dentro de `status`: añade red y latencia a una transición local, en
  contra de `INTENT.md` (núcleo local-first).
- Exigir que `dev` local contenga a `origin/dev`: obliga a actualizar `dev` para
  arrancar un hotfix y no añade seguridad sobre comparar con la copia.
- Comparar con las copias de todos los remotos: el `dev` de un fork ajeno puede
  divergir a propósito y rechazaría hotfixes correctos.
- Ante remotos ambiguos, comparar sólo en local, como hace `publishedTrackingRef`
  en `sync` (`#20261002-152923`): allí es un aviso; aquí sería abrir la guarda en
  silencio.

**Falsos positivos aceptados (falla cerrada).** Si `origin/main` ya integró `dev`
pero `main` local va por detrás, un hotfix creado desde `origin/main` se rechaza
con `contains commits of "origin/dev" that are not in "main"`. Se arregla
avanzando `main` local. Se consideró aceptar bases contenidas en
`origin/main`, pero no se incluye (ver preguntas abiertas).

**Interfaces externas.** Este change depende de `git merge-base --is-ancestor`
(código de salida), `git merge-base --all` (un OID por línea), `git rev-parse
--verify --quiet <ref>^{commit}` (código de salida) y `git remote` (un nombre por
línea, ordenado alfabéticamente; medido con git 2.53: `fork`, `upstream`). Las
tres primeras son plumbing estable para consumo automático. La salida de `git
remote` ya la consume `resolveRemote` y su orden es el del mensaje de CR8. La
resolución de refs cualificadas no depende de la plataforma, y `execFileSync`
pasa argumentos sin shell. Sigue sin determinarse el plegado de mayúsculas de
refs sueltas en sistemas de archivos que no distinguen mayúsculas (Windows,
macOS): es preexistente y este change no lo altera.

**Fuera de este change (hallazgos laterales).**

- `checkoutBranch` (`src/git.mjs`, `rev-parse --abbrev-ref HEAD`) devuelve
  `heads/dev` cuando una etiqueta se llama como la rama (medido: `branch
  --show-current` da `dev` y `abbrev-ref` da `heads/dev`). Si existiera una
  etiqueta `hotfix/<id>`, el registro automático de `branch` y el aviso de deriva
  verían `heads/hotfix/<id>`.
- `resolveContext` de `cutover` rechazaría la operación en esa situación con
  `currently on "heads/dev"`. Falla cerrada, pero con un mensaje engañoso.
- Pide decisión humana un `git.integration_branch` con forma de ref remota
  (`origin/dev`). Hoy funciona en la guarda porque git cae en
  `refs/remotes/origin/dev`. Con la cualificación, falla cerrada
  (`must descend from integration branch "origin/dev"`). La spec la define como
  rama, `cutover` ya exige que coincida con la rama del checkout y `context` la
  publica como rama de la que partir, así que no se considera un valor soportado.

**Changes relacionados.**

- `#20261002-204623` introdujo la comprobación y anotó en su Log, como
  seguimiento, el sombreado por etiquetas.
- `#20261002-181346` y `#20261002-181428` definieron las ramas por tipo y el tipo
  `hotfix`.
- `#20260731-161655` definió `change_branch_format` y la guarda de rama.
- `#20260811-151426` (`resolveRemote`), `#20260811-163203` (`activate` lo
  reutiliza), `#20260811-163204` y `#20261002-152923` sentaron el tratamiento de
  remotos ambiguos y de copias remote-tracking sin `fetch`.
- `#20261012-174407` rediseña la base de `check --commits`.

Todos los anteriores, salvo `#20261012-174407`, están `done`. Ninguno es
prerrequisito de ejecución, así que todos van en `related_to` y `depends_on`
queda vacío. `#20261012-174407` (draft) toca `src/commands/check.mjs`, no estos
archivos.

## Specification

Fixture común, salvo que el CR diga otra cosa:

- Configuración: `git.integration_branch: dev`, `git.release_branch: main`,
  `git.change_branch_format: "{type}/{id}"`.
- Tipos: `hotfix` con `integrates_into: release` y `bug` sin `integrates_into`.
- Git: un remoto `origin` (repo bare) al que se empujaron `main` y `dev`, ambas
  en el mismo commit.
- Changes: un `hotfix` aprobado `<id>` y un `bug` aprobado `<idb>`.

«Falla» significa que `changeledger status` termina con código distinto de 0,
imprime `Error: <mensaje>` y deja el documento del change byte a byte igual. Los
tests pueden usar los tipos del fixture existente (`fix` de release, `feature`
de integración): la guarda depende del rol, y el nombre de la rama del mensaje
sigue al tipo.

### CR1 — Primer uso: un hotfix correcto desde main arranca
- **Given** el fixture común con un commit `feat: dev work` en `dev`, empujado a `origin` y traído con `git fetch origin`, de modo que `dev` y `origin/dev` van por delante de `main`
- **When** se ejecuta `git checkout -b hotfix/<id> main` y después `changeledger status <id> in-progress`
- **Then** termina con código 0 e imprime `#<id> → in-progress`
- **And** el frontmatter del change tiene `status: in-progress` y `branch: hotfix/<id>`
- **And** el Log añade `` `[status]` approved → in-progress `` y `` `[branch]` set: hotfix/<id> (auto) ``

### CR2 — Una copia remote-tracking por delante bloquea el arranque
- **Given** el fixture común con `dev` local en el mismo commit que `main`, y `origin/dev` con un commit `feat: dev work` que no está en `main`, empujado desde otro clon y traído con `git fetch origin`
- **When** se ejecuta `git checkout -b hotfix/<id> origin/dev` y después `changeledger status <id> in-progress`
- **Then** falla con `branch "hotfix/<id>" contains commits of "origin/dev" that are not in "main"`

### CR3 — La rama local se comprueba antes que la copia remota
- **Given** el fixture común con un commit en `dev` empujado a `origin` y traído, de modo que `dev` y `origin/dev` coinciden por delante de `main`
- **When** se crea `hotfix/<id>` desde `dev` y se ejecuta `changeledger status <id> in-progress`
- **Then** falla con `branch "hotfix/<id>" contains commits of "dev" that are not in "main"`

### CR4 — Un remoto sin copia de la rama de integración no bloquea
- **Given** el fixture común tras `git push origin --delete dev` y `git fetch --prune origin` (no existe `refs/remotes/origin/dev`), y un commit en `dev` local que no está en `main`
- **When** se crea `hotfix/<id>` desde `main` y se ejecuta `changeledger status <id> in-progress`
- **Then** termina con código 0 y el change queda `in-progress`
- **And** en el mismo repo, una `hotfix/<id>` creada desde `dev` falla con `branch "hotfix/<id>" contains commits of "dev" that are not in "main"`

### CR5 — Sin rama de integración local, se compara con su copia remote-tracking
- **Given** el fixture común con un commit en `dev` empujado a `origin` y traído, y después `git branch -D dev` (sólo queda `refs/remotes/origin/dev`, por delante de `main`)
- **When** se crea `hotfix/<id>` desde `main` y se ejecuta `changeledger status <id> in-progress`
- **Then** termina con código 0 y el change queda `in-progress`
- **And** en el mismo repo, una `hotfix/<id>` creada desde `origin/dev` falla con `branch "hotfix/<id>" contains commits of "origin/dev" that are not in "main"`

### CR6 — Sin rama de integración local ni remota, falla cerrada como hoy
- **Given** el fixture común tras `git push origin --delete dev`, `git fetch --prune origin` y `git branch -D dev`
- **When** se crea `hotfix/<id>` desde `main` y se ejecuta `changeledger status <id> in-progress`
- **Then** falla con `branch "hotfix/<id>" cannot start: integration branch "dev" does not exist locally — create it (e.g. from its remote-tracking copy) before starting`

### CR7 — Sin remotos, el comportamiento no cambia
- **Given** un repo sin ningún remoto configurado
- **When** se ejecutan los tests existentes `204623 CR1`–`CR5`, `204623: a missing release branch ref still fails the ancestry check`, `204623: an integration branch absent locally fails closed and says so`, `204623: an integration branch with unrelated history fails closed and says so`, `181346 CR3`–`CR5` y `161655 CR5` de `test/agent.test.mjs`
- **Then** todos pasan sin modificar ni su fixture ni sus aserciones

### CR8 — Varios remotos sin origin: falla cerrada
- **Given** el fixture común tras `git remote rename origin upstream` y `git remote add fork <ruta del bare>` (remotos `fork` y `upstream`, ninguno `origin`)
- **When** se crea `hotfix/<id>` desde `main` y se ejecuta `changeledger status <id> in-progress`
- **Then** falla con `branch "hotfix/<id>" cannot start: cannot decide which remote holds integration branch "dev": this repo configures fork, upstream and none is "origin"`
- **And** `resolveRemote(<raíz>, defaultRun)` sin tercer argumento, en el mismo repo, sigue lanzando `cannot decide which remote holds the state ref: this repo configures fork, upstream and none is "origin"`, y el test `20260811-163204: --status answers in an ambiguous multi-remote repo` de `test/sync.test.mjs` pasa sin cambios

### CR9 — Los tipos de integración no resuelven remoto
- **Given** el repo de CR8 (remotos `fork` y `upstream`, ninguno `origin`)
- **When** se crea `bug/<idb>` desde `dev` y se ejecuta `changeledger status <idb> in-progress`
- **Then** termina con código 0 y el change queda `in-progress`

### CR10 — La guarda no usa la red
- **Given** el fixture común con la URL de `origin` cambiada a `/nonexistent/remote.git` y `refs/remotes/origin/dev` fijada con `git update-ref` a un commit `C` hijo de `main` que no está en ninguna rama local
- **When** se crea `hotfix/<id>` desde `main` y se ejecuta `status(<id>, 'in-progress', <raíz>, { gitRun })` con un `gitRun` que delega en `defaultRun` y registra cada invocación
- **Then** termina sin error y el change queda `in-progress`
- **And** ninguna invocación registrada tiene `fetch`, `ls-remote`, `pull` ni `remote update` como subcomando, y la única con subcomando `remote` es exactamente `['remote']`
- **And** en el mismo repo, una `hotfix/<id>` creada desde `C` falla con `branch "hotfix/<id>" contains commits of "origin/dev" that are not in "main"`

### CR11 — Copia remote-tracking sin historia común
- **Given** el fixture común con `refs/remotes/origin/dev` fijada con `git update-ref` a un commit huérfano (`git commit-tree` sobre el árbol vacío)
- **When** se crea `hotfix/<id>` desde `main` y se ejecuta `changeledger status <id> in-progress`
- **Then** falla con `branch "hotfix/<id>" cannot start: it shares no history with integration branch "origin/dev"`

### CR12 — Una etiqueta con el nombre de la rama de integración no la sustituye
- **Given** el fixture común con un commit en `dev` local que no está en `main` ni en `origin`, y `git tag dev main`
- **When** se crea `hotfix/<id>` desde `refs/heads/dev` y se ejecuta `changeledger status <id> in-progress`
- **Then** falla con `branch "hotfix/<id>" contains commits of "dev" that are not in "main"`

### CR13 — Una etiqueta con el nombre de la rama de release no la sustituye
- **Given** el fixture común con un commit en `dev` local que no está en `main` ni en `origin`, y `git tag main refs/heads/dev`
- **When** se crea `hotfix/<id>` desde `refs/heads/dev` y se ejecuta `changeledger status <id> in-progress`
- **Then** falla con `branch "hotfix/<id>" contains commits of "dev" that are not in "main"`

### CR14 — La comprobación de ascendencia de un tipo de release resuelve la rama
- **Given** el fixture común con un commit `chore: release` en `main` que no está en `dev`, y `git tag main refs/heads/dev`
- **When** se crea `hotfix/<id>` desde `refs/heads/dev` y se ejecuta `changeledger status <id> in-progress`
- **Then** falla con `branch "hotfix/<id>" must descend from integration branch "main"`

### CR15 — La comprobación de ascendencia de un tipo de integración resuelve la rama
- **Given** el fixture común con un commit en `dev` local que no está en `main`, y `git tag dev refs/heads/main`
- **When** se crea `bug/<idb>` desde `refs/heads/main` y se ejecuta `changeledger status <idb> in-progress`
- **Then** falla con `branch "bug/<idb>" must descend from integration branch "dev"`

### CR16 — Una ref fuera de refs/tags con el nombre de la rama tampoco la sustituye
- **Given** el fixture común con un commit en `dev` local que no está en `main` ni en `origin`, y `git update-ref refs/dev refs/heads/main`
- **When** se crea `hotfix/<id>` desde `refs/heads/dev` y se ejecuta `changeledger status <id> in-progress`
- **Then** falla con `branch "hotfix/<id>" contains commits of "dev" that are not in "main"`

### CR17 — Una etiqueta con el nombre de la copia remota no la sustituye
- **Given** el repo de CR2 y además `git tag origin/dev main`
- **When** se crea `hotfix/<id>` desde `refs/remotes/origin/dev` y se ejecuta `changeledger status <id> in-progress`
- **Then** falla con `branch "hotfix/<id>" contains commits of "origin/dev" that are not in "main"`

### CR18 — Sin change_branch_format la guarda sigue desactivada
- **Given** el fixture común con `git.change_branch_format: null`, los remotos de CR8 (`fork` y `upstream`, ninguno `origin`) y un commit en `dev` local que no está en `main`
- **When** se crea `hotfix/<id>` desde `refs/heads/dev` y se ejecuta `changeledger status <id> in-progress`
- **Then** termina con código 0 y el change queda `in-progress`: ni la resolución de ramas ni la de remoto se ejecutan

## Plan

- [x] Tests en rojo de la resolución de refs (etiquetas y refs que tapan a
  `refs/heads/<rama>` y a la copia remota)
  - **Target:** `test/agent.test.mjs`
  - **Verify:** `node --test test/agent.test.mjs`
  - **Criteria:** CR12, CR13, CR14, CR15, CR16, CR17
  - **Resolved:** `2026-10-12T19:46:47Z`
- [x] Cualificar como `refs/heads/<nombre>` toda rama configurada que
  `assertImplementationBranch` pasa a `isAncestor`, `mergeBases` y `refExists`,
  manteniendo el nombre corto en los mensajes
  - **Target:** `src/commands/agent.mjs`
  - **Verify:** `node --test test/agent.test.mjs`
  - **Criteria:** CR12, CR13, CR14, CR15, CR16
  - **Resolved:** `2026-10-12T19:46:47Z`
- [x] Tests en rojo de la copia remote-tracking, ausencias, remotos ambiguos, sin
  red, y regresiones de los tests existentes
  - **Target:** `test/agent.test.mjs`
  - **Verify:** `node --test test/agent.test.mjs`
  - **Criteria:** CR1, CR2, CR3, CR4, CR5, CR6, CR7, CR8, CR9, CR10, CR11, CR18
  - **Resolved:** `2026-10-12T19:46:47Z`
- [x] Parámetro opcional de `resolveRemote` con lo que se busca (por defecto
  `the state ref`)
  - **Target:** `src/commands/sync.mjs`
  - **Verify:** `node --test test/sync.test.mjs test/activate.test.mjs test/agent.test.mjs`
  - **Criteria:** CR8
  - **Resolved:** `2026-10-12T19:46:48Z`
- [ ] Comparar también con `refs/remotes/<remoto>/<integración>` en la
  comprobación de los tipos de release, con candidatas ausentes, remoto ambiguo y
  orden local-antes-que-remota como en la Specification, y reescribir los
  comentarios de la guarda y de `mergeBases`/`refExists` para que no afirmen más
  de lo que se impone
  - **Target:** `src/commands/agent.mjs`
  - **Verify:** `node --test test/agent.test.mjs`
  - **Criteria:** CR1, CR2, CR3, CR4, CR5, CR6, CR7, CR9, CR10, CR11, CR17, CR18
- [ ] Gate completo: `biome check`, `node --test` y `changeledger check` (o
  `pnpm verify` si la versión de pnpm lo permite)
  - **Support:**
  - **Verify:** `pnpm verify`

## Log
- **2026-10-12T17:51:47Z** `[version]` 0.18.0-dev
- **2026-10-12T17:58:21Z** `[status]` draft → approved (human via conversation)
- **2026-10-12T19:29:37Z** `[status]` approved → in-progress
- **2026-10-12T19:29:37Z** `[branch]` set: bug/20261012-175147 (auto)
- **2026-10-12T19:46:46Z** `[note]` Implementación: branchRef cualifica como refs/heads/<nombre> cada rama configurada que la guarda pasa a isAncestor, mergeBases y refExists (mensajes con el nombre corto); integrationCopies compara la rama de integración local y después su copia remote-tracking del remoto que elige resolveRemote (tercer parámetro opcional, mensajes de sync/activate intactos), salta la ausente, falla cerrada sin ninguna y con varios remotos sin origin; los tipos de integración no resuelven remoto; sin fetch ni ls-remote. 17 tests nuevos 175147; 16 mutantes caen en sus tests. pnpm verify en verde (1982 tests).
- **2026-10-12T19:46:46Z** `[note]` Residuo para decisión humana: si la rama configurada no existe, git resuelve refs/heads/<n> a través de refs/tags/refs/heads/<n> (o refs/refs/heads/<n>, refs/remotes/refs/heads/<n>); con una ref así creada a mano, dos casos que antes fallaban cerrados ahora arrancan (K2: dev y origin/dev ausentes; R1: main renombrada). Arreglo posible: comprobar existencia exacta con git show-ref --verify antes de usar la ref completa. Otros residuos: checkoutBranch/cutover y heads/<rama> con etiqueta homónima (tarea aparte); lo empujado tras el último fetch no se ve; un cherry-pick no se detecta; la copia remota de la rama de release no se compara; change_branch_format null desactiva la guarda; plegado de mayúsculas; integration_branch: origin/dev falla cerrada con «does not exist locally» o «must descend». Decisiones: un fallo de git remote falla cerrado con el prefijo de la guarda; primero se comprueba qué copias existen y luego las bases.
