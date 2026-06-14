---
id: "20260614-124047"
title: Auto-asignar owner desde git al pasar a in-progress
type: feature
status: done
created: 2026-06-14T12:40:47Z
depends_on: ["20260613-222912"]
reviewed: true
---

## Request

Añadimos el campo `owner` (#222912) pero nada le dice al agente que lo ponga ni
de dónde sacarlo. El momento preciso para fijarlo es cuando **empieza** el
trabajo: la transición `approved → in-progress`. Ahí, tomar el owner de
`git config user.name` (quien arranca, es quien lo trabaja). Documentarlo en el
contrato para que los agentes lo conozcan.

## Investigation

- `owner` = responsable/asignado, no el autor de git en abstracto; pero quien
  ejecuta `sl status <id> in-progress` es justamente quien se pone a trabajarlo,
  así que su identidad git es un buen proxy y se captura en el instante correcto.
- Un owner asignado antes a mano (`sl owner`) representa una decisión explícita y
  no debe pisarse: solo autocompletar si está vacío.
- Leer git acopla `status()` a un exec; debe ser inyectable para tests y tolerante
  (sin git / sin user.name → no rompe, owner queda vacío).
- Solo aplica al entrar a `in-progress`; otras transiciones no tocan owner.

## Proposal

- `gitUser(cwd, run)` en git.mjs: devuelve `git config user.name` (trim) o `''`.
- `status()` acepta `{ gitUser }` (default real, inyectable en test). Al pasar a
  `in-progress`, si el change no tiene owner y `gitUser` devuelve algo, fija
  `owner` y lo registra en el Log (`owner → X (auto)`).
- AGENTS.md: documentar el campo `owner` y esta automatización (overridable con
  `sl owner <id> <name|->`).

Descartado: fijarlo en `created` (no se sabe aún quién lo hará) o en
`approved` (el humano aprueba, no necesariamente trabaja).

## Specification

### CR1 — Autoasignar al entrar a in-progress
- **Given** un change `approved` sin owner
- **When** ejecuto `sl status <id> in-progress` con un git user resoluble
- **Then** el frontmatter queda con `owner` = ese git user
- **And** se registra en el Log

### CR2 — Respetar owner explícito
- **Given** un change con owner ya asignado
- **When** pasa a `in-progress`
- **Then** el owner no se sobrescribe

### CR3 — Tolerancia
- **Given** un entorno sin `git config user.name`
- **When** pasa a `in-progress`
- **Then** no falla y el owner queda sin asignar

## Plan

- [x] `gitUser(cwd, run)` en git.mjs (CR1, CR3) — 2026-06-14T12:42:37Z
- [x] `status()` autocompleta owner al entrar a in-progress si está vacío (CR1, CR2, CR3) — 2026-06-14T12:42:37Z
- [x] Documentar `owner` y la automatización en AGENTS.md — 2026-06-14T12:42:38Z
- [x] Tests: autoasigna, respeta existente, tolera sin git (CR1, CR2, CR3) — 2026-06-14T12:42:38Z

## Log
- **2026-06-14T12:42:38Z** — status: in-progress → done
