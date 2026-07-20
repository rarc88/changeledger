---
id: "20260714-150300"
title: Tolerar formateo Markdown en el bootstrap
type: bug
status: done
created: 2026-07-14T15:03:00Z
depends_on: []
owner: Roberto Ruiz
reviewed: true
archived: true
---

## Request

En repos consumidores, `changeledger register` instala un bloque bootstrap
administrado dentro de `AGENTS.md` y, cuando existe, `CLAUDE.md`. Herramientas
como Prettier reformatean automáticamente esos archivos antes del commit:
cambian el ajuste de línea del blockquote sin alterar sus instrucciones.

Después de ese formateo, `changeledger check` declara inválido el registro y
exige volver a ejecutar `changeledger register`. El ciclo se repite en proyectos
donde Lefthook aplica Prettier al hacer commit. El bootstrap debe conservar su
protección frente a cambios reales, pero no considerar obsoleto un bloque cuyo
único cambio sea el reflujo Markdown.

## Investigation

`checkContract()` llama a `applyBootstrap()` y sólo acepta el estado
`unchanged`. `replaceDelimited()` reconstruye el bloque canónico y decide ese
estado comparando todo el archivo byte a byte. Por eso cualquier salto de línea
que Prettier mueva dentro del blockquote produce `replaced`, aunque el Markdown
mantenga exactamente las mismas instrucciones.

El problema no está en Lefthook ni requiere integrar ChangeLedger con un
formateador concreto. Prettier ofrece delimitadores `prettier-ignore`, pero
emitirlos acoplaría el bootstrap a una herramienta particular y otros
formateadores podrían reproducir la misma fricción.

La comparación debe reconocer una equivalencia Markdown estrecha dentro del
bloque administrado. Para cada línea del blockquote se elimina únicamente el
prefijo estructural `>` con su espacio opcional; los saltos blandos consecutivos
dentro del mismo párrafo se unen con un solo espacio. Los párrafos separados por
una línea vacía del blockquote permanecen separados y el resto de los bytes de
contenido permanece significativo. Así se tolera que un formateador cambie el
ancho de línea o `>texto` por `> texto`, sin tolerar cambios de palabras,
espacios internos, código inline, orden, párrafos o estructura.

La versión de `BEGIN`, la presencia y orden de los delimitadores y el contenido
canónico continúan validándose. Una equivalencia de formato debe ser válida sin
reescribir el archivo; `register` sólo reemplaza el bloque cuando existe una
diferencia real o una versión obsoleta. La especificación persistente relacionada
es `contract-discovery`; los changes `#20260711-103803` y `#20260701-213931`
introdujeron los delimitadores y la comprobación estricta que ahora se refina.

## Specification

### CR1 — Check acepta reflujo equivalente
- **Given** un `AGENTS.md` con delimitadores de la versión vigente y el contenido canónico completo, pero con saltos blandos redistribuidos dentro de uno o más párrafos del blockquote y/o con el espacio opcional tras `>` cambiado
- **When** se ejecuta `changeledger check`
- **Then** el contrato no produce ningún error de referencia ausente u obsoleta

### CR2 — Register preserva el formato equivalente
- **Given** un repo registrado cuyo bloque bootstrap sólo difiere del canónico por los cambios de formato admitidos en CR1
- **When** se ejecuta `changeledger register`
- **Then** `AGENTS.md` y `CLAUDE.md`, cuando existe, permanecen byte a byte intactos
- **And** no se informa que el bootstrap estaba desactualizado
- **And** la ruta del repo se registra normalmente

### CR3 — Cambios de contenido siguen fallando cerrado
- **Given** un bloque de versión vigente donde se cambia una palabra o comando, se añade o elimina contenido, se altera un espacio interno, se reordena texto o se crea/elimina un límite de párrafo
- **When** se ejecuta `changeledger check`
- **Then** devuelve `<archivo> has an outdated ChangeLedger reference — run \`changeledger register\``
- **And** `changeledger register` restaura el contenido canónico preservando byte a byte todo lo situado fuera de los delimitadores

### CR4 — La equivalencia no oculta estructura o versión obsoleta
- **Given** un bloque con contenido textualmente equivalente pero una versión `BEGIN` anterior a la vigente, delimitadores ausentes/desordenados o una línea que no pertenece al blockquote administrado
- **When** se valida o registra el repo
- **Then** se conserva el comportamiento fail-closed vigente para esa estructura
- **And** una versión anterior se actualiza e informa como desactualizada

## Plan

- [x] Añadir fixtures y tests fallidos de reflujo en `test/contract.test.mjs`, luego implementar en `src/contract.mjs` la equivalencia estrecha del blockquote para `checkContract`; verify: `node --test test/contract.test.mjs` (CR1)
  - **Resolved:** `2026-07-14T15:09:16Z`
- [x] Añadir tests fallidos en `test/register.test.mjs`, luego ajustar `src/contract.mjs` para que `ensureReference` preserve bloques equivalentes en `AGENTS.md`/`CLAUDE.md` sin impedir el registro; verify: `node --test test/register.test.mjs` (CR2)
  - **Resolved:** `2026-07-14T15:09:16Z`
- [x] Añadir regresiones de contenido, párrafo, estructura y versión en `test/contract.test.mjs` y `test/register.test.mjs`, luego cerrar en `src/contract.mjs` cualquier equivalencia más amplia que el reflujo permitido; verify: `node --test test/contract.test.mjs test/register.test.mjs` (CR3, CR4)
  - **Resolved:** `2026-07-14T15:09:16Z`
- [x] Ejecutar `changeledger register` para refrescar el registro del propio repo sólo si el bloque canónico cambia y comprobar idempotencia; verify: `git diff --check && node bin/changeledger.mjs check` (support)
  - **Resolved:** `2026-07-14T15:09:41Z`
- [x] Ejecutar la puerta completa del repositorio; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-14T15:12:21Z`

## Log

- **2026-07-14T15:03:00Z** `[note]` Draft creado a partir de la fricción observada entre `changeledger register`, Prettier y Lefthook. Se descarta `prettier-ignore` a favor de equivalencia Markdown estrecha e independiente del formateador.
- **2026-07-14T15:05:04Z** `[status]` draft → approved
- **2026-07-14T15:05:51Z** `[status]` approved → in-progress
- **2026-07-14T15:05:51Z** `[owner]` set: Roberto Ruiz (auto)
- **2026-07-14T15:09:16Z** `[note]` Implementada equivalencia estrecha del blockquote: check acepta sólo reflujo y prefijo > equivalente; register preserva AGENTS.md/CLAUDE.md; mutaciones semánticas, estructura inválida y versiones antiguas siguen fallando cerrado. Tests enfocados y Biome verdes.
- **2026-07-14T15:12:22Z** `[note]` Puerta completa verde: Biome, 665 tests y changeledger check (192 changes). El primer intento detectó formato pendiente en tests; se aplicó Biome y la repetición pasó completa.
- **2026-07-14T15:14:06Z** `[note]` Regresión adicional confirma que la equivalencia no tolera cambios fuera del blockquote: perder el salto posterior a END sigue marcando la referencia como obsoleta. Puerta completa repetida: 665 tests y 192 changes verdes.
- **2026-07-14T15:14:06Z** `[status]` in-progress → in-review
- **2026-07-14T15:18:35Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-14T15:25:25Z** `[validation]` in-validation → done (human accepted)
- **2026-07-14T15:26:23Z** `[graduation]` spec: `contract-discovery.md`
- **2026-07-14T15:29:26Z** `[archive]` archived
