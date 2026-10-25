---
id: "20261025-193447"
title: "Opciones 1 y 2 del §12: delegation.md dentro del core y el bloque de commits como tabla; la épica mide su objetivo contra el contrato real"
type: change
status: approved
created: 2026-10-25T19:34:47Z
depends_on: []
related_to:
  - "20261024-202718"
  - "20261024-202659"
parent: "20261023-181733"
owner: raruiz-hiberuscom
---

## Request

El hijo `20261024-202718` dejó el contrato en diez fragmentos y 6.188
palabras sin alcanzar las cifras del §5 del plan: `core.md` pesa 1.633
palabras frente a ~960, `implement.md` 1.007 frente a ~500. No se retiró prosa
normativa para caber, y el humano decidió (2026-10-25) abrir las opciones 1 y 2
del §12 como hijo nuevo antes de cerrar la épica, ampliando su frontera.

Medido antes de redactar, el §12 rinde menos de lo que el plan asumía. El plan
dice «con 1 y 2: ~3.040 palabras» porque daba por alcanzadas las cifras del §5;
sobre el contrato real: `delegation.md` son 270 palabras con unas 100 de
solape con el core (un nivel de delegación, un dueño por superficie, la
selección como unidad, el tamaño del delegado), y el bloque `## Commits` del
core son 350 palabras. Plegar `delegation.md` en el core le añade ~170 netas y
quita 270 a las capturas de `spec` e `implement`; comprimir el bloque de
commits a una tabla de cuatro clases le quita ~200. El core quedaría en unas
1.600 palabras y el contrato en unas 5.900: el §12 cierra un tercio del hueco
del core y nada del resto. Lo que falta hasta el §5 sólo cae retirando
obligaciones que el plan conserva (§4), y eso es lo que la opción 3 del §12
desaconseja y el humano no ha autorizado.

### Objective

El contrato pesa lo que el §12 permite sin perder una obligación, y la épica
mide su objetivo contra el contrato real. Terminado significa que:

- `delegation.md` no existe: su criterio de delegación, el contrato de prompt
  y el triaje viven en `core.md` como una sección propia, sin duplicar las
  frases que el core ya tenía; `MODE_CONTEXT.spec` e `implement` componen
  sólo su fragmento y el inventario queda en nueve fragmentos;
- el bloque `## Commits` del core es una tabla de las cuatro clases (Draft,
  Baseline, Implementation, Handoff) con una fila por clase —cuántas, cuándo,
  qué lleva— y conserva, fuera de la tabla, la regla de granularidad, el
  formato del asunto con `[#<id>]` y el cuerpo `ChangeLedger: [#A] [#B]`, la
  exención de los commits de merge y release, `changeledger commit` y
  `check --commits`, y la regla del commit combinado; se pierden sólo los
  ejemplos que desambiguan, como el plan anticipa;
- cada obligación que el plan conserva (§4) sigue encontrable por un grep en
  su sede; los guards de `test/context.test.mjs` que apuntan a
  `delegation.md` se reapuntan al core, y los estructurales (inventario,
  composición, encabezados, bloques del core) al estado nuevo;
- los techos de `budgets.yml` bajan a lo medido en los dos marcos: `core` a lo
  que cabe tras el pliegue y la tabla, `spec` e `implement` a sus capturas sin
  `delegation`; ninguno sube;
- el Log registra palabras por fragmento antes y después, y la épica
  corrige en su objetivo las cifras del §5 por las medidas (decisión 1).

### Frontier

**Entra.** `templates/contract/core.md`, `templates/contract/delegation.md`
(borrado), `templates/contract/budgets.yml`, `src/commands/context.mjs`
(`MODE_CONTEXT`), `test/context.test.mjs` (inventario `143656 CR4`,
`ownedHeadings`, bloques del core, guards 26 y 27 y cualquier otro que lea
`delegation.md`, `PINNED_CEILINGS`), `test/contract.test.mjs` (el test de
`[finding]` que lee `delegation.md`), `README.md` y `CONTRIBUTING.md` donde
nombren el fragmento; el objetivo de la épica `20261023-181733`, que este
hijo propone corregir al cerrar (decisión 1).

**Queda fuera.** La opción 3 del §12 (soltar reproducir el defecto y el test
en rojo); cualquier otra frase normativa del core, `spec.md`, `implement.md`,
`review.md`, `close.md`, `global-state.md` y las cápsulas; `AGENTS.md`; el
hook; las specs, que reconcilia la épica.

