---
id: "20260614-192819"
title: Alinear version de Node y verificar matriz multiplataforma
type: chore
status: done
created: 2026-06-14T19:28:19Z
depends_on: []
owner: raruiz-hiberuscom
---

## Request

Alinear la versión de Node anunciada con las dependencias reales y añadir una
matriz CI que pruebe el paquete en las versiones y sistemas operativos que se
prometen públicamente. Actualmente `package.json` declara Node `>=18`, mientras
`marked@18.0.5` declara Node `>=20`.

## Plan

- [x] Decidir y documentar la línea mínima soportada: subir `engines.node` a `>=20` o seleccionar dependencias compatibles con Node 18 — 2026-06-15T12:00:26Z
- [x] Añadir `packageManager` y una política reproducible de instalación con lockfile en `package.json`/CI — 2026-06-15T12:00:26Z
- [x] Crear CI para `pnpm install --frozen-lockfile` y `pnpm verify` en Linux, macOS y Windows, con la versión mínima y una versión Node actual — 2026-06-15T12:00:26Z
- [x] Añadir smoke test del tarball (`npm pack`, instalación aislada, `sl --help`, `sl init`, `sl check`) en CI — 2026-06-15T12:00:26Z
- [x] Cubrir o documentar el comportamiento de `.sl/AGENTS.md` en Windows, incluyendo permisos para symlinks y un fallback si forma parte del soporte prometido — 2026-06-15T12:00:26Z
- [x] Actualizar README con requisitos de runtime y ejecutar la matriz completa — 2026-06-15T12:00:26Z

## Log

- **2026-06-15T11:38:41Z** — status: draft → approved
- **2026-06-15T11:58:29Z** — status: approved → in-progress
- **2026-06-15T11:58:30Z** — owner → raruiz-hiberuscom (auto)
- **2026-06-15T12:00:26Z** — status: in-progress → done
