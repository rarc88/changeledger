---
id: "20260630-225210"
title: Validar la secuencia de lifecycle registrada en el Log
type: bug
status: in-validation
created: 2026-06-30T22:52:10Z
depends_on: []
owner: raruiz-hiberuscom
---

## Request

Hacer que `changeledger check` detecte historias de lifecycle internamente
imposibles en `## Log`, sin invalidar de forma retroactiva los registros legacy
creados antes del gate universal de validación humana.

## Investigation

`check` valida el status final y el formato de entradas individuales, pero no
reproduce la secuencia del Log. El change `20260629-234939` contiene dos entradas
consecutivas `review → in-validation`; la segunda parte de un estado que ya era
`in-validation`, pero los 142 changes pasan validación.

`metrics.mjs` sí reconstruye una timeline suponiendo `draft` como origen, aunque
solo extrae el destino y no verifica aristas. El historial conserva además
changes legítimos del contrato anterior con transiciones como `review → done` o
`in-progress → done`. Aplicar sin compatibilidad el grafo actual convertiría
historia válida en errores, por lo que el validador debe distinguir secuencias
canónicas actuales de marcadores legacy y migrar únicamente la contradicción
confirmada.

## Specification

### CR1 — Una transición repetida o imposible se detecta
- **Given** un Log que ya alcanzó `in-validation`
- **When** aparece otra entrada `review → in-validation` sin volver antes a `in-review`
- **Then** `changeledger check` reporta un error con archivo, línea y transición esperada

### CR2 — Las aristas canónicas se reproducen en orden
- **Given** entradas `status`, `review` y `validation` producidas por el CLI o viewer actuales
- **When** `check` reconstruye el lifecycle desde `draft`
- **Then** valida cada origen y destino contra la autoridad de `src/lifecycle.mjs`
- **And** detecta self-loops, saltos y un status final incompatible con la secuencia reconstruida

### CR3 — El historial legacy permanece legible
- **Given** changes históricos anteriores a `in-validation` que cerraban con `review → done` o `in-progress → done`
- **When** se ejecuta el check del repositorio
- **Then** no se convierten automáticamente en errores del grafo actual
- **And** la regla de compatibilidad queda explícita, acotada y cubierta por fixtures reales

### CR4 — La contradicción conocida se repara como verdad histórica
- **Given** el change `20260629-234939`
- **When** se incorpora la validación secuencial
- **Then** se elimina o corrige únicamente la entrada duplicada sin alterar el veredicto humano ni el resultado aceptado
- **And** los 142 changes históricos más estos drafts pasan `changeledger check`

### CR5 — Métricas y validación comparten semántica de eventos
- **Given** dos consumidores de transiciones del Log
- **When** extraen eventos de lifecycle
- **Then** reutilizan una representación común o reglas equivalentes probadas
- **And** una entrada inválida no produce silenciosamente una timeline engañosa

## Plan

- [x] Extraer o ampliar en `src/lifecycle.mjs`/`src/metrics.mjs` el parser de eventos necesario para reproducir el Log; verify: `node --test test/lifecycle.test.mjs test/metrics.test.mjs` (CR2, CR3, CR5) — 2026-07-01T22:19:51Z
- [x] Incorporar la validación secuencial en `src/check.mjs` con diagnósticos de línea y compatibilidad legacy; verify: `node --test test/check.test.mjs` (CR1, CR2, CR3) — 2026-07-01T22:19:52Z
- [x] Reparar la entrada duplicada de `.changeledger/changes/20260629-234939-restore-dynamic-context-contract.md` y comprobarla contra `src/check.mjs`; verify: `node bin/changeledger.mjs check 20260629-234939` (CR4) — 2026-07-01T22:19:52Z
- [x] Graduar la semántica de `src/lifecycle.mjs` a `.changeledger/specs/lifecycle.md` y `.changeledger/specs/metrics.md`; verify: `pnpm test` (CR1, CR2, CR3, CR4, CR5) — 2026-07-01T22:19:52Z

## Log

- **2026-06-30T22:52:10Z** — Draft creado tras confirmar que una transición duplicada reciente pasa el check y que existen cierres legacy que requieren compatibilidad.
- **2026-07-01T21:51:30Z** — status: draft → approved
- **2026-07-01T22:11:24Z** — status: approved → in-progress
- **2026-07-01T22:11:24Z** — owner → raruiz-hiberuscom (auto)
- **2026-07-01T22:19:52Z** — parseLogEvent compartido en lifecycle.mjs (metrics lo reutiliza); validación secuencial en check con resync legacy acotado (solo status: explícito, hacia delante, pre-review) y aristas legacy literales; duplicado de 234939 eliminado y cierre en prosa de 222911 formalizado; specs lifecycle/metrics graduadas; 488 tests y 149 changes verdes
- **2026-07-01T22:20:02Z** — status: in-progress → in-review
- **2026-07-01T22:22:31Z** — review → in-validation (delegated subagent, clean context)
