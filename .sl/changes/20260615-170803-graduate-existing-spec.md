---
id: "20260615-170803"
title: Graduar a un spec existente sin edición manual
type: feature
status: done
created: 2026-06-15T17:08:03Z
depends_on: []
archived: true
reviewed: true
owner: raruiz-hiberuscom
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

`graduate(id, slug, cwd, { into })` gana la opción `into`. El registro en el change
(marker `graduado a spec` + `setReviewed(true)`) es **compartido** por ambas rutas;
solo difiere el manejo del archivo del spec.

### CR1 — `--into` sobre spec existente: enlaza sin tocar el cuerpo
- **Given** un change `done` y un spec `architecture.md` con cuerpo `B` y
  `updated: 2020-01-01T00:00:00Z`
- **When** `graduate(id, "architecture", cwd, { into: true })`
- **Then** el cuerpo del spec (todo lo posterior al frontmatter) sigue siendo `B`
- **And** el `updated` del spec cambia (ya no es `2020-01-01T00:00:00Z`)
- **And** el Log del change gana `graduado a spec \`architecture.md\``
- **And** el change queda `reviewed: true`

### CR2 — `--into` sobre spec inexistente: error simétrico, sin escribir
- **Given** un change `done` y que **no** existe `ghost.md`
- **When** `graduate(id, "ghost", cwd, { into: true })`
- **Then** lanza con el mensaje literal `Spec "ghost.md" does not exist — drop --into to create it`
- **And** el change no se modifica (sin marker ni `reviewed`)

### CR3 — sin `--into` sobre spec existente: sigue siendo el error actual
- **Given** un change `done` y un spec `architecture.md` existente
- **When** `graduate(id, "architecture", cwd)` (sin `into`)
- **Then** lanza con el mensaje literal `Spec "architecture.md" already exists`
- **And** el change no se modifica

### CR4 — sin `--into` sobre spec nuevo: comportamiento actual intacto
- **Given** un change `done` y que no existe `fresh.md`
- **When** `graduate(id, "fresh", cwd)`
- **Then** crea `fresh.md` con `> Graduado del change <id>.` y la semilla
- **And** el change queda `reviewed: true` con el marker en el Log

### CR5 — `setSpecUpdated` reemplaza solo la línea `updated`
- **Given** un spec con `title`, `updated: 2020-01-01T00:00:00Z`, `tags` y cuerpo
- **When** `setSpecUpdated(text, "2026-06-15T17:30:00Z")`
- **Then** la línea es `updated: 2026-06-15T17:30:00Z`
- **And** `title`, `tags` y el cuerpo quedan intactos

### CR6 — bin: `sl graduate <id> <slug> --into` cablea (e2e, flag en cualquier orden)
- **Given** un change `done` y un spec existente, vía el binario
- **When** `sl graduate <id> <slug> --into`
- **Then** exit 0 y el spec queda enlazado (marker + `reviewed`), sin tocar el cuerpo

## Plan

- [x] Añadir `setSpecUpdated(text, iso)` puro en `src/writer.mjs` (reemplaza la línea `updated:` del frontmatter); test en `test/writer.test.mjs` (CR5) — 2026-06-15T17:36:16Z
- [x] Extender `graduate(id, slug, cwd, { into })` en `src/commands/graduate.mjs`: rama `into` exige spec existente (error simétrico), refresca `updated` vía `setSpecUpdated`, no toca el cuerpo; marker + `setReviewed` compartidos; test en `test/graduate.test.mjs` (CR1, CR2, CR3, CR4) — 2026-06-15T17:36:16Z
- [x] Parsear `--into` en el caso `graduate` de `bin/sl.mjs` (positionals robustos a flags) + entrada en `HELP`/`USAGE`; test e2e en `test/cli-bin.test.mjs` (CR6) — 2026-06-15T17:36:16Z
- [x] Documentar `--into` en `templates/AGENTS.md` §9 (`sl graduate … --into`) y §10 (graduar a spec existente) — 2026-06-15T17:36:17Z

## Log
- **2026-06-15T17:29:52Z** — status: draft → approved
- **2026-06-15T17:31:48Z** — status: approved → in-progress
- **2026-06-15T17:31:48Z** — owner → raruiz-hiberuscom (auto)
- **2026-06-15T17:36:31Z** — status: in-progress → in-review
- **2026-06-15T17:37:35Z** — independent review (delegated subagent, clean context): VERDICT pass — 6/6 CRs implemented and tested, literal messages match, shared marker+reviewed write, no write on error paths, no residue, pnpm verify green.
- **2026-06-15T17:37:35Z** — review → done (delegated subagent, clean context)
- **2026-06-15T17:37:35Z** — graduado a spec `architecture.md`
- **2026-06-15T21:17:58Z** — archived