**Pre-autorizado.** Reapuntar los tests estructurales y de concepto al
estado nuevo, nombrándolos en el Log; bajar techos; enmendar la Specification
en `in-progress` cuando el código desmienta lo previsto, registrándolo. Si
cambia el objetivo o la frontera, se vuelve al humano.

### Decisiones de forma que el humano aprueba con el objetivo

1. **La épica corrige su objetivo a lo medido.** Su primer punto dice que el
   contrato «cabe en los pesos del §5». Con el §12 hecho no cabrá, y la
   alternativa es la opción 3, que el plan desaconseja. Recomendación: al
   cerrar, el objetivo de la épica dice «cabe en los pesos medidos tras el
   §12, con los techos de `budgets.yml` bajados a ellos y declarados
   decrecientes», y el Log de la épica conserva las cifras del §5 como la meta
   que el plan fijó y la medida que se alcanzó. Alternativa: dejar el objetivo
   como está y cerrar la épica con el hueco registrado, que deja una épica
   `done` con un objetivo que se sabe incumplido.
2. **El core gana una sección, no tres.** `## Delegation` reúne criterio,
   contrato de prompt y triaje en ~170 palabras netas; las frases que el core
   ya tenía en «Protect the orchestrator's context» no se repiten. Un
   encabezado nuevo cambia la cuenta de bloques que `test/context.test.mjs`
   pina (once → doce).
3. **La tabla de commits sustituye a la prosa de las clases, no al resto.**
   Las reglas de asunto, cuerpo, exención, comando y combinación siguen en
   prosa breve debajo de la tabla; son reglas que `check --commits` aplica y
   un test guarda por patrón.

### Investigation

Medido en `dev` (`54e6d3df`). `core.md` 1.633 palabras con once bloques
`##`; su bloque `## Commits` 350 palabras; `delegation.md` 270 palabras con
cuatro secciones (`Delegate a real boundary`, `Do not over-shard`,
`Delegation prompt contract`, `Triage at handoff`). El core ya enuncia un nivel
de delegación, un dueño por superficie, el tamaño del delegado y la selección
como unidad; `delegation.md` lo repite en su primera sección. Composición:
`MODE_CONTEXT.spec = ['spec','delegation']`, `implement = ['implement',
'delegation']`. Techos: `core` 2380 con la captura en 2374, `spec` 2380,
`implement` 1960. Tests que leen `delegation.md`: el inventario `143656 CR4`,
`ownedHeadings` de `234939`, los guards 26 (un nivel, un dueño) y 27 (triaje)
de `CONCEPT_GUARDS`, `225213 CR4/CR5/CR7`, y en `test/contract.test.mjs` el
test del hijo `[finding]` que exige la viñeta del triaje. `README.md` nombra
«the prompt contract in the `delegation` fragment».

### Proposal

#### Solución elegida

Una sección `## Delegation` en el core, después de «Protect the orchestrator's
context», con el criterio de frontera real, la prohibición de sobrefragmentar,
los siete ítems del prompt y el triaje de cuatro salidas; se borra
`delegation.md` y `MODE_CONTEXT` deja `spec` e `implement` solos. El bloque
`## Commits` pasa a una tabla de cuatro filas (clase, cuántos, cuándo, qué
lleva) seguida de la prosa de asunto, cuerpo, exenciones, comando y commit
combinado. Se mide, se bajan techos y el Log registra la tabla de palabras.

#### Alternativas descartadas

- **Mantener `delegation.md` y sólo comprimir commits.** Deja el solape que
  el plan nombra y el pack `implement` cargando dos fragmentos.
- **Tabla de tres clases, como dice el plan.** El plan contaba Draft,
  Baseline e Implementation con Handoff aparte; desde `20261024-202718` las
  clases son cuatro y la tabla las lista todas.
- **Opción 3 del §12.** El plan la desaconseja con dato (24 % de las vueltas
  son huecos de test) y el humano no la ha autorizado.

#### Escenarios

- **El día después.** `changeledger context` carga el core con `## Delegation`
  y la tabla de commits; `context spec` y `context implement` pesan ~270
  palabras menos cada uno; un agente encuentra las siete cosas que un prompt
  declara sin abrir otro fragmento.
- **La épica cierra.** Mide el contrato, corrige su objetivo según la
  decisión 1 y gradúa a las specs lo que el conjunto cambió.

## Specification

## Plan

## Log
- **2026-10-25T19:34:47Z** `[version]` 0.19.0
- **2026-10-25T20:58:10Z** `[status]` draft → approved (human via conversation)
