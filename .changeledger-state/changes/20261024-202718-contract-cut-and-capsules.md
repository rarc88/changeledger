---
id: "20261024-202718"
title: "El contrato baja a diez fragmentos y dos cápsulas: fuera §2.2, el aislamiento de correcciones y graduation-review; el estado global sale del core y nada fuera de .changeledger/ cita al ledger"
type: change
status: draft
created: 2026-10-24T20:27:18Z
depends_on:
  - "20261024-202659"
related_to:
  - "20261020-130304"
  - "20261023-181753"
  - "20261024-121022"
  - "20261007-135159"
  - "20260730-183520"
  - "20260729-143656"
  - "20260728-170429"
parent: "20261023-181733"
owner: raruiz-hiberuscom
---

## Request

Tras los dos primeros hijos de la épica, `templates/contract/` tiene 17
fragmentos Markdown más `budgets.yml`, 8.382 palabras y 11.927 tokens del
tokenizador de referencia; `core.md`, lo que carga todo agente en cada
mensaje, pesa 1.892 palabras, y el plan v1.0 (§5) lo quiere en ~960. Las
retiradas de octubre (`20261020-130304`) se autolimitaron a no decidir nada
de producto; los hijos `20261023-181753` y `20261024-121022` retiraron el
Definition of Ready y la matriz por tipo. Lo que queda del §2 es lo que sólo
se podía retirar con eso hecho: las cinco reglas del §2.2, el aislamiento de
correcciones y el delegado `graduation-review` del §2.3 —el primero asignado
al §13.1 y nunca hecho—, los dos fragmentos y seis cápsulas que duplican a
otros, y la semántica de `sync` que el §2.4 saca del core. Y lo que el §6 añade
a cambio: la regla de §6.3, porque la de §6.1 ya está en el core desde
`20261023-181753` y la de §6.2 la trae el hijo `[finding]` del que éste
depende.

El plan trae tres cifras que el código desmiente y que este draft corrige en
vez de heredar: `release.md` no aparece ni en la tabla de nueve fragmentos del
§5 ni en su lista de desaparecidos, así que el recorte deja diez; «8 de las 10
cápsulas» son 6 de 8 desde que `20261020-130304` retiró `audit` y
`post-review`; y el overlay `discarded` no tiene «1.250 tokens» (§2.1) sino
150.

### Objective

El contrato pesa lo que sus obligaciones necesitan y nada que un agente deba
buscar fuera de `.changeledger/` apunta al ledger. Terminado significa que,
medido en `templates/contract/`:

- quedan diez fragmentos: `core`, `spec`, `implement`, `review`, `close`,
  `delegation`, `release`, `global-state` y las dos cápsulas de revisión
  (`agent-contexts/review.md`, `agent-prompts/review.md`); desaparecen
  `handoff.md`, absorbido por `delegation.md`, `discarded.md`, cuyo contenido
  ya está dos veces en el core, y las seis cápsulas de `investigation`,
  `implementation` y `graduation-review`; `agent-context` y `agent-prompt`
  aceptan sólo `review` y la ayuda de la CLI lo dice;
- ninguna de las cinco reglas del §2.2 está en fragmento alguno: el estándar
  de cuantificadores universales con su contabilidad en implementador y
  revisor, «no copiar la checklist de la cápsula», «cifras y números de línea
  como datos a verificar», la restauración de mutantes editando y «cargar
  `context review` una sola vez»; el paso de cargar `context review` en la
  puerta ordenada se queda, sin el «una sola vez»;
- el aislamiento de correcciones no está: tras un `fail`, la corrección es
  una selección resuelta más, committeada antes de volver a `in-review`, y
  el revisor inspecciona de nuevo `baseline..HEAD`; las clases de commit son
  cuatro —Draft, Baseline, Implementation, Handoff—; el tercer round sigue
  devolviendo la decisión al humano;
- el rol `graduation-review` no existe en contrato ni en código
  (`AGENT_ROLES`, `ALLOWED_STATUSES`, ayuda); `close.md` no delega la
  reconciliación a nadie;
- la semántica de `cutover`, `activate` y `sync` vive en `global-state.md`,
  que `changeledger context` compone en el pack core sólo cuando el repo está
  activado, con techo propio en `budgets.yml`; un repo no activado no la
  carga;
