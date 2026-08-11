---
id: "20260810-213635"
title: "Regla de contrato: CR de primer uso end-to-end"
type: quick
status: done
created: 2026-08-10T21:36:35Z
depends_on: []
archived: true
reviewed: true
branch: quick/20260810-213635
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
- **2026-08-10T21:45:12Z** `[status]` approved → in-progress
- **2026-08-10T21:45:12Z** `[branch]` set: quick/20260810-213635 (auto)
- **2026-08-10T21:45:13Z** `[owner]` set: claude
- **2026-08-10T21:48:28Z** `[note]` Regla añadida al bloque de criterios de spec.md. Primera redacción excedió el techo por 6 tokens (2506/2500, cazado por 225213 CR6 y 6 cascadas); recortada la frase de rationale de la PROPIA adición — la normativa existente intacta. Gate 1396/1396. Sin concept guard nuevo: la obligación queda barrida por los budgets y su redacción es tolerante
- **2026-08-10T21:48:28Z** `[status]` in-progress → in-validation
- **2026-08-11T00:35:22Z** `[validation]` in-validation → done (human accepted via conversation)
- **2026-08-11T00:36:11Z** `[graduation]` skipped: la verdad duradera es el propio fragmento versionado templates/contract/spec.md
- **2026-08-11T00:36:12Z** `[archive]` archived
- **2026-08-11T11:57:28Z** `[owner]` set: rarc88
