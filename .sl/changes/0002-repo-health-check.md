---
id: "0002"
title: Validación y health del repositorio (sl check)
type: feature
status: draft
created: 2026-06-13T13:55:00Z
depends_on: ["0001"]
---

## Request

Necesitamos una forma de comprobar el **health del repositorio** y validar que
cada documento esté **correctamente formado** según el contrato de `AGENTS.md`.

**Por qué.** Los documentos son la fuente de verdad y los escriben agentes. Sin
validación, derivan en silencio (frontmatter mal tipado, enums inválidos, etapas
faltantes, dependencias colgantes) y la "fuente de verdad" deja de serlo: el
visor revienta y los agentes leen mal. Principio: *fail fast, fail clearly*.

## Investigation

Modos de fallo a detectar (por archivo):

- Frontmatter incompleto o mal tipado (faltan `id`/`title`/`type`/`status`/`created`/`depends_on`).
- `type` o `status` fuera de los enums de `config.yml`.
- `created` no es ISO 8601 UTC válido.
- `id` no coincide con el prefijo del nombre de archivo, o no respeta `id_digits`.
- Headings de etapa desconocidos, mal escritos o fuera de orden.
- Etapas activas del tipo ausentes (según la matriz de `config.yml`).
- Marcas de tarea inválidas (algo distinto de `[ ]`/`[x]`/`[!]`).

Salud agregada (repo):

- `id` duplicados entre changes.
- `depends_on` que apunta a un id inexistente (colgante).
- Ciclos en el grafo de dependencias.
- Inconsistencias estado↔tareas: `status: done` con tareas sin marcar;
  `status: blocked` sin ninguna tarea `[!]`.

## Proposal

Comando **`sl check`** que recorre `changes_dir`, valida cada archivo y luego la
salud agregada. Reporta **errors** (rompen el contrato) y **warnings**
(inconsistencias). Exit code ≠ 0 si hay errors → integrable en pre-commit y CI.

Salida legible: agrupada por archivo, una línea por hallazgo con ubicación y fix
sugerido. Opción `--json` para consumo por máquina/CI.

_Alternativas descartadas:_
- _Validar en el visor en vez de un comando:_ el visor es solo lectura humana;
  la validación debe correr en CI/hooks sin navegador.
- _JSON Schema externo:_ overkill; el contrato es pequeño y estable, validación
  imperativa simple basta.

## Specification

- **CR1** — Dado un change con frontmatter inválido, cuando ejecuto `sl check`,
  entonces reporta un error con archivo, campo y motivo, y termina con exit ≠ 0.
- **CR2** — Dado un `type`/`status` fuera de enum, entonces error.
- **CR3** — Dado un change al que le falta una etapa activa de su tipo, entonces error.
- **CR4** — Dado un heading de etapa desconocido o fuera de orden, entonces error.
- **CR5** — Dado un `depends_on` colgante o un ciclo de dependencias, entonces error.
- **CR6** — Dado `id` duplicado, entonces error.
- **CR7** — Dado `status: done` con tareas sin marcar, entonces warning (no rompe build).
- **CR8** — Sin errors → exit 0. `--json` emite el reporte estructurado.

## Plan

- [ ] Parser de change: frontmatter + etapas + tareas (reutilizable por el visor)
- [ ] Validaciones por archivo (CR1–CR4)
- [ ] Validaciones agregadas: ids únicos, depends_on, ciclos (CR5–CR6)
- [ ] Checks de consistencia estado↔tareas (CR7)
- [ ] Comando `sl check` con salida legible + `--json` (CR8)
- [ ] Documentar uso en pre-commit / CI

## Log

- **2026-06-13T13:55:00Z** — Creado en `draft` a partir de feedback humano:
  hace falta validar well-formedness y health del repo. No se implementa aún;
  queda en el plan esperando aprobación. Depende de 0001 (parser/CLI base).