- la regla del §6.3 está en vigor en tres sedes: el contrato la enuncia en
  una frase —ningún fichero fuera de `.changeledger/` contiene un id de change
  ni un `CRn`; la referencia va del change al código por `Target`, `Verify` y
  el marcador `[#id]` del commit—; la checklist del revisor verifica el
  comportamiento que la Specification declara y ya no recorre «every `CRn`»
  ni lo busca en los tests; y `hooks/pre-commit` de este repo rechaza una
  línea añadida fuera de `.changeledger/` que contenga un id o un `CRn`,
  nombrando fichero y línea, con el mismo grep corriendo en CI sobre
  `origin/dev...HEAD`; las referencias existentes se quedan como están;
- cada fragmento se reescribe al contenido que el §5 le asigna y cada captura
  —`context`, `context spec|implement|review|release`, el overlay `done` y
  las dos cápsulas— se mide con el tokenizador de referencia; los techos de
  `budgets.yml` bajan a lo medido y `PINNED_CEILINGS` lo refleja; donde una
  captura no alcanza la cifra del §5 sin retirar prosa normativa, el Log
  registra el hueco y la épica decide (AGENTS.md: un techo nunca es una meta);
- cada obligación que el plan conserva (§4) sigue en un fragmento nombrado y
  un grep de la obligación la encuentra ahí; los tests sobre el contrato son
  sólo de los cuatro tipos que AGENTS.md permite, los que pinan prosa
  retirada, fragmentos o roles borrados se retiran, y los estructurales se
  reapuntan al inventario nuevo;
- `README.md`, `CONTRIBUTING.md` y la ayuda de la CLI describen esta forma:
  dos roles de cápsula menos, sin aislamiento de correcciones, con la regla de
  §6.3 y el hook.

### Frontier

**Entra.** `templates/contract/**` y `templates/contract/budgets.yml`;
`src/commands/context.mjs` (`MODE_CONTEXT`, `STATUS_CONTEXT`, la composición
condicional de `global-state` y `packBudget`); `src/commands/agent-context.mjs`
(`AGENT_ROLES`, `ALLOWED_STATUSES`) y `src/commands/agent-prompt.mjs`;
`bin/changeledger.mjs` (ayuda de `agent-context`, `agent-prompt`, `context` y
los ocho ejemplos de ayuda que llevan un id, que pasan a un marcador);
`hooks/pre-commit`, un script bajo `scripts/` o `hooks/` que recibe `--cached`
o un rango, y el job de `.github/workflows/ci.yml` que lo ejecuta;
`README.md`, `CONTRIBUTING.md`; y los tests de esas superficies:
`test/context.test.mjs`, `test/contract.test.mjs`,
`test/agent-context.test.mjs`, `test/agent-prompt.test.mjs`,
`test/search.test.mjs`, `test/cli.test.mjs`, `test/cli-bin.test.mjs` y
`test/lifecycle.test.mjs` en los casos que pinan prosa, fragmentos, roles o
techos retirados (inventario en Investigation), más el test del hook.

**Queda fuera.** El mecanismo `[finding]` y sus tres frases de contrato, que
trae el hijo del que éste depende; `src/check.mjs`, que no lee el árbol
fuente (§6.3); el viewer; las opciones del §12 —`delegation.md` dentro del
core y la tabla de clases de commit—, que el humano decide con la medida en
la mano; `INTENT.md` y `docs/`, que son otro hijo; las specs, que reconcilia
la épica; el bootstrap de `AGENTS.md` y su `head -400`; los hooks de los repos
consumidores: ChangeLedger no empaqueta `hooks/`, así que la obligación va en
el contrato y este repo es la implementación de referencia que el README
enseña a copiar.

**Pre-autorizado.** Retirar cada test que sólo pine una frase retirada, un
fragmento o rol borrado o el techo de una entrada que desaparece, nombrándolo
en el Log; bajar techos y añadir la entrada de `global-state`; reapuntar los
tests estructurales de composición e inventario; reescribir los ejemplos de
ayuda con ids a un marcador; enmendar la Specification en `in-progress`
cuando el código desmienta lo previsto, registrándolo en el Log. Si cambia el
objetivo o la frontera, se vuelve al humano.

### Decisiones de forma que el plan deja abiertas

1. **`release.md` sobrevive y son diez fragmentos.** Sólo lo carga `context
   release`, pesa 214 palabras y ningún otro fragmento puede absorberlo sin
   cargar la release en el core.
2. **La viñeta de criterios de `spec.md` cae con el §2.2.** «A criterion that
   quantifies universally either covers its whole domain or narrows to what it
   verifies» es el mismo estándar aplicado a los CRs; lo que queda como regla
   de falsabilidad es «every `Then` states a fact measured at writing time».
3. **`global-state.md` se compone por activación.** `loadRepo` ya sabe si el
   repo tiene ref de estado; es el único «cuando aplica» que el código puede
   decidir sin configuración nueva. Un repo activado ve el core más
   `global-state`, con sus dos techos sumados en la línea `BEGIN`; uno no
   activado descubre `cutover` por `changeledger help`.
