---
id: "20260722-202101"
title: Acotar los diagnósticos de validación del cutover
type: bug
status: in-review
created: 2026-07-22T20:21:01Z
depends_on: []
owner: raruiz-hiberuscom
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

Causa raíz confirmada empíricamente, distinta de la hipótesis original de este
draft: no es una agregación de miles de errores de `checkRepo`. `gitOutput`
(`src/state-migration.mjs:49-67`) llama a `execFileSync` sin `maxBuffer`, así
que Node aplica su límite por defecto (~1 MiB). A 5.000 changes, `git show
<rev>:.changeledger-state/manifest.yml` — el manifest completo, con el
inventario de candidatos de cada documento — supera ese límite; `execFileSync`
lanza `ENOBUFS` con `error.message` corto (`spawnSync git ENOBUFS`) pero con
`error.stdout` conteniendo el contenido truncado hasta el límite (verificado
reproduciendo el mismo mecanismo: un proceso hijo que escribe >1 MiB de stdout
produce exactamente esa forma de fallo, con `~1 MiB` de `stdout` capturado). El
catch de `gitOutput` (líneas 59-66) concatena `error.stderr`+`error.stdout` y
usa ese resultado como mensaje del nuevo `Error` — así que el YAML parcial del
manifest se convierte literalmente en `error.message`, y de ahí se propaga sin
más formateo hasta el receipt de fallo del CLI. Esto reproduce con exactitud el
payload observado en la evidencia (arranca con `format_version: 1\n...`, usa
anchors YAML `&a1`/`*a1` — la forma en que `stringifyYaml` serializa objetos
repetidos —, y su tamaño coincide con el límite de buffer de Node).

Los dos agregadores identificados originalmente (`candidateSnapshot` en
`src/state-migration.mjs:555-559` para `--create`, y la validación de
`readStateMetadata` en `src/state-migration.mjs:848-852` para activación, ambos
con `errors.map((error) => error.message).join('; ')` sin tope) siguen siendo un
riesgo real e independiente: con miles de documentos inválidos el join también
puede producir mensajes de cientos de KB aunque `gitOutput` esté corregido. Se
mantienen como CR1/CR2; el mecanismo de `gitOutput` es CR4, y es el que
reproduce exactamente el fallo observado a 5.000 changes.

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

### CR4 — `gitOutput` nunca convierte stdout/stderr truncado en el mensaje
- **Given** un comando `git` invocado por `src/state-migration.mjs` cuya salida
  (stdout o stderr) supera el límite de buffer del proceso hijo (`ENOBUFS`/
  `ERR_CHILD_PROCESS_STDOUT_MAXBUFFER` u otra causa cuyo `stdout`/`stderr`
  capturado sea grande)
- **When** `gitOutput` construye el mensaje de error
- **Then** el mensaje no supera 2 KB: identifica el comando git, la causa
  (`error.code`) y trunca cualquier `stdout`/`stderr` capturado con un
  contador de bytes omitidos
- **And** para comandos cuya salida se sabe potencialmente grande (lectura de
  manifest/inventario), `gitOutput` fija un `maxBuffer` explícito y suficiente
  en vez de depender del límite por defecto de Node

## Plan

- [x] Añadir un test fallido que reproduzca `ENOBUFS`/salida truncada en `gitOutput` (proceso hijo que escribe >1 MiB) y acotar su formateo de error en `src/state-migration.mjs`, fijando `maxBuffer` explícito para las lecturas de manifest/inventario; verify: `node --test test/state-migration.test.mjs` comprobando ≤2 KB, `error.code` presente y contador de bytes omitidos (CR4)
  - **Resolved:** `2026-07-22T22:05:00Z`
- [x] Añadir un test fallido de `state migrate --create` con muchos errores y acotar el agregador de `candidateSnapshot` en `src/state-migration.mjs`; verify: `node --test test/state-migration.test.mjs test/cli-bin.test.mjs` comprobando ≤4 KB, cinco errores, contador y receipt intacto (CR1)
  - **Resolved:** `2026-07-22T22:20:00Z`
