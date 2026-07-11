---
id: "20260711-210115"
title: La rama de integración se declara en config
type: feature
status: in-validation
created: 2026-07-11T21:01:15Z
depends_on: [ "20260711-160446" ]
release_impact: minor
owner: raruiz-hiberuscom
---

## Request

El humano creó una rama `dev` como base de integración, pero el agente integró
a `main` porque nada lo declara: el contrato solo prohíbe implementar sobre
`main`/`master`/`dev`, sin decir de dónde parten las ramas de trabajo ni dónde
se integran. Se pide declarar en `.changeledger/config.yml` la rama base: las
ramas de change parten de ella y se integran en ella; `main` queda solo para
releases.

## Investigation

- `defaultBaseBranch()` en `src/git.mjs` ya auto-detecta una base
  (origin/HEAD → main → master) pero solo la usa `changeledger check --commits`
  como default del rango de lint; no existe noción de rama de integración.
- El contrato (`templates/contract/implement.md`) exige rama de trabajo no
  main/master/dev pero no dice la base de partida ni el destino de merge; el
  change 20260711-160446 añadió que el prompt de delegación declare la baseline
  esperada — esta config sería su fuente natural.
- La "Effective policy" de `changeledger context` ya expone flags de config
  (language, tdd) por modo: mismo canal para exponer la rama.
- `.changeledger/config.yml` es schema 1; una clave nueva **opcional** con
  fallback a la auto-detección actual no exige migración (a diferencia del tipo
  `quick`, ver 20260711-162556).

## Proposal

Clave opcional `git.integration_branch` en `.changeledger/config.yml`:

- Cuando está definida: `check --commits` la usa como base por defecto, la
  Effective policy del contexto la muestra (p.ej.
  `integration_branch=dev`), y el fragmento de contrato instruye partir las
  ramas de change de ella e integrar en ella, reservando `main` para release.
- Cuando falta: comportamiento actual intacto (auto-detección de
  `defaultBaseBranch`, regla genérica de rama de trabajo).
- El validador de config del visor acepta la clave; valor libre (nombre de
  rama), sin enum.

Alternativas descartadas:

- Detectarla por convención (existir `dev` ⇒ usarla): mágico y sorprendente en
  repos con `dev` heredada; la declaración explícita es más barata.
- Hacerla obligatoria con migración de schema: fuerza un bump de schema para un
  valor que la mayoría de repos no necesita fijar.

## Specification

### CR1 — La config declara la rama de integración
- **Given** `.changeledger/config.yml` con `git.integration_branch: dev`
- **When** se ejecuta `changeledger check --commits` sin base explícita
- **Then** el rango linteado es `dev..HEAD`
- **And** sin la clave, la base sigue siendo la auto-detectada actual

### CR2 — El contexto expone la política
- **Given** un repo con `git.integration_branch: dev`
- **When** se ejecuta `changeledger context implement`
- **Then** la línea de Effective policy incluye `integration_branch=dev`
- **And** sin la clave, la línea no menciona integration_branch

### CR3 — El contrato instruye partir e integrar en la rama declarada
- **Given** el fragmento de implementación compuesto en `changeledger context implement`
- **When** se lee la sección de Git
- **Then** instruye crear las ramas de change desde la rama de integración declarada e integrar el resultado en ella, reservando main para release cuando está declarada
- **And** los snapshots/matriz de `test/context.test.mjs` reclasifican la frase como aditiva dentro de budgets

### CR4 — El visor acepta la clave
- **Given** el editor de configuración del visor con un config que incluye `git.integration_branch`
- **When** se guarda sin tocarla
- **Then** la clave se preserva y no se reporta como desconocida

## Plan

- [x] Añadir `integration_branch` a la resolución de config en `src/config.mjs` (o módulo equivalente) con test en `test/config.test.mjs`; verify: `node --test test/config.test.mjs` (CR1) — 2026-07-11T22:12:02Z
- [x] Usarla como base por defecto en `changeledger check --commits` (`src/commands/check.mjs`) con test; verify: `node --test test/check.test.mjs` (CR1) — 2026-07-11T22:12:02Z
- [x] Exponerla en la Effective policy de `src/commands/context.mjs` con test; verify: `node --test test/context.test.mjs` (CR2) — 2026-07-11T22:12:02Z
- [x] Añadir la instrucción de base/integración a `templates/contract/implement.md` y reclasificar snapshots/matriz en `test/context.test.mjs`; verify: `node --test test/context.test.mjs` (CR3) — 2026-07-11T22:12:02Z
- [x] Verificar preservación de la clave en el editor de config del visor (`src/viewer/server/router.mjs`/`src/viewer/public/templates.js`); verify: `node --test test/view.test.mjs` (CR4) — 2026-07-11T22:12:03Z
- [x] Ejecutar `pnpm verify` completo tras la implementación (support) — 2026-07-11T22:12:03Z

## Log
- **2026-07-11T21:05:26Z** — status: draft → approved
- **2026-07-11T21:56:31Z** — status: approved → in-progress
- **2026-07-11T21:56:31Z** — owner → raruiz-hiberuscom (auto)
- **2026-07-11T22:12:03Z** — Integrada implementación delegada (8f4b532..b483512): integrationBranch() en config, check --commits usa la rama declarada como base, Effective policy la expone, implement.md instruye partir/integrar en ella (main solo release), test de preservación en el visor (ya pasaba: el patch AST conserva claves). TDD red-green por CR; pnpm verify 651/651.
- **2026-07-11T22:12:03Z** — status: in-progress → in-review
- **2026-07-11T22:17:14Z** — review → in-validation (delegated subagent, clean context)
- **2026-07-11T22:17:14Z** — Review independiente (contexto limpio) PASS: CR1-CR4 con evidencia e2e en repos scratch (base declarada vs auto-detección, base explícita gana, fail-fast en valores malformados, policy line exacta, preservación en visor). Sin residuos vs baseline; verify 651/651.
- **2026-07-11T22:18:43Z** — Dogfooding: este repo declara git.integration_branch: dev en su config; Effective policy lo expone y check --commits lintea dev..HEAD por defecto.
