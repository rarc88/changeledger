---
id: "20260616-212322"
title: Comando para archivar changes graduados sin scripts ad hoc
type: feature
status: done
created: 2026-06-16T21:23:22Z
depends_on: []
owner: Roberto Ruiz
reviewed: true
archived: true
---

## Request
Archivar todos los changes ya graduados requirió escribir un script ad hoc y
filtrar logs con el marcador `graduado a spec`. Esa operación es común para
mantener el board despejado y debería existir como comando seguro.

## Investigation
- Ya existe `sl archive <id>` para un change individual.
- Ya existe `sl graduate --pending` para listar `done` sin revisión de graduación.
- No existe un comando que diga "archiva todos los `done` ya graduados o skipped
  y aún no archivados".
- Usar scripts con patrones de shell sobre el marcador de graduación es frágil
  por quoting y duplica reglas que el repo ya conoce al parsear changes.

## Proposal
Agregar una operación de archivado masivo, conservadora y explícita:

- `sl archive --graduated`: archiva changes `done`, `reviewed: true`, con
  marcador `graduado a spec` o `graduation skipped`, y `archived !== true`.
- `--dry-run`: lista lo que haría sin escribir.
- Salida breve con ids archivados y total.
- No toca changes `blocked`, `discarded`, `draft`, `approved`, `in-progress` ni
  `in-review`.

Descartado: hacer que `sl graduate` archive automáticamente. La graduación y la
limpieza del board son decisiones cercanas, pero distintas; conviene mantener el
paso explícito.

## Specification
### CR1 — Dry run seguro
- **Given** hay changes `done` graduados o con graduación skipped sin archivar
- **When** ejecuto `sl archive --graduated --dry-run`
- **Then** veo la lista y el total sin modificar archivos

### CR2 — Archivado masivo conservador
- **Given** hay changes `done`, `reviewed: true`, ya graduados o skipped, y no archivados
- **When** ejecuto `sl archive --graduated`
- **Then** todos quedan con `archived: true` y entrada de Log `archived`

### CR3 — Estados activos no se tocan
- **Given** hay changes activos o bloqueados que no son `done`
- **When** ejecuto `sl archive --graduated`
- **Then** esos changes no cambian

### CR4 — Changes ya archivados no se duplican
- **Given** un change ya tiene `archived: true`
- **When** ejecuto `sl archive --graduated`
- **Then** no se agrega otra entrada de Log ni se reescribe innecesariamente

### CR5 — El board queda despejado sin scripts
- **Given** hay changes cerrados graduados que saturan el board
- **When** uso el comando masivo
- **Then** no necesito inspeccionar raw markdown ni escribir scripts de filtrado

## Plan
- [x] Añadir opciones `--graduated` y `--dry-run` al comando `archive` en `bin/sl.mjs` y aplicación en `src/commands/agent.mjs`, cubiertas por `test/agent.test.mjs` o test CLI (CR1, CR2, CR3, CR4, CR5) — 2026-06-17T10:25:48Z
- [x] Reutilizar parser de repo en `src/repo.mjs` desde `src/commands/agent.mjs` para seleccionar changes `done`, `reviewed: true`, graduados o skipped, y no archivados, cubierto por `test/agent.test.mjs` (CR1, CR2, CR3, CR4) — 2026-06-17T10:28:11Z
- [x] Añadir en `test/agent.test.mjs` tests CLI o de aplicación para salida, dry-run y no duplicar archivados de `src/commands/agent.mjs` (CR1, CR2, CR4) — 2026-06-17T10:28:11Z
- [x] Ejecutar `pnpm test -- test/agent.test.mjs` contra `src/commands/agent.mjs` y `node bin/sl.mjs check` (CR1, CR2, CR3, CR4, CR5) — 2026-06-17T10:26:44Z

## Log
- **2026-06-16T21:23:22Z** — Creado desde fricción observada: archivar graduados requirió script ad hoc y quoting incómodo del marcador de graduación.
- **2026-06-17T10:04:00Z** — status: draft → approved
- **2026-06-17T10:25:41Z** — status: approved → in-progress
- **2026-06-17T10:25:41Z** — owner → Roberto Ruiz (auto)
- **2026-06-17T10:26:49Z** — status: in-progress → in-review
- **2026-06-17T10:28:02Z** — review → in-progress (retry): Plan still had open tasks during review
- **2026-06-17T10:28:25Z** — status: in-progress → in-review
- **2026-06-17T10:29:31Z** — review → done (delegated subagent, clean context)
- **2026-06-17T10:29:36Z** — graduado a spec `architecture.md`
- **2026-06-17T15:23:05Z** — archived