4. **Sin aislamiento, la re-revisión es una revisión.** La regla «una review
   de confirmación falla sólo por el defecto nombrado» se va con el bloque;
   el mandato del prompt, que ya existe, es como el orquestador acota una
   re-revisión si quiere.
5. **El hook mira líneas añadidas, no ficheros.** `git diff --cached -U0`
   filtrado por `^+`, patrones `\b\d{8}-\d{6}\b` y `\bCR\d+\b`, exentos
   `.changeledger/`, `.changeledger-state/` y `templates/contract/spec.md`
   (sus ejemplos de gramática). `docs/` no está exento: la narrativa cita
   changes por título o por `changeledger search`. Un test nuevo se nombra por
   el comportamiento que prueba, no por `<id> CRn`; la trazabilidad del change
   al test la lleva `Verify` de la tarea.
6. **`delegation.md` lleva el contrato de prompt escrito.** Sin esqueletos de
   `investigation` e `implementation`, los ítems que todo prompt declara
   —objetivo, frontera y ficheros, baseline a verificar, comando de
   verificación, formato de vuelta y la prohibición de delegar más— se
   enumeran ahí, en las ~200 palabras del §5 que absorben el triaje del
   handoff.
7. **Lo que no cabe se registra, no se recorta.** Sin las opciones del §12, el
   core difícilmente baja de ~1.700 palabras: la mayor parte de su peso está
   en el bloque de commits (392) y el ciclo (303), que el plan conserva. El
   Log mide el hueco por fragmento y la épica decide si abre el §12.

### Investigation

Mapa medido en `dev` (`3e1f23de`) por una investigación delegada de sólo
lectura, con el tokenizador pinado (`gpt-tokenizer`, `o200k_base`).

**Inventario y capturas.** Palabras por fragmento: `core` 1.892, `spec` 1.375,
`implement` 1.346, `review` 621, `close` 682, `delegation` 208, `handoff`
140, `discarded` 31, `release` 214, cápsulas 1.873 en ocho ficheros. Capturas
contra techo (tokens/líneas): `context` 2.687/2.750 y 209/275; `spec`
2.382/2.400; `implement` 2.484/2.500; `review` 1.106/1.150; `release`
432/500; overlay `done` 1.129/1.150; `discarded` 133/150; bloque
`core-commits` 549/600; `agent-prompt graduation-review` 527/600. Secciones
del core: Classify 171 palabras, Protect 288, Invariants 181, When no change
104, Exit gates 87, Ceiling 64, Commits 392, Lifecycle 303, Context modes 32,
Synchronizing 99, Discovery 112. `packBudget(mode)` publica sólo
`base[mode]` en la línea `BEGIN`; no existe ningún asiento de composición
condicional: `MODE_CONTEXT` y `STATUS_CONTEXT` son listas fijas y el último
filtro condicional, `fragmentsForType`, cayó con el readiness.

**Dónde está cada regla del §2.2.** Cuantificadores: `implement.md` «##
Evidence obligations» (lista de frases cuantificadas con el comando que
ejecutó su borde; corregir acota o borra), `review.md` (puntos de escrutinio;
«a universal quantifier … whose falsifying edge was not executed as a defect
that fails the review»), `agent-contexts/graduation-review.md` y la viñeta de
criterios de `spec.md`; pinadas por `DELEGATION_OBLIGATIONS` 2-5, 7 y 8 y
`DRAFTING_OBLIGATIONS` 2. «No copiar la checklist»: `review.md`, sin pin.
«Cifras como datos»: `implement.md`, sin pin. Mutantes: `implement.md`, sin
pin individual, pero el guard 11 exige ≥ 8 cláusulas en esa sección, que
quedarían en 6. «Una sola vez»: paso 6 de la puerta ordenada de
`implement.md` y «never reload one already held» del core; el regex de
`134702/122950 CR1/CR2` pina los nueve pasos en orden.

**Aislamiento de correcciones.** `implement.md` «## Correction isolation»
entero; `core.md` la clase **Correction** y «one more per confirmed
correction»; `review.md` «A pass leaves the change done … unless it confirms
uncommitted correction … A confirmation review fails only for the named
defect». Pins: guard 9, `DELEGATION_OBLIGATIONS` 6 y 9, `164620 CR3`, y un
comentario en `cli.test.mjs`. `graduation-review`: `close.md` (delegar antes
del primer `--into`), `core.md` (lista de roles), `agent-context.mjs`
(`AGENT_ROLES`, `ALLOWED_STATUSES`), `agent-prompt.mjs`, ayuda de `bin`, dos
plantillas; pins en `agent-context.test` (`152555 CR1/CR2/CR7`, regexes de
roles retirados), `agent-prompt.test` (`ROLES`, `152555 CR3`, CR3, CR4),
guards 18 y 19, `144327 CR5`, `cli-bin 134716 CR2` y `lifecycle 152555 CR8`.