- [x] Añadir un test fallido de `state activate --prepare` con un baseline inválido y acotar el agregador de validación de `readStateMetadata` en `src/state-migration.mjs`; verify: `node --test test/state-migration.test.mjs test/cli-bin.test.mjs` comprobando ≤4 KB, cinco errores, contador y receipt intacto (CR2)
  - **Resolved:** `2026-07-22T22:20:00Z`
- [x] Auditar y corregir en `src/check.mjs` y los parsers invocados por `src/state-migration.mjs` los mensajes que embeben contenido documental; verify: `node --test test/state-migration.test.mjs test/check.test.mjs` con manifest y documentos grandes ausentes del error de preview/create/activate (CR3)
  - **Resolved:** `2026-07-22T22:22:00Z`
- [x] Ejecutar el gate completo; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-22T22:30:00Z`

## Log

- **2026-07-22T20:21:01Z** `[note]` Draft creado desde la unión de las dos ejecuciones de 20260721-193106 (fallo de activación a 5.000 con volcado ~2 MB en el campo error).
- **2026-07-22T20:35:00Z** `[note]` Ajustado por revisión del auditor principal: dividido — el exit code de sync pasa a 20260722-203028; causa raíz localizada (agregación sin tope en src/state-migration.mjs:850 más mensajes que embeben contenido); límite numérico explícito (4 KB, primeros 5 errores + contador).
- **2026-07-22T20:41:30Z** `[note]` Causa raíz completada: create y activate usan agregadores distintos en candidateSnapshot y readStateBaseline; cada camino recibe su propio criterio y regresión.
- **2026-07-22T21:15:27Z** `[status]` draft → approved (human via conversation)
- **2026-07-22T21:15:28Z** `[status]` approved → in-progress
- **2026-07-22T21:15:28Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-22T21:45:00Z** `[note]` Causa raíz corregida tras reproducción empírica: no es agregación de errores de checkRepo, es `ENOBUFS` de `execFileSync` sin `maxBuffer` en `gitOutput` al leer el manifest a 5.000 changes; su catch embebe ciegamente el stdout truncado (~1 MiB) como mensaje de error. Añadido CR4 como fix primario (acota `gitOutput` y fija `maxBuffer` explícito); CR1/CR2 (agregadores) se mantienen como riesgo independiente real; CR3 sin cambios.
- **2026-07-22T22:30:00Z** `[note]` Implementadas las cuatro correcciones. CR4: `gitOutput` fija `maxBuffer: 16 MiB` (antes el default de Node, 1 MiB) y, si el detalle capturado supera 2 KB, lo trunca añadiendo el código de error y el contador de bytes omitidos en vez de embeber el stdout/stderr completo; verificado con un blob de 2 MiB (antes fallaba, ahora se lee sin problema) y uno de 18 MiB (sigue fallando, pero el mensaje queda acotado). CR1/CR2: nuevo helper `boundedErrorSummary` (primeros 5 errores `file: message`, contador del resto, tope de 4 KB) reemplaza el join sin tope en `candidateSnapshot` (create) y en la validación de `readStateMetadata` (activación/doctor); verificado con 7 documentos inválidos en ambos caminos (5 mostrados, contador "and 2 more errors"). Para CR2 se construyó un manifest firmado a mano (decisions con `replacement`+sha256, sin pasar por `candidateSnapshot`) porque el camino normal de creación ya valida el contenido antes de publicar, así que la re-validación de `readStateMetadata` solo puede divergir ante un manifest ensamblado por otro medio — exactamente el escenario defensivo que esta ruta protege. CR3: auditados todos los `throw` de `check.mjs`/`change.mjs`/`spec.mjs`/`yaml.mjs`; ninguno embebe contenido de documento, confirmado además empíricamente por los mensajes acotados de CR1/CR2 pese a cuerpos de documento reales; sin cambios de código adicionales. Rojo confirmado en los 4 tests nuevos antes del fix; verde después: 35/35 en `state-migration.test.mjs`, 175/175 en la suite ampliada (`cli-bin`/`check`). Gate completo: 928/928 tests, lint y 234 changes válidos.
- **2026-07-22T21:43:21Z** `[status]` in-progress → in-review
