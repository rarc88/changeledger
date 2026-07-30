---
id: "20260710-102907"
title: Los presupuestos de contexto no tienen una fuente de verdad coherente
type: bug
status: done
created: 2026-07-10T10:29:07Z
depends_on: []
owner: Roberto Ruiz
reviewed: true
archived: true
---

## Request

La auditoría del contrato detectó riesgo de regresión por compactación: los
límites que aplican los tests no coinciden con los publicados como verdad
persistente y mezclan el objetivo de legibilidad con el límite de seguridad.
Hay que fijar una gobernanza única que permita al core conservar lo transversal
y que cargue los detalles dinámicos sólo en quien los necesita.

## Investigation

La fuente persistente `contract-discovery.md` declara estos presupuestos base:
core 120 líneas/8192 bytes, spec 285/11800, implement 170/7300, review 75/3200
y release 45/2200. `test/context.test.mjs` impone otros: core 130/8000,
spec 285/12000, implement 175/8000, review 75/4000 y release 45/3000. Los
overlays sí coinciden entre ambas fuentes. Por tanto ningún consumidor puede
saber cuál es el contrato real de tamaño.

El core actual ocupa 120 líneas y 6674 bytes: está por debajo de ambas variantes,
pero el test sólo protege un techo; no expresa la holgura deliberada ni distingue
un objetivo de lectura de un hard cap. Esto incentiva a recortar reglas para
pasar un límite en vez de decidir qué audiencia necesita cada regla.

Los nuevos capsules de `agent-context` ya demuestran el reparto correcto:
el orquestador conserva el core y los delegados reciben sólo política efectiva,
rol y change seleccionado; sus tests tienen un límite separado (<60 líneas,
<3000 bytes), pero no están inventariados en la spec. La corrección debe medir
composiciones base sin el change seleccionado y declarar de forma única tanto
objetivo como tope duro, incluyendo esos capsules, sin fijar cifras a ciegas
antes de medir los contextos efectivos y sus márgenes.

## Specification

### CR1 — Presupuesto con una sola fuente ejecutable
- **Given** las composiciones de contexto y sus tests
- **When** se consulta el presupuesto de un core, pack, overlay o capsule de agente
- **Then** existe una sola tabla versionada en `templates/contract/budgets.yml`
- **And** `test/context.test.mjs` carga esa tabla en vez de repetir cifras
- **And** `contract-discovery.md` explica el modelo y enlaza la tabla sin copiar sus números

### CR2 — Objetivo y límite duro explícitos
- **Given** la tabla de presupuestos
- **When** se mide una composición base sin el change seleccionado
- **Then** cada entrada declara `target` y `hard` para líneas y bytes
- **And** la suite falla al exceder el hard cap y avisa al superar el target
- **And** los targets/hard caps iniciales son: core 125/7500 y 140/9000; spec 280/12000 y 310/13500; implement 185/8500 y 205/10000; review 70/3500 y 85/4500; release 45/2500 y 60/3500

### CR3 — Overlays y capsules cubiertos sin cargar detalle ajeno
- **Given** los overlays de lifecycle y los tres `agent-context`
- **When** se ejecutan sus mediciones base
- **Then** los overlays conservan sus límites actuales como target y tienen un hard cap con holgura de 20% redondeada
- **And** investigation, implementation y review de agente tienen target 45 líneas/2000 bytes y hard cap 60/3000
- **And** las mediciones excluyen el cuerpo del change seleccionado, que pertenece a la tarea, no al contexto base

### CR4 — No se compacta semántica para satisfacer una cifra accidental
- **Given** una adición necesaria a una regla transversal o a un contexto especializado
- **When** supera su target pero no el hard cap
- **Then** el test informa la desviación sin obligar a borrar contenido
- **And** el cambio debe justificar en su Log si eleva target o hard cap
- **And** el core conserva sólo orientación transversal y los detalles específicos siguen en su pack o capsule de audiencia

## Plan

- [x] Añadir `templates/contract/budgets.yml`, actualizar `contract-discovery.md` y cubrir su carga/forma en `test/context.test.mjs`
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR1
  - **Resolved:** `2026-07-10T17:34:21Z`
- [x] Actualizar `templates/contract/budgets.yml` y `test/context.test.mjs` para aplicar target (diagnóstico) y hard cap (fallo) a los cinco contextos base
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR2, CR4
  - **Resolved:** `2026-07-10T17:34:21Z`
- [x] Actualizar `templates/contract/budgets.yml`, `test/context.test.mjs` y `test/agent-context.test.mjs` para medir overlays y capsules sin change seleccionado
  - **Verify:** `node --test test/context.test.mjs test/agent-context.test.mjs`
  - **Criteria:** CR3, CR4
  - **Resolved:** `2026-07-10T17:34:31Z`
- [x] Revisar `templates/contract/core.md` y ejecutar el gate completo para confirmar que detalle específico no entró al core
  - **Verify:** `pnpm verify`
  - **Support:**
  - **Resolved:** `2026-07-10T17:34:31Z`

## Log
- **2026-07-10T12:02:37Z** `[status]` draft → approved
- **2026-07-10T17:31:29Z** `[status]` approved → in-progress
- **2026-07-10T17:31:29Z** `[owner]` set: Roberto Ruiz (auto)
- **2026-07-10T17:34:32Z** `[status]` in-progress → in-review
- **2026-07-10T17:41:37Z** `[review]` in-review → in-progress (retry): La tabla no gobierna overlays/capsules ni aplica diagnóstico de target.
- **2026-07-10T17:42:05Z** `[status]` in-progress → in-review
- **2026-07-10T17:42:55Z** `[review]` in-review → in-progress (retry): Capsules no cargan tabla y los targets no emiten diagnóstico.
- **2026-07-10T17:47:55Z** `[status]` in-progress → in-review
- **2026-07-10T17:49:29Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-10T20:16:13Z** `[validation]` in-validation → done (human accepted)
- **2026-07-10T20:19:47Z** `[graduation]` spec: `contract-discovery.md`
- **2026-07-10T20:19:48Z** `[archive]` archived
