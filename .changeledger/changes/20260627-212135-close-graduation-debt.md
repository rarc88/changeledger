---
id: "20260627-212135"
title: Cerrar la deuda de graduación pendiente
type: chore
status: discarded
created: 2026-06-27T21:21:35Z
depends_on: [ "20260627-212133" ]
---

## Request

De 124 changes `done`, 32 (~25%) no tienen su graduación resuelta: ni graduaron a
un spec ni se marcaron como skip. El gate de cierre del contrato (todo `done` se
gradúa o se declara sin verdad persistente) tiene una cola acumulada. Mientras
exista, la verdad persistente queda incompleta respecto al trabajo realizado y
`changeledger graduate --pending` nunca llega a cero.

Objetivo autorizado: resolver los 32 pendientes — cada uno graduado al spec de
dominio que corresponda o marcado `--skip` con razón cuando no haya verdad
persistente (típico de bug/chore).

Depende de [[20260627-212133]]: se gradúa hacia la estructura de specs ya partida,
para no volver a engordar el monolito.

## Plan

- [ ] Listar los pendientes reales con `changeledger graduate --pending` y clasificar cada uno: graduable a un spec de dominio vs. skip sin verdad persistente; verify: `node bin/changeledger.mjs graduate --pending` (support)
- [ ] Graduar con `changeledger graduate <id> <spec> --into` cada pendiente que aporte verdad persistente, hacia el spec de dominio correspondiente; verify: `node bin/changeledger.mjs check` (support)
- [ ] Marcar `changeledger graduate <id> --skip "<razón>"` cada pendiente sin verdad persistente; verify: `node bin/changeledger.mjs check` (support)
- [ ] Confirmar que `changeledger graduate --pending` queda en cero; verify: `node bin/changeledger.mjs graduate --pending` (support)

## Log
</content>
- **2026-06-27T21:22:57Z** — status: draft → approved
- **2026-06-27T22:02:45Z** — status: approved → discarded: premisa falsa verificada: la deuda de graduación no existe. graduate --pending = 0 y 0 changes done sin reviewed:true. El conteo inicial de 32 fue un falso positivo de un grep por marker textual en vez del flag reviewed
