---
id: "20260726-141124"
title: Verificar el índice staged al commitear
type: feature
status: done
created: 2026-07-26T14:11:24Z
depends_on: []
archived: true
reviewed: true
related_to: ["20260726-124837", "20260726-131603"]
owner: raruiz-hiberuscom
---

## Request

Cuando el hook `pre-commit` falla, git deja el índice staged intacto. El
siguiente `git add` más `changeledger commit` absorbe entonces, en silencio,
los archivos del intento fallido anterior. Ocurrió de verdad en este repo: un
commit cuyo subject llevaba `[#20260726-131603]` contenía el documento de ese
change, su fix de código y cinco documentos de change no relacionados de un
intento fallido anterior. `changeledger check --commits` reportó el rango como
válido, porque el marcador estaba bien formado — el defecto es invisible para
todo check existente.

## Investigation

- `commit()` en `src/commands/commit.mjs` ya resuelve `resolvedIds` antes de
  invocar git, y **nunca** invoca git salvo que subject e ids resuelvan con
  éxito: ese es el punto natural, ya existente, para la guarda.
- `loadRepo()` (`src/repo.mjs`) ya devuelve, para cada change, su `name` de
  archivo y su `frontmatter.id` — la misma resolución que usa `resolveChange`
  para el resto del CLI. De ahí sale la ruta **esperada** de cada id declarado,
  sin parsear nada nuevo y sin tocar `src/repo.mjs` ni `src/config.mjs`.
- `changeledger check --commits` (`lintCommitRange` en `src/git.mjs`) solo linta
  el subject/marcador de cada commit; nunca compara el árbol de archivos del
  commit contra los ids declarados — de ahí que el defecto real quedara
  invisible a todo check existente.
- **Tres estrategias fallidas, una línea cada una** (el registro más valioso de
  este documento):
  1. *Prefijo de id en el nombre de archivo* (episodio 1): derivar el id de los
     15 primeros caracteres del basename bajo `changes_dir`. Falló porque
     `--name-only` colapsa un rename y oculta el borrado ajeno, porque comparaba
     contra `repo.repoRoot` mientras git emite rutas relativas al top-level, y
     porque trataba cualquier archivo bajo el directorio como documento.
  2. *Clasificación total con fail-closed* (episodio 2): `stagedPathDecision()`
     devolvía `document`/`other`/`unresolvable`. Falló porque parseaba una
     superficie de presentación configurable por el repo ajeno: `core.quotePath`
     escapaba las rutas no-ASCII, `diff.relative` reabría el desajuste de
     coordenadas, y el `realpath` no llegaba a la cola de `changes_dir`.
  3. *Clasificación con pines de invocación y probe de caja* (episodio 3):
     invocación fijada, `realpathNearest` en ambos lados y `caseInsensitiveFs()`.
     Falló porque el propio probe fallaba **abierto** (devolvía «sensible» cuando
     no podía responder) y reabría el bypass que decía cerrar; además el ancestro
     con nombre de documento se clasificaba como `other`, `ESCAPED_PATH_RE`
     abortaba en falso un `"quoted.mjs"` legítimo, la comprobación de contención
     no tenía test que la sostuviera y una rama de NUL era inalcanzable.
- **Diagnóstico común**: clasificar cadenas de ruta arbitrarias es permeable por
  construcción. Renombrado, basename, tipo de archivo, `core.quotePath`,
  `diff.relative`, symlinks, normalización Unicode y plegado de caja son ejes
  independientes; cerrar uno con más maquinaria abre otro. La única salida es
  **no clasificar**: normalizar solo las rutas que la herramienta controla y
  comparar el resto byte a byte contra ellas.
- Comportamiento real de git verificado en este repo antes de escribir código:
  `rev-parse --show-toplevel` ya devuelve el realpath; con `-z` y
  `core.quotePath=false` git emite bytes crudos terminados en NUL; y git
  **precompone a NFC** la ruta que registra (`core.precomposeunicode`) mientras
  el filesystem devuelve a `readdir` la forma que almacenó, que puede ser NFD —
  de ahí que la lista blanca inscriba ambas formas de cada cadena esperada.
- Corrección de un dato asumido: `changeledger init`
  (`src/commands/init.mjs`) crea el directorio `changes/` pero **no** crea
  ningún `.gitkeep`; no existe ni en `src/` ni en `test/`. La exención se
  mantiene porque un repo consumidor puede necesitar versionar el directorio
  vacío, pero es una exención por nombre exacto, no un hecho de `init`.
- **Modelo de amenaza, explícito**: el Request describe un **accidente** — un
  hook fallido deja el índice intacto y el siguiente commit lo absorbe. Un
  leftover así siempre lleva la grafía canónica, porque la produjo `git add -A`
  o `git add <ruta>` del propio flujo. La guarda no es una frontera de seguridad
  contra alguien que ya controla el índice y el comando de commit.
