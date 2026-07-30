---
id: "20260730-002908"
title: El pack de autoría cabe en su techo decidido
type: refactor
status: done
created: 2026-07-30T00:29:08Z
depends_on: ["20260730-002730"]
archived: true
reviewed: true
related_to: ["20260729-162015", "20260728-212043"]
owner: raruiz-hiberuscom
---

## Request

El techo decidido para todo contexto de modo es 2500 tokens; `base.spec` vive
en un andamio de 3450 desde [#20260728-212043] cuya condición de salida — la
refactorización del pack de autoría — se consumió dos veces sin ejecutarse
(acta §16.4). El pack mide hoy 3445/3450 tokens y 320/345 líneas: 5 tokens de
margen, y es el pack con el que se diseñan todos los drafts. Se pide la
refactorización: el pack baja a **2500 tokens / 250 líneas**, el andamio y su
comentario (rancio: afirma 3416/317) desaparecen, y **ninguna obligación
normativa se pierde** — la regla de `AGENTS.md` aplica literal: una regla solo
sale de un fragmento si su sede nueva queda nombrada y un grep de la propia
obligación la encuentra allí.

Depende de [#20260730-002730]: reescribir esta prosa bajo el régimen de pins
de frase pagaría el máximo de la ceremonia que esa decisión retira.

## Proposal

**Composición medida (investigación fresca contra HEAD):** el pack compone
`spec.md` (2133 tokens / 198 líneas) + `delegation.md` (583/57) +
`readiness.md` (634/54) + enmarcado (~92/15). Hay que recortar ~945 tokens.
Desglose de `spec.md` por sección: Stages 513, Change document 320, Plan task
grammar 351, ejemplo CR1 234, Repository layout 250, Authoring helpers 164,
Log grammar 150, IDs and language 129.

**Los cortes, con su clasificación (normativo se queda, descriptivo sale):**

- **`## Authoring helpers` sale entera** (164): lista de comandos descubrible
  por `changeledger --help`; su única idea normativa ("the commands support
  the file contract rather than replacing it") ya vive como "Files remain the
  source of truth" en Repository layout.
- **`## Stages` pierde sus dos tablas** (~300): la tabla heading/propósito y
  la matriz de activación son un render de `config.yml`, que el propio texto
  declara autoritativo. Sobreviven las oraciones normativas censadas
  (headings ingleses en orden y solo si el tipo los activa; matriz configurada
  autoritativa; Investigation=causa raíz para bugs; la regla completa de
  `quick`; el bloque de `search`+clasificación de relaciones; Mermaid).
  Consecuencia: `141119 CR5` (pin de la fila `refactor` de la matriz contra
  config) se retira con la tabla — la consistencia queda garantizada por
  config como sede única.
- **`## Repository layout and creation` pierde el árbol ASCII y la sintaxis de
  `new`** (~100): descubribles por CLI. Sobreviven: slug estructural inglés;
  files-source-of-truth; el bloque completo de "One concern per change"; la
  regla de aprobación explícita en conversación.
- **`## IDs and language` pierde el ejemplo de derivación y la racional de
  ordenación** (~60). Sobreviven: forma del filename; qué es siempre inglés;
  qué sigue el idioma configurado.
- **El bloque de las 8 cláusulas de evidencia se muda de `delegation.md` a
  `implement.md`** (~181 fuera del pack spec): el autor no ejecuta el contrato
  de evidencia — lo llevan los prompts vía cápsulas `agent-prompt`, y el pack
  implement lo sigue sirviendo (2143 + 181 = ~2324 ≤ 2500). **Supersede
  parcialmente la decisión de [#20260729-162015]** (el bloque llegaba a spec e
  implement); queda a confirmación de Roberto al aprobar. La entrada 11 del
  guard curado pasa a exigirlo solo en implement. Sin ficheros nuevos ni
  renombrados: el inventario de `143656 CR4` pasa sin edición.
- **`delegation.md` y `readiness.md` recortes menores** (~100): redundancias
  no normativas; las cinco condiciones numeradas de Definition of Ready se
  quedan íntegras.

Estimación: ~3445 − (164+300+100+60+181+100) ≈ **2540, contra techo 2500** —
apretado y se mide al implementar, no se supone; si una obligación censada no
cabe, se para y se pregunta antes de vaciar normativa (regla de `AGENTS.md`).

**Alternativas descartadas.** (a) Subir el techo a 3450 definitivo: contradice
la decisión de tres números de §10. (b) Partir el pack en dos capturas:
duplica enmarcado y rompe la carga de una pasada. (c) Mover secciones a un
fragmento nuevo servido aparte: fichero nuevo rompe el inventario pinneado y
añade una carga más al flujo de autoría.

## Specification

Interfaces externas: ninguna nueva. Los consumidores del pack son agentes
leyendo `changeledger context spec`; el head de modos (350) no cambia.

### CR1 — El pack cabe y el andamio desaparece
- **Given** `changeledger context spec` tras el refactor
- **When** se mide con el tokenizador pinneado y la línea BEGIN
- **Then** `base.spec` declara `{tokens: 2500, lines: 250}` sin clave
  `scaffold`, la captura cabe (hoy, medido: 3445/3450 y 320/345 con andamio), y
  los tests de forma se retargetean: el de "solo spec lleva scaffold" pasa a
  afirmar que **ninguna** entrada lleva scaffold, y el pin de la excepción de
  `212043 CR7` deja de nombrar a spec como excepción

### CR2 — Ninguna obligación censada se pierde
- **Given** el censo de oraciones normativas de la Investigation delegada
  (Stages: 6 bloques; Repository layout: 4; IDs: 3; Definition of Ready: los 5
  numerados; delegation: las kept de la doctrina más las 8 cláusulas de
  evidencia)
- **When** se grepea cada obligación censada sobre los packs servidos tras el
  refactor
- **Then** cada una se encuentra en su sede nombrada — las 8 cláusulas de
  evidencia en el pack implement — y cada recorte queda listado en el Log como
  descriptivo con su razón (tabla-render-de-config, CLI-descubrible, ejemplo)

### CR3 — La estructura de composición no se rompe
- **Given** la suite tras el refactor
- **When** corren el inventario de fragmentos y el barrido recursivo de
  `143656 CR4`, el check `ownedHeadings` y los presupuestos de todos los packs
- **Then** pasan sin edición — sin ficheros nuevos, renombrados ni borrados —
  y el pack implement queda dentro de su techo 2500/250 con el bloque de
  evidencia absorbido

### CR4 — El review no gana el bloque de evidencia
- **Given** `changeledger context review` tras el refactor
- **When** se busca cualquiera de las 8 cláusulas del contrato de evidencia
- **Then** ninguna aparece — la mudanza a `implement.md` no ensancha el pack
  del revisor, cuyas obligaciones propias siguen llegando por `review.md`

## Plan

- [x] Recortar `spec.md` (Stages sin tablas, Repository layout sin árbol ni sintaxis, IDs sin ejemplo, Authoring helpers fuera) y los menores de `readiness.md`, conservando el censo
  - **Target:** `templates/contract/spec.md`, `templates/contract/readiness.md`
  - **Verify:** `node --test test/context.test.mjs test/cli.test.mjs`
  - **Criteria:** CR2
  - **Resolved:** `2026-07-30T11:48:01Z`
- [x] Mudar las 8 cláusulas de evidencia de `delegation.md` a `implement.md` y recortar la redundancia no normativa de `delegation.md`
  - **Target:** `templates/contract/delegation.md`, `templates/contract/implement.md`
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR2, CR3, CR4
  - **Resolved:** `2026-07-30T11:48:01Z`
- [x] Bajar `budgets.yml` a `{2500, 250}` sin scaffold y retargetear los tests de forma del andamio y el pin de la matriz retirada
  - **Target:** `templates/contract/budgets.yml`
  - **Verify:** `node --test test/context.test.mjs test/contract.test.mjs`
  - **Criteria:** CR1, CR3
  - **Resolved:** `2026-07-30T11:48:01Z`
- [x] Ejecutar el gate completo
  - **Verify:** `pnpm verify`
  - **Support:** cierre operativo
  - **Resolved:** `2026-07-30T11:48:01Z`

## Log
- **2026-07-30T09:46:33Z** `[status]` draft → approved (human via conversation)
- **2026-07-30T11:08:45Z** `[status]` approved → in-progress
- **2026-07-30T11:26:21Z** `[note]` Parada honesta en CR1 conforme al mandato del propio documento: tras todos los cortes autorizados (medidos corte a corte: 164+230+63+36+174+67 = 734 contra 945 estimados) el pack mide 2711 tokens / 256 líneas contra el techo 2500/250. El censo de 48 obligaciones normativas grepa completo en los packs servidos; implement absorbió las 8 cláusulas y BAJÓ a 2122/190; review byte-idéntico. budgets.yml deliberadamente intacto para mantener el gate verde. Palancas no gastadas, todas de la clase ejemplo-copiable que 20260730-002730 pinnea como deliberadamente conservada en un caso (el fence de Verify): frontmatter YAML 125/13, plantilla de tarea del Plan 141/15, fence de evento de Log 60/4, plantilla de CR1 42/7 — 368/39 en total. Hallazgo del implementador: son CUATRO los tests de forma con la excepción del andamio, no tres (170429 CR1 también). Decisión elevada a Roberto.
- **2026-07-30T11:34:56Z** `[note]` Autorización de Roberto (2026-07-30) para refinar el alcance sin forzar el techo: no se corta ningún fence de ejemplo; en su lugar, responsabilidad única del pack — la gramática de eventos del Log se muda a implement.md (los eventos los escriben los comandos del lifecycle, no el autor del draft), la mecánica de resolución de owner se recorta a su semántica de autoría, y la delegación servida en spec se afina a lo que el autor usa (delegar investigación). Condición explícita de la autorización: no afectar a la elaboración integral de los drafts — toda obligación que un autor necesite sigue servida en spec, el censo viaja con cada movimiento con sede nueva nombrada y grep, y los guards de concepto siguen verdes. Con esto CR1 se completa: budgets.yml baja a {2500,250} sin scaffold, con holgura real medida (~150), y los CUATRO tests de forma se retargetean.
- **2026-07-30T11:45:11Z** `[note]` Corrección de una cifra mía: la nota de autorización anticipaba 'holgura real medida (~150)' — era estimación, no medida, y la señaló el implementador como residuo. Medido tras las tres mudanzas: 2467/240, holgura 33/10; con la cuarta palanca autorizada por el orquestador (la regla estructural de Resolved/Blocked, 64 tokens, misma clase que la gramática del Log: la escribe changeledger task, no el autor; el fence de ejemplo se queda en spec) se espera ~2403/236 con holgura ~97/14. La decisión queda vetable por Roberto. Supersede a registrar de la ronda: D6 (review-is-special) se sirve ahora por implement+review, no por spec — el censo de CR2 lo listaba en spec; movimiento con sede grepada, no pérdida.
- **2026-07-30T11:48:21Z** `[note]` Selección única resuelta en tres rondas con dos paradas honestas. Final medido: spec 2403 tokens / 239 líneas (holgura 97/11 contra el techo decidido 2500/250, desde 3445/320: −1042), implement 2293/198 absorbiendo el bloque de evidencia, la gramática del Log y la regla estructural de Resolved/Blocked, review 866/80 byte-idéntico a baseline. budgets.yml en {2500,250} sin clave scaffold en ningún sitio; los cuatro tests de forma retargeteados con rojo-verde por mutante único, y 212043 CR7 quedó estrictamente más fuerte (barrido de scaffold sobre el fichero entero). Censo 47/48 con delta única autorizada: D6 (review-is-special) re-sedado en implement+review — supersede parcial del enunciado del censo de CR2, con grep de la sede nueva. Cortes medidos contra estimaciones ronda a ronda en este Log; ningún fence de ejemplo tocado; guard 12 y los 18 tolerantes verdes. Suites 1012/1012, check exit 0, lint limpio.
- **2026-07-30T11:48:21Z** `[note]` Mandato de review, registrado antes de delegar: auditoría del rango por revisor fresco top-tier. Puntos de escrutinio: (1) el censo de 48 obligaciones re-derivado independientemente — cada una servida en el pack que la posee, en especial las cuatro mudanzas a implement (evidencia, Log, Resolved/Blocked, owner-mecánica recortada) y que NINGUNA obligación de autoría salió de spec (condición explícita de Roberto); (2) la cadena de autorizaciones (dos paradas honestas + palanca del orquestador vetable) contra el alcance aprobado; (3) el supersede de D6 frente a la letra de CR2; (4) los cuatro retargets de forma y el CR7 reforzado; (5) review byte-idéntico y sin las 8 cláusulas (CR4); (6) que la holgura es real y ninguna prosa normativa se recortó para cuadrar número; (7) las notas de este Log al estándar del implementador — incluida la corrección de mi ~150 estimado como medido.
- **2026-07-30T11:48:21Z** `[status]` in-progress → in-review
- **2026-07-30T12:05:14Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-30T12:05:15Z** `[note]` Cierre del conjunto de CR2 que el review señaló: razones de los seis cortes originales, restatadas — Authoring helpers (descubrible por CLI, su regla vive en files-source-of-truth), tabla heading/propósito (glosa de prosa, sin obligación), matriz de activación (render de config.yml, que sigue pinneado en ambos configs por los dos asserts vivos de 141119), árbol ASCII y sintaxis de new (descubribles por CLI; el layout lo sirve core), ejemplo de derivación de id y racional de ordenación (informativos), bloque de evidencia (mudanza con sede implement grepada). Hallazgos no bloqueantes registrados: la racional 'via cápsulas agent-prompt' del Proposal era imprecisa — la sede que funciona es el pack implement que el orquestador lee al delegar; CLAUDE.md-opcional desapareció con el árbol sin quedar nombrado en ningún fragmento (sin obligación adjunta; candidato menor al barrido de verdad persistente); nit de dos puntos apilados en implement.md; el acta describe la salida del andamio como pendiente y debe actualizarse al archivar este change.
- **2026-07-30T12:09:19Z** `[validation]` in-validation → done (human accepted via conversation)
- **2026-07-30T12:09:19Z** `[note]` Flecos del review cerrados antes de la aceptación, autorizados por Roberto ('hagámoslo de una vez'): el nit de dos puntos apilados en implement.md corregido (suites 196/196, techos intactos 239/250 y 198/250), y la spec contract-discovery actualizada en la graduación — afirmaba 'un test exige esa marca' cuando el barrido ahora exige su ausencia; la doctrina del andamio queda como procedimiento para excepciones futuras y la salida del último andamio queda fechada.
- **2026-07-30T12:09:19Z** `[graduation]` spec: `contract-discovery.md`
- **2026-07-30T12:09:53Z** `[archive]` archived
