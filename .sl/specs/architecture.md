---
title: Arquitectura de Spec Ledger
updated: 2026-06-14T18:39:36Z
tags: [architecture, cli, viewer]
---

# Arquitectura de Spec Ledger

> Graduado del change 20260613-205854.
> Graduado del change 20260614-151759 (discovery del contrato).
> Graduado del change 20260614-162547 (Definition of Ready / tdd).
> Graduado del change 20260614-165720 (revisión de graduación / reviewed).
> Graduado del change 20260614-182513 (owner desde GitHub login).

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
  SRV --> UI[visor: board / table / graph / specs / metrics]
```

## Modelo de datos

- **change**: un archivo markdown. Frontmatter estructurado (`id`, `title`,
  `type`, `status`, `created`, `depends_on`, `owner` opcional, `archived` opcional,
  `reviewed` opcional) + etapas (`## Request`…`## Log`) según el tipo. Tiene ciclo
  de vida (`draft → approved → in-progress → done`, con `blocked` como desvío
  reversible desde `in-progress`). El grafo de transiciones vive en
  `src/lifecycle.mjs` y es la única autoridad: tanto `sl status` como el visor lo
  consultan, rechazando saltos (`draft → done`), regresiones y no-ops. El visor
  añade una restricción humana extra: solo permite `draft → approved`. Tareas en
  `## Plan` como checklist (`[ ]`/`[x]`/`[!]`).
- **spec**: un archivo markdown sin ciclo de vida. Frontmatter mínimo (`title`,
  `updated`, `tags`) + cuerpo libre. Es la verdad persistente; un change `done`
  gradúa su verdad aquí.

**Revisión de graduación.** Tras `done`, cada change se resuelve: gradúa a un spec
o se descarta (bug/chore sin verdad persistente). Ambos casos fijan `reviewed: true`
(`writer.setReviewed`). `sl graduate --pending` (`pendingGraduation`) lista los
`done` con `reviewed !== true`; `sl graduate <id> --skip [razón]` (`skipGraduation`,
solo en `done`) descarta dejando `graduation skipped` en el Log; `graduate()` a spec
también fija `reviewed`. "Graduado a spec" sigue siendo derivable de la marca
`graduado a spec` del Log — `reviewed` solo registra que la pregunta quedó zanjada.
`check` valida que `reviewed`, si está, sea booleano; no avisa de pendientes (es
bajo demanda).

El `## Log` es el **ledger del ciclo de vida**, ortogonal a las etapas de
contenido del tipo: registra cada transición de `status` con su timestamp y se
crea automáticamente al primer cambio de estado aunque el tipo no lo declare
(p.ej. `chore`). El `owner` se autoasigna al pasar a `in-progress` (cuando empieza
el trabajo) vía `ownerHandle`: username de GitHub (`gh api user --jq .login`), con
fallback a `git config user.name` si `gh` falta o no está autenticado; tolerante
(vacío si ninguno). No pisa un owner fijado a mano (`sl owner`).

Una entrada de `depends_on` con la forma `<proyecto>:<changeId>` es una
dependencia **cross-proyecto**: `check` no la valida localmente (apunta a otro
repo) ni la mete en el grafo de ciclos; el visor global la resuelve por id o
nombre de proyecto y navega a ese change.

## Identidad

`id` = instante UTC de creación `YYYYMMDD-HHMMSS`, derivado de `created`. Único
sin coordinación central; `sl new` incrementa 1s ante colisión en el mismo
segundo. Ordenable cronológicamente.

## Métricas

`metrics.mjs` deriva, sin IO, métricas de entrega de los timestamps. El cierre
(`done`) y el paso a cada estado se leen del `## Log`; de ahí salen: cycle time
(`done − created`), lead time por etapa, WIP actual, aging de los `in-progress`,
tiempo bloqueado, throughput por día y desgloses por tipo/owner. El server las
precalcula y el visor las pinta en la pestaña **Metrics**.

## Validación (`sl check`)

`check.mjs` es puro (sin IO) y valida changes y, en modo repo completo, también
la capa de specs y sus enlaces: marcadores de conflicto de merge, etapas
duplicadas, enlaces change↔spec rotos (error), specs huérfanos y `updated`
desfasado respecto a la actividad de un change enlazado (warning). Los enlaces
salen de los marcadores que escribe `sl graduate`.

## Trazabilidad git

`git.mjs` (`gitRefs`, runner inyectable) enlaza un change con git por la
convención de commit `[#<id>]`: lista los commits que lo referencian y las
branches cuyo nombre lo contiene; tolera repos no-git devolviendo vacío. El
endpoint `GET /api/git?project=&id=` los sirve y el detalle muestra la sección
**Git**. El lookup de PR (red/`gh`) queda fuera del visor local.

