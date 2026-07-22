---
id: "20260722-202101"
title: Acotar el error de activación y el exit code de sync
type: bug
status: draft
created: 2026-07-22T20:21:01Z
depends_on: []
related_to: ["20260721-193106", "20260721-193102", "20260721-193103"]
release_impact: patch
---

## Request

La ejecución paralela de la auditoría `20260721-193106` encontró dos defectos de
observabilidad operacional que rompen el triage y la automatización. Se agrupan
por superficie de operación (diagnóstico de la CLI de estado); divisibles antes
de aprobar si el humano lo prefiere.

1. A 5.000 changes, `state activate --prepare` falló con `ok:false` y un campo
   `error` que serializa el plan de migración completo (~2 MB) en vez de un
   diagnóstico acotado: la causa real es irrecuperable del output y bloqueó la
   medición de todo el volumen.
2. `state sync` devuelve exit 0 cuando la publicación falla o queda ambigua
   (push fallido con pending conservado, o respuesta perdida): un script o CI
   con `changeledger state sync && …` trata un pending no publicado como éxito
   — exactamente la inferencia por exit code que el protocolo del audit
   prohíbe.

## Investigation

1. **Error gigante de activación:** algún camino de fallo de la activación
   interpola un objeto de plan/inventario completo en `error.message` en vez de
   un mensaje acotado (localizado en la ruta de `prepareStateActivation`
   /`stateFailureReceipt`; el log de evidencia de la ejecución paralela contiene
   el volcado ~2 MB). Un operador no puede diagnosticar el fallo y cualquier
   pipeline que capture stderr arrastra megabytes.
2. **Exit code de sync:** `bin/changeledger.mjs` (acción de `state sync`)
   imprime `pending publication`/`Publication result ambiguous` cuando
   `result.pending && !result.confirmed`, pero no ajusta `process.exitCode`.
   Verificado en las filas FLT-4/FLT-5 de la ejecución paralela: push fallido y
   push-con-respuesta-perdida devolvieron ambos exit 0.

## Specification

### CR1 — Los fallos de activación producen un diagnóstico acotado
- **Given** una activación que falla por cualquier causa
- **When** se emite el error y el receipt
- **Then** el mensaje identifica la causa en tamaño acotado (sin serializar
  planes ni inventarios completos) y conserva los campos del receipt
- **And** el detalle voluminoso solo es accesible de forma explícita (p. ej.
  archivo de plan referenciado), nunca inline en `error`

### CR2 — Una publicación no confirmada nunca sale con exit 0
- **Given** un `state sync` cuya publicación falla o queda ambigua (pending
  conservado sin confirmación)
- **When** el comando termina
- **Then** el exit code es distinto de 0 y de los errores fatales existentes,
  y el output identifica el estado real (pending conservado, causa)
- **And** un sync convergente sin pending sigue saliendo con exit 0

## Plan

- [ ] Añadir test fallido del error de activación acotado (fixture que fuerce el fallo con plan grande) y acotar el formateo en `src/state-migration.mjs`/`bin/changeledger.mjs`; verify: `node --test test/state-migration.test.mjs test/cli-bin.test.mjs` (CR1)
- [ ] Añadir tests fallidos de exit code para push fallido y respuesta perdida, y ajustar `process.exitCode` en la acción de `state sync` de `bin/changeledger.mjs`; verify: `node --test test/state-command.test.mjs test/cli-bin.test.mjs` (CR2)
- [ ] Ejecutar el gate completo; verify: `pnpm verify` (support)

## Log

- **2026-07-22T20:21:01Z** `[note]` Draft creado desde la unión de las dos ejecuciones de 20260721-193106 (fallo de activación a 5.000 con volcado ~2 MB; FLT-4/FLT-5 exit 0 con publicación fallida/ambigua). Ambos defectos rompen automatización y triage; ninguno pierde datos.
