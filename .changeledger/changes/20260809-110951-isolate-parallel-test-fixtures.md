---
id: "20260809-110951"
title: Aislar los fixtures de tests que corren en paralelo
type: bug
status: draft
created: 2026-08-09T11:09:51Z
depends_on: []
related_to: []
owner: rarc88
---

## Request

Flakiness preexistente observado una vez durante la etapa 1 del estado global
(2026-08-08, delegado de implementación; no reproducido en reruns): el test
`203257 correction: no raw control bytes in source files` falló con `ENOENT`
sobre `src/viewer/public-sibling-secret.txt` bajo ejecución paralela de
archivos de test — una carrera de aislamiento entre el fixture de archivo
temporal que `test/view.test.mjs` crea junto a `src/viewer/public/` y el
barrido de directorios que `test/cli.test.mjs` hace sobre `src/`. Ninguno de
los dos es incorrecto por separado: el fixture escribe y borra un archivo
real dentro del árbol fuente, y el barrido lo lista y luego intenta leerlo
cuando ya no existe.

Se pide eliminar la carrera de clase, no de incidente: ningún test debe crear
archivos dentro del árbol fuente versionado (`src/**`) — los fixtures que hoy
lo hacen se mueven a un directorio temporal, o el barrido tolera
explícitamente la desaparición entre listado y lectura, con la primera opción
como preferida (un árbol fuente que muta durante los tests es la causa raíz,
no el lector).

## Investigation

Pendiente — se completa al retomar el change. Punto de partida: el fixture
`public-sibling-secret` en `test/view.test.mjs` y el barrido de control-bytes
en `test/cli.test.mjs` (test `203257 correction`); inventariar si algún otro
test escribe dentro de `src/**`.

## Specification

Pendiente — se redacta con la Investigation al retomar el change.

## Plan

- [ ] Completar Investigation, Specification y este Plan al retomar el change
  - **Support:**

## Log

- **2026-08-09T11:09:51Z** `[note]` Draft creado al cierre de la etapa 1 del
  estado global para no perder el hallazgo: carrera preexistente y ajena a esa
  capacidad, observada una sola vez por un delegado y anotada solo en
  conversación hasta ahora. Queda en draft hasta su debido momento.
