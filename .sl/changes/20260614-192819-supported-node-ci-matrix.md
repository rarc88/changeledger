---
id: "20260614-192819"
title: Alinear version de Node y verificar matriz multiplataforma
type: chore
status: approved
created: 2026-06-14T19:28:19Z
depends_on: []
---

## Request

Alinear la versión de Node anunciada con las dependencias reales y añadir una
matriz CI que pruebe el paquete en las versiones y sistemas operativos que se
prometen públicamente. Actualmente `package.json` declara Node `>=18`, mientras
`marked@18.0.5` declara Node `>=20`.

## Plan

- [ ] Decidir y documentar la línea mínima soportada: subir `engines.node` a `>=20` o seleccionar dependencias compatibles con Node 18
- [ ] Añadir `packageManager` y una política reproducible de instalación con lockfile en `package.json`/CI
- [ ] Crear CI para `pnpm install --frozen-lockfile` y `pnpm verify` en Linux, macOS y Windows, con la versión mínima y una versión Node actual
- [ ] Añadir smoke test del tarball (`npm pack`, instalación aislada, `sl --help`, `sl init`, `sl check`) en CI
- [ ] Cubrir o documentar el comportamiento de `.sl/AGENTS.md` en Windows, incluyendo permisos para symlinks y un fallback si forma parte del soporte prometido
- [ ] Actualizar README con requisitos de runtime y ejecutar la matriz completa

## Log

- **2026-06-15T11:38:41Z** — status: draft → approved
