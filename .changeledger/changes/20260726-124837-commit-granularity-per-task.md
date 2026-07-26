---
id: "20260726-124837"
title: Unidad de commit igual a tarea del Plan
type: refactor
status: approved
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
commit. En una rama de change existen exactamente cuatro — y solo cuatro —
clases de commit:

- **Draft**: uno por cada documento de change que se redacta, commiteado en
  solitario — nunca varios borradores en un mismo commit. El discriminante que
  decide la granularidad de commit es si la unidad se revertirá, referenciará
  o implementará de forma independiente. Una transición de lifecycle no lo es
  (su información ya vive en el Log, así que el commit la duplicaría), pero un
  documento de change sí lo es: es el baseline sobre el que una futura rama de
  implementación construye, `changeledger check --commits` lo referencia por
  id, y puede descartarse en solitario. Si nueve documentos entran en un mismo
  commit, la propiedad "documentado antes que el código" se mantiene cierta
  pero deja de ser atribuible a ningún change concreto. Varios borradores
  pueden compartir una misma rama de autoría, pero sus implementaciones deben
  ir cada una a su propia rama.
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
cualquiera de las tres clases de la rama de implementación (baseline, task o
handoff) que ocurra a continuación. Por tanto, en la rama de implementación de
un change ya aprobado, `n` tareas completadas producen `n + 1` (baseline +
tareas) o `n + 2` (más handoff) commits — nunca uno por transición. El commit
Draft es anterior y externo a esa fórmula: ocurre en la rama de autoría, antes
de que exista la rama de implementación.

### Aviso sobre el índice tras un commit fallido

Observado de verdad en este repo: cuando el hook `pre-commit` falla, git deja
el índice staged intacto, así que un `git add` más commit posteriores absorben
en silencio los archivos del intento fallido anterior. El contrato debe
instruir al agente a inspeccionar el conjunto staged (p. ej. `git status` o
`git diff --cached --name-only`) antes de reintentar un commit tras cualquier
fallo — corregir el motivo del fallo no basta si el índice quedó contaminado.
El change `20260726-141124` añade la guarda equivalente del lado del CLI
(`commit()` rechaza un índice staged que mezcle ids de distintos changes);
esta prosa se limita a la obligación del agente y no duplica el alcance de
aquel change.

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

### Fuera de alcance

- Añadir un nuevo lint que cuente commits contra tareas del Plan completadas:
  merece medirse más adelante, pero es superficie nueva y no la introduce este
  change.
- El bloque de cuatro líneas sobre commits que se añade a
  `templates/contract/core.md`: lo posee el change `20260726-124835` (la
  reescritura del contexto core). Este change no edita `core.md`.
- La guarda del lado del CLI sobre el índice staged (rechazar en `commit()` un
  índice que mezcle ids de distintos changes): la posee el change
  `20260726-141124`. Este change solo añade la obligación del agente en el
  contrato.

## Specification

Los criterios se comprueban sobre la salida compuesta de
`changeledger context implement` (vía `test/context.test.mjs`), que es donde el
agente lee realmente el fragmento reescrito.

### CR1 — La frase de juicio de atribución desaparece

- **Given** el fragmento `templates/contract/implement.md` tras la reescritura
- **When** se compone el contexto con `changeledger context implement`
- **Then** la salida no contiene en ningún punto la cadena `later work could
  obscure attribution`

### CR2 — Las cuatro clases de commit quedan definidas con su fórmula de conteo

- **Given** el fragmento `templates/contract/implement.md` tras la reescritura
- **When** se compone el contexto con `changeledger context implement`
- **Then** la salida define el commit Draft en términos equivalentes a
  `one per drafted change document` y `committed on its own`, prohibiendo
  agrupar varios borradores en un mismo commit
- **And** define el commit Baseline como `exactly one`, `containing the change
  document`, `before any code`
- **And** define el commit Task como `one per completed Plan task` y el commit
  Handoff como `zero or one`
- **And** declara que una transición de lifecycle
  `travels in whichever of the [...] comes next`, es decir que nunca es un
  commit propio

### CR3 — El contrato obliga a inspeccionar el índice staged tras un hook fallido

- **Given** el fragmento `templates/contract/implement.md` tras la reescritura
- **When** se compone el contexto con `changeledger context implement`
- **Then** la salida instruye a inspeccionar el conjunto staged (en términos
  equivalentes a `inspect the staged set`) antes de reintentar un commit tras un
  fallo del hook `pre-commit`

### CR4 — Las reglas que se preservan siguen presentes sin alterar

- **Given** el fragmento `templates/contract/implement.md` tras la reescritura
- **When** se compone el contexto con `changeledger context implement`
- **Then** la salida sigue conteniendo la forma canónica del subject
  `type(scope): description [#<id>]`, la regla de body multi-change
  `ChangeLedger: [#A] [#B]` sin lista por comas, las excepciones de merge y
  `chore(release)`, `changeledger commit -m "..." [--id <id>]` como compositor y
  `changeledger check --commits [<base>]` como linter previo a la review
- **And** siguen presentes sin cambio las reglas de rama y worktree (nunca
  `main`/`master`/`dev`, ramas desde `git.integration_branch`, inspeccionar el
  worktree antes de tocarlo) y la obligación de registrar un commit combinado
  inevitable nombrando cada change que comparte la superficie

### CR5 — El presupuesto del contexto implement sigue cumpliéndose

- **Given** el fragmento `templates/contract/implement.md` tras la reescritura
- **When** se ejecuta `node --test test/context.test.mjs`
- **Then** `assertWithinBudget('implement', …)` pasa con el `target` y el `hard`
  ya declarados para `implement` en `templates/contract/budgets.yml`
- **And** no ha sido necesario modificar `budgets.yml`

## Plan

- [ ] Reescribir el párrafo de reglas de commit (líneas 24 y 28-34) en `templates/contract/implement.md` con las cuatro clases draft/baseline/task/handoff y el aviso de inspeccionar el índice staged tras un hook fallido descritos en el Proposal, sin tocar el resto de la sección de git/commits, y actualizar las aserciones de presencia/ausencia y el hash de snapshot revisado de `implement.md` en `test/context.test.mjs` acorde al nuevo texto; verify: `node --test test/context.test.mjs` (CR1, CR2, CR3, CR4, CR5)
- [ ] Ejecutar el gate completo tras el cambio; verify: `pnpm verify` (support)

## Log

- **2026-07-26T12:48:37Z** `[note]` Draft: sustituye el juicio de atribución de
  `implement.md` por una unidad de commit contable (tarea del Plan), con tres
  clases cerradas — baseline, task, handoff — y ninguna transición de
  lifecycle como commit propio.
- **2026-07-26T14:05:46Z** `[status]` draft → approved
- **2026-07-26T15:15:46Z** `[note]` Amendment while approved (human-authorized): Proposal extended to a fourth commit kind, Draft (one commit per authored change document, never batched), with the revert/reference/implement-independently discriminant; also adds the agent obligation to inspect the staged index before retrying a commit after any pre-commit hook failure (cross-ref 20260726-141124 for the CLI-side guard). Criterios verificables and the Plan task updated accordingly.
