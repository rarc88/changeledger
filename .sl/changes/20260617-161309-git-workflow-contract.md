---
id: "20260617-161309"
title: Exigir rama y commits atómicos por change
type: feature
status: done
created: 2026-06-17T16:13:09Z
depends_on: []
owner: Roberto Ruiz
reviewed: true
archived: true
---

## Request
Codex acumuló varios changes aprobados en un solo worktree y recién intentó
separarlos en commits al final. Eso rompió la trazabilidad práctica: aunque los
changes existían, la historia git no reflejó "un change, una intención, un corte".

Queremos que el contrato canónico de Spec Ledger haga explícito el flujo git que
ya esperábamos: no trabajar en rama principal, guardar la documentación aprobada
antes de implementar, y hacer commits atómicos al cerrar cada change.

## Investigation
- `templates/AGENTS.md` ya dice "Atomic commits" y "Work on a branch", pero la
  regla es demasiado general: no dice cuándo cortar, ni qué hacer cuando hay
  varios changes aprobados, ni que la documentación debe quedar committeada antes
  del código.
- Las instrucciones globales de Claude del usuario son más estrictas:
  - nunca commitear directo a `main`/`master`/`dev`;
  - antes de empezar, revisar cambios no relacionados y pedir instrucción;
  - commits atómicos: un cambio lógico por commit, sin mezclar.
- Spec Ledger necesita llevar esa disciplina al contrato de la herramienta para
  que no dependa del agente/harness que esté ejecutando.
- Si la documentación del change, su implementación, su review y su graduación
  quedan mezcladas con otros changes, se pierde la auditoría fina que el ledger
  intenta preservar.

## Proposal
Refinar `templates/AGENTS.md` §6 para convertir "Atomic commits" en un workflow
obligatorio:

- Antes de trabajar en changes aprobados, verificar la rama actual y no continuar
  en `main`, `master` o `dev`.
- Revisar el worktree; si hay cambios no relacionados, pedir instrucción antes de
  incluirlos, ignorarlos o crear commits.
- Tras aprobación humana, commitear la documentación del/de los changes aprobados
  antes de implementar.
- Implementar un change a la vez. Al completar un change (tests + review + spec
  graduation/skip), hacer commit con ese change y su verdad relacionada antes de
  empezar otro.
- Si un archivo compartido fuerza tocar más de un change en el mismo commit, el
  agente debe decirlo explícitamente en el mensaje o en el Log, pero debe tratarlo
  como excepción.

## Specification
### CR1 — No rama principal
- **Given** uno o varios changes aprobados
- **When** el agente va a empezar implementación
- **Then** el contrato exige verificar que no está en `main`, `master` ni `dev`
- **And** si está en una rama protegida, debe crear/cambiar a una rama de trabajo
  o pedir instrucción antes de continuar

### CR2 — Documentación antes de código
- **Given** un change fue aprobado por el humano
- **When** el agente va a implementar
- **Then** la documentación del change aprobado se commitea antes de tocar código

### CR3 — Commit por change completado
- **Given** un change llega a completado con tests, review y graduación/skip
- **When** el agente quiere continuar con otro change
- **Then** primero crea un commit atómico que incluye solo ese change y su verdad
  relacionada

### CR4 — Worktree sucio no relacionado
- **Given** el worktree contiene cambios no relacionados
- **When** el agente detecta esos cambios antes o durante la implementación
- **Then** no los incluye silenciosamente; pide instrucción o los deja fuera del
  commit

### CR5 — Excepciones explícitas
- **Given** un archivo compartido hace impracticable separar dos changes sin
  parches frágiles
- **When** el agente crea un commit combinado
- **Then** lo declara como excepción y explica qué changes comparten la superficie

## Plan
- [x] Actualizar `templates/AGENTS.md` §6 y verificar con `test/cli.test.mjs` que atomic commits sean un workflow git obligatorio (CR1, CR2, CR3, CR4, CR5) — 2026-06-17T16:25:29Z
- [x] Añadir assertions en `test/cli.test.mjs` sobre `templates/AGENTS.md` y verificar con `pnpm test -- test/cli.test.mjs` las frases clave del workflow instalado (CR1, CR2, CR3, CR4, CR5) — 2026-06-17T16:25:29Z
- [x] Ejecutar `pnpm test -- test/cli.test.mjs` y `node bin/sl.mjs check` para validar `templates/AGENTS.md` y el ledger (CR1, CR2, CR3, CR4, CR5) — 2026-06-17T16:25:29Z

## Log
- **2026-06-17T16:13:09Z** — Creado tras fricción: Codex acumuló varios changes
  sin commits intermedios; la regla actual de atomic commits fue insuficiente.
- **2026-06-17T16:21:37Z** — status: draft → approved
- **2026-06-17T16:24:47Z** — status: approved → in-progress
- **2026-06-17T16:24:47Z** — owner → Roberto Ruiz (auto)
- **2026-06-17T16:25:47Z** — status: in-progress → in-review
- **2026-06-17T16:26:30Z** — review → done (delegated subagent, clean context)
- **2026-06-17T16:26:53Z** — graduado a spec `architecture.md`
- **2026-06-17T16:27:34Z** — archived
