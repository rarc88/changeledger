---
id: "20260720-223228"
title: Validación server-side del estado vía pre-receive
type: feature
status: draft
created: 2026-07-20T22:32:28Z
depends_on: ["20260720-124231"]
related_to: ["20260720-124231"]
---

## Request

`20260720-124231` (almacén global en `changeledger/state`) incluía originalmente
CR11: exponer el mismo motor de validación del CLI como hook `pre-receive`, para
que un servidor Git administrado pudiera rechazar en el remoto documentos
inválidos, historia reescrita o archivos fuera del layout permitido, sin
depender de que cada cliente se comporte.

Una revisión independiente encontró que esa pieza no funciona en un push real y
el humano decidió extraerla a un change propio en vez de seguir iterando dentro
de un change ya `major` y sobrecargado. Este change recoge exclusivamente ese
trabajo pendiente: una validación server-side que sí sea correcta bajo las
condiciones reales de un `pre-receive`, probada contra un hook real.

## Investigation

`src/git.mjs` centraliza el acceso a objetos Git detrás de un entorno saneado
(`sanitizedEnv`) que elimina `GIT_OBJECT_DIRECTORY` y
`GIT_ALTERNATE_OBJECT_DIRECTORIES` de cada `objectRun`. Eso es correcto para el
CLI cliente: evita que el propio pre-commit hook del repositorio interfiera con
las lecturas de ChangeLedger. Pero es exactamente lo que un `pre-receive`
real necesita para ver los objetos entrantes: Git pone en cuarentena el push
en un directorio de objetos temporal y expone esas dos variables al hook
mientras decide si aceptarlo. La acción `validate-receive` (ahora eliminada de
`20260720-124231`) llamaba al mismo `objectRun` saneado, así que durante un
push real no encontraba los objetos que estaba validando y rechazaba cualquier
actualización de estado.

La prueba de regresión que se añadió para responder al rechazo humano
("bare receive hook") no lo detectó porque publicaba los objetos en el
repositorio bare *antes* de invocar la validación, en vez de simular la
cuarentena de un push en curso. Verificado empíricamente contra un hook
`pre-receive` real: con el entorno heredado, `GIT_OBJECT_DIRECTORY` y
`GIT_ALTERNATE_OBJECT_DIRECTORIES` son visibles y apuntan a la cuarentena; con
el entorno saneado que usa ChangeLedger, no lo son.

## Proposal

(Punto de partida para refinar antes de aprobar — no cerrado.)

La ruta de validación server-side necesita su propio entorno Git: heredar
`GIT_OBJECT_DIRECTORY`/`GIT_ALTERNATE_OBJECT_DIRECTORIES` cuando existan (para
ver la cuarentena de un `pre-receive` real) sin relajar el saneamiento que usan
el resto de comandos del CLI cliente. El motor de validación compartido
(`validateStateRange` y lo que dependía de él) puede reconstruirse sobre esa
base; no hace falta rediseñar la lógica de validación en sí, solo cómo se
invoca el acceso a objetos en este contexto.

La cobertura de test debe incluir al menos un caso que instale un hook
`pre-receive` real invocando el CLI compilado y ejecute un `git push` genuino
contra un remoto bare, en vez de pre-cargar los objetos y llamar a la función
de validación directamente. Sin esa prueba, un cambio futuro puede volver a
romper esta ruta sin que ningún test lo note.

## Specification

### CR1 — Validación visible durante la cuarentena de un push real
- **Given** un repositorio bare con el hook `pre-receive` de ChangeLedger instalado
- **When** un cliente hace `git push` con una actualización válida de `changeledger/state`
- **Then** el hook ve los objetos entrantes (cuarentena) y los valida con el mismo motor que usa el CLI
- **And** una actualización inválida se rechaza sin aceptar el push

### CR2 — Sin regresión en el saneamiento del cliente
- **Given** el CLI ejecutándose como cliente (no como hook de recepción)
- **When** ChangeLedger lee o escribe objetos Git
- **Then** el entorno sigue saneado exactamente como antes de este change
- **And** ningún comando cliente hereda variables de cuarentena que no le corresponden

### CR3 — Test de integración contra un hook real
- **Given** un remoto bare temporal con el hook `pre-receive` instalado desde el CLI real
- **When** la suite de regresión ejecuta un `git push` genuino con una actualización inválida y otra válida
- **Then** el rechazo y la aceptación se verifican contra el resultado real del push, no contra una llamada directa a la función de validación con objetos precargados

## Plan

## Log

- **2026-07-20T22:32:28Z** `[note]` Extraído de `20260720-124231` tras revisión independiente: el hook pre-receive original no ve los objetos en cuarentena de un push real porque reutiliza el entorno Git saneado del cliente. Draft pendiente de refinar y aprobar por el humano.
