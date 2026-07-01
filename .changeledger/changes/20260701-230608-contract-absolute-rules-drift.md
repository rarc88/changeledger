---
id: "20260701-230608"
title: Reglas absolutas del core omiten excepciones definidas en otros packs
type: bug
status: done
created: 2026-07-01T23:06:08Z
depends_on: [ "20260701-213931", "20260630-225213" ]
owner: raruiz-hiberuscom
reviewed: true
archived: true
---

## Request

Eliminar del contrato los riesgos de drift detectados por la auditoría de
contradicciones (2026-07-01): reglas que el core enuncia como absolutas o
exhaustivas mientras la excepción o la versión completa vive en otro pack. Es la
misma forma del bug ya corregido en la capability card del bootstrap ("Never"
absoluto vs válvula operacional del core).

## Investigation

Auditoría de contexto limpio sobre bootstrap, los cinco contextos compuestos,
los 12 fragmentos y las specs, verificando afirmaciones de comportamiento contra
`src/lifecycle.mjs`, `src/commands/agent.mjs` y `src/check.mjs`. Resultado: cero
contradicciones directas (clase A); tres hallazgos menores:

- **B1 — Prompt de delegación a dos fuerzas.** El core ("Files and delegation")
  enumera tres elementos del prompt de delegación como lista aparentemente
  exhaustiva ("ownership, expected output and integration criterion");
  `delegation.md` exige cinco (añade el porqué de delegar y la justificación del
  modelo). Un agente que solo lea el core omite dos elementos contractuales.
- **C2 — descartado como falso positivo (humano, 2026-07-01).** La regla 4 del
  core aplica al inicio del trabajo y su objeto es el **documento** del change;
  Correction isolation aplica al **diff de corrección** pendiente de
  validación. Momentos y artefactos distintos, y la excepción vive en el mismo
  pack (`implement.md`/`review.md`) que la regla de commits intermedios que
  matiza. No hay omisión.
- **C3 — Regla 8 presenta la graduación como binaria.** "graduate persistent
  truth or run `graduate --skip`" oculta que `--new` no la resuelve: solo
  `--into` o `--skip` fijan `reviewed: true` (`close.md` es la autoridad). Un
  agente podría correr `--new` y creer la graduación zanjada.

## Specification

### CR1 — El resumen de delegación del core no se lee como exhaustivo
- **Given** la salida de `changeledger context`
- **When** describe el prompt de delegación
- **Then** indica que enumera un mínimo y que el contrato completo del prompt vive en el contexto de tarea
- **And** `delegation.md` sigue siendo la única elaboración con los cinco elementos

### CR2 — La graduación no se presenta como binaria en el core
- **Given** la regla 8 del core sobre graduación tras aceptación humana
- **When** menciona graduar o registrar un skip
- **Then** aclara que crear una spec nueva es un paso doble (`--new` scaffoldea, `--into` o `--skip` resuelven)
- **And** `close.md` sigue siendo la autoridad del detalle

### CR3 — El core permanece dentro de su presupuesto
- **Given** los tests de presupuesto del core delimitado
- **When** se aplican los dos ajustes de redacción
- **Then** el core sigue dentro de 120 líneas y 8192 bytes
- **And** los snapshots de fragmentos se actualizan con clasificación explícita

## Plan

- [x] Ajustar `templates/contract/core.md` (resumen de delegación y regla 8) con punteros mínimos a los packs propietarios; verify: `node --test test/context.test.mjs` (CR1, CR2) — 2026-07-01T23:25:31Z
- [x] Cubrir los punteros y el presupuesto de `templates/contract/core.md` con aserciones y snapshot clasificado en `test/context.test.mjs`; verify: `node --test test/context.test.mjs` (CR1, CR2, CR3) — 2026-07-01T23:25:31Z
- [x] Ejecutar el gate completo (support) — 2026-07-01T23:25:31Z

## Log

- **2026-07-01T23:06:08Z** — Draft creado desde la auditoría de contradicciones: 0 clase A, 1 duplicación divergente (B1) y 2 omisiones engañosas (C2, C3). Depende de las correcciones de la card (#20260701-213931) y de la reorganización de packs (#20260630-225213) porque edita el mismo `core.md`.
- **2026-07-01T23:14:26Z** — C2 descartado por el humano como falso positivo: regla 4 del core gobierna el documento al iniciar trabajo; Correction isolation gobierna el diff de corrección pendiente de validación — artefactos y momentos distintos. Alcance reducido a B1 (prompt de delegación) y C3 (graduación no binaria).
- **2026-07-01T23:17:25Z** — status: draft → approved
- **2026-07-01T23:23:49Z** — status: approved → in-progress
- **2026-07-01T23:23:49Z** — owner → raruiz-hiberuscom (auto)
- **2026-07-01T23:25:31Z** — Regla de delegación del core ahora dice 'at least' y remite al contrato completo del pack; regla 8 explicita el doble paso --new/--into; snapshot reclasificado; gate verde
- **2026-07-01T23:25:43Z** — status: in-progress → in-review
- **2026-07-01T23:27:08Z** — review → in-validation (delegated subagent, clean context)
- **2026-07-01T23:27:55Z** — validation → done (human accepted)
- **2026-07-01T23:29:25Z** — graduado a spec `contract-discovery.md`
- **2026-07-01T23:29:25Z** — archived