**`handoff.md` y `discarded.md`.** El primero (140 palabras) lo componen
`implement` y `review`; pinado por `ownedHeadings` (`234939`) y `225213
CR4/CR5/CR7`. El segundo duplica `core.md` («terminal tombstone; never reopen
it», «The discard reason is required and logged … `discarded` never reopens»);
lo compone `STATUS_CONTEXT.discarded`, tiene techo `overlays.discarded` y
pins en `210543 CR2/CR8/CR9`, `225213 CR6`, `PINNED_CEILINGS`, `143656 CR4`
(inventario exacto de fragmentos: nueve de primer nivel y cuatro roles por
grupo) y `cli.test 171002`.

**`sync`.** `core.md` «## Synchronizing the global state» (99 palabras) más
la frase del ciclo «A branch that lands after the graduation is stamped by the
next `changeledger sync`» y el comando en `implement.md`; pinado por el guard
15, que exige las cuatro ideas en `pack('core')`, y por `124835 CR1`, que
pina los doce `##` del core en orden y su cuenta exacta.

**Sedes de las obligaciones conservadas (§4).** Revisión independiente:
`review.md`, fila del core, paso 7 de la puerta (guard 8). Aprobación humana:
core (matriz, guards 2 y 7) y `spec.md` (`approve` exige Objective y Frontier,
guard 5). Un concern con frontera: core (`181753 CR7`). Nunca en integración
ni release: `implement.md` (guards 20 y 22). Trazabilidad: core «## Commits».
Toda selección committeada antes de la revisión: core e `implement.md`
(`164620 CR2`). TDD: `implement.md` y la cápsula de implementación, que
desaparece —la frase se queda en `implement.md`. Reproducir el defecto y test
en rojo: `implement.md`. Graduación: `close.md` (guards 13 y 19). Un nivel de
delegación y un dueño por superficie: core y `delegation.md`. Taxonomía de
fallos: `review.md` (`CLASSIFICATION_OBLIGATIONS`). Triaje: `handoff.md`.
Tercer round y modelo de confianza: `review.md` (guard 14).

**Tests sobre el contrato.** `context.test.mjs` 175 casos en ejecución (131
declaraciones), `contract.test.mjs` 43, `agent-context.test.mjs` 26,
`agent-prompt.test.mjs` 12, `search.test.mjs` 16, más pins en `cli.test.mjs`
(`171002`, `214902`), `cli-bin.test.mjs` y `lifecycle.test.mjs`. Por tipo:
presupuestos (~25), composición estructural (~40, con `143656 CR4`, `124835
CR1-CR9`, la puerta ordenada y la matriz), barridos de frases retiradas
(~45), guards de concepto (21 `CONCEPT_GUARDS`, 6 `DRAFTING_OBLIGATIONS`, 9
`DELEGATION_OBLIGATIONS`, 1 `CLASSIFICATION_OBLIGATIONS`) y comportamiento de
comando, que no cambia. Fuera de los cuatro tipos: `20261020-130304 CR6`
pina dos frases literales de `implement.md` sobre la gramática de eventos, y
`20260728-170429 CR2/CR6` pina el párrafo de presupuestos de `AGENTS.md`.

**Referencias fuera de `.changeledger/` (§6.3).** Líneas con id de change o
`CRn`: `src` 144 (todas comentarios, cero literales de código; `agent.mjs`
26, `check.mjs` 20); `bin` 10, ocho de ellas ejemplos de ayuda con un id
(`changeledger context 20260630-225212` y similares); `templates` 5, todas
ejemplos de gramática en `spec.md`; `hooks` 0; `test` 3.654 líneas en 53 de
67 ficheros —1.854 de 2.002 declaraciones `test(` llevan id o `CRn` en el
nombre—; `docs` 118, casi todas en `workflow-hardening.md`; README,
CONTRIBUTING, AGENTS e INTENT ninguna. El incentivo que el plan nombra está
en `agent-contexts/review.md` («inspect the selected change, every `CRn`,
every Plan task, tests, the actual diff») y en `agent-prompts/review.md`
(«per-criterion PASS/FAIL»); ningún test pina «every `CRn`». El hook
`hooks/pre-commit` corre `lint-staged`, `pnpm test` y `check`, no lee el
índice él mismo, no está activado en este checkout (`core.hooksPath` sin
fijar; `CONTRIBUTING.md` documenta cómo) y `hooks/` no va en `files` de
`package.json`. CI ejecuta `pnpm verify` tras `activate` y `register`.

