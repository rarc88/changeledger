---
id: "20260811-163205"
title: mutateState valida el candidato antes del CAS
type: quick
status: approved
created: 2026-08-11T16:32:05Z
depends_on: []
related_to: ["20260811-151426"]
owner: rarc88
---

## Request

Nota pre-existente del review de `20260811-151426`: `mutateState` valida
el snapshot resultante DESPUÉS de mover la ref, el mismo orden que F1
corrigió en `commitMergedState`. El contenido aquí es de autoría local
(no un árbol remoto no confiable), así que el riesgo es menor — pero el
invariante del store es uno: la ref nunca apunta a una revisión que
ningún lector pueda cargar. Reordenar al asiento común (validar antes del
CAS, como `advanceStateRef` y `commitMergedState`), con el test del borde
que hoy falta.

## Log
- **2026-08-11T16:32:33Z** `[status]` draft → approved (human via conversation)
