---
id: "20260615-170803"
title: Graduar a un spec existente sin edición manual
type: feature
status: draft
created: 2026-06-15T17:08:03Z
depends_on: []
---

## Request

`sl graduate <change-id> <spec-slug>` solo **crea** un spec nuevo: si el archivo ya
existe, lanza `Spec "<name>" already exists` y aborta. Pero el caso común al cerrar
un change es **actualizar un spec existente** (p. ej. añadir una capacidad a
`architecture.md`), no crear uno. Hoy no hay camino por CLI para eso.

Esto se detectó haciendo dogfooding del change `20260615-150510` (gate de
revisión): graduar su verdad a `architecture.md` (ya existente) obligó a (1) editar
el spec a mano, (2) `sl log` el marker `graduado a spec` manualmente, y (3)
**editar el frontmatter `reviewed: true` a mano**, porque tampoco hay comando que
fije ese flag cuando la graduación se hace fuera de `graduate()`.

Resultado: tres pasos manuales propensos a error para algo que la herramienta
debería registrar de forma consistente (igual que insiste en mover el lifecycle
por CLI, no a mano).

## Investigation

**Qué hace hoy `graduate()`** (`src/commands/graduate.mjs`):
1. Resuelve el change y el `specsDir`.
2. `if (fs.existsSync(specFile)) throw new Error('Spec "<name>" already exists')`
   (línea ~40) — corta en seco para specs existentes.
3. Si no existe: scaffold del cuerpo (semilla desde Specification/Proposal),
   `appendLog(... 'graduado a spec \`<name>\`')` y `setReviewed(text, true)`.

**Quién más fija `reviewed`.** Solo `graduate()` y `skipGraduation()` (vía
`writer.setReviewed`). No hay comando suelto: si gradúas a mano, `reviewed` queda
sin fijar y el change aparece eternamente en `sl graduate --pending`.

**Marker y derivación.** "Graduado a spec" se deriva del marker
`graduado a spec \`<name>\`` en el Log (`check`/arquitectura dependen de él). Una
graduación a spec existente debe dejar ese mismo marker para no romper la
derivación.

**Bump de `updated`.** Un spec tiene `updated` (ISO UTC) en su frontmatter. Al
graduar a uno existente, ese campo debería refrescarse. Verificar si existe un
writer para specs (`spec.mjs`/`writer.mjs`) o si hay que añadir uno.

**Riesgo de auto-detección.** Si `graduate` enlazara silenciosamente cuando el
spec existe, un slug mal tecleado que coincida con un spec real quedaría enlazado
por error. El error actual `already exists` es una red de seguridad: la
sustitución debe ser **explícita**, no implícita.

## Proposal

**Dos piezas, ambas en `graduate.mjs` + wiring en `bin/sl.mjs`:**

**1. `sl graduate <id> <spec-slug> --into`** — graduar a un spec **existente**.
- Sin `--into` (hoy): si el spec existe → sigue siendo error. Crear es la ruta por
  defecto y conserva su red de seguridad.
- Con `--into`: el spec **debe** existir (si no, error simétrico
  `Spec "<name>" does not exist — drop --into to create it`). **No toca el cuerpo**
  (lo edita el agente, que es quien sabe qué refinar); solo: refresca `updated` del
  spec a `nowUtc`, deja el marker `graduado a spec \`<name>\`` en el Log del change
  y fija `reviewed: true`. Idéntico registro que crear, sin sobrescribir.

**2. Refrescar `updated` del spec.** Si no hay writer, añadir
`writer.setSpecUpdated(text, iso)` (transform puro sobre el frontmatter del spec),
análogo a los `setStatus`/`setReviewed` existentes.

**Descartado:**
- *Auto-detectar y enlazar si el spec existe* (sin flag): rechazado por el riesgo
  de slug mal tecleado — la sustitución debe ser explícita.
- *Comando suelto `sl reviewed <id>`*: innecesario si `--into` fija `reviewed`.
  Graduar (a spec nuevo o existente) es el único camino legítimo a `reviewed: true`
  además del `--skip`; no hace falta un tercer comando que lo desacople de la
  graduación real.

**Idioma de markers:** el marker `graduado a spec` sigue el idioma de contenido del
repo (ya es así hoy); el resto de markers CLI permanecen en inglés (§8).

## Specification

> Se completará test-grade tras aprobar el diseño (CRn con valores y mensajes
> literales). Criterios a cubrir:
> - `--into` sobre spec existente: deja marker, fija `reviewed`, refresca `updated`,
>   no altera el cuerpo.
> - `--into` sobre spec inexistente: error literal, sin escribir.
> - `graduate` sin `--into` sobre spec existente: sigue siendo el error actual.
> - `graduate` sin `--into` sobre spec nuevo: comportamiento actual intacto.

## Plan

> Se completará tras aprobar el diseño. Tocará: `src/commands/graduate.mjs`,
> `src/writer.mjs` (setSpecUpdated), `bin/sl.mjs` (+HELP), `templates/AGENTS.md`
> §9/§10; tests en `test/graduate.test.mjs` y `test/cli-bin.test.mjs`.

## Log
