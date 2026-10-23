---
id: "20261023-094844"
title: check reporta cada heading CRn de una spec, no solo el primero
type: bug
status: in-review
created: 2026-10-23T09:48:44Z
depends_on: ["20261022-213751"]
branch: bug/20261023-094844
related_to: []
owner: raruiz-hiberuscom
---

## Request

Una spec con varios headings `CRn` no puede reescribirse de uno en uno.
`specDurabilityIssue` en `src/check.mjs` se queda con el primer heading
`CRn` que encuentra y devuelve un único mensaje que lo nombra; al
reescribir ese primero, el mensaje pasa a nombrar el siguiente, y como la
admisión compara errores por fichero y mensaje (`introducedErrors`,
`#20261022-213751`), ese cambio de texto cuenta como error nuevo y
`edit spec:` rechaza la edición. Es exactamente el caso de una semilla de
`graduate --new` sacada de un change con varios criterios: la graduación
promete refinarla antes de `--into`, y hoy solo se puede refinar de una
sola vez.

Lo pedido: que `check` reporte un error por cada heading `CRn` visible de
la spec, con el texto de hoy por heading, de modo que cada reescritura
elimine exactamente una línea y el resto no cambie de texto. Queda fuera
cambiar qué cuenta como heading `CRn` (niveles, Setext, anidados, cercas
de código): la detección se conserva tal cual; solo deja de pararse en el
primero.

## Investigation

### Causa raíz

`specDurabilityIssue(body)` recorre los tokens de `marked` y corta en el
primer heading cuyo texto empieza por `CRn`; devuelve una cadena o
`null`. Tres sedes lo consumen y las tres heredan el corte:

| sede | función | qué hace con el resultado |
|---|---|---|
| `check` sobre cada spec | bucle de specs en `checkRepo`, `src/check.mjs` | `err(s, mensaje)`: un único error por spec |
| `graduate --into` en repo activado | `graduateInto` (rama `repo.state`) en `src/commands/graduate.mjs` | `throw new Error(mensaje)` |
| `graduate --into` en worktree | la misma función, rama inactiva | `throw new Error(mensaje)` |

El error de `check` es la clave del diff de admisión: fichero más mensaje.
Con un solo mensaje que nombra un heading, quitar ese heading cambia el
mensaje y el diff lo ve como introducido. Un mensaje que nombrara todos los
headings tendría el mismo problema: quitar uno cambia el texto. La única
forma de que una reescritura parcial sea neutra para el diff es que cada
heading tenga su propio error con texto estable.

### Dirección

- `specDurabilityIssues(body)` devuelve la lista de mensajes, uno por
  heading `CRn` visible en orden de documento, con el texto actual
  `spec contains change-local criterion heading "CRn"; rewrite it as
  durable current truth`. La detección de headings no cambia.
- `checkRepo` emite un error por elemento de la lista.
- `graduate --into`, en ambas disposiciones, rechaza con los mensajes
  unidos por salto de línea, en el mismo orden, sin escribir nada.
- Los tests de `test/check.test.mjs` y `test/graduate.test.mjs` que
  fijan el texto con un solo heading siguen válidos sin cambios: un heading
  produce exactamente el mismo error que hoy.
- Verdad persistente: `architecture.md` dice hoy que la regla de admisión
  «no garantiza reescribir una spec rota por partes: `check` nombra solo el
  primer heading `CRn`». Al cerrar, esa frase se sustituye por la nueva
  verdad con `--into architecture`.

Interfaces externas: la salida de `check` y el mensaje de `graduate` son
texto de CLI que scripts ya consumen; el texto por heading se declara
estable y se fija en los criterios.

## Specification

### CR1 — Un error por cada heading CRn, en orden de documento
- **Given** una spec `verdad.md` cuyo cuerpo contiene `### CR1 — una verdad` y después `### CR2 — otra verdad`, sin marcador de scaffold
- **When** se ejecuta `checkRepo` sobre el repo
- **Then** los errores de `verdad.md` son exactamente dos, en este orden: `spec contains change-local criterion heading "CR1"; rewrite it as durable current truth` y `spec contains change-local criterion heading "CR2"; rewrite it as durable current truth`
- **And** `changeledger check` imprime las dos líneas y sale con código distinto de cero

### CR2 — Un solo heading produce el mismo error que hoy
- **Given** una spec con un único heading `### CR33 — algo`
- **When** se ejecuta `checkRepo`
- **Then** hay exactamente un error para esa spec, con el texto `spec contains change-local criterion heading "CR33"; rewrite it as durable current truth`
- **And** los tests existentes `103551 CR2` de `test/check.test.mjs` sobre niveles ATX, Setext, anidados y cercas de código pasan sin modificar

### CR3 — Reescribir el primer heading deja el resto sin cambios y la edición se acepta
- **Given** el repo de CR1, activado
- **When** `edit spec:verdad --from` recibe el mismo documento con `### CR1 — una verdad` reescrito como prosa sin heading y `### CR2 — otra verdad` intacto
- **Then** acepta: `result.changed` es `true` y el tip de `refs/heads/changeledger/state` avanza
- **And** `checkRepo` reporta para `verdad.md` exactamente un error, el de `"CR2"`
- **And** una segunda edición que reescribe `CR2` acepta y deja `verdad.md` sin errores

