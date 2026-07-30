---
id: "20260730-214504"
title: El contrato servido documenta la ruta de migración de cada fix
type: feature
status: done
created: 2026-07-30T21:45:04Z
depends_on: []
archived: true
reviewed: true
related_to:
  - "20260729-203257"
  - "20260730-183807"
owner: raruiz-hiberuscom
---

## Request

El follow-up más material antes del release, nombrado por Roberto y registrado
desde el cierre de `20260729-203257`: un repo consumidor que actualice a la
gramática de tags del Plan ve errores de readiness en sus tareas antiguas **sin
ruta de migración documentada** — `changeledger fix --plan-tags` existe en el
CLI y no aparece en ningún fragmento del contrato servido. La investigación de
`20260730-183807` verificó la clase completa: de los tres modos de migración de
`fix`, solo `--graduation-links` está documentado (`close.md`);
`--structured-sections` y `--plan-tags` no aparecen en `templates/contract/`.

## Investigation

Verificado hoy contra HEAD (2026-07-30), por ejecución:

- `changeledger fix --help` publica tres modos de migración: `--graduation-links`
  (procedencia de graduación), `--structured-sections` (metadata de tareas y
  eventos tipados del Log) y `--plan-tags` (criteria/support/verify del Plan a
  hijos estructurados), todos con `--dry-run`.
- Grep de los tres flags sobre `templates/contract/`: un solo hit,
  `close.md` con `--graduation-links`. Los otros dos, cero sedes.
- La sede natural de `--plan-tags` es el pack de autoría: `spec.md` documenta
  la gramática de tags que las tareas viejas incumplen, y es la captura que el
  agente tiene delante cuando `check` reporta los errores de readiness. La de
  `--structured-sections` es la misma zona (migra la otra mitad de la misma
  estructura: metadata de tareas y Log tipado).
- **Restricción dura de presupuesto**: `base.spec` está a ~2397/2500 tokens
  (~103 de margen, medido hoy). La prosa nueva debe ser una frase compacta que
  cubra los dos flags, o el implementador para y reporta.
- El precedente de redacción está en `close.md`: comando en backticks +
  paréntesis de `--dry-run`, una línea.
- Relacionados: `20260729-203257` (la gramática que crea la necesidad),
  `20260730-183807` (la investigación que verificó la clase). Cerrados →
  `related_to`.

## Proposal

Una frase en la zona de la gramática del Plan de `spec.md` (o los *authoring
helpers*, a juicio del implementador midiendo): las tareas preexistentes sin
hijos estructurados migran con `changeledger fix --plan-tags` y la metadata
legada con `--structured-sections`, ambos con `--dry-run` para previsualizar.
Guard tolerante de fragmento único.

Alternativa descartada: documentarlos en `close.md` junto a
`--graduation-links` — el consumidor no está cerrando un change cuando choca
con los errores de readiness; está redactando o migrando, y su captura es la
de autoría. Segunda alternativa descartada: un verificador de paridad
automática CLI↔contrato (todo flag de `fix` documentado) — superficie nueva
sin coste medido detrás; el guard fija los dos que este change añade.

Escenario: un consumidor actualiza el paquete, `changeledger check` le reporta
tareas sin target/verification, carga `changeledger context spec` y la propia
captura le nombra `fix --plan-tags --dry-run` como ruta.

## Specification

### CR1 — El pack de autoría nombra la ruta de migración del Plan
- **Given** el pack compuesto por `buildContext('spec', root)`
- **When** un consumidor con tareas de gramática vieja lo carga
- **Then** contiene la ruta: `changeledger fix --plan-tags` para los hijos
  estructurados del Plan y `--structured-sections` para la metadata legada,
  con `--dry-run` como previsualización
- **And** un guard tolerante de fragmento fija la obligación, y `base.spec`
  sigue bajo su techo {2500, 250} — si la frase correcta no cabe, el
  implementador para y reporta las cifras

## Plan

- [x] Escribir la frase de migración en spec.md y su guard, midiendo el techo
  - **Target:** `templates/contract/spec.md`
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR1
  - **Resolved:** `2026-07-30T22:34:53Z`
- [x] Correr el gate completo tras la implementación
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-07-30T22:34:53Z`

## Log
- **2026-07-30T21:47:13Z** `[owner]` set: raruiz-hiberuscom
- **2026-07-30T21:50:27Z** `[status]` draft → approved (human via conversation)
- **2026-07-30T22:26:50Z** `[status]` approved → in-progress
- **2026-07-30T22:34:53Z** `[note]` Selección única resuelta. base.spec 2403→2452/2500 medido antes y después; guard de fragmento único en tabla hermana MIGRATION_OBLIGATIONS (una fila en DELEGATION_OBLIGATIONS habría titulado el test como 165310 — decisión del implementador, correcta); delete rojo / reword verde ejecutados; paridad 1/1 en los 4 patrones de DRAFTING_OBLIGATIONS.
- **2026-07-30T22:35:25Z** `[status]` in-progress → in-review
- **2026-07-30T22:35:25Z** `[note]` Mandato del review, declarado antes de delegar: la superficie que el change gobierna — la frase de spec.md y su guard contra CR1. Modelo medio: un CR, una frase, evidencia ya ejecutada; la cápsula condicional acota la checklist.
- **2026-07-30T22:39:11Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-30T22:50:55Z** `[validation]` in-validation → done (human accepted via conversation)
- **2026-07-30T22:51:17Z** `[graduation]` skipped: la ruta de migración vive en el contrato servido, que es el entregable; la spec de readiness documenta la gramática, no su distribución
- **2026-07-30T22:52:29Z** `[archive]` archived
