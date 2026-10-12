---
id: "20261002-204623"
title: La guarda de arranque deja pasar ramas de release creadas desde la rama de integración
type: bug
status: done
created: 2026-10-02T20:46:23Z
depends_on: []
archived: true
reviewed: true
branch: bug/20261002-204623
related_to: ["20261002-181346", "20261002-181428"]
owner: Carlos Rodríguez
release_impact: patch
---

## Request

`changeledger status <id> in-progress` sólo comprueba que la rama de un change
descienda de su rama de integración. Para un tipo que se integra en la rama de
release (`integrates_into: release`, como `hotfix`), en el esquema habitual
—`dev` por delante de `main`— una rama `hotfix/<id>` creada por error desde
`dev` también desciende de `main` y pasa la guarda. El hotfix llevaría a
producción trabajo de `dev` aún sin publicar.

Lo señaló la revisión de `#20261002-181346`, y la spec `git-traceability` lo
documenta como limitación.

Se pide que, cuando la rama de integración del change difiere de una
`git.integration_branch` declarada, la guarda rechace una rama que contenga
commits de `git.integration_branch` que no estén ya en la rama de integración
del change.

Fuera de alcance:

- Los tipos que se integran en `git.integration_branch`: no cambian.
- Comprobaciones en otros comandos (`check --commits`, `review`): sólo se
  endurece el arranque.
- Repos sin `git.integration_branch` declarada: no hay contra qué comparar.

## Investigation

**Causa raíz.** `assertImplementationBranch` en `src/commands/agent.mjs`
resuelve `baseline = changeIntegrationBranch(config, change.type)` y sólo exige
`isAncestor(repoRoot, baseline, 'HEAD', gitRun)` (`src/git.mjs`, `merge-base
--is-ancestor`).

Si `dev` contiene `main` y `HEAD` sale de `dev`, `main` es ancestro de `HEAD` y
la condición se cumple. Nada compara `HEAD` con `git.integration_branch`.

Lo reproduje razonando sobre el código y lo confirmó, ejecutándolo, el revisor
de `#20261002-181346`. Lo repetiré con un test en rojo antes de corregir.

**Comprobación propuesta.** Sea `M = merge-base(HEAD, git.integration_branch)`.
La rama no contiene trabajo de integración sin publicar si y sólo si `M` es
ancestro de la rama de integración del change. Dicho de otro modo: todo lo que
comparte con `dev` ya está en `main`.

- Una rama `hotfix/<id>` creada desde `main` cumple, porque `M` está en `main`.
- Una rama creada desde `dev` por delante de `main` no cumple, porque `M` es la
  punta de `dev`.

**Superficie.**

- `src/commands/agent.mjs` (`assertImplementationBranch`).
- `src/git.mjs`: hoy expone `isAncestor`, pero no `merge-base` a secas.
- Tests en `test/agent.test.mjs`.
- La limitación que describe la spec `git-traceability`, que se corregirá al
  graduar.

## Specification

### CR1 — Rama de release creada desde la rama de integración
- **Given** `git.integration_branch: dev`, `git.release_branch: main`, un tipo `hotfix` con `integrates_into: release`, `dev` con un commit que no está en `main`, y un change `hotfix` aprobado
- **When** se crea `hotfix/<id>` desde `dev` y se ejecuta `changeledger status <id> in-progress`
- **Then** falla con `branch "hotfix/<id>" contains commits of "dev" that are not in "main"`
- **And** el documento del change no cambia

### CR2 — Rama de release creada desde la rama de release
- **Given** el repo de CR1
- **When** se crea `hotfix/<id>` desde `main` y se ejecuta `changeledger status <id> in-progress`
- **Then** termina con éxito

### CR3 — Rama de release cuando dev no va por delante
- **Given** el repo de CR1 con `dev` y `main` en el mismo commit
- **When** se crea `hotfix/<id>` desde `dev` y se ejecuta `changeledger status <id> in-progress`
- **Then** termina con éxito

### CR4 — Los tipos de integración no cambian
- **Given** el repo de CR1 y un change `bug` aprobado
- **When** se crea `bug/<id>` desde `dev` y se ejecuta `changeledger status <id> in-progress`
- **Then** termina con éxito

