---
id: "20260705-134704"
title: La graduación en dos pasos se describe en tres sitios divergentes
type: bug
status: in-review
created: 2026-07-05T13:47:04Z
depends_on: []
owner: raruiz-hiberuscom
---

## Request

La auditoría de followability del contrato (2026-07-05) marcó la graduación
como el segundo procedimiento donde un modelo promedio falla: la secuencia de
un spec nuevo (`--new` → refinar y quitar el marcador de scaffold → `--into`)
se describe en tres lugares con encuadres distintos, y solo uno de ellos dice
que `--new` deja la graduación *pendiente*. El error previsible es ejecutar
`--new`, dar la graduación por hecha y dejar el change sin cerrar, o llegar a
`--into` sin haber quitado el marcador y chocar con un rechazo del CLI no
anticipado.

## Investigation

Dónde vive hoy la verdad de la graduación:

- `templates/contract/core.md:33-36` — regla 8: tras la aceptación humana,
  recargar `changeledger context <id>` y graduar; menciona entre paréntesis
  «a new spec is a two-step `--new` then `--into`» o `--skip`. No dice que
  entre ambos pasos hay trabajo (refinar, quitar el marcador) ni que `--new`
  solo deja un seed pendiente.
- `templates/contract/close.md:20-34` — la descripción completa: `--new` crea
  un seed y deja la graduación pendiente; hay que reescribirlo como verdad
  duradera y quitar el marcador de scaffold; `--into` finaliza y rechaza un
  scaffold marcado sin refinar; `--into` directo para specs existentes;
  `--skip` registra que no cambió verdad persistente. Es prosa en viñetas, no
  una secuencia numerada.
- `templates/contract/close.md:36-40` — el matiz de `reviewed: true` (lo
  ponen `--into` y skip, no `--new`), que refuerza que `--new` no cierra nada,
  pero está separado de las viñetas del procedimiento.

Los tres encuadres no se contradicen, pero solo `close.md` contiene las
precondiciones reales. El overlay de cierre solo se carga tras la aceptación
(`changeledger context <id>` con el change `done`), así que un agente que
actúe desde la regla 8 del core —sin recargar, o tras una recarga parcial—
opera con la versión incompleta. La precondición «quitar el marcador de
scaffold» es silenciosa hasta que `--into` la rechaza.

Verificado que el CLI hace cumplir el flujo: `graduate --into` rechaza un
scaffold marcado sin refinar, y `graduate --pending` lista decisiones sin
resolver. El guardrail existe; el defecto es que el contrato no presenta el
procedimiento como pasos ordenados en su única fuente y el core insinúa una
versión abreviada que parece completa.

Causa raíz: verdad repartida con niveles de detalle distintos. El core debe
poseer solo el disparador (recargar contexto por id y decidir la graduación) y
`close.md` debe poseer el procedimiento completo como receta numerada.

Restricción: presupuestos de `test/context.test.mjs` — el overlay de cierre no
tiene presupuesto propio medido aparte, pero el core (120 líneas / 8000 bytes)
se reduce ligeramente al abreviar la regla 8, lo que además da holgura a
20260705-134703 si ambos se aceptan.

## Specification

### CR1 — El overlay de cierre contiene la receta numerada de graduación
- **Given** un change en estado `done` pendiente de cierre
- **When** se ejecuta `changeledger context <id>`
- **Then** la salida contiene una lista numerada para spec nuevo con
  exactamente estos pasos en este orden: `changeledger graduate <id>
  <spec-slug> --new`; reescribir el seed como verdad duradera concisa;
  eliminar el marcador de scaffold; `changeledger graduate <id> <spec-slug>
  --into`
- **And** el paso de `--new` declara literalmente que deja la graduación
  pendiente
- **And** el paso de `--into` declara que rechaza un scaffold marcado sin
  refinar
- **And** los caminos de spec existente (`--into` directo tras editar el
  body) y `--skip` se mantienen como alternativas explícitas

### CR2 — El core conserva solo el disparador, sin versión abreviada
- **Given** el fragmento `templates/contract/core.md` tras el cambio
- **When** se lee la regla 8
- **Then** ordena recargar `changeledger context <id>` tras la aceptación y
  decidir la graduación (graduar o `--skip`) antes de archivar
- **And** ya no contiene el paréntesis «a new spec is a two-step `--new` then
  `--into`» ni ningún otro resumen del procedimiento
- **And** el procedimiento completo existe únicamente en
  `templates/contract/close.md`

### CR3 — El matiz de reviewed queda junto a la receta
- **Given** el fragmento `templates/contract/close.md` tras el cambio
- **When** se lee la receta de graduación
- **Then** la explicación de `reviewed: true` (la ponen `--into` y skip, no
  `--new`) acompaña a los pasos que la producen, no una sección separada

### CR4 — Los presupuestos de contexto siguen pasando sin ajuste
- **Given** los presupuestos vigentes en `test/context.test.mjs` (core: 120
  líneas / 8000 bytes)
- **When** se ejecuta `node --test test/context.test.mjs`
- **Then** todas las pruebas pasan con los valores actuales, sin modificarlos

## Plan

- [x] Añadir pruebas fallidas en `test/context.test.mjs` que exijan la receta numerada en el overlay de cierre (contexto por id de un change `done`) y la ausencia del resumen `--new`/`--into` en el core; luego reescribir las viñetas de graduación de `templates/contract/close.md` como receta numerada con el matiz de `reviewed: true` integrado y abreviar la regla 8 de `templates/contract/core.md` al disparador; verify: `node --test test/context.test.mjs` (CR1, CR2, CR3) — 2026-07-05T14:13:02Z
- [x] Comprobar que las composiciones de `templates/contract/core.md` y `templates/contract/close.md` respetan los presupuestos vigentes sin modificarlos; verify: `node --test test/context.test.mjs` (CR4) — 2026-07-05T14:13:02Z
- [x] Ejecutar el quality gate completo; verify: `pnpm verify` (support) — 2026-07-05T14:13:02Z

## Log
- **2026-07-05T13:57:41Z** — status: draft → approved
- **2026-07-05T14:09:09Z** — status: approved → in-progress
- **2026-07-05T14:09:09Z** — owner → raruiz-hiberuscom (auto)
- **2026-07-05T14:13:02Z** — Receta numerada de graduacion en close.md (new-spec en 3 pasos, reviewed:true por paso, existing-spec y skip como alternativas). Regla 8 de core.md recortada: sin el parentesis --new/--into, apunta al close overlay. Actualizados tests context/230608/cli(221849) y snapshots core/close. Budgets core 120/8000 intactos. 541 tests verdes.
- **2026-07-05T14:13:02Z** — status: in-progress → in-review