### CR4 — graduate --into rechaza nombrando todos los headings, en ambas disposiciones
- **Given** un change `done` sin graduación resuelta y la spec de CR1 sin marcador de scaffold
- **When** se ejecuta `graduate <id> verdad --into`
- **Then** rechaza con el mensaje de dos líneas `spec contains change-local criterion heading "CR1"; rewrite it as durable current truth` y `spec contains change-local criterion heading "CR2"; rewrite it as durable current truth`, en ese orden, y no escribe nada: la spec y el documento del change quedan byte-idénticos
- **And** el resultado es el mismo en un repo en worktree y en uno activado

### CR5 — El día después: una semilla con dos criterios se refina en dos ediciones
- **Given** un repo activado con un change `done` de tipo `feature` cuya Specification tiene `### CR1` y `### CR2`
- **When** se ejecuta `graduate <id> verdad --new`, se quita el marcador de scaffold, se reescribe `CR1` con `edit spec:verdad`, se reescribe `CR2` con una segunda `edit spec:verdad` y se ejecuta `graduate <id> verdad --into`
- **Then** las dos ediciones aceptan, `--into` acepta y `verdad.md` lista `<id>` en `graduated_from`
- **And** entre la primera y la segunda edición `checkRepo` reporta para `verdad.md` exactamente el error de `"CR2"`

## Plan

- [x] `specDurabilityIssues` devuelve la lista y `checkRepo` emite un error por heading
  - **Target:** `src/check.mjs`
  - **Verify:** `node --test test/check.test.mjs`
  - **Criteria:** CR1, CR2
  - **Resolved:** `2026-10-23T10:42:35Z`
- [x] `graduate --into` rechaza con la lista unida, en las dos disposiciones
  - **Target:** `src/commands/graduate.mjs`
  - **Verify:** `node --test test/graduate.test.mjs`
  - **Criteria:** CR4
  - **Resolved:** `2026-10-23T10:42:36Z`
- [x] Reescritura parcial aceptada por `edit spec:`
  - **Target:** `test/edit.test.mjs`
  - **Verify:** `node --test test/edit.test.mjs`
  - **Criteria:** CR3
  - **Resolved:** `2026-10-23T10:42:36Z`
- [x] Recorrido del día después: semilla con dos criterios refinada en dos ediciones
  - **Target:** `test/graduate.test.mjs`
  - **Verify:** `node --test test/graduate.test.mjs`
  - **Criteria:** CR5
  - **Resolved:** `2026-10-23T10:42:37Z`
- [x] Suite completa y puertas del repo
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-10-23T10:46:17Z`

## Log
- **2026-10-23T09:48:44Z** `[version]` 0.18.0
- **2026-10-23T09:58:29Z** `[status]` draft → approved (human via conversation)
- **2026-10-23T10:34:15Z** `[status]` approved → in-progress
- **2026-10-23T10:34:15Z** `[branch]` set: bug/20261023-094844 (auto)
- **2026-10-23T10:34:40Z** `[note]` Rama bug/20261023-094844 creada desde dev (39c44516) por orden del humano, pero dev no contiene #20261022-213751 (PR 19 abierto): en dev prepareSpecEdit sigue filtrando por fichero y CR3/CR5 (reescritura parcial aceptada por edit spec:) no pueden pasar sin esa regla. depends_on declarado; la base de la rama vuelve al humano antes de implementar.
- **2026-10-23T10:35:27Z** `[note]` Por orden del humano, la rama bug/20261023-094844 se recoloca sobre bug/20261022-213751 (6d19abba) y la implementación sigue apilada; el PR irá contra esa rama o contra dev cuando el PR 19 se fusione.
- **2026-10-23T10:42:38Z** `[note]` Selección única (tareas 1-4) implementada: specDurabilityIssues devuelve la lista, checkRepo emite un error por heading, --into une los mensajes en las dos ramas; tests CR1-CR5 rojo→verde con evidencia literal; mutantes: volver a parar en el primer heading pone en rojo CR1, CR3, CR4 y CR5; hacer que --into lance solo el primero pone en rojo exactamente el test de su disposición. Decisiones no especificadas: CR5 quita el marcador de scaffold en la primera edición (dos ediciones en total); un heading CRn repetido produce dos mensajes iguales, sin deduplicar; la aserción del bin de CR1 usa check() en proceso como el patrón 103551. Residual del change corregido por el orquestador: dos comentarios de test/apply.test.mjs que afirmaban que check nombra solo el primer heading. Residual de cierre: architecture.md dice que la regla no garantiza reescribir por partes; se reconcilia en la graduación.
- **2026-10-23T10:46:18Z** `[note]` Tarea 5: pnpm verify — biome limpio (134 ficheros), suite 2134/2135; el único fallo es 'CR6: the skeletons ship in the publishable package' (npm 12, preexistente en dev, ajeno a este change); changeledger check en verde por separado.
- **2026-10-23T10:46:19Z** `[status]` in-progress → in-review
