---
id: "20260710-102908"
title: INTENT contradice el cierre provisional de un change done
type: bug
status: draft
created: 2026-07-10T10:29:08Z
depends_on: []
---

## Request

Alinear `INTENT.md` con el comportamiento ya implementado: `done` permite una
reapertura humana y acotada mientras no se haya resuelto la graduación, archivado
o publicación. La intención no debe inducir a un agente a tratar esa ventana
como una contradicción o a evitar una corrección del alcance original.

## Investigation

`INTENT.md` afirma dos veces que un change `done` nunca se reabre o que un
change cerrado es terminal. En cambio, la spec canónica `lifecycle.md`, el
comando `reopen` y el contexto de validación especifican la misma regla:
la reapertura sólo la hace el humano, exige razón, vuelve a `in-progress` y
queda limitada al alcance ya autorizado; se bloquea definitivamente al graduar
o hacer skip, archivar o incluir el change en un release. `discarded` sí es
terminal desde el principio.

No hay desacuerdo de producto: el usuario confirmó que la reapertura previa a
graduación/archivado es intencional. El defecto es documental y de vocabulario:
`done` significa aceptación humana provisional, mientras que el cierre durable
ocurre al resolver graduación/skip y cruzar una frontera irreversible. La
actualización debe preservar que el trabajo posterior o más amplio necesita un
change nuevo y no alterar la semántica del CLI.

## Specification

## Plan

## Log
