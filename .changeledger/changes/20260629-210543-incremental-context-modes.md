---
id: "20260629-210543"
title: Contextos específicos incrementales
type: feature
status: in-review
created: 2026-06-29T21:05:43Z
depends_on: []
release_impact: patch
owner: Roberto Ruiz
---

## Request

Evitar que los agentes carguen dos veces el contrato `core` cuando siguen el
flujo obligatorio de ejecutar primero `changeledger context` y después un
contexto específico por modo o change id. La salida específica debe ampliar el
contexto base ya leído, no repetirlo y engordar innecesariamente la ventana del
modelo.

## Investigation

`src/commands/context.mjs` compone hoy todos los modos y estados con el fragmento
`core`. Por tanto, el flujo documentado carga primero unas 83 líneas comunes y
las vuelve a imprimir antes del pack `spec`, `implement`, `review`, `release` o
del overlay de lifecycle. Ambas salidas permanecen en la conversación del
agente; el cache de prompts puede abaratar procesamiento, pero no elimina esa
ocupación de contexto.

El bootstrap vigente ya exige ejecutar `changeledger context` directamente y
leer su salida completa antes de crear o modificar archivos. Esa precondición
permite que las consultas posteriores sean incrementales. El riesgo es una
invocación aislada de un modo o change id, por lo que la salida incremental debe
declarar brevemente que depende del contexto base y ordenar detenerse si todavía
no fue leído.

## Proposal

Mantener `changeledger context` sin argumentos como única entrega del contrato
`core`. Hacer que los modos explícitos y los contextos inferidos por change id
incluyan sólo sus packs u overlays especializados, precedidos por una cabecera
breve que los identifique como incrementales y exija haber leído primero la
salida base completa.

Actualizar el propio `core` para explicar que las variantes amplían el contexto
ya leído. No añadir flags, memoria de sesión ni un segundo comando: el CLI sigue
siendo determinista y stateless, y la precondición continúa en el bootstrap.

## Specification

### CR1 — Los modos no repiten el núcleo
- **Given** un repo ChangeLedger registrado cuyo contexto base ya fue leído
- **When** se solicita `changeledger context spec`, `implement`, `review` o `release`
- **Then** la salida contiene el pack especializado correspondiente
- **And** la salida no contiene el fragmento `# ChangeLedger — Core Contract`

### CR2 — El contexto por change id tampoco repite el núcleo
- **Given** un change válido en cualquier estado soportado y su contexto base ya leído
- **When** se solicita `changeledger context <change-id>`
- **Then** la salida contiene el pack u overlay inferido y el documento completo del change
- **And** la salida no contiene el fragmento `# ChangeLedger — Core Contract`

### CR3 — Las salidas incrementales fallan cerrado por instrucción
- **Given** cualquier contexto solicitado por modo explícito o change id
- **When** se imprime su salida
- **Then** una cabecera breve declara que amplía el contexto base leído previamente
- **And** ordena detenerse y ejecutar `changeledger context` si la salida base completa todavía no fue leída

### CR4 — El contexto base enseña la composición incremental
- **Given** un repo ChangeLedger registrado
- **When** se solicita `changeledger context` sin argumentos
- **Then** la salida conserva el contrato core completo dentro de sus presupuestos vigentes
- **And** explica que los modos y change ids amplían ese contexto sin repetirlo

## Plan

- [x] Ajustar la composición en `src/commands/context.mjs` y escribir primero las regresiones en `test/context.test.mjs`; verify: `node --test test/context.test.mjs` (CR1, CR2, CR3) — 2026-06-29T21:14:05Z
- [x] Actualizar `templates/contract/core.md` y sus aserciones en `test/context.test.mjs`; verify: `node --test test/context.test.mjs` (CR4) — 2026-06-29T21:14:05Z
- [x] Ejecutar la puerta completa del repositorio; verify: `pnpm verify` (support) — 2026-06-29T21:14:31Z

## Log

- 2026-06-29T21:05:43Z — Alcance autorizado por el humano; se documenta como mejora separada y se pospone el release para incluir ambos cambios.
- **2026-06-29T21:11:52Z** — status: draft → approved
- **2026-06-29T21:12:55Z** — status: approved → in-progress
- **2026-06-29T21:12:55Z** — owner → Roberto Ruiz (auto)
- **2026-06-29T21:14:31Z** — Implementación completada: los contextos específicos son incrementales y pnpm verify pasa con 468 tests; permanece el warning conocido de dependencies.md huérfano.
- **2026-06-29T21:14:40Z** — status: in-progress → in-review
