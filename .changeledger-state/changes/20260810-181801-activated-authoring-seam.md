---
id: "20260810-181801"
title: Costura de autoría de documentos en modo activado
type: feature
status: approved
created: 2026-08-10T18:18:01Z
depends_on: []
related_to: ["20260810-180434"]
owner: rarc88
---

## Request

Hallazgo de la 2ª ronda del experimento de activación (2026-08-10): en un
repo activado no existe ninguna vía soportada para escribir la PROSA de un
documento del ledger. `new` scaffoldea en la ref, el lifecycle
(`status`/`log`/`task`/`owner`) muta sus campos, y las rutas de escritura
del viewer son solo status/config/path/remove — pero el cuerpo (Request,
Investigation, Proposal, Specification, Plan) no tiene camino de escritura.
El draft `20260810-180434` quedó scaffoldeado VACÍO en la ref
(commit `bd6bf6c6`) y no pudo rellenarse.

Requisito de diseño fijado por el humano (2026-08-10): **nada de commits a
cuentagotas en la ref de estado**. El journal es permanente — reescribirlo
rompería el CAS y, con sync, a todos los clones — así que cada entrada debe
ser un evento con significado: un documento aterriza COMPLETO, y cada
edición posterior es un guardado deliberado, como ya hace `import`
(todo-o-nada, un commit). Estados intermedios a medio escribir no entran
nunca en la ref.

Alcance esperado:

- Un camino de edición de cuerpo para el agente (decisión de diseño
  pendiente: contenido por archivo/stdin hacia `mutateLedgerFile`, u otro),
  capaz de editar documentos existentes — su primer dogfood es rellenar el
  draft `20260810-180434`.
- Corregir `new` en modo activado: no publicar un scaffold vacío en la ref
  (aceptar el cuerpo como entrada, o no commitear hasta tenerlo).
- La granularidad del journal para el lifecycle actual (un commit CAS por
  mutación con significado) se mantiene; si el humano quiere agrupar también
  eventos de lifecycle, eso se mide aparte contra el presupuesto de INTENT.

## Investigation

## Proposal

## Specification

## Plan

## Log
- **2026-08-10T18:24:41Z** `[status]` draft → approved (human via conversation)
