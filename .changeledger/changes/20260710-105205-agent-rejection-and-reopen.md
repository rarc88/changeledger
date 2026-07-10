---
id: "20260710-105205"
title: El agente no puede rechazar validaciones ni reabrir changes provisionales
type: feature
status: draft
created: 2026-07-10T10:52:05Z
depends_on: []
---

## Request

Permitir que el agente rechace un change en `in-validation` y reabra uno en
`done` aún provisional, siempre con motivo y dentro de las mismas fronteras
durables ya comprobadas. La aceptación de `draft → approved` y de
`in-validation → done` seguirá siendo exclusivamente humana. El viewer conserva
ambas acciones para el humano como alternativa, sin convertirlas en obligatorias.

## Investigation

La lógica ya existe en `src/commands/agent.mjs`: `validation(..., 'fail',
{ reason })` exige el motivo y devuelve a `in-progress`; `reopen(id, reason)`
exige el motivo, toma el lock de releases y rechaza changes graduados/skipped,
archivados o incluidos en un release. Sin embargo, ambas funciones no están
expuestas por el CLI: `validation` sólo la invoca el dominio del viewer y
`reopen` se bloquea explícitamente en `status`. Además sus entradas de Log dicen
"human rejected" y "human reopened", y el core, el pack de implementación y
las specs asignan esos movimientos sólo al humano.

La separación que se quiere mantener no depende de que el actor sea el viewer:
depende de que nadie pueda aceptar por el humano. El rechazo y la reapertura son
movimientos correctivos, reversibles dentro del alcance original y ya disponen
de validación, motivo auditado y fronteras durables fail-closed. La solución debe
exponer comandos explícitos que permitan registrar correctamente el actor,
conservar la ruta del viewer y no abrir una vía para `done` ni para aprobar un
draft desde el agente.

## Proposal

Agregar comandos explícitos para el agente: uno de rechazo de validación y uno
de reapertura, ambos con razón obligatoria. El dominio del viewer reutilizará la
misma lógica pero identificará el actor humano, de modo que el Log distinga
"agent rejected/reopened" de "human rejected/reopened" sin cambiar el grafo ni
las fronteras de seguridad. Actualizar el contrato, ayuda y specs para que sólo
las dos transiciones positivas permanezcan human-only.

## Specification

## Plan

## Log
