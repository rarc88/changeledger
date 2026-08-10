---
id: "20260810-213635"
title: "Regla de contrato: CR de primer uso end-to-end"
type: quick
status: approved
created: 2026-08-10T21:36:35Z
depends_on: []
related_to: ["20260810-182641"]
owner: rarc88
---

## Request

Corrección de proceso acordada con el humano (2026-08-10): la costura de
autoría (`20260810-182641`) era descubrible en el spec del cutover con la
pregunta "¿cómo funciona el primer día de trabajo completo tras esto?" — el
corte se blindó hacia atrás (undo, decoys) y nadie caminó el flujo hacia
adelante; el hueco lo encontró el experimento, tarde.

Regla nueva en `templates/contract/spec.md` (sección de criterios): un
feature que entrega o altera un workflow incluye un CR que camina su primer
uso real end-to-end — el camino feliz completo del día siguiente, no solo
los bordes. Redacción tolerante a reescritura; si se añade concept guard,
guarda la obligación, jamás el fraseo. Respetar el techo de `budgets.yml`
con la misma disciplina: si no cabe, volver al humano.

## Log
- **2026-08-10T21:38:11Z** `[status]` draft → approved (human via conversation)
