---
id: "20260627-000730"
title: Resolve dependency audit vulnerabilities
type: bug
status: in-progress
created: 2026-06-27T00:07:30Z
depends_on: [ "20260624-153236" ]
release_impact: patch
owner: raruiz-hiberuscom
---

## Request

Resolver las vulnerabilidades reportadas por `pnpm audit --audit-level moderate`
antes de publicar ChangeLedger 0.3.0, manteniendo el alcance limitado a las
dependencias afectadas y sin introducir actualizaciones mayores innecesarias.

## Investigation

El audit del lockfile actual reporta ocho vulnerabilidades: tres high, tres
moderate y dos low. Los hallazgos que superan el umbral se concentran en:

- `undici@7.27.2`, dependencia transitiva de `jsdom@29.1.1`. Cinco advisories
  high/moderate quedan corregidos en `undici >=7.28.0`.
- `dompurify@3.4.10`, dependencia directa y también transitiva de
  `mermaid@11.15.0`. El advisory moderate queda corregido en
  `dompurify >=3.4.11`.

`pnpm outdated` confirma que `dompurify@3.4.11` es la actualización patch
disponible. `jsdom@29.1.1` ya está en su versión vigente y su rango transitivo
permite refrescar la resolución de `undici` sin convertirlo en dependencia
directa. Commander 15 constituye un major no relacionado y queda fuera de
alcance; las actualizaciones disponibles de Biome, lint-staged y Mermaid tampoco
son necesarias para cerrar estos advisories.

## Specification

### CR1 — Audit sin vulnerabilidades relevantes
- **Given** las dependencias instaladas desde el lockfile actualizado
- **When** se ejecuta `pnpm audit --audit-level moderate`
- **Then** el comando termina correctamente sin vulnerabilidades moderate, high o critical

### CR2 — Actualización mínima y trazable
- **Given** los advisories identificados en `dompurify` y `undici`
- **When** se inspeccionan `package.json` y `pnpm-lock.yaml`
- **Then** `dompurify` resuelve a una versión igual o superior a 3.4.11 y `undici` a una versión igual o superior a 7.28.0
- **And** no se agregan dependencias directas ni actualizaciones mayores ajenas al fix

### CR3 — Viewer y CLI sin regresiones
- **Given** las dependencias corregidas instaladas
- **When** se ejecutan las pruebas de sanitización, viewer y el gate completo
- **Then** la sanitización de contenido no confiable, el viewer y el CLI conservan su comportamiento esperado
- **And** `pnpm verify` termina correctamente

## Plan

- [ ] Actualizar únicamente `dompurify` y las resoluciones de `undici` consumidas por `src/viewer/**` en `package.json`/`pnpm-lock.yaml`; verify: `pnpm why dompurify`, `pnpm why undici` y `node --test test/viewer-sanitize.test.mjs` (CR2)
- [ ] Verificar sanitización y viewer en `src/viewer/**`; verify: `node --test test/viewer-sanitize.test.mjs test/view.test.mjs` (CR3)
- [ ] Validar las dependencias que soportan `src/**`; verify: `pnpm audit --audit-level moderate` y `pnpm test` mediante `pnpm verify` (CR1, CR3)

## Log

- **2026-06-27T00:07:30Z** — `pnpm audit --audit-level moderate` reportó 8 vulnerabilidades (3 high, 3 moderate, 2 low); se aislaron en `dompurify` y `undici` transitivo de `jsdom`.
- **2026-06-27T00:09:14Z** — status: draft → approved
- **2026-06-27T00:10:21Z** — status: approved → in-progress
- **2026-06-27T00:10:21Z** — owner → raruiz-hiberuscom (auto)
