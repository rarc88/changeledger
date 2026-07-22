---
id: "20260722-202101"
title: Acotar los diagnósticos de validación del cutover
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

Nota de alcance: este change cubre solo los diagnósticos de creación y
activación del cutover. El exit
code engañoso de `state sync` es un defecto independiente con su propio draft
(`20260722-203028`).

## Investigation

Mecanismo localizado: existen dos agregadores sin tope en
`src/state-migration.mjs`. `candidateSnapshot` usa `migration candidate
validation failed: ${errors.map(...).join('; ')}` (líneas 555–559) durante
`--create`; `readStateBaseline` usa `state baseline validation failed:
${errors.map(...).join('; ')}` (líneas 848–852) cuando activación vuelve a leer
el baseline. Con miles de documentos inválidos cualquiera de los dos joins
produce megabytes. Además, el payload observado en la evidencia arranca con el
YAML del manifest, lo que demuestra que al menos un mensaje individual de
`checkRepo`/parseo embebe contenido completo de documento en vez de una
referencia (identidad + path + regla violada). Deben acotarse independientemente
los dos agregadores y los mensajes individuales.

## Specification

### CR1 — La creación produce un diagnóstico acotado
- **Given** un `state migrate --create` que genera N errores en la validación
  del snapshot candidato, para cualquier N
- **When** se emite el error y el receipt de creación
- **Then** el mensaje completo no supera 4 KB: reporta los primeros 5 errores
  (identidad, path y regla violada, sin contenido embebido de documentos) y el
  total restante como contador
- **And** los campos estructurados del receipt (`written`, `baseline`,
  `sources`, `network`) se conservan intactos

### CR2 — La activación produce un diagnóstico acotado
- **Given** un `state activate --prepare` cuyo baseline genera N errores al
  volver a validarse, para cualquier N
- **When** se emite el error y el receipt de activación
- **Then** el mensaje completo no supera 4 KB con los primeros 5 errores y el
  contador del resto, bajo el mismo formato de identidad, path y regla
- **And** los campos estructurados del receipt permanecen intactos

### CR3 — Ningún mensaje individual embebe documentos completos
- **Given** cualquier error de validación de un documento durante
  preview/create/activate
- **When** se formatea su mensaje
- **Then** referencia el documento por identidad y path, nunca por su contenido
  serializado

## Plan

- [ ] Añadir un test fallido de `state migrate --create` con muchos errores y acotar el agregador de `candidateSnapshot` en `src/state-migration.mjs`; verify: `node --test test/state-migration.test.mjs test/cli-bin.test.mjs` comprobando ≤4 KB, cinco errores, contador y receipt intacto (CR1)
- [ ] Añadir un test fallido de `state activate --prepare` con un baseline inválido y acotar el agregador de `readStateBaseline` en `src/state-migration.mjs`; verify: `node --test test/state-migration.test.mjs test/cli-bin.test.mjs` comprobando ≤4 KB, cinco errores, contador y receipt intacto (CR2)
- [ ] Auditar y corregir en `src/check.mjs` y los parsers invocados por `src/state-migration.mjs` los mensajes que embeben contenido documental; verify: `node --test test/state-migration.test.mjs test/check.test.mjs` con manifest y documentos grandes ausentes del error de preview/create/activate (CR3)
- [ ] Ejecutar el gate completo; verify: `pnpm verify` (support)

## Log

- **2026-07-22T20:21:01Z** `[note]` Draft creado desde la unión de las dos ejecuciones de 20260721-193106 (fallo de activación a 5.000 con volcado ~2 MB en el campo error).
- **2026-07-22T20:35:00Z** `[note]` Ajustado por revisión del auditor principal: dividido — el exit code de sync pasa a 20260722-203028; causa raíz localizada (agregación sin tope en src/state-migration.mjs:850 más mensajes que embeben contenido); límite numérico explícito (4 KB, primeros 5 errores + contador).
- **2026-07-22T20:41:30Z** `[note]` Causa raíz completada: create y activate usan agregadores distintos en candidateSnapshot y readStateBaseline; cada camino recibe su propio criterio y regresión.
