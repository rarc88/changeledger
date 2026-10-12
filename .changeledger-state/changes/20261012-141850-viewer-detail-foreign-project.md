---
id: "20261012-141850"
title: "El detalle de un change no sobrevive ni se abre desde el payload de otro proyecto"
type: bug
status: draft
created: 2026-10-12T14:18:50Z
depends_on: []
related_to: ["20261012-125604"]
owner: rarc88
---

## Request

Las revisiones de `20261012-125604` dejaron dos casos del detalle de un change
en los que el viewer puede presentar datos de otro proyecto como del
seleccionado: un detalle abierto de un change del proyecto A sigue abierto tras
seleccionar el proyecto B, y `gotoChange` (resultados de la búsqueda global y
enlaces externos del detalle) abre el detalle buscando el change en el payload
que el viewer conserve aunque sea de otro proyecto porque la carga de B falló.
Se pide que el detalle sólo muestre changes del proyecto seleccionado.

## Investigation

Razonado desde el código, sin reproducir todavía; lo primero es reproducir cada
caso. En `src/viewer/public/app.js`, `selectViewerProject` no llama a
`closeDetail`; `gotoChange` llama a `selectProject`, espera `load()` y después
llama a `openDetail(changeId)` aunque la carga haya fallado; `openDetail` busca
en `state.repo.changes`, que tras un fallo conserva el payload de A, mientras que
`selectedRepo()` (de `20261012-125604`) devuelve el payload sólo si es del
proyecto seleccionado. Los ids son instantes de creación, así que dos proyectos
pueden compartir uno.

Interfaces externas: ninguna.

## Specification

### CR1 — Cambiar de proyecto cierra el detalle del anterior
- **Given** el viewer con el proyecto A cargado y el detalle de su change `#20261012-120000` abierto
- **When** se selecciona el proyecto B
- **Then** el detalle se cierra y no muestra `#20261012-120000`

### CR2 — Un fallo de carga no abre un change de otro proyecto
- **Given** los proyectos A y B con un change del mismo id `20261012-120000`, A cargado y la carga de B fallando
- **When** se pulsa el resultado de la búsqueda global de ese change de B
- **Then** no se abre ningún detalle y la vista activa muestra el error de carga de B

## Plan

- [ ] Reproducir los dos casos con pruebas fallidas
  - **Target:** `test/viewer-metadata.test.mjs`
  - **Verify:** `pnpm test`
  - **Criteria:** CR1, CR2
- [ ] Cerrar el detalle al seleccionar proyecto y abrirlo sólo desde el payload del seleccionado
  - **Target:** `src/viewer/public/app.js`
  - **Verify:** `pnpm test`
  - **Criteria:** CR1, CR2
- [ ] Ejecutar el gate completo
  - **Verify:** `pnpm verify`
  - **Support:**

## Log
- **2026-10-12T14:18:50Z** `[version]` 0.18.0-dev
