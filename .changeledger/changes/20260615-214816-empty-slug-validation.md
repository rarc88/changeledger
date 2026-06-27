---
id: "20260615-214816"
title: Validar slugs vacíos al crear changes
type: bug
status: done
created: 2026-06-15T21:48:16Z
depends_on: []
reviewed: true
owner: Roberto Ruiz
archived: true
---

## Request

Evitar que `sl new` cree archivos con slug vacío después de normalizar el slug
inglés recibido por CLI.

## Investigation

`src/commands/new.mjs` normaliza el argumento `slug` con `slugify()`, pero no
valida el resultado. Un valor como `!!!` o solo caracteres no ASCII que se
eliminen por completo puede producir un filename de la forma
`<id>-.md`.

El contrato exige que el slug sea estructura en inglés; permitir un slug vacío
debilita esa regla y deja nombres menos legibles en `.sl/changes/`.

## Specification

### CR1 — Slug vacío tras normalización se rechaza
- **Given** un repo Spec Ledger inicializado
- **When** el usuario ejecuta `sl new bug "!!!" "Título"`
- **Then** el comando falla sin crear archivo
- **And** el error explica que el slug debe contener caracteres ASCII alfanuméricos

### CR2 — Slug válido sigue normalizándose
- **Given** un repo Spec Ledger inicializado
- **When** el usuario ejecuta `sl new bug "Fix Login!" "Título"`
- **Then** se crea un archivo cuyo sufijo es `fix-login.md`
- **And** el frontmatter conserva el título como contenido

## Plan

- [x] Añadir tests en `test/change.test.mjs` o `test/cli.test.mjs` para slug vacío y slug válido normalizado (CR1, CR2) — 2026-06-15T21:54:33Z
- [x] Extraer o exponer la normalización en `src/commands/new.mjs` solo si mejora la testabilidad sin crear abstracción innecesaria (CR1, CR2) — 2026-06-15T21:54:33Z
- [x] Validar el resultado de `slugify(slug)` antes de escribir el archivo en `src/commands/new.mjs` (CR1) — 2026-06-15T22:02:51Z
- [x] Ejecutar `pnpm test -- test/change.test.mjs test/cli.test.mjs` y `pnpm check` (CR1, CR2) — 2026-06-15T21:59:43Z

## Log
- **2026-06-15T21:52:22Z** — status: draft → approved
- **2026-06-15T21:53:14Z** — status: approved → in-progress
- **2026-06-15T21:53:14Z** — owner → Roberto Ruiz (auto)
- **2026-06-15T22:00:05Z** — status: in-progress → in-review
- **2026-06-15T22:02:31Z** — review → in-progress (retry): Plan incompleto detectado por revisión independiente
- **2026-06-15T22:03:03Z** — status: in-progress → in-review
- **2026-06-15T22:07:19Z** — review → done (delegated subagent, clean context)
- **2026-06-15T22:08:03Z** — graduado a spec `architecture.md`
- **2026-06-16T21:19:24Z** — archived