## Discovery del contrato

El **contrato canónico de la herramienta** (instrucciones de uso) vive separado
del contrato propio de cada repo: se distribuye como `templates/AGENTS.md` y
`paths.mjs` lo resuelve como `agentsTemplate`, sin importar la instalación (npm
global, `pnpm link`, node_modules). Es artefacto **de la herramienta**, no del
repo. `init`/`register` lo enlazan en cada repo como `.sl/AGENTS.md` — symlink
**por máquina, gitignored**: nunca se copia (no drifta) ni se committea (no queda
dangling al clonar). Separarlo del raíz evita la recursión: el `AGENTS.md` raíz
es el contrato **propio** del proyecto y solo **referencia** al enlazado.

`init` exige el `AGENTS.md` raíz y appendea la referencia como **caja de alerta
GitHub** (`> [!IMPORTANT]`, marcador `<!-- spec-ledger -->`, idempotente) a cada
archivo de contrato presente que **no sea symlink** — `AGENTS.md` y `CLAUDE.md` —
de modo que cualquier agente (Claude, Codex, opencode, Copilot, Cursor…) lo
descubra sin tooling específico. `contract.mjs` concentra la lógica
(`linkContract`, `ensureReference`, `ensureGitignore`, `checkContract`);
`sl check` falla (error, no warning) si falta el raíz, si un contrato presente no
referencia, o si el link no resuelve — el discovery es condición para que la
herramienta funcione en el repo.

## Definition of Ready (tdd)

El modelo de uso es **documentar con modelo fuerte, implementar con modelo menos
potente**. El flag `tdd` en `config.yml` (default `true`) gobierna la política: con
`true`, los changes se documentan *test-grade* (cada requisito un CR concreto;
cada tarea del Plan nombra archivos+test y mapea a un CR) y se implementan con TDD.
`change.mjs` expone los CR declarados en `## Specification` (`parseChange().criteria`);
`check.mjs` (`checkCoverage`) cruza CR↔tarea y emite **warnings** (nunca errores)
cuando, en un change `approved`/`in-progress` cuyo tipo activa `specification`, un
CR no tiene tarea o una tarea no referencia CR. No juzga si un CR es realmente
test-grade (no parseable) — eso queda como juicio del agente documentador. `draft`
(autoría en curso) y `done` (histórico) no se evalúan. `tdd: false` desactiva el
cruce (repos exploratorios).

## Política de idioma

La estructura es inglés fijo (claves, enums, headings de etapa, nombres de
archivo, CLI). El contenido sigue `config.language`. El contrato (`AGENTS.md`) es
inglés canónico.

## Presentación

El visor (`sl view`) levanta un server `node:http` enlazado **solo a loopback**
(`127.0.0.1`) que relee `.sl/` en cada request (live) y expone JSON. Rechaza
requests cuyo `Host`/`Origin` no sea local (defensa anti DNS-rebinding), añade
headers defensivos (`nosniff`, `X-Frame-Options: DENY`, `no-store`), acota el
body y exige una credencial efímera por proceso (inyectada en la página y
enviada en `x-sl-token`) para escribir. Las escrituras exigen un `project`
exacto, sin fallback al primero. Es de solo lectura salvo `POST /api/status`, que
permite que **el humano** mueva un change de `draft` a `approved` arrastrando su
card entre esas columnas del board (el único salto que le corresponde; el resto
del ciclo lo conduce el agente). La UI rinde board (kanban), table, graph
(`depends_on`), specs y metrics, con búsqueda full-text, filtros (tipo, estado,
owner) y render de markdown + mermaid. Los changes con `archived: true` se ocultan
por defecto (toggle "Archived" para mostrarlos); el flag los saca del board sin
sacarlos de `changes_dir`, así `check` y las deps los siguen viendo. `marked` y
`mermaid` son dependencias instaladas (pnpm), servidas desde `node_modules` bajo
`/vendor/*`; el resto del runtime es cero-deps. **Frontera de confianza:** los
documentos del repo son contenido no confiable aunque el repo sea local. El
cuerpo Markdown se rinde vía `safeHtml` (marked → DOMPurify, también servido bajo
`/vendor/*`) antes de tocar el DOM, y Mermaid se inicializa con
`securityLevel: 'strict'`, de modo que ningún change/spec pueda ejecutar
JavaScript en el origen del visor. En modo global el visor lee el
registro y muestra todos los proyectos (selector + autoenfoque), y la búsqueda
"Global" (`GET /api/search?q=`) hace match full-text en todos los repos vivos y
agrupa los resultados por proyecto.