- **Residuo conocido y no cerrado**: en un filesystem que no distingue caja,
  `git add .Changeledger/changes/<id>-x.md` (grafía distinta a la configurada,
  escrita a mano) registra esa grafía, no empieza por el prefijo esperado y por
  tanto no se juzga. Reproducido con el CLI real. No se cierra porque hacerlo
  exige plegar caja sobre entrada arbitraria, que es exactamente la maquinaria
  que el reset del episodio 3 eliminó; y queda fuera del modelo de amenaza
  anterior, porque `git add -A` nunca produce esa grafía. Queda declarado aquí
  en lugar de descubierto en review.
- **Residuo conocido y no cerrado**: `changes_dir: .` es aceptado por
  `isInside` (`src/config.mjs:69`, `target === root` permitido), lo que deja
  `changesDirRel` vacío; el prefijo calculado se convierte en `/` y ninguna
  ruta staged se juzga bajo él, así que un documento ajeno en la raíz del repo
  se commitea sin abortar. Mitigado porque `loadRepo()` (`src/repo.mjs`) parsea
  entonces cualquier `*.md` de la raíz como change y lanza en cualquier repo
  que pase `check --valid`, así que el escenario falla cerrado ahí en la
  práctica. No se corrige aquí: exigiría tocar `src/config.mjs` o `isInside`,
  fuera del alcance autorizado de esta corrección.
- **Comportamiento aceptado, no un defecto**: el abort de borrado declarado
  bloquea dos operaciones manuales sin vía de escape — borrar a mano un
  documento de change staged, y un `git mv` que lo renombre (la ruta vieja
  aborta como no declarada, la nueva se permite porque coincide con el id
  esperado). Ningún comando de ciclo de vida ejecuta ninguna de las dos:
  `archive`, `discard` y `graduate` parchean el frontmatter in place, nunca
  borran ni mueven el documento. Ningún flujo sancionado, por tanto, produce
  jamás un falso abort por esta vía.

## Proposal

**Lista blanca exacta en el índice staged, en la fase pre-git ya existente de
`commit()`.** No se clasifica ninguna ruta: se invierte la pregunta.

- Para cada id declarado, `commit()` calcula la cadena **exacta** que git
  reportaría para el documento de ese change: `change.name` de `loadRepo()`
  bajo el `changes_dir` resuelto, expresado en el sistema de coordenadas de git
  (relativo al top-level, barras hacia delante). La normalización — `realpath`,
  separador, formas Unicode — se aplica **solo** a las rutas que la herramienta
  controla, nunca a la entrada staged.
- Toda ruta staged que caiga bajo el directorio de changes y no sea
  byte-idéntica a una de esas cadenas aborta el commit y se nombra en el error.
  Sin plegado de caja, sin test de `.md`, sin lógica de ancestros, sin
  heurística de forma escapada.
- Una única exención: coincidencia exacta de nombre `.gitkeep` directamente en
  el directorio de changes.
- Las rutas fuera del directorio de changes no se juzgan: un archivo de código
  acompaña legítimamente a un change.
- Se conserva la invocación fijada de lectura del índice
  (`-c core.quotePath=false diff --cached -z --no-renames --no-relative
  --ignore-submodules=none --name-only`, leída con el top-level git como `cwd`,
  partida por NUL) porque la comparación byte a byte exige cadenas estables.
- **Esto invierte a propósito el criterio CR7 anterior**: un `.DS_Store` o un
  temporal de `atomic-write` staged bajo el directorio de changes ahora aborta
  el commit y se nombra, en lugar de ignorarse. Un abort explícito sobre algo
  inocuo es preferible a una decisión de «esto es seguro ignorarlo», que es la
  forma que tomaron los tres bypasses anteriores.
- **Fuera de alcance**: ningún lint nuevo sobre `check --commits` ni sobre
  commits ya creados; la prosa de contrato sobre inspeccionar el índice tras un
  fallo la posee `20260726-124837`.

## Specification

Criterios renumerados en el reset del episodio 3; los CR1–CR13 anteriores
pertenecían a dos estrategias superadas.

### CR1 — Una ruta staged bajo el directorio de changes que no es una ruta esperada aborta
- **Given** está staged `.changeledger/changes/20260711-999999-x.md` junto a
  `a.txt`, y el único id declarado es `20260711-000001`
- **When** se llama `commit({ message: "fix(x): y", ids: ["20260711-000001"] })`
- **Then** lanza un `Error` con mensaje exactamente
  `` Staged path(s) under the changes directory not declared for this commit: .changeledger/changes/20260711-999999-x.md (declared: 20260711-000001) ``
