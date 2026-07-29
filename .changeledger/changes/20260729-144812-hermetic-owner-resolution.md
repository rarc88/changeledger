---
id: "20260729-144812"
title: "La resolución del owner no lanza red: perezosa y con kill-switch en la suite"
type: bug
status: done
created: 2026-07-29T14:48:12Z
depends_on: []
archived: true
reviewed: true
related_to: ["20260726-124836", "20260614-182513"]
owner: raruiz-hiberuscom
---

## Request

CH-11 de la iniciativa de endurecimiento. Decisión de Roberto (2026-07-28, acta
§CH-11): nada debería necesitar llamadas externas, y la suite tiene que ser
hermética **por construcción**, no por disciplina. Dos defectos, mismo origen:

1. **En producción**: toda transición a `in-progress` lanza un subproceso de red
   (`gh api user`) aunque el change ya tenga owner y el resultado se descarte.
2. **En la suite**: la hermeticidad depende de que cada test inyecte un resolver
   a mano; un test nuevo que no lo haga lanza red a api.github.com y ninguna
   aserción falla — detrás de un portal cautivo la suite se cuelga.

El diseño de resolución (gh, y si no `git config user.name`) es correcto y **no
se toca**.

## Investigation

Verificado en HEAD el 2026-07-29 (símbolos, no líneas):

- `status()` en `src/commands/agent.mjs` calcula
  `autoOwner = newStatus === 'in-progress' ? ownerHandle(...) : ''` **antes** de
  abrir el documento; el guard `!fm.owner && autoOwner` que decide si se usa
  vive dentro del `mutateFileAtomic` posterior. Con owner ya asignado, el
  subproceso corre y su resultado se tira. Registrado por `20260726-124836` como
  residuo preexistente fuera de su alcance.
- Cadena completa: `ownerHandle` → `githubLogin` → `defaultGhRun` →
  `execFileSync('gh', ['api','user','--jq','.login'])` (`src/git.mjs`).
  `githubLogin` es tolerante (devuelve `''` si `gh` falta o falla), así que el
  fallo es silencioso: coste y red, nunca un error visible.
- `newChange` (`src/commands/new.mjs`) también resuelve owner al crear; ahí el
  subproceso **sí** hace falta (salvo `--owner`). El defecto de producción es
  solo el eager de `status()`.
- Suite: **39 sitios** de `newChange(` en 5 ficheros de test
  (`agent` 9, `cli` 18, `view` 10, `graduate` 1, `git` 1); los cinco inyectan
  `ownerHandle` donde toca, así que hoy no hay fuga — pero es disciplina por
  sitio, nada estructural. Coste medido por el revisor de `124836` cuando la
  fuga existía: 35 → 107 invocaciones de `gh`, suite de 18,7s a 24,4s (13,5s
  con `gh` stubbeado).
- `defaultGhRun` no se exporta hoy; el kill-switch necesita que sea observable
  para su test.

Causa raíz: la resolución vive en el camino caliente (transición y creación) sin
distinguir cuándo se necesita, y el runner por defecto no tiene forma de
apagarse en entornos que exigen hermeticidad.

## Specification

### CR1 — La transición con owner asignado no resuelve nada

- **Given** un change `approved` con `owner: ana` en el frontmatter y un
  `ownerHandle` espía inyectado que incrementa un contador al ser invocado
- **When** `status(id, 'in-progress')`
- **Then** el contador queda en **0**, el frontmatter conserva `owner: ana` y el
  Log no gana entrada `[owner]`
- **And** este test falla en rojo sobre el código actual (el contador da 1)

### CR2 — Sin owner, la resolución se conserva idéntica

- **Given** un change `approved` sin `owner` y un `ownerHandle` espía que
  devuelve `resolved-user`
- **When** `status(id, 'in-progress')`
- **Then** el contador queda en **1**, el frontmatter gana
  `owner: resolved-user` y el Log gana su entrada `[owner]`, exactamente el
  comportamiento vigente

### CR3 — El runner por defecto respeta el kill-switch

- **Given** `CHANGELEDGER_NO_GH=1` en el entorno
- **When** se invoca `defaultGhRun(['api','user','--jq','.login'])` (exportado
  de `src/git.mjs`)
- **Then** devuelve `''` sin lanzar subproceso — determinista en toda máquina:
  sin el guard, en una máquina con `gh` autenticado devolvería el login (≠ `''`)
  y en una sin `gh` lanzaría `ENOENT`; ambas fallan el test

