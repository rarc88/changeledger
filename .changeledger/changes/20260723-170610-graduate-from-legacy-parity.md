---
id: "20260723-170610"
title: Paridad de --from y diagnóstico real de --to en graduate legacy
type: bug
status: in-validation
created: 2026-07-23T17:06:10Z
depends_on: []
owner: raruiz-hiberuscom
related_to: ["20260615-170803", "20260721-193101", "20260721-193102", "20260721-193106"]
release_impact: patch
---

## Request

La doble auditoría del 2026-07-23 (revisión integral en worktree + auditoría read-only de 20260721-193106) confirmó dos defectos en `graduate` para repos en modo worktree (legacy):

1. `changeledger graduate <id> <slug> --into --from <file>` acepta `--from` (pasa el guard «--from requires --into» del CLI) pero la rama legacy nunca lo lee: la graduación usa el contenido del spec existente y el archivo indicado se ignora en silencio.
2. El scaffold legacy con `--to` apuntando a un archivo existente lanza `Spec "<specName>" already exists`, nombrando el destino por defecto de specsDir en lugar de la ruta real de `--to`.

## Investigation

Causa raíz: el split state/legacy dentro de `src/commands/graduate.mjs`.

- En `graduate(...)`, la rama state (`store.mode === 'state'`) exige y aplica `from`: lee el archivo, rechaza el scaffold marker y escribe el contenido importado con `updated` y `graduated_from`. La rama legacy (a partir de la resolución con `graduationTarget`) no referencia el parámetro `from` en ningún punto, de modo que `--from` es un no-op silencioso. Sin cobertura: los tests solo ejercitan `from` en modo state.
- En `scaffoldSpec`, la rama state reporta `Scaffold target already exists: ${output}`; la legacy calcula `output = to ? path.resolve(cwd, to) : specFile` pero el error usa `Spec "${specName}" already exists`, incorrecto siempre que `output !== specFile`.

Cambios relacionados (contexto, sin orden de ejecución): [20260615-170803] definió `--into`; [20260721-193101] y [20260721-193102] introdujeron el modo dual state/worktree que creó la asimetría.

Decisión: paridad de semántica — legacy aplica `--from` igual que state (importar contenido refinado, validar marker) y unifica el diagnóstico de destino existente.

## Specification

### CR1 — La rama legacy aplica --from
- **Given** un repo en modo worktree con un change `done` graduable, un spec existente `specs/foo.md`, y un archivo `refined.md` cuyo contenido es un spec refinado sin scaffold marker
- **When** se ejecuta `changeledger graduate <id> foo --into --from refined.md`
- **Then** `specs/foo.md` contiene el cuerpo de `refined.md` con `updated` refrescado y `graduated_from: <id>`
- **And** el Log del change registra el evento `graduation` con `spec: foo.md`

### CR2 — --from legacy rechaza el scaffold marker
- **Given** el mismo repo y un `refined.md` que aún contiene el scaffold marker
- **When** se ejecuta `changeledger graduate <id> foo --into --from refined.md`
- **Then** falla con el error exacto `prepared spec still contains the scaffold marker — refine it before --into`
- **And** `specs/foo.md` queda intacto

### CR3 — El scaffold legacy nombra el destino real
- **Given** un repo en modo worktree con un change graduable y un archivo preexistente `docs/out.md`
- **When** se ejecuta el scaffold de graduación con `--to docs/out.md`
- **Then** falla con `Scaffold target already exists: <ruta absoluta de docs/out.md>` en lugar de `Spec "<specName>" already exists`

## Plan

- [x] Actualizar la rama legacy de `graduate()` en `src/commands/graduate.mjs` para leer y aplicar `from` con la misma validación que la rama state, escribiendo primero los tests rojos en `test/graduate.test.mjs`; verify: `node --test test/graduate.test.mjs` (CR1, CR2)
  - **Resolved:** `2026-07-23T17:48:25Z`
- [x] Unificar el diagnóstico de destino existente de `scaffoldSpec` en `src/commands/graduate.mjs` a `Scaffold target already exists: <output>`, con test rojo previo en `test/graduate.test.mjs`; verify: `node --test test/graduate.test.mjs` (CR3)
  - **Resolved:** `2026-07-23T17:48:25Z`
- [x] Ejecutar la suite completa y el gate tras la implementación; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-23T17:57:14Z`

## Log
- **2026-07-23T17:41:37Z** `[status]` draft → approved (human via conversation)
- **2026-07-23T17:41:38Z** `[status]` approved → in-progress
- **2026-07-23T17:41:38Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-23T17:41:58Z** `[note]` Ejecución en paralelo por write-sets disjuntos ordenada explícitamente por el humano (2026-07-23); orquestador retiene ledger, commits y gates.
- **2026-07-23T17:48:25Z** `[note]` Implementación delegada completa: rama legacy aplica --from con validación de marker; scaffoldSpec unifica diagnóstico a Scaffold target already exists. Test previo de mensaje exacto actualizado a la nueva redacción (cambio intencional de CR3). 39/39 en test/graduate.test.mjs.
- **2026-07-23T17:57:15Z** `[status]` in-progress → in-review
- **2026-07-23T17:58:45Z** `[review]` in-review → in-validation (delegated subagent, clean context)
