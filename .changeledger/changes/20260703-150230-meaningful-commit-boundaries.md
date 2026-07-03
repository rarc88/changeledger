---
id: "20260703-150230"
title: Commits por evidencia significativa del change
type: feature
status: in-progress
created: 2026-07-03T15:02:30Z
depends_on: []
release_impact: minor
owner: Roberto Ruiz
---

## Request

Reducir commits que solo registran movimientos administrativos como
`in-progress → in-review`, `in-review → in-validation` y
`in-validation → done`, sin perder la evidencia del documento aprobado, las
correcciones verificadas ni la cronología del lifecycle.

## Investigation

El contrato exige commitear la documentación aprobada antes de implementar,
mantener status, tareas y Log al día y commitear unidades completas cuando la
atribución pueda volverse ambigua. No exige literalmente un commit por
transición, pero la combinación de esas reglas permite esa interpretación.

Los timestamps del Log ya conservan la secuencia exacta de estados. Repetir la
misma granularidad en Git añade ruido cuando no existe código, documentación
sustantiva, evidencia de review o una frontera real de handoff. El commit de
inicio sí es diferente: fija el baseline aprobado del que parte la
implementación.

## Proposal

Definir commits por evidencia significativa y coalescer las transiciones con el
commit sustantivo más cercano. El baseline `approved → in-progress` se mantiene
obligatorio antes de tocar código. El paso a `in-review` acompaña al último
commit de implementación; el veredicto a `in-validation` espera al cierre salvo
que incluya evidencia persistente o exista un handoff real; `done` y la decisión
de graduación se consolidan en un commit final.

El Log no se reduce ni se difiere: sigue actualizándose en el momento de cada
evento. La optimización afecta a los límites de Git, no a la verdad del ledger.
Un checkpoint administrativo queda permitido cuando un cambio de agente,
worktree o sesión necesita persistir estado antes de que exista otro commit
sustantivo, pero agrupa todo el estado pendiente en uno solo.

## Specification

### CR1 — Baseline obligatorio
- **Given** un change aprobado que va a comenzar implementación
- **When** el agente lo mueve a `in-progress`
- **Then** commitea el documento inicial completo antes de modificar código
- **And** el commit identifica el change con el formato canónico

### CR2 — Unidad significativa de implementación
- **Given** código, tests o documentación sustantiva completados para una unidad atribuible
- **When** el agente crea un commit de implementación
- **Then** incluye las tareas y entradas de Log relacionadas con esa misma evidencia
- **And** puede incluir la transición a `in-review` sin crear después un commit exclusivo para ella

### CR3 — Transiciones sin commit dedicado
- **Given** una transición a `in-review` o `in-validation` que solo modifica frontmatter y Log
- **When** no existe una frontera de handoff ni evidencia adicional
- **Then** el agente no crea un commit exclusivo para ese movimiento
- **And** conserva la modificación para el siguiente commit sustantivo o de cierre

### CR4 — Correcciones verificadas
- **Given** una corrección tras fallo de review o rechazo humano
- **When** alcanza el gate de verificación exigido por el contrato
- **Then** la corrección se commitea con sus tests, tareas y Log como una unidad significativa
- **And** los intentos todavía no confirmados permanecen sin commit conforme a la política vigente

### CR5 — Cierre consolidado
- **Given** un change aceptado por el humano y con graduación o skip resuelto
- **When** el agente cierra el trabajo Git pendiente
- **Then** consolida `in-validation → done`, la resolución de graduación y las entradas finales en un solo commit de cierre
- **And** no crea commits separados cuyo único contenido sea cada transición

### CR6 — Excepción de handoff
- **Given** estado de lifecycle sin commit y un handoff real a otra sesión, agente o worktree antes del siguiente commit sustantivo
- **When** es necesario persistir una frontera recuperable
- **Then** se permite un único checkpoint que agrupe todo el estado pendiente
- **And** el Log o handoff explica por qué fue necesario

## Plan

- [ ] Define evidence-based commit boundaries in `templates/contract/implement.md`, `templates/contract/review.md`, `templates/contract/validation.md` and `templates/contract/close.md`, including reviewed assertions in `test/context.test.mjs`; verify: `node --test test/context.test.mjs test/cli.test.mjs` (CR1, CR2, CR3, CR4, CR5, CR6)
- [ ] Record durable Git boundary policy in `.changeledger/specs/lifecycle.md`; verify: `node bin/changeledger.mjs check 20260703-150230` (CR1, CR2, CR3, CR4, CR5, CR6)
- [ ] Run the complete quality gate after implementation; verify: `pnpm verify` (support)

## Log

- 2026-07-03T15:02:30Z — Se preservó el baseline de inicio como evidencia
  obligatoria y se decidió que el Log, no un commit por estado, conserva la
  granularidad temporal del lifecycle.
- **2026-07-03T15:11:49Z** — status: draft → approved
- **2026-07-03T15:17:07Z** — status: approved → in-progress
- **2026-07-03T15:17:07Z** — owner → Roberto Ruiz (auto)
