---
id: "20260617-195016"
title: Plan debe permitir tareas operativas sin CRn explícito
type: bug
status: done
created: 2026-06-17T19:50:16Z
depends_on: []
owner: raruiz-hiberuscom
reviewed: true
---

## Request

`sl check` advierte cualquier tarea de `## Plan` que no referencia un `CRn`. Eso
fuerza a mapear tareas puramente operativas — como correr `pnpm test`, leer un
wrapper antes de refactorizar, evaluar blast radius, o hacer bookkeeping de docs —
a criterios funcionales que no satisfacen directamente. El resultado es trazabilidad
ruidosa: el plan parece más completo para la máquina, pero menos honesto para el
humano.

La regla correcta debe distinguir entre:
- tareas de implementación/verificación que satisfacen un requisito (`CRn` requerido);
- tareas operativas/de soporte que hacen viable el trabajo, pero no son un requisito
  observable por sí mismas (`CRn` permitido pero no obligatorio).

## Investigation

El contrato canónico ya reconoce la excepción en `templates/AGENTS.md`:

```markdown
Pure support tasks (docs, scaffolding) may carry no `CR`
```

Pero el checker no implementa esa distinción. En `src/check.mjs`, `checkCoverage`
emite warning para toda tarea sin criterio:

```js
if (!task.criteria.length) {
  warn(c, `Plan task "${label}" references no criterion`);
}
```

Esto contradice el contrato y empuja a crear CRs artificiales como "sin regresión"
solo para colgar tareas de comandos (`pnpm test`, `sl check`) o tareas de lectura.

Casos legítimos detectados durante la revisión de drafts:
- `Correr pnpm test -- test/graduate.test.mjs`
- `Leer action() wrapper en bin/sl.mjs`
- `Evaluar blast radius`
- tareas de documentación de decisión cuando la documentación no es el requisito
  principal, sino soporte de mantenibilidad

La excepción no debe abrir la puerta a esconder implementación real sin CR. Si una
tarea cambia comportamiento, escribe código principal o añade tests para un requisito,
debe seguir referenciando los criterios que satisface.

## Specification

### CR1 — Tareas operativas explícitas pueden omitir CR
- **Given** un change con `tdd: true` y una tarea de Plan sin `CRn`
- **When** la tarea termina con el marcador explícito `(support)`
- **Then** `sl check` no emite warning de "references no criterion"
- **And** la tarea sigue apareciendo en el Plan y cuenta para progreso normal

### CR2 — Tareas de implementación siguen requiriendo CR
- **Given** un change con `tdd: true` y una tarea de Plan sin `CRn`
- **When** la tarea no termina con el marcador explícito `(support)`
- **Then** `sl check` conserva el warning actual de "references no criterion"
- **And** los criterios sin tareas de implementación siguen reportándose como no cubiertos

### CR3 — Convención documentada en contrato y spec
- **Given** un agente lee `templates/AGENTS.md` o `.sl/specs/architecture.md`
- **When** necesita añadir tareas como comandos de verificación, investigación previa o bookkeeping
- **Then** entiende que debe marcarlas con `(support)` al final de la tarea para omitir `CRn`
- **And** entiende que esa excepción no cubre tareas que implementan comportamiento requerido

### CR4 — Readiness no se aplica a tareas sin CR
- **Given** una tarea operativa sin `CRn`
- **When** `sl check` evalúa readiness configurado (`target_patterns` y `verification_patterns`)
- **Then** no exige target+verification para esa tarea
- **And** las tareas que sí referencian `CRn` mantienen la validación de readiness existente

## Plan

- [x] Documentar el marcador final `(support)` para tareas operativas sin CR en `templates/AGENTS.md` y `.sl/specs/architecture.md`, verificado por `test/cli.test.mjs` o `test/check.test.mjs` (CR1, CR3) — 2026-06-17T22:46:28Z
- [x] Ajustar `src/check.mjs` para no advertir tareas sin CR cuando usen la convención operativa documentada, cubierto por `test/check.test.mjs` (CR1, CR2, CR4) — 2026-06-17T22:46:28Z
- [x] Agregar tests en `test/check.test.mjs` sobre `src/check.mjs`: tarea operativa sin CR no advierte; tarea normal sin CR sigue advirtiendo; CR sin cobertura sigue advirtiendo (CR1, CR2) — 2026-06-17T22:46:28Z
- [x] Agregar tests o asserts en `test/cli.test.mjs` o `test/check.test.mjs` para que `templates/AGENTS.md` documente la convención y su límite (CR3) — 2026-06-17T22:46:29Z
- [x] Correr `pnpm test -- test/check.test.mjs test/cli.test.mjs` y `pnpm exec sl check --json` sobre `src/check.mjs`, `templates/AGENTS.md` y `.sl/specs/architecture.md` como verificación final (CR1, CR2, CR3, CR4) — 2026-06-17T22:46:29Z

## Log

- **2026-06-17T19:50:16Z** — Creado a partir de la revisión de drafts: las tareas de verificación y soporte no deberían necesitar CRs artificiales, pero el checker actual las advierte.
- **2026-06-17T20:04:30Z** — status: draft → approved
- **2026-06-17T22:44:54Z** — status: approved → in-progress
- **2026-06-17T22:44:54Z** — owner → raruiz-hiberuscom (auto)
- **2026-06-17T22:46:29Z** — status: in-progress → in-review
- **2026-06-17T22:47:22Z** — review → done (delegated subagent, clean context)
- **2026-06-17T22:47:23Z** — graduado a spec `architecture.md`
