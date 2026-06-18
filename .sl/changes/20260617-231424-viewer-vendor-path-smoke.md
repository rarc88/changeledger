---
id: "20260617-231424"
title: El viewer debe detectar rutas vendor rotas por cambios de dependencias
type: bug
status: done
created: 2026-06-17T23:14:24Z
depends_on: [ "20260617-225650" ]
owner: raruiz-hiberuscom
reviewed: true
archived: true
---

## Request

Resolver el hallazgo de auditoria: el viewer sirve dependencias de navegador
desde rutas internas de paquetes (`marked`, `mermaid`, `dompurify`, `lit-html`).
Si una version minor/patch reorganiza esos artefactos, el viewer puede romperse
con un 404 en `/vendor/*`.

## Investigation

`src/viewer/server/router.mjs` usa `require.resolve()` para mapear rutas vendor a
archivos dentro de `node_modules`. La decision evita bundlers y es apropiada para
una herramienta local, pero las rutas a artefactos internos son un contrato
fragil cuando `package.json` usa rangos `^`.

Solucion elegida para el primer paso: agregar un smoke test que pruebe todas las
rutas `/vendor/*` que el HTML/import map necesita, tanto en el router como en el
tarball smoke si aplica. Si el test expone fragilidad futura, evaluar fijar
versiones exactas o empaquetar assets en un paso minimo.

## Specification

### CR1 — Todas las rutas vendor declaradas responden
- **Given** el viewer se sirve desde una instalacion con dependencias instaladas
- **When** se solicitan `/vendor/marked.min.js`, `/vendor/mermaid.min.js`, `/vendor/purify.min.js` y los modulos `lit-html` usados por el import map
- **Then** cada respuesta tiene status `200`
- **And** cada respuesta usa `text/javascript`

### CR2 — Una ruta vendor inexistente falla de forma explicita
- **Given** el viewer recibe `GET /vendor/unknown.js`
- **When** no existe un mapeo para esa ruta
- **Then** la respuesta es `404`
- **And** no se sirve ningun archivo fuera del allowlist vendor

### CR3 — El smoke del tarball cubre vendor
- **Given** CI instala el tarball en un directorio aislado
- **When** ejecuta el smoke de CLI/viewer
- **Then** se verifica que las rutas vendor criticas resuelven desde el paquete instalado

## Plan

- [x] Agregar tests HTTP en `test/view.test.mjs` para las rutas vendor criticas de `src/viewer/server/router.mjs`, verificando con `pnpm test` (CR1) — 2026-06-18T10:08:49Z
- [x] Agregar test de 404 allowlist en `test/view.test.mjs` para `/vendor/unknown.js` contra `src/viewer/server/router.mjs`, verificando con `pnpm test` (CR2) — 2026-06-18T10:08:49Z
- [x] Actualizar `.github/workflows/ci.yml` o un helper de smoke que pruebe vendor de `src/viewer/server/router.mjs` desde el tarball instalado, verificando con `pnpm test` y `node bin/sl.mjs check` (CR3) — 2026-06-18T10:08:49Z
- [x] Decidir en `package.json` si las dependencias runtime servidas por `src/viewer/server/router.mjs` deben quedar fijadas exactas, verificando con `pnpm verify` (support) — 2026-06-18T10:08:49Z
- [x] Ejecutar `pnpm verify` como cierre (support) — 2026-06-18T10:08:49Z

## Log

- **2026-06-17T23:14:29Z** — creado desde los hallazgos de la auditoria 20260617-225650.
- **2026-06-18T09:47:06Z** — status: draft → approved
- **2026-06-18T09:56:48Z** — status: approved → in-progress
- **2026-06-18T09:56:48Z** — owner → raruiz-hiberuscom (auto)
- **2026-06-18T10:05:52Z** — status: in-progress → in-review
- **2026-06-18T10:06:02Z** — review → done (delegated subagent, clean context)
- **2026-06-18T10:06:37Z** — graduation skipped: Test coverage addition; no architectural truth to persist
- **2026-06-18T10:09:09Z** — archived
