---
id: "20260614-182514"
title: Mostrar fechas en formato local en el viewer
type: refactor
status: approved
created: 2026-06-14T18:25:14Z
depends_on: []
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

- [ ] `fmtDateTime`/`fmtDate` en `src/viewer/public/app.js` (tolerantes a vacío/ inválido)
- [ ] Aplicar a `c.created`, `s.updated` (x2) y `c.date`, con `title=` = ISO original
- [ ] Verificar en preview: pills muestran formato local; hover muestra el ISO; vacío no rompe

## Log
- **2026-06-14T18:31:40Z** — status: draft → approved
