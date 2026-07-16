---
id: "20260715-122950"
title: Preservar formato tras mutaciones del lifecycle
type: bug
status: done
created: 2026-07-15T12:29:50Z
depends_on: [ "20260616-151230", "20260616-174430" ]
archived: true
reviewed: true
owner: raruiz-hiberuscom
---

## Request

Una mutación obligatoria del lifecycle puede invalidar el gate de formato que el
repositorio acaba de superar. `changeledger status` y los veredictos de review
modifican el change después de las verificaciones: el writer normaliza también
YAML no relacionado y `appendLog` añade texto nuevo que el formatter local puede
redistribuir. El resultado obliga a reformatear y verificar de nuevo antes del
commit o de la validación humana, aunque la implementación no haya cambiado.

## Investigation

- `writer.mjs` parsea el frontmatter con `yaml.parseDocument()`, muta el AST y
  llama `doc.toString({ lineWidth: 0 })`. La serialización cubre todo el bloque:
  por ejemplo, una entrada `depends_on: ["A", "B"]` pasa a
  `depends_on: [ "A", "B" ]` al cambiar únicamente `status`.
- Esto contradice `specs/data-model.md`, que promete preservación del formato
  textual, y la decisión del change `20260616-151230`, que descartó reserializar
  todo el frontmatter por el churn sobre documentos históricos.
- El refactor `20260616-174430` sustituyó la edición textual por serialización
  completa para no confundir una clave raíz con texto dentro de escalares
  multilineales o mappings anidados. Sus tests prueban seguridad semántica, pero
  no que las regiones ajenas permanezcan byte-for-byte intactas.
- El paquete `yaml` permite conservar tokens fuente con `keepSourceTokens`;
  cada token CST expone `offset` y `source`. Es posible usar el parser para
  identificar con seguridad la pareja raíz y aplicar un parche solo sobre su
  rango textual, sin volver a un regex que pueda tocar `metadata.status` o un
  bloque literal.
- `appendLog` inserta cada evento como una sola línea. Una herramienta Markdown
  puede replegar eventos o razones largas. ChangeLedger no debe ejecutar un
  `format_command` arbitrario: acoplaría el núcleo local-first a procesos
  externos, añadiría fallos y concurrencia fuera de la mutación atómica y no
  podría representar todos los formatters de los repositorios consumidores.
- El gate documentado en `templates/contract/implement.md` verifica las tareas
  antes de `status ... in-review`; después, tanto esa transición como
  `changeledger review ...` vuelven a escribir el ledger. Falta una validación
  explícita posterior a las mutaciones que forman parte del resultado entregado.

La solución combina dos garantías del mismo flujo: mutaciones de frontmatter
quirúrgicas, dirigidas por el parser, y gates del repositorio ejecutados sobre el
estado realmente entregado. La segunda cubre el texto nuevo del Log y cualquier
formatter local sin convertirlo en una dependencia de ChangeLedger.

## Specification

### CR1 — Status preserva el frontmatter ajeno
- **Given** un change válido cuyo frontmatter raíz contiene `status: in-progress`, `depends_on: ["A", "B"]`, comentarios y estilos de quoting propios
- **When** `setStatus` cambia el estado a `in-review`
- **Then** cambia únicamente la representación textual del valor raíz de `status`
- **And** todos los bytes del frontmatter anteriores y posteriores a ese valor permanecen idénticos

### CR2 — Campos opcionales preservan regiones no relacionadas
- **Given** un frontmatter válido con comentarios, colecciones flow sin padding, escalares multilineales y mappings anidados
- **When** `setOwner`, `setArchived` o `setReviewed` añade, actualiza o elimina su campo raíz
- **Then** solo cambia la pareja objetivo y, al añadirla, se coloca después de `depends_on` según el modelo canónico
- **And** las demás parejas y el cuerpo Markdown permanecen byte-for-byte idénticos

### CR3 — Updated es una mutación textual acotada
- **Given** una spec válida con `updated: 2020-01-01T00:00:00Z`, comentarios y `tags: [architecture]`
- **When** `setSpecUpdated` recibe `2026-07-15T12:00:00Z`
- **Then** reemplaza únicamente el valor raíz de `updated`
- **And** conserva exactamente el estilo de `tags`, los comentarios y el cuerpo

### CR4 — La seguridad estructural no retrocede
- **Given** un documento con un bloque literal que contiene `status: texto`, un mapping `metadata.status` y una única clave raíz `status`
- **When** una mutación de frontmatter modifica `status`
- **Then** solo modifica la clave raíz identificada por el parser YAML
- **And** claves requeridas ausentes, claves duplicadas o YAML inválido fallan sin escribir el archivo