- **And** no se crea ningún commit nuevo (`git rev-list --count HEAD` no cambia)

### CR2 — El documento del change declarado es byte-idéntico a una ruta esperada y se permite
- **Given** está staged `.changeledger/changes/20260711-999999-x.md`, cuyo
  frontmatter declara `id: "20260711-999999"`, y ese es el id declarado
- **When** se llama `commit({ message: "fix(x): y", ids: ["20260711-999999"] })`
- **Then** retorna el subject `fix(x): y [#20260711-999999]`
- **And** se crea exactamente un commit nuevo

### CR3 — Las rutas fuera del directorio de changes no se juzgan
- **Given** están staged `src/app.mjs` y `.changeledger/config.yml`, ninguna
  bajo el directorio de changes, y hay exactamente un change `in-progress` con
  id `20260711-000001`
- **When** se llama `commit({ message: "feat(x): y" })` sin pasar `ids`
- **Then** retorna `feat(x): y [#20260711-000001]` y se crea un commit nuevo

### CR4 — La lista staged completa se imprime antes de evaluar la guarda
- **Given** están staged `.changeledger/changes/20260711-999999-x.md` (ajeno) y
  `src-app.mjs`, con `ids: ["20260711-000001"]`, y se inyecta un `log` que
  registra sus llamadas
- **When** se llama `commit({ message: "feat(x): y", ids: ["20260711-000001"] }, cwd, run, log)`
- **Then** la llamada aborta por CR1
- **And** `log` fue invocado con exactamente
  `` Staged: .changeledger/changes/20260711-999999-x.md, src-app.mjs ``

### CR5 — `.gitkeep` es la única exención, y cualquier otra entrada inesperada aborta
- **Given** está staged solo `.changeledger/changes/.gitkeep`, con
  `ids: ["20260711-000001"]`
- **When** se llama `commit({ message: "chore(x): y", ids: ["20260711-000001"] })`
- **Then** retorna `chore(x): y [#20260711-000001]` y se crea un commit nuevo
- **And Given** en cambio están staged `.changeledger/changes/.DS_Store` y
  `.changeledger/changes/.20260711-000002-x.md.12345.1690000000000.0.tmp`
- **Then** lanza un `Error` con mensaje exactamente
  `` Staged path(s) under the changes directory not declared for this commit: .changeledger/changes/.20260711-000002-x.md.12345.1690000000000.0.tmp, .changeledger/changes/.DS_Store (declared: 20260711-000001) ``
  — la inversión deliberada del CR7 anterior — y no se crea ningún commit

### CR6 — Una ruta staged cuyo ancestro se llama como un documento de change aborta
- **Given** el índice contiene
  `.changeledger/changes/20260711-999999-x.md/inner` (añadido con
  `update-index --cacheinfo`, sin nada en el working tree)
- **When** se llama `commit({ message: "fix(x): y", ids: ["20260711-000001"] })`
- **Then** lanza un `Error` con mensaje exactamente
  `` Staged path(s) under the changes directory not declared for this commit: .changeledger/changes/20260711-999999-x.md/inner (declared: 20260711-000001) ``
- **And** no se crea ningún commit nuevo

### CR7 — Un nombre entrecomillado no es una forma de ruta: no aborta fuera, sí aborta dentro
- **Given** está staged `"quoted.mjs"` (comillas literales en el nombre) en la
  raíz del repo, y hay exactamente un change `in-progress` con id
  `20260711-000001`
- **When** se llama `commit({ message: "feat(x): y" })` sin pasar `ids`
- **Then** retorna `feat(x): y [#20260711-000001]` y se crea un commit nuevo
- **And Given** en cambio está staged
  `.changeledger/changes/"20260711-999999-x.md"`
- **Then** lanza un `Error` con mensaje exactamente
  `` Staged path(s) under the changes directory not declared for this commit: .changeledger/changes/"20260711-999999-x.md" (declared: 20260711-000001) ``
  — nombrada verbatim como no declarada, no como «forma escapada»

### CR8 — Las rutas esperadas se calculan en el sistema de coordenadas de git
- **Given** el repo git tiene su raíz en `<gitRoot>` pero la ledger vive en
  `<gitRoot>/pkg/.changeledger`, y están staged el documento ajeno bajo ese
  `changes_dir` y `src/app.mjs`
- **When** se llama `commit({ message: "fix(x): y", ids: ["20260711-000001"] }, "<gitRoot>/pkg")`
- **Then** lanza un `Error` con mensaje exactamente
  `` Staged path(s) under the changes directory not declared for this commit: pkg/.changeledger/changes/20260711-999999-x.md (declared: 20260711-000001) ``
  — la ruta tal como la reporta git, relativa a `<gitRoot>`
- **And** no se crea ningún commit nuevo

