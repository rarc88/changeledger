---
id: "20260613-205852"
title: CLI para agentes: status, log, task, list, show
type: feature
status: draft
created: 2026-06-13T20:58:52Z
depends_on: ["20260613-135500"]
---

## Request

Comandos CLI aditivos para que los **agentes** muten y consulten changes sin
editar frontmatter a mano (donde el error es frecuente: timestamps UTC,
transiciones de estado, marcadores de tarea). Los archivos siguen siendo la
fuente de verdad; el CLI es un helper opcional, no obligatorio.

## Investigation

- Lo más frágil de editar a mano: timestamp ISO UTC, `status` válido, marcador
  de tarea correcto. Ahí el CLI aporta valor.
- Editar la prosa de las etapas NO es mecánico (es el trabajo del agente) → no se
  automatiza.
- Reusa el parser (`change.mjs`) y la validación (`check.mjs`) ya existentes.
- Mutaciones deben re-validar con `sl check <id>` el change tocado.

## Proposal

Comandos (aditivos, no rompen la edición manual):

- `sl status <id> <status>` — mueve el ciclo validando enum + existencia; añade
  entrada de Log automática.
- `sl log <id> "<msg>"` — añade entrada al `## Log` con timestamp UTC al inicio.
- `sl task <id> done|block <n> [reason]` — marca la tarea n del `## Plan`:
  `done` inyecta `— <UTC>`, `block` la pasa a `[!]` con motivo.
- `sl list [--status S] [--type T] [--json]` — lista changes filtrados.
- `sl show <id> [--json]` — emite el change (parseado) como JSON.

Todas escriben de forma idempotente y dejan el archivo válido para `sl check`.

## Specification

### CR1 — status válido
- **Given** un change y un estado del enum
- **When** ejecuto `sl status <id> <estado>`
- **Then** el frontmatter `status` cambia
- **And** se añade una entrada de Log con timestamp UTC

### CR2 — status inválido rechazado
- **Given** un estado fuera del enum
- **When** ejecuto `sl status <id> <estado>`
- **Then** falla con error y no modifica el archivo

### CR3 — log con timestamp
- **Given** un change
- **When** ejecuto `sl log <id> "texto"`
- **Then** se añade `- **<UTC>** — texto` al final del `## Log`

### CR4 — task done/block
- **Given** una tarea pendiente n en el Plan
- **When** ejecuto `sl task <id> done <n>`
- **Then** la tarea pasa a `[x]` con `— <UTC>`
- **And** `block <n> "motivo"` la pasa a `[!]` con el motivo

### CR5 — list y show
- **Given** changes en el repo
- **When** ejecuto `sl list --status approved --json`
- **Then** emite solo los approved en JSON
- **And** `sl show <id> --json` emite ese change parseado

## Plan

- [ ] Escritor de change: editar frontmatter y secciones preservando formato
- [ ] `sl status` (CR1, CR2)
- [ ] `sl log` (CR3)
- [ ] `sl task` done/block (CR4)
- [ ] `sl list` + `sl show` con `--json` (CR5)
- [ ] Tests de cada comando
- [ ] Actualizar AGENTS.md (comandos disponibles para agentes) y README

## Log

- **2026-06-13T20:58:52Z** — Creado en draft. Comandos elegidos con el humano:
  status, log, task (mutación), list, show (consulta). Aditivos; archivos siguen
  siendo la fuente de verdad.
