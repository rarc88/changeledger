---
id: "20260811-163204"
title: sync --status no exige resolver el remoto
type: quick
status: in-progress
created: 2026-08-11T16:32:04Z
depends_on: []
branch: quick/20260811-163204
related_to: ["20260811-151426"]
owner: rarc88
---

## Request

Follow-up del review de `20260811-151426`: `sync --status` resuelve el
remoto antes de la rama de status, así que en un repo con varios remotos
sin `origin` sale con error — rompe la promesa de "status gratis en
cualquier punto del flujo". `--status` es offline por contrato: debe
responder desde las copias remote-tracking existentes de la ref de estado
(si hay varias, reportar la relación por cada una; si no hay ninguna,
decirlo), sin resolver ningún remoto ni ejecutar red.

## Log
- **2026-08-11T16:32:33Z** `[status]` draft → approved (human via conversation)
- **2026-08-11T16:49:56Z** `[status]` approved → in-progress
- **2026-08-11T16:49:56Z** `[branch]` set: quick/20260811-163204 (auto)
