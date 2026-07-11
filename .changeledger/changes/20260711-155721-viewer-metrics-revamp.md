---
id: "20260711-155721"
title: Metrics filtradas y con visualización de valor
type: feature
status: in-progress
created: 2026-07-11T15:57:21Z
depends_on: []
release_impact: minor
owner: raruiz-hiberuscom
---

## Request

La pestaña Metrics deja que desear: bloques planos de divs, sin ejes ni
etiquetas ricas, y los filtros globales (type, owner, status, búsqueda) no le
afectan — siempre pinta el repo completo. Se pide una pantalla visualmente
impactante, con datos que aporten valor y coherente con los filtros del header.

## Investigation

- Las métricas se calculan en el server: `computeMetrics(repo.changes)` de
  `src/metrics.mjs` (puro, sin IO) dentro de `serialize()`
  (`src/viewer/server/domain.mjs`) y llegan precalculadas en `/api/repo`.
- `renderMetrics()` (`src/viewer/public/app.js`) ignora `state.filters` por
  completo y delega en `metricsHtml(state.repo.metrics)`
  (`src/viewer/public/view-renderers.js`): imposible filtrar sin recalcular.
- Métricas actuales: closed, avg/median cycle, WIP con chips por estado,
  blocked time, tiempo medio por estado, throughput por día, aging de
  in-progress y tabla por tipo. Las barras son spans con `width:%` inline, sin
  eje, escala ni valores comparables entre grupos.
- `metricsHtml` no tiene cobertura de tests; la matemática de `computeMetrics`
  sí (`test/metrics.test.mjs`).
- El dolor operativo medido en este repo que las métricas no exponen: retries
  de review (59 en 32 changes) y latencia de validación humana (tiempo en
  `in-validation`), ambos derivables de los mismos eventos del Log que ya
  parsea `parseLogEvent`.

## Proposal

- **Cálculo en cliente sobre el set filtrado.** El server sirve `src/metrics.mjs`
  como módulo estático de solo lectura (misma técnica de contención que los
  assets propios); el cliente lo importa y ejecuta `computeMetrics` sobre los
  changes que pasan el mismo predicado de filtros que Board/Table (texto, type,
  owner, status, archived/discarded). Una sola implementación de métricas y una
  sola de filtros: nada duplicado. El precálculo del server se mantiene para
  el payload actual.
- **Métricas nuevas en `computeMetrics`** (con tests unitarios): percentiles
  p50/p85 del cycle time, tiempo medio en `in-validation` (latencia humana),
  número de veredictos `fail --retry`, y desglose por owner simétrico al de
  tipo.
- **Visualización SVG hecha a mano** (sin dependencias nuevas, como el graph):
  throughput como bar chart con eje temporal y valor por barra; tiempos por
  estado como barras horizontales con escala común y etiqueta de valor; fila de
  KPI cards (closed, cycle p50/p85, WIP, blocked, espera de validación,
  retries de review); tablas por tipo y por owner.
- **Estado vacío**: si los filtros no dejan changes, mensaje claro sin NaN ni
  divisiones por cero.

Alternativas descartadas:

- Endpoint con parámetros de filtro: duplica la semántica de filtros en el
  server y añade un request por cada cambio de filtro; el dataset ya está en
  el cliente.
- Librería de charts: coste de dependencia y sanitización para cuatro
  gráficos simples; el precedente del graph SVG propio funciona.

## Specification

### CR1 — Los filtros globales afectan a Metrics
- **Given** un repo con 3 bugs done y 2 features done
- **When** el filtro Type selecciona solo `bug` y se abre Metrics
- **Then** la KPI Closed muestra 3 y la tabla por tipo lista únicamente `bug`
- **And** limpiar el filtro vuelve a mostrar 5

### CR2 — Una sola implementación de métricas
- **Given** el visor servido
- **When** el cliente solicita el módulo de métricas compartido
- **Then** la respuesta son los bytes de `src/metrics.mjs` servidos por una ruta de solo lectura con la contención de assets existente
- **And** `view-renderers.js`/`app.js` no contienen una reimplementación de `computeMetrics`

### CR3 — Métricas de fricción nuevas
- **Given** un change done con Log que contiene dos `review → in-progress (fail --retry)` y 4 h entre `in-validation` y `done`
- **When** se ejecuta `computeMetrics`
- **Then** reporta 2 retries de review y una espera media de validación de 4 h
- **And** expone p50 y p85 del cycle time junto a avg y median

### CR4 — Throughput como SVG con eje y valores
- **Given** métricas con throughput de varios días
- **When** se renderiza Metrics
- **Then** el throughput es un `<svg>` con una barra por día, etiqueta de fecha y valor numérico por barra
- **And** los tiempos por estado usan barras con escala común y valor visible

### CR5 — Estado vacío sin ruido
- **Given** filtros que no dejan ningún change visible
- **When** se abre Metrics
- **Then** se muestra un estado vacío explícito
- **And** ningún KPI muestra `NaN`, `Infinity` ni división por cero

## Plan

- [ ] Añadir en `test/metrics.test.mjs` percentiles, espera de validación, retries y desglose por owner para `src/metrics.mjs`; verify: `node --test test/metrics.test.mjs` (CR3)
- [ ] Implementar esas métricas en `src/metrics.mjs`; verify: `node --test test/metrics.test.mjs` (CR3)
- [ ] Servir el módulo compartido en `src/viewer/server/router.mjs` con test de ruta y contención en `test/view.test.mjs`; verify: `node --test test/view.test.mjs` (CR2)
- [ ] Añadir en `test/viewer-metadata.test.mjs` cobertura de `metricsHtml` de `src/viewer/public/view-renderers.js`: SVG de throughput, barras con escala común y estado vacío; verify: `node --test test/viewer-metadata.test.mjs` (CR4, CR5)
- [ ] Reescribir `metricsHtml` en `src/viewer/public/view-renderers.js` con KPI cards, SVG y tablas; verify: `node --test test/viewer-metadata.test.mjs` (CR4, CR5)
- [ ] Conectar `renderMetrics` de `src/viewer/public/app.js` al predicado de filtros compartido y al módulo servido; verify: manual browser check con filtros activos (CR1)
- [ ] Estilos de KPI cards y charts en `src/viewer/public/styles.css`; verify: manual browser check (CR4)
- [ ] Ejecutar `pnpm verify` completo tras la implementación (support)

## Log
- **2026-07-11T16:13:58Z** — status: draft → approved
- **2026-07-11T16:22:27Z** — status: approved → in-progress
- **2026-07-11T16:22:27Z** — owner → raruiz-hiberuscom (auto)
