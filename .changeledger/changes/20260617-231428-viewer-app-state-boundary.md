---
id: "20260617-231428"
title: Reducir acoplamiento del estado del viewer
type: refactor
status: done
created: 2026-06-17T23:14:28Z
depends_on: [ "20260617-225650" ]
owner: raruiz-hiberuscom
reviewed: true
archived: true
---

## Request

Reducir el acoplamiento residual de `src/viewer/public/app.js`. Aunque ya se
modularizo bastante el viewer, `app.js` aun concentra estado global, wiring de
eventos, navegacion, polling y render orchestration.

## Proposal

Mantener la filosofia sin build step ni framework adicional. Extraer solo una
capa minima de estado/transiciones del viewer para que `app.js` quede como
bootstrap y wiring DOM:

- nuevo modulo posible: `src/viewer/public/app-state.js`
- estado agrupado en un objeto unico (`repo`, filtros, vista actual, proyecto)
- helpers puros para cambiar filtros/vista/proyecto sin tocar DOM
- `app.js` conserva listeners, llamadas API y render target

Alternativa descartada: introducir un store/reactividad completa. Seria mas peso
conceptual que beneficio para una UI local y pequena.

## Plan

- [x] Extraer estado y transiciones puras desde `src/viewer/public/app.js` hacia `src/viewer/public/app-state.js`, verificando con `pnpm test` — 2026-06-18T10:08:51Z
- [x] Agregar tests unitarios en `test/viewer-metadata.test.mjs` o archivo nuevo para filtros, cambio de vista y reset de proyecto; verificar con `pnpm test` — 2026-06-18T10:08:51Z
- [x] Mantener `src/viewer/public/app.js` como bootstrap/wiring sin cambiar comportamiento visible; verificar con `pnpm test` y `node bin/sl.mjs check` — 2026-06-18T10:08:51Z
- [x] Ejecutar `pnpm verify` como cierre — 2026-06-18T10:08:51Z

## Log

- **2026-06-17T23:14:29Z** — creado desde los hallazgos de la auditoria 20260617-225650.
- **2026-06-18T09:47:26Z** — status: draft → approved
- **2026-06-18T09:56:51Z** — status: approved → in-progress
- **2026-06-18T09:56:51Z** — owner → raruiz-hiberuscom (auto)
- **2026-06-18T10:05:52Z** — status: in-progress → in-review
- **2026-06-18T10:06:02Z** — review → done (delegated subagent, clean context)
- **2026-06-18T10:06:47Z** — graduado a spec `architecture.md`
- **2026-06-18T10:09:09Z** — archived
