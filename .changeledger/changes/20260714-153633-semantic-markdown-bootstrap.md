---
id: "20260714-153633"
title: Comparar semánticamente el bootstrap Markdown
type: bug
status: done
created: 2026-07-14T15:36:33Z
depends_on: [ "20260714-150300" ]
owner: Roberto Ruiz
reviewed: true
---

## Request

El change `#20260714-150300` intentó evitar que un formateador invalidara el
bootstrap administrado por diferencias sin significado, pero la validación
sigue fallando en `/Users/raruiz/repositories/mine/ranchops`. Su `AGENTS.md` fue
formateado por Prettier 3.9.5 y `prettier --check AGENTS.md` confirma que ya está
en la forma canónica del proyecto; aun así, tanto ChangeLedger 0.11.1 como el
`check` de la rama que implementó el change anterior lo declaran obsoleto.

ChangeLedger debe comparar el significado Markdown del bloque, no imponer una
representación textual distinta de la que producen formateadores válidos.

## Investigation

La salida real de Prettier añade una línea vacía entre `BEGIN` y el blockquote,
otra antes de `END`, y transforma este fragmento:

```markdown
> After a compaction, verify a retained capture with `changeledger context
> [mode] --have <rev>` (the BEGIN line's `rev:`) instead of recapturing in
> full; a mismatch still returns the complete output.
```

en:

```markdown
> After a compaction, verify a retained capture with `changeledger context
[mode] --have <rev>` (the BEGIN line's `rev:`) instead of recapturing in
> full; a mismatch still returns the complete output.
```

CommonMark define la línea sin `>` como una *lazy continuation*: continúa el
párrafo ya abierto y pertenece al mismo blockquote. El árbol Markdown no cambia.
La implementación vigente (`normalizeBlockquote()` en `src/contract.mjs`)
rechaza cualquier línea que no cumpla `^> ?(.*)$` y también interpreta el
padding vacío como contenido inválido. Por eso la supuesta equivalencia sigue
siendo una comparación léxica incompleta.

La corrección debe proyectar el bloque real y `REFERENCE` a una representación
semántica producida por `marked.lexer()`, disponible ya como dependencia runtime.
La proyección elimina campos de representación como `raw`, ignora únicamente el
padding exterior y la posición de saltos blandos en texto de párrafo, y compara
tipos de token, anidamiento y valores significativos. El contenido administrado
debe parsear como un único blockquote; texto fuera de él no es equivalente. Los
tokens de código inline, enlaces y demás sintaxis conservan el valor que entrega
el parser, de modo que cambiar un comando o la estructura sigue fallando cerrado.

No se invoca Prettier ni se añade una dependencia del formateador. El fixture
exacto observado en `ranchops` queda versionado como regresión determinista. La
verdad persistente afectada continúa siendo `contract-discovery`.

## Specification

### CR1 — El fixture real de Prettier es equivalente
- **Given** un `AGENTS.md` con versión bootstrap vigente y el contenido exacto observado en `ranchops`: padding vacío dentro de los delimitadores, ajuste a 100 columnas y `[mode] --have <rev>` como lazy continuation sin `>`
- **When** se ejecuta `changeledger check`
- **Then** no produce ningún error de referencia ausente u obsoleta

### CR2 — Register preserva la representación equivalente
- **Given** `AGENTS.md` y `CLAUDE.md` con el fixture semánticamente equivalente de CR1
- **When** se ejecuta `changeledger register`
- **Then** ambos archivos permanecen byte a byte intactos
- **And** no se informa que el bootstrap estaba desactualizado
- **And** el registro local del repo se actualiza normalmente

### CR3 — La equivalencia sigue el árbol Markdown
- **Given** dos bloques de versión vigente que `marked.lexer()` interpreta como un único blockquote con los mismos tipos de token, anidamiento y valores significativos, pero difieren en padding exterior, prefijos lazy y posición de saltos blandos
- **When** se comparan durante `check` o `register`
- **Then** se consideran equivalentes sin reescritura
- **And** no se requiere que todas las líneas físicas empiecen por `>`

