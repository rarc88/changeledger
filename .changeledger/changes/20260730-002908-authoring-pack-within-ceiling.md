---
id: "20260730-002908"
title: El pack de autoría cabe en su techo decidido
type: refactor
status: approved
created: 2026-07-30T00:29:08Z
depends_on: ["20260730-002730"]
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

- [ ] Recortar `spec.md` (Stages sin tablas, Repository layout sin árbol ni sintaxis, IDs sin ejemplo, Authoring helpers fuera) y los menores de `readiness.md`, conservando el censo
  - **Target:** `templates/contract/spec.md`, `templates/contract/readiness.md`
  - **Verify:** `node --test test/context.test.mjs test/cli.test.mjs`
  - **Criteria:** CR2
- [ ] Mudar las 8 cláusulas de evidencia de `delegation.md` a `implement.md` y recortar la redundancia no normativa de `delegation.md`
  - **Target:** `templates/contract/delegation.md`, `templates/contract/implement.md`
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR2, CR3, CR4
- [ ] Bajar `budgets.yml` a `{2500, 250}` sin scaffold y retargetear los tests de forma del andamio y el pin de la matriz retirada
  - **Target:** `templates/contract/budgets.yml`
  - **Verify:** `node --test test/context.test.mjs test/contract.test.mjs`
  - **Criteria:** CR1, CR3
- [ ] Ejecutar el gate completo
  - **Verify:** `pnpm verify`
  - **Support:** cierre operativo

## Log
- **2026-07-30T09:46:33Z** `[status]` draft → approved (human via conversation)
