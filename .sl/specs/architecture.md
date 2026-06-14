---
title: Arquitectura de Spec Ledger
updated: 2026-06-14T11:30:00Z
tags: [architecture, cli, viewer]
---

# Arquitectura de Spec Ledger

Spec Ledger separa **almacén** (fuente de verdad, optimizada para agente y git)
de **presentación** (un visor agradable para el humano). Es un CLI global; en
cada repo solo viven los documentos bajo `.sl/`.

## Componentes

```mermaid
flowchart TD
  subgraph repo[".sl/ en el repo"]
    CFG[config.yml]
    CH[changes/*.md]
    SP[specs/*.md]
  end
  subgraph core["núcleo (src/)"]
    YAML[yaml.mjs] --> CHANGE[change.mjs]
    YAML --> SPEC[spec.mjs]
    CFG --> REPO[repo.mjs]
    CHANGE --> REPO
    SPEC --> REPO
    REPO --> CHECK[check.mjs]
    REPO --> WRITER[writer.mjs]
  end
  subgraph cli["CLI (bin/sl)"]
    INIT[init] --> repo
    NEW[new] --> CH
    CHECKC[check] --> CHECK
    AGENT[status/log/task/list/show] --> WRITER
    VIEW[view] --> SRV
  end
  SRV[server node:http] --> REPO
  SRV --> UI[visor: board / table / graph / specs]
```

## Modelo de datos

- **change**: un archivo markdown. Frontmatter estructurado (`id`, `title`,
  `type`, `status`, `created`, `depends_on`, `owner` opcional) + etapas
  (`## Request`…`## Log`) según el tipo. Tiene ciclo de vida (`draft → approved → in-progress → done`,
  con `blocked`). Tareas en `## Plan` como checklist (`[ ]`/`[x]`/`[!]`).
- **spec**: un archivo markdown sin ciclo de vida. Frontmatter mínimo (`title`,
  `updated`, `tags`) + cuerpo libre. Es la verdad persistente; un change `done`
  gradúa su verdad aquí.

Una entrada de `depends_on` con la forma `<proyecto>:<changeId>` es una
dependencia **cross-proyecto**: `check` no la valida localmente (apunta a otro
repo) ni la mete en el grafo de ciclos; el visor global la resuelve por id o
nombre de proyecto y navega a ese change.

## Identidad

`id` = instante UTC de creación `YYYYMMDD-HHMMSS`, derivado de `created`. Único
sin coordinación central; `sl new` incrementa 1s ante colisión en el mismo
segundo. Ordenable cronológicamente.

## Política de idioma

La estructura es inglés fijo (claves, enums, headings de etapa, nombres de
archivo, CLI). El contenido sigue `config.language`. El contrato (`AGENTS.md`) es
inglés canónico.

## Presentación

El visor (`sl view`) levanta un server `node:http` que relee `.sl/` en cada
request (live) y expone JSON; la UI rinde board (kanban), table, graph
(`depends_on`) y specs, con búsqueda full-text, filtros (tipo, estado, owner) y
render de markdown + mermaid. Los changes con `archived: true` se ocultan por
defecto (toggle "Archived" para mostrarlos); el flag los saca del board sin
sacarlos de `changes_dir`, así `check` y las deps los siguen viendo. `marked` y `mermaid` son dependencias instaladas (pnpm), servidas desde
`node_modules` bajo `/vendor/*`; el resto del runtime es cero-deps. En modo global
el visor lee el registro y muestra todos los proyectos (selector + autoenfoque),
y la búsqueda "Global" (`GET /api/search?q=`) hace match full-text en todos los
repos vivos y agrupa los resultados por proyecto.
