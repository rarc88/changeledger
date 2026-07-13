---
id: "20260711-225637"
title: Completar migración y formulario de la rama de integración
type: bug
status: done
created: 2026-07-11T22:56:37Z
depends_on: [ "20260711-210115", "20260628-113219", "20260628-113924" ]
release_impact: patch
reviewed: true
archived: true
owner: Roberto Ruiz
---

## Request

El change 20260711-210115 añadió `git.integration_branch` a la resolución de
configuración, al contexto y al lint de commits, pero no completó las superficies
de distribución y edición. `changeledger config migrate` no incorpora la nueva
sección a configuraciones existentes y el formulario de proyecto del viewer no
permite verla ni editarla. Los repos nuevos tampoco reciben orientación porque
`templates/config.yml` no declara la sección.

## Investigation

- `SUPPORTED_SCHEMA_VERSION` sigue en `2`; `buildMigration()` devuelve `null`
  inmediatamente para cualquier config v2, por lo que una adición a
  `migrateToV2()` tampoco repararía repos ya actuales.
- `templates/config.yml` no contiene `git` ni `integration_branch`; `init` no
  puede sembrar la capacidad ni sus comentarios gestionados.
- `formEditorTemplate()` renderiza General, Paths, Lifecycle, Types, Readiness e
  Internal, pero ninguna sección Git. `collectFormPatch()` tampoco produce un
  patch anidado `git.integration_branch`.
- El backend ya preserva claves desconocidas y `integrationBranch()` acepta una
  cadena no vacía o ausencia. El hueco está en migración, plantilla y UI, no en
  la lectura runtime.
- No existe una rama universal segura: detectar o escribir `dev` cambiaría el
  comportamiento de repos que usan otra convención. La migración debe habilitar
  la sección sin activar una rama inventada.

## Specification

### CR1 — Schema v3 incorpora la sección Git sin inventar una rama
- **Given** una configuración válida con `schema_version: 2` y sin clave `git`
- **When** se ejecuta `changeledger config migrate`
- **Then** queda en `schema_version: 3` con una línea en blanco antes del comentario `# Git integration: change branches start from and merge into this branch` y `git.integration_branch` vacío
- **And** el valor vacío no declara una rama efectiva y conserva la autodetección
- **And** el resumen declara exactamente la actualización de schema y la sección añadida

### CR2 — La migración preserva configuraciones Git existentes
- **Given** una configuración v2 con `git.integration_branch: develop` y claves personalizadas
- **When** se migra a v3
- **Then** conserva `develop`, las claves personalizadas y sus comentarios sin duplicar ni reemplazar `git`
- **And** una segunda migración informa que la configuración ya está actualizada sin escribir

### CR3 — Los repos nuevos documentan la opción
- **Given** un repositorio inicializado con la plantilla vigente
- **When** se inspecciona `.changeledger/config.yml`
- **Then** usa schema v3 e incluye, como bloque separado por una línea en blanco, el comentario Git y `integration_branch:` vacío
- **And** no activa por defecto una rama concreta

### CR4 — El formulario edita la rama de integración
- **Given** el formulario de proyecto con `git.integration_branch: dev`
- **When** se renderiza y se cambia el campo Integration branch a `develop`
- **Then** el input muestra `dev` inicialmente y `collectFormPatch()` emite solo `{ git: { integration_branch: "develop" } }`

### CR5 — El formulario permite desactivar la rama declarada
- **Given** una configuración con `git.integration_branch: dev`
- **When** el humano vacía Integration branch y guarda
- **Then** el patch elimina `integration_branch` sin eliminar otras claves bajo `git`
- **And** al recargar el formulario el campo queda vacío y el runtime vuelve a autodetectar la base

### CR6 — Preview y aplicación del viewer usan la misma migración
- **Given** un proyecto registrado con config v2
- **When** se previsualiza y aplica la migración desde el viewer
- **Then** la preview muestra el candidato v3 con la sección Git y la aplicación escribe ese mismo resultado

## Plan

- [x] Añadir migración v2 → v3 y actualizar `templates/config.yml`; verify: `node --test test/config-migration.test.mjs test/cli.test.mjs` (CR1, CR2, CR3) — 2026-07-11T23:04:41Z
- [x] Añadir el campo Git a `formEditorTemplate()` y `collectFormPatch()` en `src/viewer/public/app.js`; verify: `node --test test/viewer-metadata.test.mjs` (CR4, CR5) — 2026-07-11T23:04:41Z
- [x] Verificar patch anidado y migración compartida en `src/viewer/domain.mjs`; verify: `node --test test/view.test.mjs test/viewer-metadata.test.mjs` (CR5, CR6) — 2026-07-11T23:04:42Z
- [x] Ejecutar `pnpm verify` después de los ciclos red-green (support) — 2026-07-11T23:05:49Z

## Log

- **2026-07-11T22:56:37Z** — Draft creado tras detectar el hueco del change 20260711-210115; se separa de la mejora independiente del formato de commits.
- **2026-07-11T22:59:28Z** — status: draft → approved
- **2026-07-11T23:00:54Z** — status: approved → in-progress
- **2026-07-11T23:00:54Z** — owner → Test (auto)
- **2026-07-11T23:05:50Z** — Implementación TDD completa: schema v3 añade sección git inerte, plantilla documenta integration_branch opcional, formulario edita/elimina la rama preservando claves hermanas; pnpm verify 655/655 y 189 changes válidos.
- **2026-07-11T23:05:50Z** — status: in-progress → in-review
- **2026-07-11T23:07:43Z** — review → in-validation (delegated subagent, clean context)
- **2026-07-11T23:16:23Z** — validation → in-progress (agent rejected): La migración genera git: {}; debe insertar una sección documentada con integration_branch: vacío para que sea visible y editable.
- **2026-07-11T23:16:23Z** — Corrección solicitada: migración y plantilla deben materializar el comentario Git y la clave vacía; `null` mantiene la autodetección existente.
- **2026-07-11T23:16:23Z** — Alcance afinado por el humano: no se repara `git: {}` en schema 3 porque la única instalación afectada fue revertida; la corrección aplica a nuevas migraciones v2 → v3 y a la plantilla.
- **2026-07-11T23:21:12Z** — Corrección candidata confirmada: v2→v3 y la plantilla generan comentario Git + integration_branch vacío; sin reparación intra-schema. pnpm verify 658/658 y 189 changes válidos.
- **2026-07-11T23:21:12Z** — status: in-progress → in-review
- **2026-07-11T23:22:13Z** — review → in-validation (delegated subagent, clean context)
- **2026-07-12T10:23:03Z** — validation → in-progress (agent rejected): El bloque Git migrado debe incluir una línea en blanco antes del comentario para no quedar pegado al bloque anterior.
- **2026-07-12T10:24:23Z** — Corrección candidata: la migración inserta una línea en blanco antes del bloque Git; pnpm verify 658/658 y 189 changes válidos.
- **2026-07-12T10:24:23Z** — status: in-progress → in-review
- **2026-07-12T10:26:11Z** — review → in-validation (delegated subagent, clean context)
- **2026-07-12T10:47:18Z** — validation → done (human accepted)
- **2026-07-12T10:49:19Z** — graduado a spec `git-traceability.md`
- **2026-07-12T10:49:19Z** — archived
- **2026-07-13T13:19:23Z** — owner → Roberto Ruiz
