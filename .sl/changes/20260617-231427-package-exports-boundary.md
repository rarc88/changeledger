---
id: "20260617-231427"
title: Declarar frontera pública del paquete con exports
type: chore
status: done
created: 2026-06-17T23:14:27Z
depends_on: [ "20260617-225650" ]
owner: raruiz-hiberuscom
reviewed: true
archived: true
---

## Request

Declarar explicitamente la frontera publica del paquete npm. El paquete esta
pensado principalmente como CLI (`bin.sl`); sin `exports`, consumidores pueden
importar rutas internas y tratarlas como API accidental.

## Plan

- [x] Agregar `exports` restrictivo en `package.json` manteniendo el binario `sl` funcional; verificar con `pnpm test` — 2026-06-18T10:08:50Z
- [x] Actualizar o agregar smoke test de tarball en `.github/workflows/ci.yml`/`test/cli-bin.test.mjs` para confirmar que `sl --help`, `sl init` y `sl check` siguen funcionando desde paquete instalado; verificar con `pnpm test` — 2026-06-18T10:08:50Z
- [x] Documentar en `README.md` que no hay API publica estable salvo el CLI, o declarar la API si se decide exponer alguna; verificar con `node bin/sl.mjs check` — 2026-06-18T10:08:51Z
- [x] Ejecutar `pnpm verify` como cierre — 2026-06-18T10:08:51Z

## Log

- **2026-06-18T09:53:23Z** — status: draft → approved
- **2026-06-18T09:56:50Z** — status: approved → in-progress
- **2026-06-18T09:56:50Z** — owner → raruiz-hiberuscom (auto)
- **2026-06-18T10:05:45Z** — status: in-progress → done
- **2026-06-18T10:06:37Z** — graduation skipped: Package hygiene; no public API spec needed
- **2026-06-18T10:09:09Z** — archived