### CR9 — Un `.changeledger` simbólico mantiene la guarda activa
- **Given** `.changeledger` es un symlink a `ledger/` dentro del propio repo
  (forma que `resolveRepoPath` acepta), y está staged
  `ledger/changes/20260711-999999-x.md`
- **When** se llama `commit({ message: "fix(x): y", ids: ["20260711-000001"] })`
- **Then** lanza un `Error` con mensaje exactamente
  `` Staged path(s) under the changes directory not declared for this commit: ledger/changes/20260711-999999-x.md (declared: 20260711-000001) ``
- **And** no se crea ningún commit nuevo

### CR10 — La cadena cruda de disco y su forma NFC están inscritas; NFD no se aísla de la cruda en estos tests
- **Given** el documento del change declarado `20260711-000001` se escribe en
  disco con nombre descompuesto `20260711-000001-añadir.md` y está staged
- **When** se llama `commit({ message: "feat(x): y", ids: ["20260711-000001"] })`
- **Then** retorna `feat(x): y [#20260711-000001]` y se crea un commit nuevo,
  aunque git registre por defecto (`core.precomposeunicode=true`) la forma
  precompuesta `20260711-000001-añadir.md` — fija la necesidad de la forma NFC
- **And Given** `changes_dir` es `.changeledger/cambiós` (descompuesto en
  disco) y está staged un documento ajeno dentro
- **Then** lanza un `Error` con mensaje exactamente
  `` Staged path(s) under the changes directory not declared for this commit: .changeledger/cambiós/20260711-999999-x.md (declared: 20260711-000001) ``
  — el prefijo también se compara en su forma NFC
- **And Given**, en una plataforma de bytes crudos (`core.precomposeunicode=false`),
  `changes_dir` es `.changeledger/cambiós-añadir` con composición mixta (`ó`
  precompuesta, `ñ` descompuesta — ni NFC ni NFD puros de sí misma) y está
  staged un documento ajeno `20260711-999999-f.md` dentro
- **Then** lanza un `Error` con mensaje exactamente
  `` Staged path(s) under the changes directory not declared for this commit: .changeledger/cambiós-añadir/20260711-999999-f.md (declared: 20260711-000001) ``
  — fija la necesidad de la cadena cruda: sin ella el prefijo nunca coincidía
  y el commit absorbía el documento ajeno
- **And Given**, con la misma configuración de plataforma, el documento
  declarado `20260711-000001` se escribe en disco con nombre de composición
  mixta `20260711-000001-café-añadir.md` (`é` precompuesta, `ñ` descompuesta) y
  está staged
- **Then** retorna `feat(x): y [#20260711-000001]` y se crea un commit nuevo —
  fija la necesidad de la cadena cruda: sin ella el documento declarado
  abortaba como no declarado
- **Alcance probado por mutación**: mutar `unicodeForms` a solo NFC hace pasar
  los dos primeros casos y fallar los dos últimos; mutar a solo NFD hace
  fallar los cuatro. Ningún caso de esta Specification aísla la necesidad de
  NFD de la cadena cruda cuando ambas difieren — en los cuatro casos el nombre
  en disco ya coincide con su propia forma NFD (descompuesto, o mixto pero
  igual a sí mismo), así que NFD nunca se ejercita como la única forma que
  falta si la cruda ya está presente.

### CR11 — La lectura del índice fija todos los ejes configurables de la invocación
- **Given** un `run` inyectado que registra sus argumentos y su `cwd`
- **When** se llama `commit({ message: "fix(x): y", ids: ["20260711-000001"] })`
- **Then** la invocación de lectura del índice fue exactamente
  `` ["-c", "core.quotePath=false", "diff", "--cached", "-z", "--no-renames", "--no-relative", "--ignore-submodules=none", "--name-only"] ``
  con `cwd` igual al top-level git realpath-eado
- **And** un documento ajeno cuyo nombre contiene un `\n`
  (`.changeledger/changes/20260711-999999-a\nb.md`) sigue siendo **una** entrada
  y aborta con el mensaje del CR1 nombrando esa ruta completa

### CR12 — `core.quotePath` y `diff.relative` no pueden dejar la guarda inerte
- **Given** un repo con `core.quotePath=true` y `diff.relative=true` en su
  config, la ledger en `<gitRoot>/pkg/.changeledger` y staged un documento ajeno
  con nombre no-ASCII
- **When** se llama `commit({ message: "fix(x): y", ids: ["20260711-000001"] }, "<gitRoot>/pkg")`
- **Then** lanza un `Error` con mensaje exactamente
  `` Staged path(s) under the changes directory not declared for this commit: pkg/.changeledger/changes/20260711-999999-añadir.md (declared: 20260711-000001) ``
  — sin escapar y relativa al top-level
- **And** no se crea ningún commit nuevo

