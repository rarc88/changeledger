---
id: "20260626-115134"
title: Aclarar formato machine-readable de tareas y readiness
type: bug
status: done
created: 2026-06-26T11:51:34Z
depends_on: []
release_impact: patch
owner: Roberto Ruiz
reviewed: true
archived: true
---

## Request

Aclarar en el contrato canónico las reglas de markdown que `sl check` interpreta
como estructura, especialmente en tareas de `## Plan` y Definition of Ready.

La fricción observada: un agente creó un change en `ionic-app` con tareas que sí
referenciaban `(CRn)` y nombraban archivos, pero puso la verificación como sufijo
`— verify: manual device check` después de los criterios. El parser elimina el
sufijo `— ...` antes de validar readiness, por lo que `sl check` reportó warnings
de target/verificación aunque el texto parecía correcto para un lector humano.

Se pide crear un change para documentar esas reglas con suficiente precisión y
evitar que otros agentes pierdan tiempo intentando "arreglar" referencias que no
están rotas.

## Investigation

### Estado actual

- `templates/AGENTS.md` explica que las tareas referencian criterios con
  `(CRn)` y que los timestamps/razones usan el sufijo `— ...`.
- `templates/AGENTS.md` §11 dice que target y verificación deben estar "in its
  description", pero no muestra una gramática exacta ni ejemplos negativos.
- `src/change.mjs` parsea cada tarea en este orden:
  1. detecta `- [ ]`, `- [x]` o `- [!]`;
  2. corta el último sufijo ` — ...`;
  3. extrae criterios solo si hay un bloque final `(CRn, CRm)`;
  4. guarda el resto como `task.text`.
- `src/check.mjs` valida readiness contra `task.text`, no contra la línea
  original completa.

### Huecos de contrato

El contrato no deja lo bastante explícito que:

- `verify:` debe quedar antes del bloque final `(CRn)`;
- el sufijo `— ...` no forma parte de la descripción validada de una tarea;
- `(support)` es literal y final;
- los `CRn` solo cuentan si son headings `### CRn ...` y sus pasos usan
  `- **Given**`, `- **When**`, `- **Then**`;
- headings de stages y pasos estructurales se mantienen en inglés aunque el
  contenido del repo esté en otro idioma;
- los patrones de readiness son búsquedas textuales/glob, no inferencia semántica.

### Diagnóstico actual

El warning genérico `Plan task for CRn must name target and verification` es
correcto, pero no ayuda cuando la verificación existe en la línea original y fue
colocada en una zona que el parser descarta. Ese caso puede detectarse con un
mensaje más específico para tareas pendientes que usan `— verify:` después del
bloque de criterios.

## Specification

### CR1 — Gramática de tareas explícita

- **Given** un agente lee el contrato canónico en `templates/AGENTS.md`
- **When** llega a la sección de tareas de `## Plan`
- **Then** encuentra ejemplos normativos de tareas pending, done, blocked y support que muestran el orden parseable de descripción, readiness, `(CRn)` y sufijo de resolución

### CR2 — Readiness antes de los criterios

- **Given** un repo configura `readiness.verification_patterns` con un marcador textual como `verify:`
- **When** el contrato muestra cómo escribir tareas que referencian criterios
- **Then** el ejemplo correcto coloca target y `verify:` dentro de la descripción antes del bloque final `(CRn)`
- **And** el ejemplo incorrecto muestra que `- [ ] ... (CR1) — verify: ...` no es parseable como verificación

### CR3 — Estructura CR y stages sin ambigüedad idiomática

- **Given** un repo usa `language: es`
- **When** un agente documenta `## Specification`
- **Then** el contrato deja claro que headings de stages, ids `CRn` y keywords `Given`/`When`/`Then`/`And` siguen en inglés y deben usar el formato exacto que parsea `sl check`

### CR4 — Support literal y final

- **Given** una tarea operacional no satisface directamente un criterio
- **When** el agente la marca como support
- **Then** el contrato indica que debe terminar literalmente en `(support)` y que no sustituye a un `CRn` para tareas que cambian comportamiento observable

### CR5 — Diagnóstico específico de sufijo mal colocado

- **Given** una tarea pendiente contiene criterios antes de un sufijo `— verify: ...`
- **When** se ejecuta `sl check`
- **Then** el resultado explica que `verify:` debe ir antes del bloque final `(CRn)` porque el sufijo `— ...` se reserva para timestamp o razón de bloqueo

## Plan

- [x] Actualizar `templates/AGENTS.md` §4 con una mini-gramática y ejemplos correctos/incorrectos de tareas parseables; verificar con `node bin/sl.mjs check 20260626-115134` (CR1, CR2, CR4) — 2026-06-26T12:03:20Z
- [x] Reforzar `templates/AGENTS.md` §3/§8/§11 para explicar que stages, `CRn` y pasos Given/When/Then son estructura en inglés aunque el contenido sea local; verificar con `node bin/sl.mjs check 20260626-115134` (CR3) — 2026-06-26T12:03:23Z
- [x] Añadir o ajustar tests en test/check.test.mjs para el diagnóstico de src/check.mjs sobre una tarea pending con la verificación mal ubicada en el sufijo reservado; verificar con pnpm test (CR5) — 2026-06-26T12:04:03Z
- [x] Actualizar src/change.mjs y src/check.mjs para conservar el sufijo reservado y emitir un diagnóstico específico cuando `verify:` queda allí; verificar con pnpm test y node bin/sl.mjs check (CR5) — 2026-06-26T12:04:06Z

## Log

- 2026-06-26T11:51:34Z — Change creado en estado draft.
- **2026-06-26T12:00:00Z** — status: draft → approved
- **2026-06-26T12:01:33Z** — status: approved → in-progress
- **2026-06-26T12:01:33Z** — owner → Roberto Ruiz (auto)
- **2026-06-26T12:05:28Z** — status: in-progress → in-review
- **2026-06-26T12:07:05Z** — review → in-validation (delegated subagent, clean context)
- **2026-06-26T17:18:49Z** — validation → done (human accepted)
- **2026-06-26T17:40:44Z** — graduado a spec `architecture.md`
- **2026-06-26T17:41:22Z** — archived
