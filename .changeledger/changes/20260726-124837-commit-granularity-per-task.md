---
id: "20260726-124837"
title: Unidad de commit igual a tarea del Plan
type: refactor
status: draft
created: 2026-07-26T12:48:37Z
depends_on: ["20260726-124835"]
related_to: ["20260722-124656"]
owner: raruiz-hiberuscom
---

## Request

Agentes que implementan un change producen commits de más: entre otros, uno
para `draft → approved` y otro para `approved → in-progress`. Ninguna de esas
dos transiciones lleva código, y su trazabilidad ya vive en el Log del change
(`changeledger status` escribe el evento `[status]` correspondiente), así que
esos commits añaden ruido sin añadir información nueva al historial.

`templates/contract/implement.md` ya contiene una regla al respecto, pero está
redactada de un modo que se autoviola:

- La línea 28 convierte la regla positiva en un juicio: "Commit completed units
  with their tasks and Log **when later work could obscure attribution**". El
  agente se pregunta si trabajo posterior podría oscurecer la atribución, y la
  respuesta segura es siempre que sí — la instrucción invita al exceso que
  pretende evitar.
- La línea 29 es una prohibición sin unidad de referencia: "Do not create a
  dedicated commit for a lifecycle-only transition" dice qué no hacer sin decir
  con qué medir cuándo sí commitear.
- La línea 24 contradice a las dos anteriores en la práctica: "After
  `approved → in-progress`, create a baseline commit" se lee como licencia para
  commitear en una transición.

Se necesita sustituir el juicio por una unidad contable, de modo que la regla
no dependa de que el agente estime "podría importar más adelante".

## Proposal

**Unidad de commit decidida: la tarea del Plan.** `templates/contract/readiness.md`
ya exige dimensionar cada tarea del Plan a un ciclo rojo-verde; esa tarea,
que ya es la unidad atómica del Plan, pasa a ser también la unidad atómica de
commit. En una rama de change existen exactamente tres — y solo tres — clases
de commit:

- **Baseline**: exactamente uno, con el documento del change, antes de
  cualquier código. No es un commit de lifecycle: es el invariante "documentado
  antes que el código" hecho verificable en el historial de git — sin él no
  queda prueba en git de que el diseño precedió a la implementación.
- **Task**: uno por cada tarea del Plan completada, con el código de esa tarea,
  su test, su casilla marcada y sus entradas de Log.
- **Handoff**: cero o uno, solo cuando el trabajo se detiene (pasa a review,
  queda bloqueado, termina la sesión) y de otro modo quedaría sin commitear
  estado que es solo documento.

Una transición de lifecycle nunca es un commit propio: viaja dentro de
cualquiera de los tres anteriores que ocurra a continuación. Por tanto, `n`
tareas completadas producen `n + 1` (baseline + tareas) o `n + 2` (más
handoff) commits — nunca uno por transición.

### Qué se preserva sin cambios en `implement.md`

La reescritura sustituye únicamente el párrafo del juicio de atribución
(líneas 24 y 28-34); el resto de la sección de commits permanece intacto:

- La forma canónica del subject: `type(scope): description [#<id>]`.
- La regla de body multi-change: `ChangeLedger: [#A] [#B]`, nunca una lista
  separada por comas dentro de un mismo corchete.
- Las excepciones: commits de merge y la preparación `chore(release)`.
- `changeledger commit -m "..." [--id <id>]` como compositor del commit.
- `changeledger check --commits [<base>]` como linter a ejecutar antes de
  solicitar review.
- Las reglas de rama y worktree de las líneas 18-22 (nunca implementar en
  `main`/`master`/`dev`, ramas desde `git.integration_branch`, inspeccionar el
  worktree antes de tocarlo).
- La regla sobre registrar un commit combinado inevitable cuando varios
  changes comparten archivos (nombrar cada change afectado en Log o handoff).

### Criterios verificables

Sin etapa de Specification en `refactor`, este Proposal fija los criterios que
un reviewer puede comprobar directamente sobre la salida compuesta de
`changeledger context implement` (vía `test/context.test.mjs`):

- **Debe estar ausente** la frase de juicio: `later work could obscure
  attribution` no aparece en ningún lugar de `implement.md` tras la reescritura.
- **Debe estar presente** la definición de las tres clases de commit y su
  fórmula de conteo, en términos equivalentes a:
  - "exactly one" commit baseline, "containing the change document", "before
    any code".
  - "one per completed Plan task" para el commit de task.
  - "zero or one" para el commit de handoff.
  - que una transición de lifecycle "travels in whichever of the three comes
    next" (nunca es un commit propio).
- **Debe seguir presente**, sin alterar, cada elemento listado en "Qué se
  preserva sin cambios" arriba (aserciones literales sobre las líneas que no se
  tocan).
- El presupuesto `implement` de `templates/contract/budgets.yml` (`target` y
  `hard`, líneas y bytes) sigue cumpliéndose tras la reescritura —
  `assertWithinBudget('implement', …)` en `test/context.test.mjs` sigue en
  verde sin necesidad de tocar `budgets.yml`.

### Fuera de alcance

- Añadir un nuevo lint que cuente commits contra tareas del Plan completadas:
  merece medirse más adelante, pero es superficie nueva y no la introduce este
  change.
- El bloque de cuatro líneas sobre commits que se añade a
  `templates/contract/core.md`: lo posee el change `20260726-124835` (la
  reescritura del contexto core). Este change no edita `core.md`.

## Plan

- [ ] Reescribir el párrafo de reglas de commit (líneas 24 y 28-34) en
      `templates/contract/implement.md` con la unidad de commit
      baseline/task/handoff descrita en el Proposal, sin tocar el resto de la
      sección de git/commits, y actualizar las aserciones de presencia/ausencia
      y el hash de snapshot revisado de `implement.md` en `test/context.test.mjs`
      acorde al nuevo texto; verify: `node --test test/context.test.mjs`
- [ ] Ejecutar el gate completo tras el cambio (support); verify: `pnpm verify`

## Log

- **2026-07-26T12:48:37Z** `[note]` Draft: sustituye el juicio de atribución de
  `implement.md` por una unidad de commit contable (tarea del Plan), con tres
  clases cerradas — baseline, task, handoff — y ninguna transición de
  lifecycle como commit propio.
