---
id: "20260711-204419"
title: changeledger commit falla con exit 1 sin diagnóstico
type: bug
status: done
created: 2026-07-11T20:44:19Z
depends_on: [ "20260711-103757" ]
release_impact: patch
owner: raruiz-hiberuscom
reviewed: true
archived: true
---

## Request

En la orquestación paralela del 2026-07-11, dos delegados independientes
reportaron que `changeledger commit -m "..."` salía con exit 1 sin ningún
mensaje que explicara la causa. Ambos recurrieron a `git commit` plano con el
marcador `[#id]` manual — el helper existe precisamente para evitar eso. Un
fallo del commit debe explicar por qué falló.

## Investigation

- `src/commands/commit.mjs` valida subject e ids y delega en
  `run(['commit', '-m', subject], repo.repoRoot)` usando `defaultRun` de
  `src/git.mjs`.
- `defaultRun` ejecuta git con `stdio: ['ignore', 'pipe', 'ignore']`: stderr se
  descarta y el stdout capturado no se imprime en el camino de error. Ese
  perfil es correcto para las consultas tolerantes (refs, config), donde
  cualquier fallo degrada a vacío, pero `commit` es mutador: el diagnóstico de
  git (hook pre-commit fallido, nada staged, identidad ausente, lock) es la
  única pista del fallo y se pierde.
- El wrapper `action()` de `bin/changeledger.mjs` imprime `Error: ${e.message}`;
  para `execFileSync` eso es solo `Command failed: git commit …`, sin causa.
- La causa concreta del fallo dentro de los worktrees de agente no pudo
  diagnosticarse en el momento **precisamente por este bug**: el síntoma
  observable era exit 1 opaco.
- No hay regresión previa: `changeledger commit` nació así en el change
  20260711-103757 (contrato de commits ejecutable).

## Specification

### CR1 — El fallo de git commit expone stderr
- **Given** un repo donde `git commit` va a fallar (por ejemplo, sin cambios staged)
- **When** se ejecuta `changeledger commit -m "fix(x): algo"`
- **Then** el proceso sale con exit 1
- **And** stderr del CLI contiene el diagnóstico de git (p.ej. la línea con `nothing to commit` o el mensaje del hook), no solo `Command failed`

### CR2 — El éxito no cambia
- **Given** un repo con cambios staged y un change in-progress
- **When** se ejecuta `changeledger commit -m "fix(x): algo"`
- **Then** el commit se crea con el marcador `[#id]` y stdout muestra `Committed: <subject>`

### CR3 — Las consultas tolerantes no cambian
- **Given** las rutas de consulta existentes (`gitRefs`, `gitUser`, `lintCommitRange`)
- **When** git falla en ellas
- **Then** siguen degradando en silencio como hasta ahora, sin ruido nuevo

## Plan

- [x] Añadir en `test/commit.test.mjs` el caso de fallo de git de `src/commands/commit.mjs` con stderr propagado al error
  - **Verify:** `node --test test/commit.test.mjs`
  - **Criteria:** CR1
  - **Resolved:** `2026-07-11T21:16:05Z`
- [x] Hacer que el camino de commit en `src/commands/commit.mjs` y `src/git.mjs` capture stderr y lo incluya en el error lanzado, sin tocar el perfil de las consultas
  - **Verify:** `node --test test/commit.test.mjs test/git.test.mjs`
  - **Criteria:** CR1, CR2, CR3
  - **Resolved:** `2026-07-11T21:16:05Z`
- [x] Ejecutar `pnpm verify` completo tras la implementación
  - **Support:**
  - **Resolved:** `2026-07-11T21:16:05Z`

## Log
- **2026-07-11T21:05:24Z** `[status]` draft → approved
- **2026-07-11T21:08:42Z** `[status]` approved → in-progress
- **2026-07-11T21:08:42Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-11T21:16:05Z** `[note]` Integrada implementación delegada (bf039f4): mutatingRun captura stderr/stdout en fallo solo para el camino de commit; defaultRun y consultas tolerantes intactos. TDD red-green; pnpm verify 633/633. Verificación end-to-end: commit sin staged sale exit 1 mostrando el diagnóstico del hook y de git.
- **2026-07-11T21:16:05Z** `[status]` in-progress → in-review
- **2026-07-11T21:21:54Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-11T21:21:54Z** `[note]` Review independiente (contexto limpio) PASS: CR1-CR3 con evidencia e2e en repo scratch; defaultRun intacto byte a byte; suite 633/633. Observaciones menores no bloqueantes: diagnóstico duplicado stderr+stdout en fallo de hook (cosmético) y labels CR sin desambiguar en test/git.test.mjs.
- **2026-07-11T21:39:56Z** `[validation]` in-validation → done (human accepted)
- **2026-07-11T21:53:18Z** `[graduation]` spec: `git-traceability.md`
- **2026-07-11T21:54:25Z** `[archive]` archived