### CR13 — Un rename detectado no oculta el borrado de un documento ajeno
- **Given** ya está commiteado `.changeledger/changes/20260711-999999-x.md`, y
  el índice contiene su borrado junto con la adición de
  `.changeledger/changes/20260711-000001-x.md` con contenido casi idéntico, de
  modo que `git diff --cached --name-status` detecta un rename (`R09x`)
- **When** se llama `commit({ message: "fix(x): y", ids: ["20260711-000001"] })`
- **Then** lanza un `Error` con mensaje exactamente
  `` Staged path(s) under the changes directory not declared for this commit: .changeledger/changes/20260711-999999-x.md (declared: 20260711-000001) ``
- **And** el recuento de commits sigue siendo 1

### CR14 — La frontera del directorio de changes es exacta, no un prefijo laxo
- **Given** están staged `.changeledger/changes-old/20260711-999999-x.md` — un
  directorio hermano, no el configurado — y hay un change `in-progress`
- **When** se llama `commit({ message: "feat(x): y" })` sin pasar `ids`
- **Then** retorna `feat(x): y [#20260711-000001]` y se crea un commit nuevo
- **And Given** se añade además `.changeledger/changes/20260711-999999-y.md`
- **Then** lanza un `Error` con mensaje exactamente
  `` Staged path(s) under the changes directory not declared for this commit: .changeledger/changes/20260711-999999-y.md (declared: 20260711-000001) ``
  — de modo que quitar la comprobación de contención, en cualquiera de sus dos
  direcciones, rompe la suite

### CR15 — El suelo de versión y cualquier otro fallo de lectura del índice se atribuyen por separado
- **Given** un `run` inyectado cuya lectura del índice falla con
  `` error: unknown option `no-relative' ``
- **When** se llama `commit({ message: "fix(x): y", ids: ["20260711-000001"] })`
- **Then** lanza un `Error` con mensaje exactamente
  `` Cannot read the staged index; git >= 2.28 is required for --no-relative: error: unknown option `no-relative' ``
- **And Given** en cambio la lectura falla con
  `fatal: index file smaller than expected`
- **Then** lanza un `Error` con mensaje exactamente
  `` Cannot read the staged index: fatal: index file smaller than expected ``
  — sin atribuirlo al suelo de versión
- **And** en ambos casos no se emite ninguna invocación `git commit`

## Plan

- [x] Sustituir la clasificación de rutas de `src/commands/commit.mjs` por la lista blanca exacta (ruta esperada por id declarado desde `loadRepo`, más la exención de nombre `.gitkeep`) y cubrirla en `test/commit.test.mjs`; verify: `node --test test/commit.test.mjs` (CR1, CR2, CR3, CR4, CR5)
  - **Resolved:** `2026-07-26T16:59:39Z`
- [x] Cubrir en `test/commit.test.mjs` los tres falsos veredictos del review 3 que la lista blanca resuelve sin lógica de ancestros ni heurística de forma escapada en `src/commands/commit.mjs`: ancestro con nombre de documento, `"quoted.mjs"` legítimo y frontera exacta del directorio; verify: `node --test test/commit.test.mjs` (CR6, CR7, CR14)
  - **Resolved:** `2026-07-26T16:59:39Z`
- [x] Calcular en `src/commands/commit.mjs` las rutas esperadas en coordenadas de git (`gitRelative` sobre `gitTopLevel`, `realpathNearest` aplicado a la cola de `changes_dir`) y cubrirlo en `test/commit.test.mjs` con ledger bajo `pkg/` y con `.changeledger` simbólico; verify: `node --test test/commit.test.mjs` (CR8, CR9)
  - **Resolved:** `2026-07-26T16:59:39Z`
- [x] Inscribir en `src/commands/commit.mjs` ambas formas Unicode de cada cadena esperada y del prefijo (`unicodeForms`) y cubrir en `test/commit.test.mjs` el documento declarado con nombre descompuesto y un `changes_dir` no-ASCII; verify: `node --test test/commit.test.mjs` (CR10)
  - **Resolved:** `2026-07-26T16:59:39Z`
- [x] Corrección acotada (excepción autorizada, review 4): inscribir también la cadena cruda de disco en `unicodeForms()` (`src/commands/commit.mjs`) y cubrir en `test/commit.test.mjs`, con `core.precomposeunicode=false` y nombre de composición mixta, ambas direcciones — bypass del prefijo del `changes_dir` y falso abort del documento declarado; verify: `node --test test/commit.test.mjs` (CR10)
  - **Resolved:** `2026-07-26T17:47:00Z`
- [x] Conservar en `src/git.mjs` la invocación fijada de lectura del índice y asertar en `test/commit.test.mjs` sus argumentos, su `cwd`, el split por NUL y la inercia de `core.quotePath`/`diff.relative`/renames; verify: `node --test test/commit.test.mjs` (CR11, CR12, CR13)
  - **Resolved:** `2026-07-26T16:59:39Z`
