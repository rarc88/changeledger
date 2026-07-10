---
id: "20260705-134703"
title: Matriz de ownership de transiciones del lifecycle
type: feature
status: done
created: 2026-07-05T13:47:03Z
depends_on: []
owner: raruiz-hiberuscom
reviewed: true
archived: true
---

## Request

La auditoría de followability del contrato (2026-07-05) señaló que «quién
posee qué transición» exige cruzar prosa densa: el párrafo de
`templates/contract/core.md:80-86` concentra en seis líneas que `status` no
acepta `done` ni `discarded`, que el viewer posee `draft → approved`,
`in-validation → done|in-progress` y el reopen elegible de `done`, que el
agente realiza el resto de movimientos y que descartar usa un comando propio.

Un modelo promedio resuelve mal esa prosa: intenta `changeledger status <id>
done` (rechazado por el CLI) o `status <id> approved` (transición humana). Se
quiere una matriz explícita transición → propietario → mecanismo en el core,
que elimine la inferencia.

## Investigation

Transiciones válidas y su mecanismo real, verificados contra el diagrama de
`core.md:60-69`, la ayuda del CLI y los guards de `src/commands/agent.mjs` y
del viewer:

| Transición | Propietario | Mecanismo |
|---|---|---|
| draft → approved | humano | viewer |
| approved → in-progress | agente | `changeledger status` |
| in-progress → in-review | agente | `changeledger status` |
| in-progress → in-validation (sin review) | agente | `changeledger status` |
| in-review → in-validation | orquestador | `changeledger review <id> pass` |
| in-review → in-progress | orquestador | `changeledger review <id> fail --retry` |
| in-review → blocked | orquestador | `changeledger review <id> fail --block` |
| blocked → in-progress | agente | `changeledger status` |
| in-validation → done | humano | viewer |
| in-validation → in-progress | humano | viewer |
| done → in-progress (cierre pendiente) | humano | viewer, con motivo |
| draft/approved/in-progress/blocked → discarded | agente con autorización | `changeledger discard <id> "<reason>"` |

Restricción: el core compuesto tiene presupuesto de 120 líneas / 8000 bytes en
`test/context.test.mjs` y `core.md` ya ocupa 113 líneas. Una tabla de ~16
líneas que reemplaza un párrafo de 6 no cabe sin ajuste: o se compensa
compactando texto existente del core o se ajusta deliberadamente el
presupuesto de líneas (los bytes siguen siendo el límite duro en múltiplos de
1000).

Riesgo de doble verdad: el diagrama de lifecycle (`core.md:60-69`) ya enumera
las transiciones. La primera implementación conservó ese diagrama y añadió la
matriz, por lo que dejó dos enumeraciones paralelas de los mismos arcos aunque
solo una incluyera ownership. La corrección debe dejar una sola representación.

## Proposal

Sustituir en `templates/contract/core.md` tanto el diagrama como el párrafo de
ownership por una sola matriz transición → propietario → mecanismo. Las filas
con el mismo actor y mecanismo pueden agrupar transiciones cuando la lectura
sigue siendo inequívoca; los tres veredictos de review permanecen separados
porque usan comandos distintos.

Las frases del párrafo actual que no son ownership se conservan fuera de la
matriz en una nota breve: el motivo de descarte es obligatorio y se registra,
`discarded` nunca reabre, y el reopen de `done` solo cabe antes del cierre
duradero.

Presupuesto: el límite de bytes sigue siendo el control duro de carga y se
mantiene en 8000. El límite de líneas no puede coincidir con el tamaño exacto
de una composición concreta: queda en un techo redondo de 130, con margen real
tras eliminar el diagrama, para no incentivar compactaciones editoriales que
borren razones o instrucciones.

Alternativas descartadas: (a) poner la matriz en un fragmento aparte cargado
bajo demanda — el orquestador necesita el ownership en la conversación inicial,
antes de cualquier modo; la separación de contexto para delegados pertenece al
change 20260704-144327; (b) anotar el diagrama con propietarios inline —
ilegible y vuelve a competir con la tabla; (c) tabla solo en README — los
agentes consumen el contexto, no el README.

## Specification

### CR1 — El core compuesto contiene la matriz de ownership
- **Given** un repo ChangeLedger con la plantilla de contrato de este paquete
- **When** se ejecuta `changeledger context`
- **Then** la salida contiene una tabla Markdown con columnas transición,
  propietario y mecanismo
- **And** la tabla cubre las 12 transiciones enumeradas en la Investigation,
  agrupando solo las que comparten propietario y mecanismo, con
  `changeledger review <id> pass` como mecanismo de `in-review →
  in-validation` y el viewer como mecanismo de `draft → approved`,
  `in-validation → done|in-progress` y `done → in-progress`