### CR4 — La inyección puentea el kill-switch

- **Given** `CHANGELEDGER_NO_GH=1` en el entorno y un runner espía inyectado en
  `githubLogin(espía)`
- **When** se invoca
- **Then** el espía **sí** es invocado y su valor se usa — el kill-switch vive
  solo en el runner por defecto, así que ningún test existente de resolución
  cambia de comportamiento

### CR5 — La suite corre con el kill-switch puesto por construcción

- **Given** los scripts `test` y `verify` de `package.json`
- **When** se leen y se ejecuta `pnpm test`
- **Then** ambos scripts fijan `CHANGELEDGER_NO_GH=1`, la suite pasa completa, y
  un test nuevo que cree changes sin inyectar resolver no puede alcanzar la red
  por construcción del runner

## Plan

- [x] Hacer perezosa la resolución en `status()` de `src/commands/agent.mjs`: `ownerHandle` se invoca solo cuando el documento no tiene `owner`, dentro de la ventana que ya lee el frontmatter; verify: `node --test test/agent.test.mjs` con el test rojo-verde de CR1 (CR1, CR2)
  - **Resolved:** `2026-07-29T15:11:39Z`
- [x] Añadir el kill-switch en `defaultGhRun` de `src/git.mjs` (retorno `''` inmediato bajo `CHANGELEDGER_NO_GH`), exportarlo, y fijar la variable en los scripts `test` y `verify` de `package.json`; verify: `node --test test/git.test.mjs` (CR3, CR4, CR5)
  - **Resolved:** `2026-07-29T15:11:39Z`
- [x] Correr el gate completo; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-29T15:11:39Z`

## Log

- **2026-07-29T14:52:00Z** `[note]` Documentado en paralelo a la implementación de 20260729-143656 por instrucción de Roberto. Hechos de la Investigation verificados por grep/lectura en HEAD antes de redactar; la cifra 35→107/18,7s→24,4s es del review de 124836, citada con su fuente. Destino: carril WT-B del plan de worktrees (acta §13.4).
- **2026-07-29T14:52:11Z** `[status]` draft → approved
- **2026-07-29T15:01:05Z** `[status]` approved → in-progress
- **2026-07-29T15:01:05Z** `[note]` Implementación delegada en una sola pasada (las 3 tareas son una selección: los dos edits de src acoplados por la cadena ownerHandle y sus tests, más el gate). Baseline 5c394478 en worktree spec-ledger-wtb, rama change/hermetic-owner-resolution. Modelo mid-tier: trabajo acotado, mecanismo ya decidido en el documento.
- **2026-07-29T15:11:53Z** `[note]` Implementación entregada por delegado (123k tokens, 52 tool calls) y verificada por el orquestador contra el árbol de WT-B: lazy confirmado (ownerHandle dentro del guard !fm.owner), kill-switch en defaultGhRun exportado, scripts test/verify con CHANGELEDGER_NO_GH=1. Gate corrido por el orquestador: pnpm verify EXIT=0, 951/951, lint limpio, check 0 errores. Rojo-verde literal por criterio en el informe del delegado.
- **2026-07-29T15:11:53Z** `[note]` Edición del orquestador, declarada para escrutinio del revisor: el delegado dejó el comentario del kill-switch duplicado (dos copias contiguas del bloque de 4 líneas sobre defaultGhRun); retiré una copia con un replace que asertaba exactamente 2 copias antes y 1 después. Barrido de la clase sobre el diff completo: ningún otro bloque añadido contiguo duplicado; las líneas repetidas restantes son boilerplate entre tests distintos.
- **2026-07-29T15:11:53Z** `[status]` in-progress → in-review
- **2026-07-29T15:12:34Z** `[note]` Mandato del review, registrado antes de delegar: superficie que gobierna — el diff del commit bdee3c87 (5c394478..HEAD marcado con este id), los cinco criterios con re-derivación de mutantes, y escrutinio de las decisiones no especificadas del implementador más la edición del orquestador (dedup del comentario). No es auditoría repo completa. Revisor mid-tier: diff pequeño, mecanismo pre-decidido, tests deterministas.
- **2026-07-29T15:23:05Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-29T16:05:23Z** `[validation]` in-validation → done (human accepted via conversation)
- **2026-07-29T16:05:55Z** `[graduation]` spec: `lifecycle.md`
- **2026-07-29T16:05:55Z** `[archive]` archived