### CR4 — Diferencias semánticas fallan cerrado
- **Given** un bloque vigente donde se cambia `changeledger context`, un valor dentro de código inline, el texto o destino de un enlace, se añade/elimina/reordena contenido, cambia un límite de párrafo o aparece contenido parseado fuera del único blockquote
- **When** se ejecuta `changeledger check`
- **Then** devuelve `<archivo> has an outdated ChangeLedger reference — run \`changeledger register\``
- **And** `changeledger register` restaura el bloque canónico preservando byte a byte el contenido externo a los delimitadores

### CR5 — Delimitadores y versión permanecen estrictos
- **Given** contenido semánticamente equivalente con una versión `BEGIN` distinta de la vigente, un delimitador ausente/duplicado/desordenado o texto unido a la línea de un delimitador
- **When** se valida o registra el repo
- **Then** se conserva el comportamiento fail-closed vigente
- **And** una versión anterior se actualiza e informa como desactualizada

## Plan

- [x] Añadir el fixture exacto de Prettier 3.9.5 como test fallido en `test/contract.test.mjs`, luego sustituir en `src/contract.mjs` la normalización por líneas por una proyección de tokens de `marked.lexer()`; verify: `node --test test/contract.test.mjs` (CR1, CR3) — 2026-07-14T15:55:49Z
- [x] Añadir tests fallidos en `test/register.test.mjs`, luego ajustar la integración de equivalencia en `src/contract.mjs` para preservar `AGENTS.md`/`CLAUDE.md` y completar el registro sin warning; verify: `node --test test/register.test.mjs` (CR2) — 2026-07-14T15:55:49Z
- [x] Añadir una matriz de mutaciones semánticas y estructurales en `test/contract.test.mjs` y `test/register.test.mjs`, luego cerrar en `src/contract.mjs` cualquier proyección más amplia que el árbol permitido; verify: `node --test test/contract.test.mjs test/register.test.mjs` (CR4, CR5) — 2026-07-14T15:55:49Z
- [x] Ejecutar el CLI de esta rama contra `/Users/raruiz/repositories/mine/ranchops` sin modificarlo y confirmar que `check` pasa mientras Prettier mantiene el archivo canónico; verify: `node /Users/raruiz/repositories/mine/spec-ledger/bin/changeledger.mjs check` desde `ranchops` (support) — 2026-07-14T15:55:49Z
- [x] Ejecutar la puerta completa del repositorio; verify: `pnpm verify` (support) — 2026-07-14T15:56:27Z

## Log

- **2026-07-14T15:36:33Z** — Draft creado tras reproducir el fallo en `ranchops`: Prettier 3.9.5 emite padding y una lazy continuation CommonMark válida que la normalización léxica de `#20260714-150300` rechaza. Se elige comparación por tokens Markdown con `marked`, no integración con Prettier.
- **2026-07-14T15:50:54Z** — status: draft → approved
- **2026-07-14T15:51:28Z** — status: approved → in-progress
- **2026-07-14T15:51:28Z** — owner → Roberto Ruiz (auto)
- **2026-07-14T15:55:50Z** — Implementada proyección semántica con marked: un único blockquote, tokens y valores significativos preservados, saltos blandos normalizados y padding exterior ignorado. Marcadores duplicados o fuera de línea fallan cerrado. 23 tests enfocados y prueba real contra ranchops/Prettier verdes sin modificar ranchops.
- **2026-07-14T15:56:28Z** — Puerta completa verde: Biome, 669 tests y 194 changes válidos.
- **2026-07-14T15:58:39Z** — Reforzada la proyección para fallar cerrado ante tipos de token no modelados; puerta completa repetida: Biome, 669 tests y 194 changes válidos.
- **2026-07-14T15:58:51Z** — status: in-progress → in-review
- **2026-07-14T16:03:01Z** — review → in-validation (delegated subagent, clean context)
- **2026-07-14T16:07:04Z** — validation → done (human accepted)
- **2026-07-14T16:08:14Z** — graduado a spec `contract-discovery.md`