- [x] Distinguir en `src/git.mjs` el fallo por suelo `git >= 2.28` de cualquier otro fallo de lectura del índice, ambos cerrados, y cubrir las dos atribuciones en `test/commit.test.mjs`; verify: `node --test test/commit.test.mjs` (CR15)
  - **Resolved:** `2026-07-26T16:59:39Z`
- [x] Ejecutar el gate completo tras el reset del episodio 3; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-26T16:59:40Z`

## Log

- **2026-07-26T14:11:24Z** `[note]` Draft: `changeledger commit` gana una
  guarda determinista sobre el índice staged — todo documento de change
  staged debe pertenecer a uno de los ids declarados, o aborta sin crear
  commit, nombrando el path sobrante y los ids declarados; además imprime la
  lista de paths staged antes de la guarda. Fuera de alcance: la prosa de
  granularidad de commit, que posee `20260726-124837`.
- **2026-07-26T15:05:11Z** `[status]` draft → approved
- **2026-07-26T15:18:47Z** `[status]` approved → in-progress
- **2026-07-26T15:23:18Z** `[note]` Task 1: stagedFiles(cwd, run) en src/git.mjs + guarda pre-git en commit() que aborta si un documento de change staged bajo changes_dir no está en resolvedIds (CR1).
- **2026-07-26T15:24:09Z** `[note]` Task 2: cobertura del camino de éxito (CR2) — id staged declarado en resolvedIds no dispara la guarda.
- **2026-07-26T15:25:00Z** `[note]` Task 3: cobertura CR3 — un src/*.mjs staged en solitario nunca dispara la guarda.
- **2026-07-26T15:26:30Z** `[note]` Task 4: parámetro inyectable log (default console.log) en commit() que imprime la lista staged antes de la guarda (CR4); conectado explícitamente en la acción commit de bin/changeledger.mjs.
- **2026-07-26T15:27:52Z** `[note]` Task 5: pnpm verify (lint + 722 tests + changeledger check) en verde tras el cambio.
- **2026-07-26T15:29:26Z** `[status]` in-progress → in-review
- **2026-07-26T15:38:42Z** `[review]` in-review → in-progress (retry): El guard no cumple el Request pese a que CR1-CR4 pasan literalmente. Clase del defecto: la nocion de documento de change staged esta mal definida en tres ejes. (1) src/git.mjs:70 usa git diff --cached --name-only, que colapsa un par de rename a la ruta destino; como los documentos son casi identicos git reporta R098 y el borrado de un documento ajeno viaja invisible al guard y al log de CR4. (2) src/commands/commit.mjs:56-61 compara rutas relativas a repo.repoRoot, pero git emite rutas relativas al top-level, asi que el guard es inerte cuando .changeledger no esta en la raiz git. (3) src/commands/commit.mjs:62-63 trata cualquier fichero bajo changes_dir como documento, provocando falso abort con .gitkeep, .DS_Store o temporales de atomic-write. La correccion debe definir una vez que es un documento de change staged y derivar los tres, con criterios nuevos que los cubran.
- **2026-07-26T15:49:07Z** `[note]` Retry: se define un unico helper stagedChangeDocument() en src/commands/commit.mjs (una ruta staged, resuelta con gitTopLevel() de src/git.mjs, bajo changes_dir, basename *.md) del que derivan las tres guardas; se anaden CR5 (rename R09x ya no oculta el borrado ajeno, via --no-renames en stagedFiles), CR6 (la guarda usa el sistema de coordenadas de git via rev-parse --show-toplevel, no repo.repoRoot) y CR7 (solo *.md bajo changes_dir cuenta como documento; .gitkeep/.DS_Store/temporales de atomic-write ya no disparan abort falso), mas sus tareas de Plan. Tambien se inyecta noop log en los tests que no ejercitan CR4 para no filtrar Staged: a stdout. Completan la especificacion del Request ya aprobado (leftovers de un hook fallido), no la amplian.
- **2026-07-26T15:49:59Z** `[status]` in-progress → in-review
- **2026-07-26T15:59:07Z** `[review]` in-review → blocked: Segundo veredicto fallido con la misma clase abierta: el guard parsea una superficie de presentacion. git diff --cached --name-only cambia de formato segun configuracion del repo: core.quotePath escapa y entrecomilla rutas no-ASCII (reproducido con el CLI real: un documento con enie entra al commit), diff.relative=true emite rutas relativas al cwd y reabre CR6 verbatim, y el realpath se aplico al repoRoot pero no a la cola, asi que un .changeledger simbolico deja el guard inerte. CR1-CR7 pasan y el guard sigue siendo evitable. Se detiene el parcheo: hace falta decision humana sobre la estrategia de lectura del indice antes de otro intento.
- **2026-07-26T16:04:20Z** `[note]` Reset de diseno ratificado por el humano tras dos reviews fallidos. Estrategia nueva: (1) fail closed, una ruta staged no resoluble aborta y se nombra en lugar de saltarse; (2) invocacion fijada con -c core.quotePath=false, -z, --no-renames, --no-relative y suelo de version git 2.28; (3) realpath en ambos lados incluida la cola del changes_dir; (4) un criterio por punto mas uno meta para ruta no interpretable. Se abandona el parseo de la salida por defecto de git, que es superficie de presentacion configurable por el repo ajeno.
- **2026-07-26T16:04:21Z** `[status]` blocked → in-progress
- **2026-07-26T16:17:06Z** `[note]` Reset de diseno implementado. (1) Fail closed: stagedPathDecision() en src/commands/commit.mjs es total — document/other/unresolvable — y todo unresolvable aborta nombrando path y razon antes de cualquier otro veredicto (CR8, CR12). (2) Invocacion fijada en src/git.mjs: -c core.quotePath=false diff --cached -z --no-renames --no-relative --ignore-submodules=none --name-only, split por NUL sin trim, ejecutada con el top-level git como cwd; suelo git >= 2.28 con fallo explicito si git rechaza la invocacion (CR9, CR10). (3) realpathNearest() aplica realpath a la cola del changes_dir y al dirname de cada path staged, nunca al basename, para que un .changeledger simbolico y un symlink staged se juzguen donde git los registra (CR11). (4) Cuarto eje encontrado al intentar romper la guarda y cerrado con criterio propio: en un filesystem case-insensitive git puede registrar .Changeledger/... y la comparacion case-sensitive dejaba la guarda inerte (CR13). --ignore-submodules=none es un quinto eje del mismo tipo, cerrado dentro del CR9. 24 intentos de rotura mas 4 controles de falso-abort: ningun bypass.
- **2026-07-26T16:19:52Z** `[status]` in-progress → in-review
- **2026-07-26T16:33:33Z** `[review]` in-review → blocked: Tercer veredicto fallido y tercera estrategia insuficiente. El fix introdujo el bypass que decia cerrar: caseInsensitiveFs() falla abierto (mapea la ruta absoluta completa y prueba existsSync, devolviendo sensible cuando no puede responder), reproducido dos veces con el CLI real; y su test usa un probe distinto al de produccion, asi que no puede detectar el fallo. Ademas: un ancestro con nombre de documento se clasifica como other y se commitea; ESCAPED_PATH_RE aborta en falso un fichero llamado quoted.mjs; la comprobacion de contencion no tiene ningun test que la sostenga; una rama de NUL es inalcanzable. Diagnostico: clasificar cadenas de ruta arbitrarias es permeable por construccion, cada eje nuevo trae su agujero. Se detiene el parcheo: hace falta decision humana sobre la estrategia, no otra correccion.
- **2026-07-26T16:42:10Z** `[note]` Reset de diseno del episodio 3, ratificado por el humano. Estrategia: lista blanca exacta en lugar de clasificar rutas. commit calcula la ruta esperada de cada id declarado y aborta toda ruta staged bajo el directorio de changes que no sea byte-identica a una esperada, con una unica exencion de nombre exacto para .gitkeep. Se eliminan el probe de case folding, la heuristica de forma escapada, la logica de ancestros y la rama de NUL. Se conservan los pines de la invocacion porque la comparacion exige cadenas estables. Esto invierte CR7 a proposito: un fichero inesperado bajo el directorio abortara aunque sea inocuo. Tope duro acordado: si el review de este episodio falla, se degrada a solo log informativo y se cierra el change, sin cuarto intento.
- **2026-07-26T16:42:11Z** `[status]` blocked → in-progress
- **2026-07-26T16:59:57Z** `[note]` Renumeracion de criterios en el reset del episodio 3: la Specification pasa a CR1-CR15 sobre la lista blanca exacta. Las entradas de Log anteriores a esta linea que citan CR1-CR13 se refieren a las dos estrategias superadas (prefijo de id, y clasificacion total con pines y probe de caja); no deben leerse contra la numeracion nueva.
- **2026-07-26T16:59:57Z** `[note]` Reset del episodio 3 implementado. La guarda ya no clasifica rutas: para cada id declarado se calcula la cadena exacta que git reportaria para su documento (change.name de loadRepo bajo el changes_dir resuelto, en coordenadas de git, con realpath y formas Unicode aplicados solo a lo que la herramienta controla) y toda ruta staged bajo el directorio de changes que no sea byte-identica a una de ellas aborta y se nombra; unica exencion, nombre exacto .gitkeep. Eliminados caseInsensitiveFs, ESCAPED_PATH_RE, stagedPathDecision, isUnderDir, CHANGE_ID_PREFIX_RE y la rama de NUL inalcanzable (grep: 0 hits en src/ test/ bin/); realpathNearest se conserva porque la cola del changes_dir lo exige. src/git.mjs distingue el suelo git 2.28 de cualquier otro fallo de lectura del indice, ambos cerrados. Barrido hostil de 24 intentos con el CLI real: 23 abortan; queda un residuo declarado en Investigation (grafia con otra caja en filesystem case-insensitive, solo alcanzable escribiendo la ruta a mano) que no se cierra porque exigiria plegar caja sobre entrada arbitraria. 7 controles de falso-abort: ninguno aborta indebidamente. 8 mutaciones confirman que cada pieza es load-bearing.
- **2026-07-26T17:03:42Z** `[status]` in-progress → in-review
- **2026-07-26T17:22:24Z** `[review]` in-review → blocked: Un solo hallazgo, dentro de la estrategia y no contra ella: unicodeForms() inscribe NFC y NFD de cada cadena esperada pero no la cadena cruda de disco, que es la forma que git reporta con core.precomposeunicode=false o en plataformas de bytes crudos. Reproducido en ambas direcciones con el CLI real (bypass con git add -A, y falso abort de un documento declarado de composicion mixta) y la pareja inscrita no es load-bearing: quitar NFD deja 25/25 verde, asi que CR10 afirma lo que su test no establece. Fix de una linea verificado por el revisor. Los otros 14 criterios verificados independientemente con mutaciones y CLI real; el residual de mayusculas quedo establecido como inalcanzable por accidente. Se bloquea porque el tope duro acordado exige decision humana: continuar con una excepcion acotada a este hallazgo, o degradar a solo log informativo y cerrar.
- **2026-07-26T17:28:42Z** `[note]` Excepcion al tope duro autorizada por el humano, por una sola vez: el hallazgo esta dentro de la estrategia ratificada y no contra ella, 14 de 15 criterios quedaron verificados independientemente, y el fix es de una linea ya verificado. Alcance de la correccion limitado a ese hallazgo: inscribir tambien la cadena cruda junto a NFC y NFD, un test que lo fije con core.precomposeunicode=false y nombre de composicion mixta, y corregir el enunciado de CR10 y del Log, que afirmaban una propiedad que los tests no establecian. Sub-tope: si la ronda de confirmacion falla, se degrada a solo log informativo y se cierra el change sin mas intentos.
- **2026-07-26T17:28:42Z** `[status]` blocked → in-progress
- **2026-07-26T17:47:00Z** `[note]` Corrección acotada de la excepción implementada: `unicodeForms()` (`src/commands/commit.mjs`) inscribe ahora la cadena cruda además de NFC y NFD (deduplicadas con `Set`). Dos tests nuevos en `test/commit.test.mjs`, ambos con `core.precomposeunicode=false` y nombre de composición mixta: bypass del prefijo del `changes_dir` (documento ajeno absorbido sin abortar) y falso abort de un documento declarado. Confirmado que ambos fallan contra el código previo (`Missing expected exception` y el propio `Error` de abort no declarado, respectivamente) y que ambos vuelven a fallar bajo mutación de `unicodeForms` a solo NFC y a solo NFD por separado — la cadena cruda es load-bearing para los dos.
- **2026-07-26T17:47:00Z** `[note]` Corrección del enunciado inexacto: la entrada de Log de `2026-07-26T16:59:57Z` y el CR10 original afirmaban "ambas formas Unicode... inscritas" y "8 mutaciones confirman que cada pieza es load-bearing" sin que ningún test aislara la necesidad de NFD de la cadena cruda — quitar NFD dejaba la suite en verde, como el review de `2026-07-26T17:22:24Z` estableció. Esa entrada anterior no se borra; queda como registro de lo que se creyó y se ejecutó en su momento. CR10 se reescribe para afirmar solo lo que sus cuatro casos (los dos originales más los dos nuevos) prueban por mutación: la cadena cruda y la forma NFC son necesarias; NFD nunca se aísla de la cruda en ningún caso de esta Specification porque en los cuatro el nombre en disco ya coincide con su propia forma NFD. La tarea de Plan que cubre CR10 gana una entrada nueva con el `verify:` de esta corrección; la original queda intacta.
- **2026-07-26T17:40:22Z** `[status]` in-progress → in-review
- **2026-07-26T17:47:40Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-26T18:21:27Z** `[validation]` in-validation → done (human accepted)
- **2026-07-26T18:26:56Z** `[graduation]` spec: `git-traceability.md`
- **2026-07-28T13:31:39Z** `[archive]` archived
