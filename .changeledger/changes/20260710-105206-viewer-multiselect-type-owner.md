---
id: "20260710-105206"
title: El visor limita type y owner a una sola selección
type: feature
status: draft
created: 2026-07-10T10:52:06Z
depends_on: []
---

## Request

Convertir los filtros de `type` y `owner` del viewer en multiselección, con la
misma semántica inclusiva del filtro de estados. El filtro de owner debe incluir
una opción explícita para changes sin owner asignado.

## Investigation

El viewer usa dos `<select>` de selección única. Su estado persiste `type` y
`owner` como strings (`all` o un único valor), mientras que `statuses` es un
`Set` persistido como array. `isVisible` compara igualdad exacta, por lo que no
puede combinar tipos/owners. Al hidratar owners se descartan los valores falsy,
de modo que ni siquiera puede elegirse el conjunto sin owner. Esta restricción
se refleja igual en board, table y graph porque todos usan el predicado puro.

El owner es texto libre en frontmatter. Por ello no es seguro usar una cadena
sentinela como `__unassigned__`: un owner real podría coincidir. La selección
persistida debe modelar por separado el conjunto de nombres y el booleano
"include unassigned", validar ambos contra el repo actual y mantener
compatibilidad de lectura con snapshots existentes de selección única.

## Proposal

Reemplazar ambos selects por popovers con checkboxes, resumen y Clear, siguiendo
el patrón accesible ya usado por Status. Type usa un conjunto de tipos; Owner usa
un conjunto de nombres más la casilla `Unassigned`. Las selecciones se combinan
por OR dentro de cada filtro y por AND con texto, status y visibilidad. La
migración de estado preservará snapshots antiguos como una selección de un
elemento y actualizará las pruebas de persistencia, predicado y UI.

## Specification

## Plan

## Log
