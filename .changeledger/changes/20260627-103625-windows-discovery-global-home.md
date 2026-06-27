---
id: "20260627-103625"
title: Ignore global ChangeLedger home during project discovery
type: bug
status: done
created: 2026-06-27T10:36:25Z
depends_on: []
release_impact: patch
owner: raruiz-hiberuscom
reviewed: true
archived: true
---

## Request

Corregir el fallo de CI en Windows donde los tests ejecutados bajo el home del
runner descubren `C:\Users\RUNNER~1\.changeledger` como si fuera la raíz de un
repositorio, aunque ese directorio solo contiene el estado global y no
`config.yml`.

## Investigation

`changeledger register` crea el registro global bajo
`~/.changeledger/.registry.json`. En Windows, `os.tmpdir()` normalmente está
dentro del home (`C:\Users\<user>\AppData\Local\Temp`).

`findChangeledgerDir()` asciende desde el directorio inicial y actualmente
acepta cualquier directorio llamado `.changeledger`. Por eso, cuando un test
crea un repo temporal vacío, el ascenso llega al `.changeledger` global del
runner y `loadRepo()` intenta cargar `~/.changeledger/config.yml`. El error
resultante es `Missing config` en vez del error esperado para un directorio que
no pertenece a un repo.

El directorio global y la raíz de proyecto comparten nombre deliberadamente,
pero tienen marcadores distintos: solo una raíz de proyecto válida contiene
`.changeledger/config.yml`. El discovery debe comprobar ese marcador, igual que
ya hace `viewer/domain.mjs` al determinar si un proyecto registrado está vivo.

## Specification

### CR1 — El estado global no se descubre como repositorio
- **Given** un directorio de trabajo ubicado bajo un home que contiene `.changeledger/` sin `config.yml`
- **When** `findChangeledgerDir()` o `loadRepo()` asciende por sus ancestros
- **Then** ignora ese directorio global y reporta que no encontró un repo ChangeLedger
- **And** no intenta cargar el registro global como configuración de proyecto

### CR2 — Los repositorios válidos siguen descubriéndose
- **Given** un directorio `.changeledger/` que contiene `config.yml`
- **When** el discovery comienza en la raíz o en un subdirectorio del repo
- **Then** devuelve esa raíz de proyecto y conserva el comportamiento existente

### CR3 — Regresión reproducible en todas las plataformas
- **Given** una jerarquía sintética equivalente a `home/AppData/Local/Temp`
- **When** los tests se ejecutan en Linux, macOS o Windows
- **Then** reproducen y verifican el conflicto sin depender de la ubicación real de `os.tmpdir()`
- **And** `pnpm verify` completa correctamente

## Plan

- [x] Exigir `config.yml` como marcador del discovery en `src/**` (`src/config.mjs`); verify: `test/repo.test.mjs` mediante `node --test` (CR1, CR2) — 2026-06-27T10:40:39Z
- [x] Añadir en `test/repo.test.mjs` una jerarquía sintética que verifique el discovery de `src/**` con `.changeledger` global y repo válido anidado; verify: `test/repo.test.mjs` mediante `node --test` (CR1, CR2, CR3) — 2026-06-27T10:40:39Z
- [x] Ejecutar el gate completo para `src/**`; verify: `pnpm test` mediante `pnpm verify` (CR3) — 2026-06-27T10:40:39Z

## Log

- **2026-06-27T10:36:25Z** — El fallo de Windows CI se aisló a la colisión entre `~/.changeledger/` global y el marcador de proyecto durante el ascenso de directorios.
- **2026-06-27T10:38:08Z** — status: draft → approved
- **2026-06-27T10:39:06Z** — status: approved → in-progress
- **2026-06-27T10:39:06Z** — owner → raruiz-hiberuscom (auto)
- **2026-06-27T10:40:39Z** — Discovery ahora exige .changeledger/config.yml; la regresión sintética reproduce el layout Windows y pnpm verify pasa con 366 pruebas y 123 changes válidos.
- **2026-06-27T10:40:39Z** — status: in-progress → in-review
- **2026-06-27T10:42:02Z** — review → in-validation (delegated subagent, clean context)
- **2026-06-27T10:43:15Z** — validation → done (human accepted)
- **2026-06-27T10:44:24Z** — graduado a spec `architecture.md`
- **2026-06-27T10:44:24Z** — archived
