---
id: "20260722-202101"
title: Acotar el diagnóstico de fallo de activación
type: bug
status: draft
created: 2026-07-22T20:21:01Z
depends_on: []
related_to: ["20260721-193106", "20260721-193103", "20260722-203028"]
release_impact: patch
---

## Request

La ejecución paralela de la auditoría `20260721-193106` encontró que un fallo de
`state activate --prepare` a 5.000 changes produce un `error` de ~2 MB que
serializa contenido del plan/manifest en vez de un diagnóstico acotado: la causa
real es irrecuperable del output, cualquier pipeline que capture stderr arrastra
megabytes, y el fallo bloqueó la medición de todo ese volumen en la auditoría.

Nota de alcance: este change cubre solo el diagnóstico de activación. El exit
code engañoso de `state sync` es un defecto independiente con su propio draft
(`20260722-203028`).

## Investigation

Mecanismo localizado: `createStateBaseline`/la validación del baseline agregan
errores sin tope — `state baseline validation failed:
${errors.map((error) => error.message).join('; ')}`
(`src/state-migration.mjs:850`). Con miles de documentos inválidos el join
produce megabytes. Además, el payload observado en la evidencia arranca con el
YAML del manifest, lo que indica que al menos un mensaje individual de
`checkRepo`/parseo embebe contenido completo de documento en vez de una
referencia (identidad + path + regla violada). Ambas cosas deben acotarse: la
agregación y los mensajes individuales.

## Specification

### CR1 — Los fallos de activación producen un diagnóstico acotado
- **Given** una activación o creación de baseline que falla con N errores de
  validación, para cualquier N
- **When** se emite el error y el receipt
- **Then** el mensaje completo no supera 4 KB: reporta los primeros 5 errores
  (identidad, path y regla violada, sin contenido embebido de documentos) y el
  total restante como contador
- **And** los campos estructurados del receipt (`written`, `baseline`,
  `sources`, `network`) se conservan intactos

### CR2 — Ningún mensaje individual embebe documentos completos
- **Given** cualquier error de validación de un documento durante
  preview/create/activate
- **When** se formatea su mensaje
- **Then** referencia el documento por identidad y path, nunca por su contenido
  serializado

## Plan

- [ ] Añadir test fallido con una fixture que genere muchos errores de validación y verifique el tope de 4 KB, los 5 primeros errores con identidad/path/regla y el contador del resto; acotar la agregación en `src/state-migration.mjs:850` y auditar los mensajes individuales que embeben contenido; verify: `node --test test/state-migration.test.mjs test/cli-bin.test.mjs` (CR1, CR2)
- [ ] Ejecutar el gate completo; verify: `pnpm verify` (support)

## Log

- **2026-07-22T20:21:01Z** `[note]` Draft creado desde la unión de las dos ejecuciones de 20260721-193106 (fallo de activación a 5.000 con volcado ~2 MB en el campo error).
- **2026-07-22T20:35:00Z** `[note]` Ajustado por revisión del auditor principal: dividido — el exit code de sync pasa a 20260722-203028; causa raíz localizada (agregación sin tope en src/state-migration.mjs:850 más mensajes que embeben contenido); límite numérico explícito (4 KB, primeros 5 errores + contador).