- **And** ninguna fila asigna `done` ni `discarded` a `changeledger status`

### CR2 — La matriz sustituye al párrafo de ownership sin doble verdad
- **Given** el fragmento `templates/contract/core.md` tras el cambio
- **When** se lee la sección Lifecycle completa
- **Then** el párrafo de prosa de ownership (actual `core.md:80-86`) ya no
  existe; propietario y mecanismo aparecen solo en la matriz
- **And** el diagrama de texto deja de existir; la matriz es también la única
  representación de la topología
- **And** las reglas no-ownership sobreviven como nota: motivo de descarte
  obligatorio y registrado, `discarded` nunca reabre, reopen de `done` solo
  antes del cierre duradero

### CR3 — El presupuesto del core queda en un estado deliberado
- **Given** los presupuestos de `test/context.test.mjs` (core: 130 líneas /
  8000 bytes)
- **When** se ejecuta `node --test test/context.test.mjs` tras el cambio
- **Then** todas las pruebas pasan
- **And** el presupuesto de bytes del core sigue siendo 8000
- **And** la composición queda por debajo de ambos límites, sin usar su tamaño
  medido como presupuesto

## Plan

- [x] Añadir pruebas fallidas en `test/context.test.mjs` que exijan la matriz (columnas y las 12 filas, incluidos los mecanismos de review y viewer) en la composición del core; luego reescribir la sección Lifecycle de `templates/contract/core.md`: matriz en lugar del párrafo de ownership, diagrama solo topología, nota con las reglas no-ownership; verify: `node --test test/context.test.mjs` (CR1, CR2) — 2026-07-05T14:42:14Z
- [x] Medir la composición resultante de `templates/contract/core.md` y compactarla o ajustar el presupuesto de líneas en `test/context.test.mjs` con registro en el Log, manteniendo 8000 bytes; verify: `node --test test/context.test.mjs` (CR3) — 2026-07-05T14:42:14Z
- [x] Ejecutar el quality gate completo; verify: `pnpm verify` (support) — 2026-07-05T14:42:14Z
- [x] Preparar las regresiones en `test/context.test.mjs` y `test/cli.test.mjs` para exigir una sola representación sin fijar la forma retirada; verify: `node --test test/context.test.mjs test/cli.test.mjs` (support) — 2026-07-05T16:57:44Z
- [x] Eliminar el diagrama paralelo de `templates/contract/core.md`, agrupar filas equivalentes sin perder comandos y fijar el techo del core en 130 líneas / 8000 bytes con margen; verify: `node --test test/context.test.mjs` (CR1, CR2, CR3) — 2026-07-05T16:57:44Z
- [x] Ejecutar el quality gate completo tras la corrección; verify: `pnpm verify` (support) — 2026-07-05T16:59:53Z

## Log
- **2026-07-05T13:57:40Z** — status: draft → approved
- **2026-07-05T14:36:22Z** — status: approved → in-progress
- **2026-07-05T14:36:22Z** — owner → raruiz-hiberuscom (auto)
- **2026-07-05T14:42:14Z** — Matriz transicion->propietario->mecanismo (12 filas) reemplaza el parrafo de ownership en core.md; diagrama de lifecycle queda solo topologia (anotaciones entre corchetes eliminadas, expresadas por la matriz); reglas no-ownership sobreviven como nota. Presupuesto de lineas del core elevado 120->134 (composicion medida exacta) manteniendo bytes 8000 (real 7076); actualizadas 8 aserciones de linea, el snapshot de core.md y la asercion viewer-owns de 234939. 549 tests verdes.
- **2026-07-05T14:42:14Z** — status: in-progress → in-review
- **2026-07-05T14:44:40Z** — review → in-validation (delegated subagent, clean context)
- **2026-07-05T16:53:42Z** — validation → in-progress (human rejected): Necesita ajustes
- **2026-07-05T16:59:53Z** — Corrección tras rechazo humano: la matriz queda como única representación del lifecycle; agrupa transiciones con actor/mecanismo idénticos, conserva separados los tres veredictos de review y elimina el diagrama paralelo. Core medido en 120 líneas/6674 bytes frente a techo redondo 130/8000. pnpm verify verde con 549 tests.
- **2026-07-05T16:59:53Z** — status: in-progress → in-review
- **2026-07-05T17:02:27Z** — review → in-validation (delegated subagent, clean context)
- **2026-07-10T20:16:11Z** — validation → done (human accepted)
- **2026-07-10T20:19:47Z** — graduado a spec `lifecycle.md`
- **2026-07-10T20:19:48Z** — archived
