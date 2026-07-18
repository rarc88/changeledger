---
id: "20260718-105457"
title: Filtrar operaciones masivas por owner
type: feature
status: in-progress
created: 2026-07-18T10:54:57Z
depends_on: []
owner: Roberto Ruiz

---

## Request

En un repositorio con varios owners, el humano pidió a un agente graduar y
archivar todos sus changes. La selección por owner existe en `changeledger list`,
pero la acción masiva `changeledger archive --graduated` actúa sobre todos los
candidatos del repositorio. Una previsualización acotada puede, por tanto,
mostrar los changes de una persona y la acción posterior archivar también los de
las demás.

Revisar las operaciones que seleccionan múltiples changes y permitir acotar por
owner aquellas cuya unidad de trabajo pertenece a una persona.

## Investigation

- `changeledger graduate` no tiene modo masivo: `--new`, `--into` y `--skip`
  reciben un solo change. Graduar varios consiste en consultar
  `changeledger list --pending graduation` e iterar, porque cada decisión puede
  requerir crear/refinar una spec o justificar un skip diferente.
- `changeledger list` ya combina `--owner` o `--unowned` con
  `--pending graduation|archive`. Es la superficie canónica de selección desde
  `20260716-131649`.
- `changeledger archive --graduated` es el único mutador de changes que selecciona
  una colección. `archiveGraduated()` aplica elegibilidad global y no recibe los
  filtros disponibles en `list`.
- El contrato afirma que `list --pending archive` previsualiza exactamente los
  candidatos de `archive --graduated`; esa equivalencia solo se cumple hoy si la
  consulta no usa filtros.
- `release plan` y `release record` también consideran colecciones, pero su
  unidad es una release del producto, no trabajo personal. Filtrarlas por owner
  produciría releases parciales con semántica distinta. Los demás mutadores de
  lifecycle operan sobre un id explícito.

## Proposal

Añadir `--owner <name>` y `--unowned` a `changeledger archive --graduated` con la
misma comparación exacta y exclusión mutua que `changeledger list`. La selección
de archivables se centralizará en una función común para que consulta y mutación
no puedan divergir:

```bash
changeledger list --pending archive --owner "Roberto Ruiz"
changeledger archive --graduated --owner "Roberto Ruiz"
```

Las opciones de owner solo son válidas junto con `--graduated`; combinarlas con
un id falla, porque el id ya determina exactamente el change. Sin filtro, la
acción conserva su significado actual de archivar todos los candidatos.

No se añade una graduación masiva. El contrato operativo explicitará que una
petición acotada como “gradúa todos mis changes” empieza por
`changeledger list --pending graduation --owner <name>` y procesa cada resultado
individualmente con `graduate --new`, `--into` o `--skip`. Así se filtra el
conjunto sin fingir que todas las decisiones de verdad persistente son iguales.

La revisión de comandos concluye que no debe añadirse owner a releases ni a
operaciones de un solo id. El alcance se limita al único mutador masivo de
changes: `archive --graduated`.

Alternativas descartadas:

- `graduate --all --skip`: convierte una decisión individual sobre verdad
  persistente en una acción homogénea y facilita skips injustificados.
- Inferir siempre el owner desde Git: el humano puede operar en nombre de otra
  persona y los valores existentes son nombres libres; el filtro debe ser
  explícito.
- Filtrar releases por owner: cambia la composición del producto publicado y no
  resuelve el problema observado.

## Specification

### CR1 — Archivar candidatos de un owner exacto
- **Given** changes archivables de owners `Roberto Ruiz` y `Ana`, y otro change de `Roberto Ruiz` aún pendiente de graduación
- **When** se ejecuta `changeledger archive --graduated --owner "Roberto Ruiz"`
- **Then** se archivan únicamente los changes archivables cuyo owner es exactamente `Roberto Ruiz`
- **And** no se archivan los de `Ana` ni el change todavía pendiente de graduación

### CR2 — Archivar candidatos sin owner
- **Given** un change archivable sin owner y otro con `owner: Ana`
- **When** se ejecuta `changeledger archive --graduated --unowned`
- **Then** se archiva únicamente el change sin owner

### CR3 — Rechazar combinaciones ambiguas
- **Given** cualquier repositorio ChangeLedger
- **When** se combina `--owner <name>` con `--unowned`
- **Then** el comando falla con `--owner and --unowned are mutually exclusive`
- **And** cuando `--owner` o `--unowned` se combina con un id sin `--graduated`, falla con `--owner and --unowned require --graduated`

### CR4 — Mantener equivalencia entre preview y acción
- **Given** un conjunto estable de changes de varios owners
- **When** se ejecuta `changeledger list --pending archive --owner "Roberto Ruiz"` y después `changeledger archive --graduated --owner "Roberto Ruiz"`
- **Then** la acción archiva exactamente los ids mostrados por la consulta
- **And** la misma equivalencia se cumple con `--unowned`

### CR5 — Conservar el comportamiento global explícito
- **Given** changes archivables de varios owners
- **When** se ejecuta `changeledger archive --graduated` sin filtro
- **Then** se archivan todos los candidatos, como antes del cambio

### CR6 — Guiar la graduación múltiple acotada
- **Given** un agente que ha leído el contexto core o close y recibe la orden de graduar todos los changes de `Roberto Ruiz`
- **When** selecciona el trabajo pendiente
- **Then** el contrato indica usar `changeledger list --pending graduation --owner "Roberto Ruiz"`
- **And** indica resolver individualmente cada id con `graduate --new`, `--into` o `--skip`
- **And** no presenta `graduate` como una acción masiva

### CR7 — Documentar el alcance del filtro
- **Given** la ayuda instalada del CLI
- **When** se ejecuta `changeledger archive --help`
- **Then** muestra `--owner <name>` y `--unowned` como filtros de `--graduated`
- **And** incluye un ejemplo de preview y acción con el mismo owner
- **And** `release --help` no ofrece un filtro por owner

## Plan

- [ ] Escribir primero tests de selección y extender `archiveGraduated()` en `src/commands/agent.mjs` con filtros compartidos con `list`; verify: `node --test test/agent.test.mjs` (CR1, CR2, CR4, CR5)
- [ ] Escribir primero tests del CLI y añadir opciones, guardas, salida y ejemplos en `bin/changeledger.mjs`; verify: `node --test test/cli-bin.test.mjs` (CR1, CR2, CR3, CR7)
- [ ] Actualizar `templates/contract/core.md`, `templates/contract/close.md` y `README.md` con el flujo multiowner; verify: `node --test test/context.test.mjs test/cli-bin.test.mjs` (CR4, CR6, CR7)
- [ ] Ejecutar el gate completo `pnpm verify` (support)

## Log

- **2026-07-18T10:54:57Z** — Draft autorizado por el humano tras detectar que una operación pedida por owner podía ampliar silenciosamente su alcance al archivar candidatos de otras personas.
- **2026-07-18T11:18:34Z** — status: draft → approved
- **2026-07-18T12:16:16Z** — status: approved → in-progress
- **2026-07-18T12:16:16Z** — owner → Roberto Ruiz (auto)
