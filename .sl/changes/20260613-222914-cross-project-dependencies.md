---
id: "20260613-222914"
title: Dependencias entre proyectos
type: feature
status: done
created: 2026-06-13T22:29:14Z
depends_on: []
reviewed: true
---

## Request

Un change puede depender de trabajo en otro proyecto. Referencia tipo `proyecto:id` en `depends_on`; el visor global la resuelve y enlaza entre proyectos.

## Investigation

- Hoy `depends_on` lista ids locales (`YYYYMMDD-HHMMSS`). `check.mjs` valida que
  cada dep exista localmente, si no error "missing change", y construye el grafo
  de ciclos solo con ids locales.
- El visor global ya conoce todos los proyectos (`/api/projects`) y carga uno por
  vez (`/api/repo?project=`). El registro mapea `project_id → {name, path}`.
- Una dep externa cruza repos: el checker es puro (sin IO al registro ni a otros
  repos), así que no puede verificar que el change externo exista. Lo correcto es
  no tratarla como dep local rota.

## Proposal

Forma de referencia: `<proyecto>:<changeId>`, donde `<proyecto>` casa con el
`id` **o** el `name` de un proyecto registrado. Cualquier dep que contenga `:`
es **externa**.

- **check**: las deps externas se excluyen de la validación local (no son
  "missing") y del grafo de ciclos (solo aristas locales). Las deps locales
  (sin `:`) siguen validándose igual.
- **Visor**: el detalle distingue deps locales de externas. Una dep externa se
  muestra como pill `proyecto:#id`; al hacer clic, el visor resuelve el proyecto
  (por id o nombre) en la lista cargada, cambia el selector y abre ese change.

Descartado: validar deps externas leyendo otros repos desde `check` — rompe la
pureza del validador y acopla el check al registro/FS global.

## Specification

### CR1 — check no falsea una dep externa
- **Given** un change con `depends_on: ["otro:20260101-000000"]`
- **When** ejecuto `sl check`
- **Then** no se reporta "missing change" para esa dep
- **And** las deps locales inexistentes siguen siendo error

### CR2 — el grafo de ciclos ignora deps externas
- **Given** changes con deps externas
- **When** se calcula el ciclo de dependencias
- **Then** solo se consideran aristas a ids locales

### CR3 — el visor enlaza una dep externa
- **Given** el visor global con varios proyectos
- **When** abro un change con una dep `proyecto:id`
- **Then** se muestra como pill externa
- **And** al hacer clic cambia al proyecto resuelto y abre ese change

## Plan

- [x] `check.mjs`: deps con `:` son externas — 2026-06-14T11:45:24Z
- [x] Visor: pill de dep externa + navegación cross-proyecto (`gotoChange`) (CR3) — 2026-06-14T11:45:24Z
- [x] Tests: dep externa no falsea; dep local rota sí; grafo ignora externas (CR1, CR2) — 2026-06-14T11:45:24Z

## Log
- **2026-06-14T11:12:24Z** — status: draft → approved
- **2026-06-14T11:45:24Z** — status: in-progress → done
