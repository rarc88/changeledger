---
id: "20260729-203257"
title: "Gramática del Plan por tags: Target, Verify y Criteria"
type: feature
status: done
created: 2026-07-29T20:32:57Z
depends_on: []
archived: true
reviewed: true
related_to: ["20260728-194157", "20260720-125007", "20260729-185200"]
owner: raruiz-hiberuscom
release_impact: minor
---

## Request

El parseo posicional de las tareas del Plan pierde información en silencio y el
requisito de readiness es evadible por construcción. Se pide:

1. Gramática por tags — campos estructurados `**Target:**`, `**Verify:**`,
   `**Criteria:**` — en vez de deducir la traza del último grupo entre
   paréntesis de la línea física.
2. Parser inmune al reflow: las líneas de continuación se unen a su tarea, no se
   descartan.
3. Toda línea de Plan que no se pueda decidir produce un issue nombrado, nunca
   un descarte silencioso.
4. Migración determinista del corpus existente vía `changeledger fix`.
5. Readiness por campo: `target_patterns` juzga solo el Target y
   `verification_patterns` solo el Verify, cerrando la vacuidad de casar ambas
   listas sobre el mismo texto.

Decidido como el candidato más rentable de la iniciativa de endurecimiento: la
clase golpeó tres veces en una sesión al redactar changes reales, y hoy bloquea
la aprobación de [#20260728-194157] (un change cuyo entregable es enteramente
una guarda de test no tiene forma legal de pasar readiness). Fuera de alcance,
explícitamente: tocar `readiness.target_patterns` de este repo (eso es de
[#20260728-194157]) y formatear `.changeledger/**` con Prettier (change
posterior que esta inmunidad al reflow desbloquea).

## Investigation

Investigación fresca contra HEAD del 2026-07-29 (delegada, con reproducciones
ejecutadas), tras `changeledger search`: la gramática vigente de metadatos
estructurados la introdujo [#20260720-125007]; el gate de severidad
draft→approved lo introdujo [#20260729-185200] y este diseño se apoya en él.

**Pérdidas silenciosas del parser (`parseTaskBlocks`, `src/task.mjs`) —
confirmadas ejecutándolo:**

- La extracción de criterios (`taskContent`) casa solo el **último** grupo entre
  paréntesis de la línea física. `- [ ] Do things (CR1) (support)` produce
  `criteria: []` — el grupo final es `(support)`, la regex entera no casa y CR1
  se pierde sin diagnóstico.
- Una tarea envuelta a segunda línea física acabando en `(CR2)` pierde la
  continuación y el criterio, con `issues: []`: la línea que no casa ni
  `TASK_LINE` ni `METADATA_LINE` cae en un `continue` sin registro. Misma suerte
  para cualquier línea de prosa dentro de `## Plan`.
- La rama `misplacedVerificationSuffix` de `src/check.mjs` lee `task.suffix`,
  que ningún sitio de `src/` asigna: su mensaje ("puts verification in the
  reserved suffix") es inemitible hoy — aserción que no puede fallar dentro del
  propio checker.

**Vacuidad de readiness — confirmada ejecutándolo:** `namesTargetAndVerification`
evalúa `target_patterns` y `verification_patterns` sobre el **mismo** string
(`t.text`). Con `test/**` en `target_patterns`, una tarea que solo nombra
`test/check.test.mjs` satisface ambas listas a la vez y el diagnóstico "must
name target and verification" no dispara. Por eso `test/**` no puede entrar como
target hoy sin vaciar el requisito repo-wide.

**Segunda sede del parser:** `src/fix.mjs` declara su propia regex de línea de
tarea, independiente de la de `src/task.mjs`. Dos literales que ya divergen en
lo que aceptan.

**Población medida (238 documentos, 1071 líneas de tarea):** 716 con `(CRn...)`
final, 151 con `(support)`, 153 planas, 204 sin marcador final (incluye
paréntesis de prosa no finales); **cero** tareas envueltas a varias líneas y
**cero** con la forma `(CRn) (support)`. 26 líneas de prosa dentro de `## Plan`,
todas en 3 documentos archivados. 1044 líneas de metadatos `Resolved`/`Blocked`.

**Consumidores:** solo `src/change.mjs` y `src/writer.mjs` importan
`src/task.mjs`. El viewer no tiene parser propio: renderiza los campos ya
serializados (`text`, `criteria`, `state`, `resolvedAt`, `reason`).
`checkTasks` reporta los `taskIssues` como **error en cualquier status**, y
solo juzga changes abiertos (los congelados quedan fuera del conjunto
`targets` por construcción).

**Restricción de secuencia descubierta:** no existe orden de aterrizaje sin
ventana rota. El parser nuevo no lee el corpus viejo (los criterios finales
desaparecen y la cobertura falla) y el viejo rechaza los hijos nuevos (clave de
metadato desconocida = issue). Como el pre-commit corre `check` repo-wide, el
flip del parser, el migrador y la migración del corpus deben aterrizar en la
misma selección de trabajo. Además este mismo documento estará `in-progress`
durante esa ventana: sus tareas migradas necesitan sus campos completados en el
mismo commit o readiness lo bloquea en severidad de error.

## Proposal

**Gramática.** Los campos son hijos estructurados de la tarea, por el canal de
metadatos que [#20260720-125007] ya fijó (una línea por campo, inmune al reflow
por construcción):

```markdown
- [ ] Descripción libre, que puede envolver
  a la línea siguiente indentada
  - **Target:** `src/task.mjs`
  - **Verify:** `node --test test/change.test.mjs`
  - **Criteria:** CR1, CR2
- [ ] Ejecutar el gate completo
  - **Support:** cierre operativo
```

- `Criteria` lleva una lista de tokens `CRn`; cualquier token que no lo sea es
  issue nombrado. `Support` (valor opcional) sustituye a `(support)`; una tarea
  sin `Criteria` y sin `Support` conserva el diagnóstico actual de "references
  no criterion". Los paréntesis de la descripción son siempre prosa: nada se
  deduce de la posición.
- Continuación: línea no vacía, indentada, que no es metadato — se une a la
  descripción con un espacio. Línea no indentada que no es tarea ni metadato:
  issue nombrado por el canal existente de `taskIssues` (error, solo changes
  abiertos; los 26 renglones de prosa de los archivados son dato, no sujeto).
- Validez: `Target`/`Verify`/`Criteria`/`Support` a lo sumo una vez por tarea y
  en cualquier estado; las reglas estructurales de `Resolved`/`Blocked` por
  estado no cambian. `setTask` (`src/writer.mjs`) conserva su contrato visible.
- La forma serializada de la tarea conserva `text`, `criteria`, `state`,
  `resolvedAt` y `reason` (el viewer no se toca); los campos nuevos son
  aditivos.

**Readiness por campo.** `target_patterns` casa únicamente el valor de
`Target`; `verification_patterns` únicamente el de `Verify`. Una tarea
CR-bearing sin uno de los dos campos recibe el diagnóstico vigente con la
severidad de [#20260729-185200] (warning en draft, error desde approved). La
rama muerta `misplacedVerificationSuffix` y la regla posicional "verification
must precede the final criteria block" se retiran: sin posiciones, no hay sitio
equivocado.

**Sede única.** El reconocimiento de línea de tarea vive en `src/task.mjs` y
`src/fix.mjs` lo importa — identidad de función, no igualdad de resultado. La
única lógica posicional legal que queda es la del migrador, cuyo objeto es
precisamente la gramática vieja.

**Migración: `changeledger fix --plan-tags [--dry-run]`.** Determinista e
idempotente, con el precedente estructural de `--structured-sections`: el grupo
final `(CRn...)` pasa a hijo `Criteria`; `(support)` final pasa a hijo
`Support`; una cláusula `verify:` que aparece exactamente una vez pasa a hijo
`Verify` con su cola; cero o varias apariciones dejan la descripción intacta y
reportan la tarea bajo `manual`. El Target no tiene marcador determinista en la
gramática vieja: no se migra. Consecuencia aceptada: los drafts abiertos quedan
con warnings de readiness hasta que se editen — exactamente lo que el gate de
approve debe decir de ellos. Este documento, `in-progress` durante la ventana,
completa sus campos a mano en el mismo commit de la migración y lo registra en
el Log.

**Alternativas descartadas.** (a) Parser dual con fallback posicional: mantiene
viva la clase de pérdida silenciosa y deja dos gramáticas para siempre. (b) Tags
inline en la línea lógica: re-frágil a la puntuación de la descripción — la
clase que [#20260720-125007] cerró — y complica el empalme de `setTask`. (c) No
migrar el corpus: los 716 criterios archivados desaparecen del viewer y de toda
consulta, o exige (a).

**Secuencia de aterrizaje.** Selección 1 (acoplada por la restricción de la
Investigation): parser + readiness por campo + migrador + corpus migrado + sus
suites, en un commit. Selección 2: la prosa del contrato. El pack `spec` está en
andamio de presupuesto; la reescritura de su gramática debe mantenerlo bajo su
techo y la cifra se mide al implementar, no se supone.

## Specification

Interfaces externas: ninguna nueva de la que este change dependa. La salida de
`fix --plan-tags` es diagnóstico humano, no estable para consumo automático; la
forma serializada de las tareas (campos arriba) sí es contrato para el viewer.

### CR1 — La continuación indentada se une y conserva la traza
- **Given** un `## Plan` con `- [ ] Descripción que envuelve` seguida de la
  línea `  a una segunda línea física` y del hijo `  - **Criteria:** CR2`
- **When** se parsea el documento (`parseTaskBlocks`)
- **Then** la tarea tiene `text` igual a `Descripción que envuelve a una
  segunda línea física`, `criteria` igual a `["CR2"]` e `issues` vacío
- **And** hoy, medido: la continuación se descarta, `criteria` queda `[]` y no
  hay diagnóstico

### CR2 — La línea indecidible es un issue nombrado
- **Given** un change abierto cuyo `## Plan` contiene la línea no indentada
  `Prosa suelta que no es tarea` entre dos tareas válidas
- **When** `changeledger check <id>`
- **Then** se reporta el error con mensaje exacto
  `unrecognized Plan line: "Prosa suelta que no es tarea"`
- **And** en `draft` conserva la severidad de error del canal de `taskIssues`
  vigente, y un documento congelado con esa misma línea no emite diagnóstico

### CR3 — Los criterios vienen del hijo y los paréntesis son prosa
- **Given** la tarea `- [ ] Hacer cosas (CR1) (support)` con hijo
  `  - **Criteria:** CR2`
- **When** se parsea
- **Then** `criteria` es `["CR2"]`, el texto conserva `(CR1) (support)` como
  prosa y no hay issue — hoy, medido: `criteria` queda `[]` en silencio
- **And** con hijo `  - **Criteria:** CR1, banana` se reporta el issue con
  mensaje exacto `invalid Criteria value "banana" for task #1`

### CR4 — Readiness juzga cada campo con su lista, sin vacuidad cruzada
- **Given** `readiness: { target_patterns: ["src/**", "test/**"],
  verification_patterns: ["test/**"] }` y una tarea CR-bearing con hijo
  `  - **Verify:** test/check.test.mjs` y sin hijo `Target`
- **When** `changeledger check <id>` sobre el change en `draft` y proyectado
  `approved`
- **Then** dispara "must name target and verification" como warning en `draft`
  y error en la proyección — hoy, medido: no dispara en ningún status porque el
  mismo string satisface ambas listas
- **And** con `  - **Target:** src/check.mjs` y `  - **Verify:** pnpm test` no
  hay diagnóstico, y con `Target` presente pero sin `Verify` vuelve a disparar

### CR5 — La migración es determinista, idempotente y honesta con lo ambiguo
- **Given** un fixture con las formas medidas en el corpus: tarea con
  `; verify: \`pnpm test\` (CR1, CR2)` final, tarea con `(support)` final,
  tarea plana, y tarea con paréntesis de prosa no final `(formato, ciclo)`
- **When** `changeledger fix --plan-tags`
- **Then** la primera queda con hijos `Verify` (con `\`pnpm test\``) y
  `Criteria` (`CR1, CR2`) y sin marcador en el texto; la segunda con hijo
  `Support`; la tercera y el paréntesis de prosa quedan byte-idénticos
- **And** una segunda ejecución es byte-idéntica (idempotencia), `--dry-run` no
  escribe nada, y una tarea con `verify:` repetido migra solo sus criterios y
  se reporta bajo `manual`

### CR6 — El reconocimiento de línea de tarea tiene sede única
- **Given** `src/task.mjs` como dueño del reconocimiento de línea de tarea
- **When** se inspecciona la relación entre módulos
- **Then** `src/fix.mjs` obtiene ese reconocimiento por importación desde
  `src/task.mjs` y el test lo afirma por identidad de función — no por igualdad
  de resultado —, de modo que reintroducir un literal propio en `src/fix.mjs`
  hace fallar la aserción

### CR7 — El contrato servido enseña la gramática nueva y retira la posicional
- **Given** `changeledger context spec`
- **When** se lee la captura completa
- **Then** el pack documenta los cuatro hijos (`**Target:**`, `**Verify:**`,
  `**Criteria:**`, `**Support:**`) con un ejemplo en la gramática nueva, y las
  frases posicionales `final parenthesized block` y `Verification must precede
  the final criteria block` ya no aparecen en ningún fragmento servido
- **And** los guards de obligación del contrato fijan las frases nuevas por
  grep, y los presupuestos de `budgets.yml` siguen pasando

### CR8 — El corpus real queda migrado y el gate verde
- **Given** este repositorio tras ejecutar `changeledger fix --plan-tags`
- **When** `node bin/changeledger.mjs check` y el script de equivalencia
  antes/después
- **Then** exit 0 sin errores; las 716 tareas que hoy portan criterios los
  conservan (mismo multiconjunto id→criterios por documento); los 26 renglones
  de prosa de los 3 documentos archivados no emiten diagnóstico; y los drafts
  abiertos conservan diagnóstico de readiness como warnings, ahora por campos
  ausentes

## Plan

- [x] Reescribir `parseTaskBlocks` en `src/task.mjs` a la gramática por hijos con continuación unida e issue nombrado, ajustando la validez y `setTask` en `src/writer.mjs`
  - **Target:** `src/task.mjs`, `src/writer.mjs`
  - **Verify:** `node --test test/change.test.mjs test/writer.test.mjs`
  - **Criteria:** CR1, CR2, CR3
  - **Resolved:** `2026-07-29T21:38:40Z`
- [x] Aplicar readiness por campo en `src/check.mjs` y retirar `misplacedVerificationSuffix` con su mensaje inemitible
  - **Target:** `src/check.mjs`
  - **Verify:** `node --test test/check.test.mjs`
  - **Criteria:** CR2, CR4
  - **Resolved:** `2026-07-29T21:38:40Z`
- [x] Añadir el migrador `--plan-tags` a `src/fix.mjs` y `src/commands/fix.mjs` con sede única del reconocimiento en `src/task.mjs`, retirando el fixer de reordenación posicional
  - **Target:** `src/fix.mjs`, `src/commands/fix.mjs`, `bin/changeledger.mjs`
  - **Verify:** `node --test test/fix.test.mjs`
  - **Criteria:** CR5, CR6
  - **Resolved:** `2026-07-29T21:38:40Z`
- [x] Ejecutar el migrador de `src/fix.mjs` sobre el corpus con equivalencia antes/después por script, completando a mano los campos de este documento
  - **Target:** `src/fix.mjs` sobre `.changeledger/changes/`
  - **Verify:** `node bin/changeledger.mjs check`
  - **Criteria:** CR8
  - **Resolved:** `2026-07-29T21:38:41Z`
- [x] Reescribir la gramática del Plan en `templates/contract/spec.md` y el punto 2 de `templates/contract/readiness.md`, actualizando sus guards de obligación
  - **Target:** `templates/contract/spec.md`, `templates/contract/readiness.md`
  - **Verify:** `node --test test/context.test.mjs test/cli.test.mjs`
  - **Criteria:** CR7
  - **Resolved:** `2026-07-29T22:03:03Z`
- [x] Ejecutar el gate completo tras ambas selecciones
  - **Verify:** `pnpm verify`
  - **Support:**
  - **Resolved:** `2026-07-29T22:03:03Z`

## Log
- **2026-07-29T21:00:52Z** `[status]` draft → approved
- **2026-07-29T21:02:23Z** `[status]` approved → in-progress
- **2026-07-29T21:38:58Z** `[note]` Selección 1 resuelta (parser+readiness+migrador+corpus). Equivalencia medida por script (extracción vieja sobre texto crudo vs parser nuevo): 239 documentos, multiconjunto id→criterios idéntico, 721 tareas con criterios; segunda pasada del migrador byte-idéntica; fix --plan-tags emitió 583 notas manual — 581 tareas sin cláusula verify: (sin ambigüedad real) y 2 con verify: repetido. Cifras del draft corregidas por el corpus vivo: 238→239 docs, 716→721 con criterios, 1071→1077 líneas de tarea (el delta es este propio change).
- **2026-07-29T21:38:58Z** `[note]` Precisión sobre la cláusula And de CR1: 'no hay diagnóstico' es exacto para la variante de la Investigation (criterio en la segunda línea física: criteria [] e issues [], reproducido literal), pero para el Given literal con hijo Criteria el HEAD anterior emitía 'invalid task metadata structure' por clave desconocida. El Then de CR1 no cambia y su test pasa; queda como punto de escrutinio del review, no se enmienda el criterio aprobado.
- **2026-07-29T21:38:59Z** `[note]` Dos ensanchamientos de comportamiento para escrutinio del review: (1) la prosa en ## Plan de un change abierto pasa a error (CR2), coste de migración para repos consumidores no nombrado en el documento; (2) setTask ahora lanza ante cualquier issue del Plan, incluida una línea unrecognized en otro punto del documento — antes se saltaba en silencio; en la práctica los congelados no se mutan.
- **2026-07-29T21:43:19Z** `[note]` Commit de la migración en forma multi-id: chore(changes) con los 196 documentos migrados declarados en el body más el autorizante, siguiendo el precedente del archivado masivo. Combinado porque la migración es una operación mecánica única sobre los 196 documentos como dato; la enumeración completa de los changes cuya superficie comparte vive en el body del propio commit. El guard de índice de commit rechazó primero la forma sin declarar — funcionó según diseño ante su primer caso de migración de corpus.
- **2026-07-29T22:03:03Z** `[note]` Selección 2 resuelta (prosa del contrato). Pack spec en 3445/3450 tokens y 320/345 líneas medido por la línea BEGIN — 5 tokens de margen, el andamio sigue esperando su refactorización declarada. Guards retargeteados con rojo-verde literal por mutante único; el barrido de frases retiradas es recursivo sobre templates/contract/ y se probó plantando la frase en un fragmento no compuesto. Residuos nombrados sin tocar: comentario del andamio en budgets.yml rancio (dice 3416/317, mide 3445/320 — misma clase que el 'ten ceilings'); fix --plan-tags ausente de Authoring helpers por coste de tokens; regla de exención de Support en dos sedes preexistente.
- **2026-07-29T22:03:03Z** `[note]` Decisión no especificada adoptada en la selección 2: la convención verify: sobrevive como prefijo del valor del hijo Verify ('start the Verify value with verify:'), manteniendo verification_patterns ["verify:"] con significado bajo el matching por campo.
- **2026-07-29T22:03:16Z** `[note]` Mandato de review, registrado antes de delegar: auditoría completa del rango a2597a38..HEAD por revisor top-tier de contexto limpio. Puntos de escrutinio explícitos: (1) las listas de decisiones no especificadas de los dos implementadores (13 + 6), transmitidas literales; (2) la precisión sobre la cláusula And de CR1 anotada en este Log; (3) los dos ensanchamientos de comportamiento (prosa en Plan abierto pasa a error; setTask lanza ante cualquier issue del documento); (4) la forma multi-id del commit de migración; (5) el margen de 5 tokens del pack spec; (6) las notas de este Log del orquestador, juzgadas con el mismo estándar que el entregable — el orquestador no editó código ni prosa del contrato en este ciclo.
- **2026-07-29T22:03:16Z** `[status]` in-progress → in-review
- **2026-07-29T22:23:20Z** `[review]` in-review → in-progress (retry): Byte NUL crudo en src/task.mjs (clave de dedupe de addIssue): git clasifica el parser de sede única como binario — sin diff textual del rango, invisible a grep por líneas — y escapa a lint, suite y check; arreglo de un token con el escape \u0000. Y el Then de CR6 sobre-afirma: un literal de línea de tarea local junto al re-export retenido deja test/fix.test.mjs verde, así que la aserción de identidad no caza la reintroducción como el criterio enuncia.
- **2026-07-29T22:29:33Z** `[note]` Corrección de una cifra mía refutada por el review: las notas manual del migrador son 585 en total — 583 'no verify: clause' más 2 'verify: clauses' repetidas — sobre 158 documentos. Medido ahora por mí: dry-run del migrador de HEAD sobre un git archive del baseline a2597a38, contando las líneas de bloque manual. Mi nota anterior (583 = 581+2) propagó la cifra del implementador sin medirla.
- **2026-07-29T22:29:33Z** `[note]` Hallazgo del review sobre CR3, misma clase que la precisión ya anotada de CR1: para el Given literal con hijo Criteria el parser del baseline emitía 'invalid task metadata structure', no silencio; el enunciado 'criteria [] en silencio' vale para la variante sin hijo de la Investigation. El Then de CR3 está probado y no se enmienda el criterio.
- **2026-07-29T22:29:33Z** `[note]` Cifras de prosa en ## Plan, con método: 26 renglones en el baseline con mi barrido (líneas no vacías que no son tarea ni metadato: 21 sin indentar + 5 indentadas); el revisor midió 23 con método no declarado; la cláusula portadora de CR8 — cero diagnósticos de los congelados — la confirmamos ambos. Y el 'cero tareas envueltas' de la Investigation era falso: 3 colas indentadas en 20260626-174204 que el parser nuevo recupera como continuaciones (el viejo las truncaba).
- **2026-07-29T22:29:33Z** `[note]` Corrección del retry, ediciones del orquestador declaradas al estándar del implementador: (1) el byte NUL crudo de src/task.mjs (clave de dedupe de addIssue, offset 2287) pasa a escape \u0000, con guard nuevo en test/cli.test.mjs que barre src|bin|test|templates|hooks buscando bytes de control crudos — rojo literal antes del fix nombrando el offset exacto, verde después; dotfiles excluidos (.DS_Store no trackeado). (2) CR6 reforzado en test/fix.test.mjs: barrido de fuente que prohíbe la secuencia regex \[ en src/fix.mjs — el mutante del revisor (literal local junto al re-export retenido) muere ahora con mensaje literal; el comentario del test sobre-afirmaba el mecanismo y se corrigió. pnpm verify exit 0 tras la corrección.
- **2026-07-29T22:29:46Z** `[note]` Mandato de la ronda de confirmación, registrado antes de delegar: mandato mínimo sobre la corrección sin commitear — verificar los dos fixes del retry (NUL y CR6), re-derivar sus dos evidencias (guard de bytes de control en rojo con un NUL plantado; mutante de literal junto al import), y juzgar las ediciones y notas de Log del orquestador de esta ronda con el estándar del implementador. Nada más: el resto del rango ya tiene PASS técnico de la auditoría completa.
- **2026-07-29T22:29:46Z** `[status]` in-progress → in-review
- **2026-07-29T22:36:54Z** `[review]` in-review → in-progress (retry): El comentario corregido de CR6 afirma un absoluto falso: un matcher funcional escrito como clase de caracteres ([[]( |x|!)[\]]) no contiene la secuencia \[ y deja CR6 verde. Misma clase que el defecto que arreglaba — prosa de test que sobre-afirma su mecanismo. Corrección: acotar el comentario a la forma natural que el barrido sí cierra y nombrar el residuo de la forma ofuscada.
- **2026-07-29T22:37:18Z** `[note]` Segunda ronda de confirmación: los dos fixes CONFIRMADOS con re-derivación (el guard rojo reproduce 'src/task.mjs offset 2287 byte 0x0' literal; el mutante del literal muere), las cuatro cifras de mis notas reproducidas exactas por el método declarado (585/583/2/158), gates verdes por el revisor. FAIL-RETRY estrecho por prosa mía: el comentario corregido de CR6 afirmaba un absoluto falso — contraejemplo ejecutado del revisor: un matcher como clase de caracteres [[]( |x|!)[\]] no lleva \[ y deja CR6 verde. La misma clase que el retry arreglaba, reintroducida por mi edición. Corregido: el comentario queda acotado a la forma natural (copia del literal de la sede) y nombra el residuo de la forma ofuscada, que posee el review. Matiz del revisor asumido: git diff contra el blob de HEAD sigue diciendo Binary hasta que la corrección se commitee — el par se clasifica por ambos lados; mis notas no afirmaban lo contrario.
- **2026-07-29T22:37:18Z** `[status]` in-progress → in-review
- **2026-07-29T22:42:59Z** `[review]` in-review → in-progress (retry): El comentario del guard de bytes de control en test/cli.test.mjs afirma un absoluto falso: solo NUL dispara la heurística binaria de git — un fichero cuyo único byte de control es 0x1b diffea textual y grepea por líneas (contraejemplo ejecutado). Acotar la consecuencia de clasificación binaria a NUL y dar la razón honesta más débil del barrido amplio.
- **2026-07-29T22:43:23Z** `[note]` Tercera ronda: CR6 y su comentario CONFIRMADOS (el residuo ofuscado nombrado y probado por el revisor), pero el otro comentario de la misma corrección — el del guard de bytes de control — sobre-afirmaba: atribuía a todo byte de control la clasificación binaria de git, que es heurística de NUL solamente (contraejemplo ejecutado del revisor con 0x1b: diff textual completo y grep por líneas). Tercera instancia de la misma clase en este ciclo, las tres en prosa mía. Corregido: el comentario relata el incidente verificado (NUL en src/task.mjs, escapó a lint, suite y check) y justifica el barrido amplio sin afirmar mecanismo — ningún byte de control pertenece a la fuente, haga git lo que haga con cada uno.
- **2026-07-29T22:43:23Z** `[status]` in-progress → in-review
- **2026-07-29T22:46:19Z** `[review]` in-review → in-progress (retry): El comentario reescrito aún afirma un absoluto falso sobre el alcance del guard: 'every raw control byte except tab/LF/CR' y el predicado no rechaza DEL 0x7f (contraejemplo ejecutado: probe con 0x7f queda verde, control positivo NUL rojo). Salida elegida: ensanchar el predicado a 0x7f — estrictamente más fuerte, vuelve exactos la frase y el nombre del test.
- **2026-07-29T22:46:51Z** `[note]` Cuarta ronda: la frase 1 del comentario y todo lo demás CONFIRMADO; FAIL por el alcance del guard — 'every raw control byte' con un predicado que no rechazaba DEL 0x7f (contraejemplo ejecutado del revisor). Salida estrictamente más fuerte adoptada: el predicado se ensancha a 0x7f — probe con DEL en rojo literal 'test/__probe_ctl.txt offset 5 byte 0x7f', restaurado, 53/53 verde. C1 (0x80-0x9F) queda fuera a propósito y sin afirmarse: a nivel de byte solaparía las continuaciones UTF-8 de la prosa en español. Cuarta instancia de la clase en el ciclo, las cuatro en prosa u alcance escritos por mí.
- **2026-07-29T22:46:51Z** `[status]` in-progress → in-review
- **2026-07-29T22:51:19Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-29T23:49:08Z** `[validation]` in-validation → done (human accepted)
- **2026-07-29T23:52:23Z** `[graduation]` spec: `readiness.md`
- **2026-07-29T23:52:45Z** `[archive]` archived