**Changes relacionados.** `20261007-135159` escribió el estándar de
cuantificadores que este change retira; `20260730-183520` hizo condicional
la checklist de la cápsula del revisor; `20260729-143656` sustituyó los pins
de hash por guards de obligación; `20260728-170429` creó los presupuestos en
tokens; `20261020-130304` fue el recorte anterior y retiró `audit` y
`post-review`.

### Proposal

#### Solución elegida

**Recorte por retirada, no por síntesis.** Cada fragmento pierde primero las
reglas que el §2 nombra —cuantificadores y su contabilidad, checklist,
cifras, mutantes, «una sola vez», aislamiento de correcciones,
`graduation-review`— y después se reescribe a la densidad del §5 sin soltar
ninguna obligación del §4; la Specification lista, por fragmento, qué sale y
a dónde va lo que se queda. `handoff.md` entra en `delegation.md` como triaje
de dos líneas que apunta a `[finding]`; `discarded.md` desaparece y
`STATUS_CONTEXT.discarded` deja de componer nada; `global-state.md` nace con
el texto de `sync` y la frase del ciclo, y `context` lo añade al pack core
cuando `loadRepo` devuelve estado.

**Cápsulas.** Se borran seis; `AGENT_ROLES` queda en `['review']`; la
cápsula del revisor pierde «every `CRn`» y gana «el comportamiento que la
Specification declara, en el diff y en los tests que lo prueban»; el
esqueleto de revisión conserva el mandato y la lista de puntos de escrutinio
que no sea la de frases cuantificadas.

**§6.3.** Una frase en `implement.md` («Git protects traceability»), el hook
con un script `--cached` o `<rango>` que CI ejecuta sobre `origin/dev...HEAD`
y un test que lo prueba en un repo de pruebas con una línea añadida con id,
otra con `CRn` y otra limpia en `spec.md`.

**Tests.** Los pins de prosa retirada se retiran con nombre en el Log; los
estructurales (`143656 CR4`, `124835 CR1`, `ownedHeadings`, `PINNED_CEILINGS`,
la puerta ordenada) se reapuntan; el guard 11 pasa a exigir las cláusulas
que sobreviven; ningún pin literal nuevo.

#### Alternativas descartadas

- **Un hijo por área (contrato, cápsulas, §6.3).** El inventario de
  fragmentos y roles es un solo test (`143656 CR4`) y las cápsulas se citan
  desde `core.md`, `review.md` y `close.md`: separarlas deja dos changes
  tocando los mismos tests y fragmentos.
- **Meter aquí `[finding]`.** Cuatro superficies —prosa, tests, código del
  Log, hook— en una pasada; el mecanismo tiene revisión propia y la frase que
  lo nombra sólo puede escribirse cuando existe.
- **Componer `global-state.md` en `implement` y `review` en vez del core.**
  `sync` al abrir sesión es el primer punto estratégico y vive en el core; lo
  que aplica no es el modo sino el repo.
- **Mantener `graduation-review` para la épica.** Es el delegado que el §2.3
  retira; la reconciliación de la épica la revisa el humano en el PR, y la
  observación D7 del hijo anterior (changes sólo de specs sin revisión) sigue
  abierta con él.
- **Meter el grep en `changeledger check`.** El plan lo excluye: obligaría a
  la herramienta a leer el árbol fuente de cada repo.

#### Escenarios

- **El día después.** Un agente abre sesión en un repo activado y lee el core
  con `global-state`; en uno no activado, sin él. Implementa, falla la
  revisión, committea la corrección como una selección más, vuelve a
  `in-review` y delega otra revisión completa. Encuentra algo fuera de la
  frontera y lo registra con `changeledger finding`. Nombra un test por lo
  que prueba; si escribe `CR3` en un comentario, el hook rechaza el commit
  nombrando fichero y línea.
- **Una captura no alcanza el §5.** El Log registra fragmento, cifra medida
  y objetivo; la épica decide si abre el §12 o corrige el objetivo. Nada se
  retira para caber.
- **Un test pina una frase que se reescribe.** Si es de los cuatro tipos, se
  reapunta; si es un pin literal, se retira y el Log lo nombra.

## Specification

## Plan

## Log
- **2026-10-24T20:27:18Z** `[version]` 0.19.0