### CR5 — Review verifica el estado previo al veredicto
- **Given** un change `in-progress` cuyo tipo requiere review y un repositorio con formatter y gates locales
- **When** termina la implementación
- **Then** el contrato ordena mover a `in-review`, aplicar el formatter local y ejecutar los gates completos antes de delegar la revisión independiente
- **And** el reviewer inspecciona el mismo contenido ya formateado y verificado

### CR6 — La entrega verifica la última mutación
- **Given** un veredicto de review que añade un evento al Log y mueve el change a `in-validation`
- **When** el orquestador prepara el commit o solicita validación humana
- **Then** el contrato ordena aplicar el formatter local y repetir los checks afectados por la mutación, incluido `changeledger check`
- **And** los tipos sin review aplican la misma regla después de su transición directa a `in-validation`

### CR7 — El núcleo permanece agnóstico al formatter
- **Given** un repositorio consumidor con cualquier formatter o sin formatter
- **When** ChangeLedger ejecuta una mutación del ledger
- **Then** ChangeLedger no ejecuta hooks ni comandos externos configurables como efecto lateral de la mutación
- **And** el agente anfitrión conserva la responsabilidad de ejecutar los gates definidos por el repositorio

## Plan

- [x] Actualizar src/writer.mjs y test/writer.test.mjs con el ciclo TDD para que `status` preserve byte-for-byte el YAML válido ajeno mediante su token CST; verify: node --test test/writer.test.mjs (CR1, CR4) — 2026-07-15T13:12:21Z
- [x] Escribir en `test/writer.test.mjs` los fallos de inserción, actualización y borrado de campos opcionales; implementar en `src/writer.mjs` parches de parejas raíz dirigidos por AST/CST sin reserializar regiones ajenas; verify: `node --test test/writer.test.mjs` (CR2, CR4) — 2026-07-15T13:12:22Z
- [x] Escribir en `test/writer.test.mjs` el fallo de preservación de `tags` y comentarios al actualizar una spec; adaptar `setSpecUpdated` en `src/writer.mjs` al reemplazo acotado; verify: `node --test test/writer.test.mjs` (CR3, CR4) — 2026-07-15T13:12:22Z
- [x] Añadir en `test/agent.test.mjs` regresiones integradas de `status` y `review` sobre frontmatter con estilo no canónico válido; verify: `node --test test/agent.test.mjs` (support) — 2026-07-15T13:12:22Z
- [x] Actualizar `templates/contract/implement.md`, `templates/contract/review.md` y `templates/contract/validation.md` con los gates posteriores a transición y veredicto; cubrir la composición del contexto en `test/context.test.mjs`; verify: `node --test test/context.test.mjs` (CR5, CR6, CR7) — 2026-07-15T13:12:22Z
- [x] Alinear `.changeledger/specs/data-model.md` y `.changeledger/specs/lifecycle.md` con la preservación textual dirigida por parser y la responsabilidad de gates posterior a mutaciones; verify: `changeledger check 20260715-122950` (CR1, CR5, CR6, CR7) — 2026-07-15T13:12:22Z
- [x] Ejecutar `pnpm verify` y confirmar que el repositorio completo permanece verde (support) — 2026-07-15T13:13:52Z

## Log

- **2026-07-15T12:29:50Z** — Draft creado a partir de una fricción reproducida en un repositorio consumidor: una mutación obligatoria del lifecycle invalida su gate de formato ya superado. Se mantiene un solo bug porque preservación textual y orden de gates protegen el mismo resultado observable; se descarta integrar un `format_command` en el núcleo.
- **2026-07-15T12:45:13Z** — status: draft → approved
- **2026-07-15T13:06:38Z** — status: approved → in-progress
- **2026-07-15T13:06:38Z** — owner → raruiz-hiberuscom (auto)
- **2026-07-15T13:06:39Z** — Implementation started on codex/resolve-approved-changes after #20260715-124113 reached in-validation.
- **2026-07-15T13:12:23Z** — TDD complete: writer preservation tests failed under full YAML reserialization, then passed with parser-directed source-range patches; integrated agent/context suites pass (104 tests).
- **2026-07-15T13:13:52Z** — Full quality gate passed outside sandbox: Biome, 679/679 tests, and ChangeLedger check.
- **2026-07-15T13:13:52Z** — status: in-progress → in-review
- **2026-07-15T13:19:14Z** — review → in-validation (delegated subagent, clean context)
- **2026-07-16T13:37:29Z** — validation → done (human accepted)
- **2026-07-16T13:39:26Z** — graduado a spec `data-model.md`
- **2026-07-16T13:39:36Z** — archived
