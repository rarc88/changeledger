---
id: "20260731-161655"
title: Configurar el formato de las ramas de change
type: feature
status: approved
created: 2026-07-31T16:16:55Z
depends_on: []
related_to: ["20260711-103757", "20260711-210115", "20260711-225637"]
owner: Roberto Ruiz
release_impact: minor
---

## Request

Los repositorios pueden declarar la rama de integración, pero no una convención
ejecutable para las ramas que implementan cada change. Agentes y humanos deben
inventar el nombre y pueden terminar trabajando en una rama que no se relaciona
de forma determinista con el id. Se necesita un formato configurable que derive
el nombre desde campos inmutables del change, lo publique en el contexto y lo
verifique al comenzar la implementación.

## Investigation

`git.integration_branch` ya define de dónde parten y a dónde vuelven las ramas;
`context` publica esa base y `check --commits` la usa por defecto. No existe una
función que renderice el nombre esperado ni una validación del branch actual en
`approved → in-progress`. La rama histórica `codex/global-state-branch`
implementó `{type}/{id}`, validación de placeholders y `git check-ref-format`,
pero mezcló el campo con una migración de schema que también activaba el almacén
global. Esa parte no debe recuperarse.

`20260711-210115` y `20260711-225637` son la base terminada de configuración,
migración y edición de `integration_branch`; `20260711-103757` define el lint y
helper de commits sobre los que se apoya la trazabilidad Git. No son
prerrequisitos pendientes.

## Proposal

Añadir la clave opcional `git.change_branch_format`. Su ausencia mantiene el
comportamiento actual y no impone nombres retroactivamente. Cuando se declara,
solo admite `{type}` y `{id}`, exige `{id}` exactamente una vez y permite texto
literal, por ejemplo `changes/{type}/{id}`. No admite `owner`, `title` ni otros
campos mutables que obligarían a renombrar una rama.

El nombre renderizado debe pasar la validación nativa de refs de Git. El contexto
de un change publica `change_branch=<nombre>` y el contrato ordena usarlo. La
transición `approved → in-progress` verifica que el branch actual tenga ese
nombre y descienda de `git.integration_branch` cuando ambas claves estén
declaradas. No se crea ni cambia de rama automáticamente: esa mutación permanece
explícita y bajo control del operador.

Se descarta añadir un valor por defecto obligatorio. El repositorio ya contiene
convenciones y ramas activas anteriores a esta capacidad; activarla sin una clave
explícita convertiría una mejora opt-in en una ruptura del workflow existente.

## Specification

### CR1 — Render determinista opt-in
- **Given** un change feature con id `20260731-161655` y `git.change_branch_format: changes/{type}/{id}`
- **When** se calcula su rama de implementación
- **Then** devuelve exactamente `changes/feature/20260731-161655`
- **And** repetir el cálculo con la misma config y change devuelve el mismo resultado

### CR2 — Ausencia conserva el comportamiento actual
- **Given** una config sin `git.change_branch_format` o con el valor YAML `null`
- **When** se resuelve la convención de rama
- **Then** no se exige ni publica un nombre de rama de change
- **And** las transiciones actuales no incorporan una validación nueva

### CR3 — Formatos ambiguos o inválidos fallan cerrados
- **Given** cada formato `{type}`, `{id}/{id}`, `{owner}/{id}`, `{type/{id}` o `bad..{id}`
- **When** se valida o renderiza para un change
- **Then** se rechaza respectivamente por ausencia o duplicación de `{id}`, placeholder desconocido, placeholder malformado o resultado inválido para Git
- **And** `changeledger check` reporta el mismo defecto sin lanzar una excepción

### CR4 — El contexto publica la rama esperada
- **Given** un change resoluble y una config con `git.change_branch_format: work/{id}`
- **When** se ejecuta `changeledger context <id>`
- **Then** la política efectiva incluye `change_branch=work/<id>`
- **And** conserva `integration_branch=<rama>` cuando también está declarada

### CR5 — Inicio de implementación verifica nombre y baseline
- **Given** un change `approved`, `git.integration_branch: dev` y `git.change_branch_format: work/{id}`
- **When** se intenta `approved → in-progress`
- **Then** solo se permite desde el branch exacto `work/<id>` cuyo historial desciende de `dev`
- **And** cualquier nombre distinto falla antes de modificar el change con un diagnóstico que nombra la rama esperada y la actual

### CR6 — El viewer edita sin destruir claves Git
- **Given** una config con `integration_branch`, `change_branch_format` y una clave Git desconocida
- **When** el formulario del viewer cambia o limpia únicamente `change_branch_format`
- **Then** persiste el valor solicitado o elimina la clave
- **And** conserva sin cambios `integration_branch`, comentarios y claves Git desconocidas

## Plan

- [ ] Escribir primero la matriz del formato y añadir resolución/renderizado con validación de Git
  - **Target:** `src/config.mjs`, `src/git.mjs`, `test/config.test.mjs`, `test/git.test.mjs`
  - **Verify:** `node --test test/config.test.mjs test/git.test.mjs`
  - **Criteria:** CR1, CR2, CR3
- [ ] Validar la clave opcional desde `check` y publicar el nombre renderizado en el contexto del change
  - **Target:** `src/check.mjs`, `src/commands/context.mjs`, `test/check.test.mjs`, `test/context.test.mjs`
  - **Verify:** `node --test test/check.test.mjs test/context.test.mjs`
  - **Criteria:** CR3, CR4
- [ ] Escribir primero regresiones de rama/nombre/baseline y verificar el inicio de implementación antes de mutar lifecycle
  - **Target:** `src/commands/agent.mjs`, `src/git.mjs`, `test/agent.test.mjs`
  - **Verify:** `node --test test/agent.test.mjs`
  - **Criteria:** CR5
- [ ] Extender la plantilla, el contrato y el editor del viewer preservando YAML ajeno
  - **Target:** `templates/config.yml`, `templates/contract/implement.md`, `src/viewer/domain.mjs`, `src/viewer/public/app.js`, `test/view.test.mjs`, `test/viewer-metadata.test.mjs`
  - **Verify:** `node --test test/view.test.mjs test/viewer-metadata.test.mjs`
  - **Criteria:** CR2, CR6
- [ ] Ejecutar el gate completo después del ciclo red-green-refactor
  - **Support:**
  - **Verify:** `pnpm verify`

## Log
- **2026-07-31T16:30:55Z** `[status]` draft → approved (human via conversation)
