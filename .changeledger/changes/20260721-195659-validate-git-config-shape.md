---
id: "20260721-195659"
title: Validar la estructura de git en changeledger check
type: bug
status: approved
created: 2026-07-21T19:56:59Z
depends_on: []
related_to: ["20260613-205853", "20260711-210115", "20260711-225637"]
release_impact: patch
---

## Request

`changeledger check` debe detectar una sección `git` estructuralmente inválida
antes de que un comando concreto intente usarla. Actualmente una configuración
puede pasar el gate y fallar después al resolver `git.integration_branch`, por
lo que el check no representa el contrato efectivo del repositorio.

## Investigation

`integrationBranch(config)` acepta clave ausente o `null`, normaliza un string
no vacío y falla para cualquier otra forma. `checkConfig` valida las colecciones
principales, paths, readiness y releases, pero no inspecciona `config.git`. Así,
`git: dev`, `git: []` o `integration_branch: 7` no producen diagnóstico en
`changeledger check`, aunque `check --commits` y otros consumidores fallen.

`20260613-205853` estableció que `check` valida config; `20260711-210115`
declaró la rama de integración y `20260711-225637` completó su migración/editor.
Están terminados y son contexto. La corrección debe reflejar exactamente el
contrato público actual, sin introducir `change_branch_format`, `state_branch`
ni el schema 4 del prototipo descartado.

La causa raíz es duplicar la validación únicamente en el accessor de runtime en
vez de expresarla también en el validador puro. Claves Git desconocidas siguen
permitidas para preservar extensibilidad y configuración específica del repo.

## Specification

### CR1 — `git` debe ser mapping
- **Given** una config cuyo resto es válido y contiene `git: dev`, `git: []` o `git: true`
- **When** se ejecuta `changeledger check`
- **Then** falla con `config "git" must be a mapping`
- **And** no lanza una excepción ni modifica la config

### CR2 — Forma exacta de integration branch
- **Given** una config con `git` mapping
- **When** `integration_branch` es `""`, whitespace, número, boolean, lista o mapping
- **Then** `check` falla con `config "git.integration_branch" must be a non-empty string`
- **And** clave ausente, `null`, `dev` y `" dev "` no producen ese error

### CR3 — Checker y accessor permanecen alineados
- **Given** cualquier valor de `git.integration_branch` cubierto por CR2
- **When** se compara `check` con `integrationBranch(config)`
- **Then** ambos aceptan o rechazan la misma forma
- **And** el accessor continúa devolviendo `dev` sin whitespace para `" dev "`

### CR4 — Extensibilidad y migración
- **Given** una sección Git válida con claves custom desconocidas o la sección `git:\n  integration_branch:` generada por schema 3
- **When** se ejecuta `check` o la migración actual
- **Then** las claves custom no generan error ni se eliminan
- **And** la rama vacía representada como `null` sigue siendo válida y conserva autodetección

## Plan

- [ ] Añadir una tabla fallida en `test/config.test.mjs` y después implementar `checkGitConfig` en `src/check.mjs`, alineado con `src/config.mjs`; verify: `node --test test/config.test.mjs test/check.test.mjs` (CR1, CR2, CR3)
- [ ] Añadir regresión de config migrada/claves custom y preservar ese comportamiento en `src/config-migration.mjs`; verify: `node --test test/config-migration.test.mjs test/config.test.mjs` (CR4)
- [ ] Ejecutar el gate completo; verify: `pnpm verify` (support)

## Log

- **2026-07-21T19:56:59Z** `[note]` Extraído por separado para mantener una sola preocupación: alinea check con el accessor Git actual sin portar el schema del estado v1.
- **2026-07-21T20:03:17Z** `[status]` draft → approved (human via conversation)
