---
id: "20260614-182514"
title: Mostrar fechas en formato local en el viewer
type: refactor
status: done
created: 2026-06-14T18:25:14Z
depends_on: []
archived: true
reviewed: true
owner: raruiz-hiberuscom
---

## Request

El viewer muestra los timestamps crudos en ISO UTC (`2026-06-14T18:25:14Z`).
Para el humano debería verse en formato **local** (`toLocaleString`). El dato
sigue siendo ISO UTC en disco (fuente de verdad); solo cambia la presentación.

## Proposal

- Helper `fmtDateTime(iso)` en `src/viewer/public/app.js`: `new Date(iso).toLocaleString()`
  (vacío si `iso` es falsy o inválido). Variante `fmtDate(iso)` →
  `toLocaleDateString()` para fechas sin hora (date de commit).
- Aplicar en los puntos que hoy pintan el ISO crudo:
  - `c.created` (pill de la card, app.js:241) → `fmtDateTime`
  - `s.updated` (specs, app.js:525 y :545) → `fmtDateTime`
  - `c.date` de commits (app.js:296) → `fmtDate`
- `title=` con el ISO original en el elemento, para no perder el dato exacto al hover.

Fuera de alcance: los timestamps dentro del `## Log` y resoluciones de tareas se
renderizan como markdown (contenido), no como campos; localizarlos exigiría
post-procesar el HTML/markdown — se deja para otra iteración si hace falta.

Descartado:
- Guardar fechas locales en disco — rompe la fuente de verdad (ISO UTC) y la
  portabilidad entre zonas/máquinas.

## Plan

- [x] `fmtDateTime`/`fmtDate` en `src/viewer/public/app.js` (tolerantes a vacío/ inválido) — 2026-06-14T18:45:20Z
- [x] Aplicar a `c.created`, `s.updated` (x2) y `c.date`, con `title=` = ISO original — 2026-06-14T18:45:20Z
- [x] Verificar en preview: pills muestran formato local; hover muestra el ISO; vacío no rompe — 2026-06-14T18:45:20Z

## Log
- **2026-06-14T18:31:40Z** — status: draft → approved
- **2026-06-14T18:41:36Z** — status: approved → in-progress
- **2026-06-14T18:41:37Z** — owner → raruiz-hiberuscom (auto)
- **2026-06-14T18:45:21Z** — status: in-progress → done
- **2026-06-14T18:45:21Z** — graduation skipped: presentacion del viewer; sin verdad persistente nueva
- **2026-06-15T21:17:57Z** — archived
