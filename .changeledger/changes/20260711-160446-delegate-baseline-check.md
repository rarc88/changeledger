---
id: "20260711-160446"
title: El delegado verifica su baseline antes de implementar
type: feature
status: done
created: 2026-07-11T16:04:46Z
depends_on: []
release_impact: minor
owner: raruiz-hiberuscom
reviewed: true
---

## Request

En la orquestación paralela del 2026-07-11, dos olas de delegados empezaron
sobre una base equivocada: sus worktrees nacían de `main` sin la rama del
change, `agent-context` no resolvía el documento y un delegado llegó a operar
sobre el checkout principal. El contrato no dice qué hacer cuando la cápsula no
resuelve; hace falta una regla mínima y agnóstica del harness.

## Investigation

- El fallo es del entorno de aislamiento del harness (worktrees creados desde
  la rama por defecto), no de ChangeLedger; pero el contrato puede convertirlo
  en una parada limpia en vez de trabajo perdido.
- `changeledger agent-context implementation <id>` ya falla con error claro si
  el change no existe o su status no admite el rol: es el detector natural de
  baseline equivocado, sin comando nuevo.
- El skeleton (`templates/contract/agent-prompts/implementation.md`) hoy ordena
  cargar la cápsula pero no define la reacción ante su fallo; el fragmento de
  delegación (`templates/contract/delegation.md`) pide ownership, salida e
  integración pero no exige declarar la base esperada.
- Superficie protegida por snapshots normalizados y matriz semántica en
  `test/context.test.mjs`: el cambio exige reclasificación explícita.

## Proposal

Dos frases, cada una en su fragmento propietario:

- Skeleton de implementación: si `agent-context implementation <id>` no
  resuelve el change (o el working tree no contiene su documento), el delegado
  se detiene y lo reporta; nunca reconstruye el change de memoria ni trabaja
  desde otra base.
- Fragmento de delegación (lado orquestador): todo prompt de implementación
  declara la base esperada (rama o commit) sobre la que el delegado debe
  verificar que trabaja.

Alternativa descartada: un comando de verificación nuevo — `agent-context` ya
falla cerrado; añadir superficie duplicaría el detector.

## Specification

### CR1 — El skeleton define la parada por baseline
- **Given** el skeleton emitido por `changeledger agent-prompt implementation`
- **When** se lee su texto
- **Then** instruye detenerse y reportar cuando `agent-context implementation <id>` no resuelve el change o el documento no está en el working tree
- **And** prohíbe reconstruir el change de memoria o continuar desde otra base

### CR2 — La delegación exige declarar la base
- **Given** el fragmento de delegación compuesto en `changeledger context spec` y `changeledger context implement`
- **When** se lee el contrato del prompt de delegación
- **Then** la lista de elementos obligatorios del prompt incluye la base esperada (rama o commit) para roles que escriben

### CR3 — Gate contractual reclasificado
- **Given** los snapshots normalizados y la matriz semántica de `test/context.test.mjs`
- **When** se ejecuta la suite tras el cambio
- **Then** pasa con las nuevas frases clasificadas explícitamente y sin pérdida de reglas existentes
- **And** los budgets de `templates/contract/budgets.yml` se mantienen dentro de límites

## Plan

- [x] Añadir la regla de parada al skeleton `templates/contract/agent-prompts/implementation.md` con aserción en `test/agent-prompt.test.mjs`; verify: `node --test test/agent-prompt.test.mjs` (CR1) — 2026-07-11T16:31:13Z
- [x] Añadir la base esperada al contrato de prompt en `templates/contract/delegation.md` con cobertura en `test/context.test.mjs`; verify: `node --test test/context.test.mjs` (CR2) — 2026-07-11T16:31:13Z
- [x] Reclasificar snapshots y matriz semántica de los fragmentos de `templates/contract/` en `test/context.test.mjs` y validar budgets; verify: `node --test test/context.test.mjs` (CR3) — 2026-07-11T16:31:13Z
- [x] Ejecutar `pnpm verify` completo tras la implementación (support) — 2026-07-11T16:31:13Z

## Log
- **2026-07-11T16:13:59Z** — status: draft → approved
- **2026-07-11T16:23:17Z** — status: approved → in-progress
- **2026-07-11T16:23:17Z** — owner → raruiz-hiberuscom (auto)
- **2026-07-11T16:31:14Z** — Integrada implementación delegada (6468786, 2e5fbd1): regla de parada en el skeleton de implementación, baseline esperada en el contrato de prompt de delegación, snapshot de delegation.md reclasificado como aditivo, budgets bajo hard caps. pnpm verify verde.
- **2026-07-11T16:31:14Z** — status: in-progress → in-review
- **2026-07-11T16:34:25Z** — review → in-validation (delegated subagent, clean context)
- **2026-07-11T21:37:34Z** — validation → done (human accepted)
- **2026-07-11T21:51:13Z** — graduado a spec `lifecycle.md`
