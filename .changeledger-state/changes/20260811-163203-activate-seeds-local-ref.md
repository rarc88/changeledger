---
id: "20260811-163203"
title: activate siembra la ref local desde la copia remote-tracking
type: quick
status: done
created: 2026-08-11T16:32:03Z
depends_on: []
branch: quick/20260811-163203
related_to: ["20260811-151426"]
owner: rarc88
---

## Request

Hueco de adopción hallado implementando `20260811-151426`: `git clone`
trae la ref de estado solo como remote-tracking
(`refs/remotes/<remote>/changeledger/state`) y `changeledger activate`
exige la local — hoy un clon necesita un `git update-ref` a mano.

`activate`, cuando la ref local falta y existe la copia remote-tracking
(remoto resuelto con la misma regla que `sync`: origin, o el único
configurado), la siembra por CAS de creación apuntando a esa copia,
reporta la siembra, y continúa la activación normal. Sin copia
remote-tracking, el error actual se conserva. `sync` sigue sin crear la
ref jamás (un repo sin activar se queda como está): el flujo del clon es
`clone → activate → sync`, un paso manual, nunca invisible.

## Log
- **2026-08-11T16:32:32Z** `[status]` draft → approved (human via conversation)
- **2026-08-11T16:32:52Z** `[status]` approved → in-progress
- **2026-08-11T16:32:52Z** `[branch]` set: quick/20260811-163203 (auto)
- **2026-08-11T16:36:17Z** `[note]` seedStateRef en el store (CAS create contra ausencia, readSnapshot ANTES de crear la ref — mutante del orden matado por el test del árbol inválido); activate siembra desde refs/remotes/<remote>/changeledger/state con resolveRemote exportado de sync; sin copia tracking, el error accionable original intacto. 3 tests, vistos fallar primero
- **2026-08-11T16:36:18Z** `[status]` in-progress → in-validation
- **2026-08-11T17:51:21Z** `[validation]` in-validation → done (human accepted via conversation)
