---
id: "20260722-203028"
title: Exit code no cero cuando sync no confirma la publicación
type: bug
status: draft
created: 2026-07-22T20:30:28Z
depends_on: []
related_to: ["20260721-193106", "20260721-193102", "20260722-202101"]
release_impact: patch
---

## Request

La ejecución paralela de la auditoría `20260721-193106` (filas FLT-4/FLT-5)
verificó que `changeledger state sync` devuelve **exit 0** cuando la publicación
falla (push rechazado, pending conservado) o queda ambigua (push aterrizado con
respuesta perdida). Un script o CI con `changeledger state sync && …` trata un
pending no publicado como éxito — exactamente la inferencia por exit code que
el protocolo del audit prohíbe. Separado de `20260722-202101` por ser un
defecto independiente en otro módulo.

## Investigation

La acción de `state sync` en `bin/changeledger.mjs` imprime `pending
publication`/`Publication result ambiguous` cuando el resultado tiene
`pending: true` y `confirmed: false` (los caminos de error de push de
`syncStateReplica` en `src/state-store.mjs:279-289` y `:335-344` devuelven ese
estado en vez de lanzar), pero nunca ajusta `process.exitCode`. Reproducido en
FLT-4 (push fallido: remoto sin cambios, pending conservado, exit 0) y FLT-5
(push aterrizado, respuesta perdida, exit 0).

Semántica de salida elegida — tres valores distinguibles:

- `0`: sync convergente, sin pending sin confirmar.
- `1`: error fatal (comportamiento actual de `action()` para excepciones).
- `2`: el comando terminó sin excepción pero la publicación no quedó
  confirmada (pending conservado, causa en el output).

## Specification

### CR1 — Publicación no confirmada sale con exit 2
- **Given** un `state sync` cuyo push falla o cuya respuesta se pierde,
  conservando pending sin confirmación
- **When** el comando termina
- **Then** el exit code es `2` y el output identifica pending conservado y la
  causa
- **And** el estado de la réplica queda igual que hoy (sin cambio de
  comportamiento, solo de señalización)

### CR2 — Los caminos existentes conservan su código
- **Given** un sync convergente, o un sync que lanza un error fatal
- **When** el comando termina
- **Then** devuelven `0` y `1` respectivamente, sin cambios

## Plan

- [ ] Añadir tests fallidos de exit code para push fallido y respuesta perdida (exit 2) y para convergencia/fatal (0/1), y ajustar `process.exitCode` en la acción de `state sync` de `bin/changeledger.mjs`; verify: `node --test test/state-command.test.mjs test/cli-bin.test.mjs` (CR1, CR2)
- [ ] Ejecutar el gate completo; verify: `pnpm verify` (support)

## Log

- **2026-07-22T20:30:28Z** `[note]` Draft creado por la revisión cruzada de los drafts de remediación de 20260721-193106: separado de 20260722-202101 (defecto independiente); semántica concreta de salida 0/1/2 en lugar de «distinto de los errores existentes».
