---
id: "20260711-103756"
title: Carril rápido para trabajo pequeño trazable
type: feature
status: in-progress
created: 2026-07-11T10:37:56Z
depends_on: []
release_impact: minor
owner: raruiz-hiberuscom
---

## Request

Los equipos que usan ChangeLedger (datos de dos semanas sobre v0.8.0 en
`ionic-app` y `backend-laravel`) reportan que a veces quieren hacer trabajo
pequeño y rápido, pero el contrato obliga a los agentes a pagar el ciclo
completo (documentar, aprobar, review, validar) o a no tocar nada. El resultado
observado no es cumplimiento: es bypass silencioso, que pierde justo la
trazabilidad que ChangeLedger existe para proteger. Se pide un carril oficial
ligero para trabajo pequeño que conserve autorización humana y trazabilidad.

## Investigation

Evidencia de la minería (2026-07-11, 325 changes en 3 repos):

- En `ionic-app`, ~80% de los commits sustantivos posteriores a la adopción no
  llevan marcador `[#id]`; familias enteras de features se committearon fuera
  del flujo. En `backend-laravel` convive una convención paralela (`WS-####` /
  número de PR) sin enlace al ledger.
- El contrato actual solo ofrece la excepción operativa estrecha del core
  ("purely operational, reversible edit"), que exige preguntar al humano caso a
  caso y no cubre fixes pequeños con comportamiento observable.
- El coste fijo por change es alto para trabajo trivial: ~7-8k tokens de
  contrato por ciclo más el reviewer de contexto limpio; en `backend-laravel`
  hay bugs con documentos de 16-35 líneas que pagan el mismo ciclo que una
  feature de 500.
- Restricción: la aprobación humana de alcance y la aceptación final son
  invariantes del producto (INTENT); el carril no puede eliminarlas.

## Proposal

Nuevo tipo de change `quick` en la matriz por defecto:

- Stages activados: solo `## Request` y `## Log`. Sin Specification, Plan ni
  review gate. Documento objetivo: ~10-15 líneas.
- Mismo ciclo de vida corto: `draft → approved` (humano) →
  `in-progress → in-validation → done`, sin `in-review`. Mismas reglas de
  rama y de marcador `[#id]` en commits.
- Elegibilidad documentada en el contrato: un solo concern, reversible, sin
  ampliar superficie pública ni verdad persistente (`specs/`). Si durante la
  ejecución el alcance crece, se descarta y se recrea con el tipo correcto —
  igual que el patrón ya observado en `backend-laravel` (20260708-115313).
- La graduación de un `quick` es siempre `--skip` implícito: no produce verdad
  persistente por definición de elegibilidad.

Alternativas descartadas:

- Permitir trabajo sin registro alguno: pierde trazabilidad y contradice el
  propósito; el bypass actual ya demuestra su coste.
- Umbral automático por tamaño de diff: no determinista y fácil de burlar.
- Auto-aprobación del draft por el agente: rompe el invariante de que el humano
  autoriza el alcance.

## Specification

### CR1 — Scaffold quick
- **Given** un repo inicializado con la matriz por defecto
- **When** se ejecuta `changeledger new quick fix-copy "Corregir texto del banner"`
- **Then** se crea el documento con frontmatter `type: quick`, `status: draft`
- **And** sus únicos headings de stage son `## Request` y `## Log`, en ese orden

### CR2 — Sin review gate
- **Given** un change `quick` en `in-progress` con Request y Log completos
- **When** se ejecuta `changeledger status <id> in-validation`
- **Then** la transición se acepta sin exigir paso por `in-review`

### CR3 — check acepta el formato mínimo
- **Given** un change `quick` válido sin Specification ni Plan
- **When** se ejecuta `changeledger check <id>`
- **Then** termina con exit 0 y sin diagnósticos por stages desactivados

### CR4 — Matriz efectiva incluye quick
- **Given** un repo con `config.yml` sin personalizar
- **When** se consulta la matriz efectiva de tipos
- **Then** `quick` aparece con `request` y `log` activados y sin review requerida

### CR5 — Contrato documenta la elegibilidad
- **Given** el contexto de autoría
- **When** se ejecuta `changeledger context spec`
- **Then** la salida incluye el carril `quick` con sus criterios de
  elegibilidad y la regla de conversión a otro tipo cuando el alcance crece

## Plan

- [x] Añadir `quick` a tipos válidos y matriz por defecto en `src/config.mjs`; verify: `pnpm test` (CR4) — 2026-07-11T11:05:46Z
- [x] Aceptar el scaffold `quick` en `src/commands/new.mjs`; verify: `pnpm test` (CR1) — 2026-07-11T11:05:47Z
- [x] Excluir `quick` del review gate en la lógica de transiciones de `src/lifecycle.mjs`; verify: `pnpm test` (CR2) — 2026-07-11T11:05:47Z
- [x] Verificar que `src/check.mjs` no exige stages desactivados para `quick` y cubrirlo con test; verify: `pnpm test` (CR3) — 2026-07-11T11:05:47Z
- [x] Documentar el carril y su elegibilidad en `templates/contract/spec.md` y la mención mínima en `templates/contract/core.md`; verify: `pnpm test` (CR5) — 2026-07-11T11:05:47Z
- [x] Ejecutar `pnpm verify` completo tras la implementación (support) — 2026-07-11T11:05:47Z

## Log
- **2026-07-11T10:47:23Z** — status: draft → approved
- **2026-07-11T10:52:15Z** — status: approved → in-progress
- **2026-07-11T10:52:15Z** — owner → raruiz-hiberuscom (auto)
- **2026-07-11T11:05:48Z** — Integrada implementación delegada (1a18fe4..a921f3b). Divergencia registrada: la matriz por defecto vive en templates/config.yml, no en src/config.mjs; new/check/lifecycle ya eran genéricos y solo requirieron tests. Añadido release.impacts.quick=patch. Snapshots de core.md/spec.md actualizados. pnpm verify 567/567.