### CR5 — Sin git.integration_branch declarada no hay comparación
- **Given** el repo de CR1 sin `git.integration_branch`
- **When** se crea `hotfix/<id>` desde `main` y se ejecuta `changeledger status <id> in-progress`
- **Then** termina con éxito y no se ejecuta la comprobación nueva

## Plan

- [x] Test en rojo de CR1 y regresiones de CR2–CR5
  - **Target:** `test/agent.test.mjs`
  - **Verify:** `node --test test/agent.test.mjs`
  - **Criteria:** CR1, CR2, CR3, CR4, CR5
  - **Resolved:** `2026-10-02T21:01:08Z`
- [x] Comprobación del merge-base con la rama de integración en la guarda de
  arranque
  - **Target:** `src/commands/agent.mjs`
  - **Verify:** `node --test test/agent.test.mjs`
  - **Criteria:** CR1, CR2, CR3, CR5
  - **Resolved:** `2026-10-02T21:01:10Z`
- [x] Gate completo: `biome check`, `node --test` y `changeledger check`
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-10-02T21:01:11Z`

## Log
- **2026-10-02T20:46:23Z** `[version]` 0.18.0-dev
- **2026-10-02T20:47:04Z** `[status]` draft → approved (human via conversation)
- **2026-10-02T20:47:06Z** `[status]` approved → in-progress
- **2026-10-02T20:47:06Z** `[branch]` set: bug/20261002-204623 (auto)
- **2026-10-02T21:01:07Z** `[note]` Decisiones de implementación: sin merge-base (ref de integración ausente o historias sin relación) la guarda falla cerrada con «branch "<b>" cannot be compared with integration branch "<i>": no merge base found» y no toca el documento. Los tests usan los tipos del fixture existente —fix (release) y feature (integración)— en lugar de hotfix y bug: la guarda depende del rol integrates_into, no del nombre. Gates: biome check limpio; node --test 1717/1718 —el único fallo es 20261001-155612 CR9, preexistente en origin/dev—; changeledger check limpio; pnpm verify no se puede ejecutar (pnpm v11.13.0 < 12.6.0).
- **2026-10-02T21:01:18Z** `[status]` in-progress → in-review
- **2026-10-02T21:01:25Z** `[note]` Mandato de revisión: la superficie que gobierna el change — CR1–CR5 sobre dev..c6ec722 (src/commands/agent.mjs, src/git.mjs, test/agent.test.mjs).
- **2026-10-02T21:12:09Z** `[review]` in-review → in-progress (retry): Revisión 1: con varias bases de fusión (criss-cross), git merge-base devuelve una sola según fechas y la guarda puede dejar arrancar un hotfix con un commit de dev que no está en main; los comentarios de la guarda y de mergeBase afirman más de lo que el código impone; y, aunque la decisión de fallar cerrado se mantiene, el mensaje con la ref local de integración ausente no dice qué falta.
- **2026-10-02T21:22:34Z** `[status]` in-progress → in-review
- **2026-10-02T21:22:36Z** `[note]` Mandato de revisión (confirmación, ronda 2): la corrección sin commitear sobre c6ec722 —merge-base --all con todas las bases en la rama de integración del change, el test criss-cross, los comentarios reescritos y los dos mensajes de fallo cerrado (ref local ausente, historias sin relación)— y cualquier regresión que introduzca.
- **2026-10-02T21:31:25Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-10-02T21:31:26Z** `[note]` Seguimientos de la revisión (fuera del change, ya presentes en c6ec722): una etiqueta llamada dev sombrea a la rama en ambas comprobaciones (resolver refs/heads/<nombre> lo cerraría); un cherry-pick de trabajo de dev no se detecta, y el comentario no lo afirma.
- **2026-10-02T21:33:56Z** `[validation]` in-validation → done (human accepted via conversation)
- **2026-10-02T21:34:54Z** `[note]` graduation-review de la reconciliación (git-traceability): recomienda aplicar; cada frase coincide con assertImplementationBranch y mergeBases, y no queda rastro de la limitación anterior. Matiz no bloqueante: mergeBases devuelve vacío también ante otros fallos de git, y entonces el mensaje diría «shares no history».
- **2026-10-02T21:34:56Z** `[graduation]` spec: `git-traceability.md`
- **2026-10-12T21:17:02Z** `[archive]` archived
