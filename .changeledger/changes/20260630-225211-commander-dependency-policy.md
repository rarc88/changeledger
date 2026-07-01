---
id: "20260630-225211"
title: Justificar Commander en la política de dependencias runtime
type: chore
status: done
created: 2026-06-30T22:52:11Z
depends_on: []
owner: raruiz-hiberuscom
reviewed: true
---

## Request

Completar la política de dependencias runtime para incluir `commander`, que forma
parte del CLI publicado pero hoy solo aparece en arquitectura y `package.json`.
La documentación de gobernanza debe justificar por qué pertenece al core con el
mismo estándar aplicado a `yaml` y a las librerías del viewer.

## Plan

- [x] Actualizar `.changeledger/specs/dependencies.md`, `AGENTS.md` y `CONTRIBUTING.md` para justificar `commander` como parser CLI maduro que centraliza argumentos, opciones, subcomandos, errores y help (support) — 2026-07-01T22:24:04Z
- [x] Verificar que la lista documentada coincide con `package.json` y no promete un core sin dependencias; verify: `rg -n "commander|yaml|lit-html|marked|dompurify|mermaid" package.json AGENTS.md CONTRIBUTING.md .changeledger/specs/dependencies.md` (support) — 2026-07-01T22:24:04Z
- [x] Ejecutar el gate completo y graduar la actualización a la spec de dependencias; verify: `pnpm verify` (support) — 2026-07-01T22:24:04Z

## Log

- **2026-07-01T21:51:33Z** — status: draft → approved
- **2026-07-01T22:23:14Z** — status: approved → in-progress
- **2026-07-01T22:23:14Z** — owner → raruiz-hiberuscom (auto)
- **2026-07-01T22:24:14Z** — status: in-progress → in-validation
- **2026-07-01T23:17:59Z** — validation → done (human accepted)
- **2026-07-01T23:21:38Z** — graduado a spec `dependencies.md`
