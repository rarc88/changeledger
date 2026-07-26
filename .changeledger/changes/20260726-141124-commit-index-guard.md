---
id: "20260726-141124"
title: Verificar el índice staged al commitear
type: feature
status: in-progress
created: 2026-07-26T14:11:24Z
depends_on: []
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

- `commit()` en `src/commands/commit.mjs:13-44` ya resuelve `resolvedIds` antes
  de invocar git, y **nunca** invoca git salvo que subject e ids resuelvan con
  éxito: ese es el punto natural, ya existente, para la nueva guarda — ninguna
  fase pre-git nueva hace falta, solo extenderla.
- Los nombres de archivo bajo `changes_dir` son deterministas:
  `{id}-{slug}.md`, con `id` en forma `YYYYMMDD-HHMMSS` (confirmado por
  `ID_FORM = /^\d{8}-\d{6}$/` en `src/check.mjs:11`). El id de un path staged
  es por tanto derivable de su propio nombre de archivo (los 15 primeros
  caracteres), sin necesidad de parsear frontmatter.
- Cambio de estado archivado: `archive()` en `src/commands/agent.mjs:283-289`
  solo pone `archived: true` en el frontmatter y reescribe el archivo en el
  mismo sitio; no existe ningún directorio de archivo separado en este repo
  (`loadRepo`/`loadRepoWithConfig` en `src/repo.mjs` leen un único
  `changesDir`, archivados incluidos). Un change archivado es, por tanto,
  exactamente igual de derivable que uno activo — no complica la regla y no
  hace falta ningún caso especial: la guarda opera sobre el único
  `changes_dir` configurado, sin distinguir activo de archivado.
- `changeledger check --commits` (`src/git.mjs:168-178`, `lintCommitRange`)
  solo linta el subject/marcador de cada commit; nunca compara el árbol de
  archivos del commit contra los ids declarados — de ahí que el defecto real
  quedara invisible.
- Fuera de alcance, explícito: la prosa del contrato sobre inspeccionar el
  índice tras un commit fallido pertenece al change `20260726-124837`
  (granularidad de commit), que este repo posee por separado; este change no
  toca `templates/contract/*.md`.

## Proposal

**Guarda determinista en el índice staged, en la fase pre-git ya existente de
`commit()`.**

- Nuevo helper `stagedFiles(cwd, run)` en `src/git.mjs`, sobre
  `git diff --cached --name-only`, siguiendo el mismo patrón de inyección de
  `run` que el resto del módulo.
- `commit()` calcula, entre los paths staged, los que caen bajo `changes_dir`;
  para cada uno extrae su id por el prefijo fijo `YYYYMMDD-HHMMSS` del nombre
  de archivo y exige que esté en `resolvedIds`. Si algún path staged bajo
  `changes_dir` no pertenece a ningún id declarado, `commit()` aborta sin
  invocar git, nombrando el/los path(s) sobrantes y los ids declarados.
- Los archivos fuera de `changes_dir` son invisibles para la guarda: un
  archivo de código legítimamente acompaña a un change y nunca la dispara.
- `commit()` imprime (parámetro `log` inyectable, default `console.log`, mismo
  patrón que `run`) la lista completa de paths staged **antes** de evaluar la
  guarda, de modo que el conjunto quede visible en la salida que lee un agente
  incluso cuando la guarda aborta a continuación.
- **Alternativa descartada:** parsear el frontmatter de cada path staged para
  obtener su id. Se descarta porque el nombre de archivo ya codifica el id de
  forma determinista (ver Investigation); parsear sería trabajo redundante sin
  ganar precisión.
- **Fuera de alcance:** ningún lint nuevo sobre `check --commits` ni sobre
  commits ya creados; la guarda solo actúa antes de que un commit exista. La
  prosa de contrato sobre inspeccionar el índice tras un fallo la posee
  `20260726-124837`.

## Specification

### CR1 — Un documento de change staged no declarado aborta el commit
- **Given** está staged `.changeledger/changes/<foreignId>-x.md` y `commit()`
  resuelve `ids: ["<declaredId>"]` con `<foreignId>` distinto de `<declaredId>`
- **When** se llama `commit({ message: "fix(x): y", ids: ["<declaredId>"] })`
- **Then** lanza un `Error` con mensaje exactamente
  `` Staged change document(s) not declared for this commit: .changeledger/changes/<foreignId>-x.md (declared: <declaredId>) ``
- **And** no se crea ningún commit nuevo (`git rev-list --count HEAD` queda
  igual que antes de la llamada)

### CR2 — Declarar el id staged permite el commit
- **Given** el mismo `.changeledger/changes/<foreignId>-x.md` staged, pero
  `commit()` resuelve `ids: ["<foreignId>"]`
- **When** se llama `commit({ message: "fix(x): y", ids: ["<foreignId>"] })`
- **Then** retorna el subject compuesto `fix(x): y [#<foreignId>]`
- **And** se crea un commit nuevo (`git rev-list --count HEAD` aumenta en 1)

### CR3 — Un archivo de código staged por sí solo nunca dispara la guarda
- **Given** solo está staged `src/app.mjs` (ningún archivo bajo
  `changes_dir` está staged) y hay exactamente un change `in-progress` con id
  `<activeId>`
- **When** se llama `commit({ message: "feat(x): y" })` sin pasar `ids`
- **Then** retorna `feat(x): y [#<activeId>]` sin lanzar ningún error de
  documento no declarado

### CR4 — La lista de paths staged aparece en la salida antes del commit
- **Given** están staged `.changeledger/changes/<declaredId>-x.md` y
  `src/app.mjs`, con `ids: ["<declaredId>"]`, y se inyecta una función `log`
  que registra sus llamadas
- **When** se llama `commit({ message: "feat(x): y", ids: ["<declaredId>"] }, cwd, run, log)`
- **Then** `log` fue invocado con exactamente
  `` Staged: .changeledger/changes/<declaredId>-x.md, src/app.mjs ``
  antes de que la llamada retorne

## Plan

- [x] Añadir `stagedFiles(cwd, run)` a `src/git.mjs` (`git diff --cached --name-only`) y la guarda pre-git en `commit()` de `src/commands/commit.mjs`: todo path staged bajo `changes_dir` debe traer su prefijo de id (`YYYYMMDD-HHMMSS`) dentro de `resolvedIds`, o aborta antes de cualquier llamada a git con el mensaje del CR1; verify: `node --test test/commit.test.mjs` (CR1)
  - **Resolved:** `2026-07-26T15:23:18Z`
- [x] Cubrir en `test/commit.test.mjs`, sobre la guarda de `src/commands/commit.mjs`, el camino de éxito cuando el id staged sí está declarado (mismo path, ahora en `ids`); verify: `node --test test/commit.test.mjs` (CR2)
  - **Resolved:** `2026-07-26T15:24:09Z`
- [x] Cubrir que un `src/*.mjs` staged en solitario, sin ningún path bajo `changes_dir`, nunca evalúa ni dispara la guarda; verify: `node --test test/commit.test.mjs` (CR3)
  - **Resolved:** `2026-07-26T15:25:00Z`
- [x] Añadir el parámetro inyectable `log` (default `console.log`) a `commit()` que imprime la lista de paths staged antes de evaluar la guarda, y conectarlo desde la acción `commit` de `bin/changeledger.mjs`; verify: `node --test test/commit.test.mjs` (CR4)
  - **Resolved:** `2026-07-26T15:26:30Z`
- [ ] Ejecutar el gate completo tras el cambio; verify: `pnpm verify` (support)

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
