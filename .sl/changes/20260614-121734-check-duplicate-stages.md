---
id: "20260614-121734"
title: El check no detecta etapas duplicadas
type: bug
status: done
created: 2026-06-14T12:17:34Z
depends_on: []
reviewed: true
---

## Request

Un change con una etapa repetida (p.ej. dos `## Proposal`) pasa `sl check` sin
error. Se descubrió en el change 111153, que llegó a `approved` con `## Proposal`
duplicado. El validador debe detectarlo.

## Investigation

- Causa raíz: `checkRepo` comprueba orden canónico, etapas activas y etapas
  desconocidas, pero nunca cuenta repeticiones. Con dos `proposal`, el orden
  relativo es válido (proposal == proposal), ambas son etapa conocida y activa,
  así que no salta nada.
- `splitStages` (change.mjs) sí conserva ambas como entradas separadas con la
  misma `key`, así que la duplicación es observable en `c.stages`.

## Specification

### CR1 — Etapa duplicada es error
- **Given** un change con dos headings `## Proposal`
- **When** ejecuto `sl check`
- **Then** se reporta un error de etapa duplicada nombrando la etapa
- **And** un change sin repeticiones no genera ese error

## Plan

- [x] `checkRepo`: contar keys de etapa repetidas y emitir error por cada una (CR1) — 2026-06-14T12:18:19Z
- [x] Test: etapa duplicada = error; sin duplicados no falsea (CR1) — 2026-06-14T12:18:19Z

## Log
- **2026-06-14T12:18:19Z** — status: in-progress → done
