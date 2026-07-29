---
id: "20260729-203257"
title: "Gramática del Plan por tags: Target, Verify y Criteria"
type: feature
status: in-progress
created: 2026-07-29T20:32:57Z
depends_on: []
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
- [ ] Reescribir la gramática del Plan en `templates/contract/spec.md` y el punto 2 de `templates/contract/readiness.md`, actualizando sus guards de obligación
  - **Target:** `templates/contract/spec.md`, `templates/contract/readiness.md`
  - **Verify:** `node --test test/context.test.mjs test/cli.test.mjs`
  - **Criteria:** CR7
- [ ] Ejecutar el gate completo tras ambas selecciones
  - **Verify:** `pnpm verify`
  - **Support:**

## Log
- **2026-07-29T21:00:52Z** `[status]` draft → approved
- **2026-07-29T21:02:23Z** `[status]` approved → in-progress
- **2026-07-29T21:38:58Z** `[note]` Selección 1 resuelta (parser+readiness+migrador+corpus). Equivalencia medida por script (extracción vieja sobre texto crudo vs parser nuevo): 239 documentos, multiconjunto id→criterios idéntico, 721 tareas con criterios; segunda pasada del migrador byte-idéntica; fix --plan-tags emitió 583 notas manual — 581 tareas sin cláusula verify: (sin ambigüedad real) y 2 con verify: repetido. Cifras del draft corregidas por el corpus vivo: 238→239 docs, 716→721 con criterios, 1071→1077 líneas de tarea (el delta es este propio change).
- **2026-07-29T21:38:58Z** `[note]` Precisión sobre la cláusula And de CR1: 'no hay diagnóstico' es exacto para la variante de la Investigation (criterio en la segunda línea física: criteria [] e issues [], reproducido literal), pero para el Given literal con hijo Criteria el HEAD anterior emitía 'invalid task metadata structure' por clave desconocida. El Then de CR1 no cambia y su test pasa; queda como punto de escrutinio del review, no se enmienda el criterio aprobado.
- **2026-07-29T21:38:59Z** `[note]` Dos ensanchamientos de comportamiento para escrutinio del review: (1) la prosa en ## Plan de un change abierto pasa a error (CR2), coste de migración para repos consumidores no nombrado en el documento; (2) setTask ahora lanza ante cualquier issue del Plan, incluida una línea unrecognized en otro punto del documento — antes se saltaba en silencio; en la práctica los congelados no se mutan.
