---
id: "20260728-194157"
title: Las guardas del contrato barren todo subfragmento
type: feature
status: draft
created: 2026-07-28T19:41:57Z
depends_on: []
related_to: ["20260728-170429", "20260726-124837", "20260727-194234", "20260729-203257", "20260730-002730", "20260729-143656"]
owner: raruiz-hiberuscom
---

## Request

Las guardas exhaustivo-negativas del contrato — las que afirman que una
obligación retirada **no aparece en ningún fragmento** — enumeran solo el nivel
superior de `templates/contract/`, así que son ciegas a los 8 fragmentos de
`agent-contexts/` y `agent-prompts/`, versionados y publicados a los repos
consumidores. Son precisamente el mecanismo que garantiza que retirar prosa no
pierde nada; con el 40% de los ficheros fuera de su barrido, dan una garantía
que no tienen. Descubierto el 2026-07-28 al cerrar el mismo hueco en una cuarta
guarda ([#20260728-170429] CR2); las otras tres quedaron fuera de alcance por
ser criterios de otros changes.

## Investigation

Investigación fresca contra HEAD del 2026-07-30 (delegada, con exploits
ejecutados). El documento original quedó rancio por dos reescrituras de su
fichero objetivo — el retiro de pins de [#20260730-002730] y el refactor del
pack — y por la gramática de tags de [#20260729-203257]; todos sus hechos se
re-verificaron.

**El hueco sigue vivo y el exploit reproduce a HEAD, en las dos suites.**
Plantada la frase retirada que `124837 CR1` vigila (`later work could obscure
attribution`) en `templates/contract/agent-contexts/investigation.md`: la suite
de contexto sigue **108/108 verde**. Plantado el literal que los barridos de
`cli.test.mjs` vigilan (`Spec Ledger`) en
`templates/contract/agent-prompts/review.md`: `235628 CR3` sigue verde. Ambas
sondas restauradas byte-exactas.

**Las sedes afectadas.** En `test/context.test.mjs`, las tres guardas
originales — `194234 CR4` (sede única de la unidad de commit), `124837 CR1`
(juicio de atribución retirado) y `124837 CR8` (ninguna obligación sale de
`implement.md` sin sede) — conservan la forma
`fs.readdirSync(dir).filter(name => name.endsWith('.md'))` sin
`{ recursive: true }`. Y en `test/cli.test.mjs`, `contractText()` concatena
solo el nivel superior y alimenta los **tres barridos** de esa suite: el
alcance de este change crece respecto al draft original, que solo cubría una
suite.

**La causa creció como el Proposal original predijo.** Hoy hay **8 sedes de
enumeración independientes** sobre `templates/contract/**` con fines de guarda
— 5 copias recursivas idénticas pegadas una a una (`203257 CR7`, `170429 CR2`,
`111349 CR1/CR2/CR3/CR5`, `111349 CR7`, `143656 CR4`) más las 3 no recursivas
de arriba — y **cero helper compartido**. Cada change nuevo pegó su propia
copia. [#20260729-143656] CR4 añadió un barrido recursivo para su propia frase
y pinnea los inventarios de ficheros, pero no tocó las tres guardas ciegas: es
aditivo, no correctivo.

**Referentes del CR3 original, actualizados.** El "inventario de digests" que
debía quedar intacto ya no existe — el retiro de pins lo borró entero; el
inventario vigente son las igualdades de lista de `143656 CR4` (nivel superior
+ subdirectorios, a propósito). Y la "búsqueda de fragmento por nombre" es hoy
`contractFragment(file)`, que lee un filename conocido sin escanear directorio:
no comparte el defecto ni el arreglo.

**El residuo del mismo fichero sigue intacto.** `bootstrapHeadCut()` hace
`REFERENCE.match(/head -(\d+)/)` y destructura sin comprobar nulo: si
`REFERENCE` dejara de declarar `head -<n>`, lanza `TypeError` en vez de nombrar
la ausencia del corte. Sin tocar desde su introducción.

**El bloqueador del hallazgo 41 está resuelto, verificado mecánicamente.**
`test/**` ya es target legal (matching por campo de [#20260729-203257] +
edición de config de Roberto), y añadir hijos `Target:` a las tareas convierte
los 4 warnings de este draft en `✓ valid` — probado en copia antes de esta
reescritura.

## Proposal

Las enumeraciones de guarda pasan a recursivas y quedan **derivadas de una sola
sede**: un helper compartido entre las dos suites (precedente de módulo de
apoyo: `test/budget-support.mjs`) que devuelve todo fragmento `.md` bajo
`templates/contract/` a cualquier profundidad. Lo usan las guardas
exhaustivo-negativas de `context.test.mjs`, las 5 copias recursivas pegadas, y
`contractText()` en `cli.test.mjs` (que pasa a concatenar recursivo — sus
barridos ganan los 8 subfragmentos). Repetir la enumeración es lo que permitió
que tres de cuatro quedaran atrás en la corrección original y que después se
pegaran cinco copias más.

El helper es también donde se nombra la distinción: una guarda
exhaustivo-negativa lo usa; un acceso por filename (`contractFragment`) o un
inventario que pinnea listas a propósito (`143656 CR4` puede consumir el helper
o mantener sus igualdades — lo decide la implementación sin perder su
semántica de inventario exacto).

Y `bootstrapHeadCut()` comprueba el nulo y falla nombrando que el bootstrap no
declara corte.

Bajo el perímetro de guards de `AGENTS.md`: nada de esto añade pins de
oraciones — es enumeración (estructura), no fraseo.

Alternativas descartadas:

- **Añadir `{ recursive: true }` en los sitios y ya**: cierra las instancias de
  hoy y deja la causa — la novena copia divergirá igual que las ocho primeras.
- **Un test que prohíba `readdirSync` sin `recursive` en estas suites**:
  prohibición ciega que rompería los accesos legítimos que no son guardas.

## Specification

Interfaces externas: ninguna. Superficie enteramente en `test/**`, target
legal desde el matching por campo.

### CR1 — Toda guarda exhaustivo-negativa barre los subfragmentos
- **Given** las guardas que afirman que una obligación retirada no aparece en
  ningún fragmento del contrato — las tres de `test/context.test.mjs`
  (`194234 CR4`, `124837 CR1`, `124837 CR8`) y los tres barridos de
  `test/cli.test.mjs` que consumen `contractText()`
- **When** se inyecta la cadena que cada una vigila en un fichero bajo
  `templates/contract/agent-contexts/` y en otro bajo
  `templates/contract/agent-prompts/`
- **Then** cada guarda falla nombrando lo encontrado — hoy, reproducido a HEAD:
  las seis pasan verdes con la inyección presente

### CR2 — La enumeración tiene una sola sede compartida
- **Given** las dos suites tras el change
- **When** se busca cómo cada guarda exhaustivo-negativa y cada barrido obtiene
  su lista de fragmentos
- **Then** todas la obtienen del mismo helper compartido, que devuelve todo
  `.md` bajo `templates/contract/` a cualquier profundidad, y ninguna guarda
  exhaustivo-negativa enumera el directorio por su cuenta — las 5 copias
  recursivas pegadas quedan sustituidas por el helper
- **And** reintroducir una enumeración propia en una guarda se caza con la
  evidencia de mutante registrada (una copia local plantada deja de ver el
  subfragmento sembrado y su test de inyección la delata en rojo)

### CR3 — Los accesos que no son guardas conservan su semántica
- **Given** `contractFragment(file)` (acceso por filename) y los inventarios de
  igualdad exacta de `143656 CR4`
- **When** corre la suite tras el cambio
- **Then** `contractFragment` sigue leyendo por filename sin escaneo, los
  inventarios de `143656 CR4` conservan sus igualdades exactas
  (nivel superior + subdirectorios), y ambos pasan sin cambio de
  comportamiento

### CR4 — La ausencia del corte del bootstrap se nombra, no revienta
- **Given** un `REFERENCE` que no contiene el patrón `head -<n>`
- **When** se evalúa el techo de líneas del core contra el corte del bootstrap
- **Then** la aserción falla con un mensaje que nombra que el bootstrap no
  declara corte — hoy, verificado en código: destructura un `null` y lanza
  `TypeError`

## Plan

- [ ] Extraer el helper compartido de enumeración recursiva y hacer que las seis guardas exhaustivo-negativas, las cinco copias recursivas y `contractText()` lo usen, conservando la semántica de `contractFragment` y de los inventarios de `143656 CR4`
  - **Target:** `test/context.test.mjs`, `test/cli.test.mjs`
  - **Verify:** `node --test test/context.test.mjs test/cli.test.mjs`
  - **Criteria:** CR1, CR2, CR3
- [ ] Comprobar el nulo en `bootstrapHeadCut` y fallar nombrando la ausencia del corte
  - **Target:** `test/context.test.mjs`
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR4
- [ ] Ejecutar el gate completo
  - **Verify:** `pnpm verify`
  - **Support:** cierre operativo

## Log

- **2026-07-28T19:41:57Z** `[note]` Draft creado. Nace del barrido de clase de `20260728-170429`: al cerrar el hueco no recursivo de una guarda, el delegado encontró tres más y las reportó sin arreglarlas por ser criterios de otros changes. El revisor de confirmación probó que el hueco es explotable inyectando la frase retirada de 124837 CR1 en un subdirectorio y obteniendo la suite verde. La causa no es el flag ausente sino la enumeración repetida cuatro veces, así que el arreglo es una sola sede.
- **2026-07-28T19:43:53Z** `[note]` BLOQUEADO POR EL HALLAZGO 41, en su forma mas pura. Todo el entregable de este change vive en test/context.test.mjs, pero test/** es patron de verificacion y no de target, asi que NINGUNA de sus tareas pasa readiness: 4 warnings en draft que serian errores en approved. Y no hay tarea de src/ ni templates/ con la que fusionarlas, que es el apano que usaron 194233 y 124837, porque el change es puramente endurecimiento de guardas. Las tres salidas conocidas son todas malas: meter test/** en target_patterns vuelve vacio el requisito de target para todo el repo porque check busca ambas listas sobre el mismo texto de la tarea; marcar todo (support) es el bypass que convierte errores en warnings y desactiva la trazabilidad; y bajar el tipo a chore deja cero diagnosticos. El arreglo estructural es la gramatica del Plan por tags, que separa el campo de target del de verificacion. Este change espera a ese, y su existencia es el mejor argumento para priorizarlo: demuestra que un change cuyo entregable es enteramente una guarda de test no tiene forma legal de documentarse con criterios.
- **2026-07-30T12:21:36Z** `[note]` Draft reescrito contra HEAD del 2026-07-30 sobre investigación fresca delegada, tras dos reescrituras del fichero objetivo (retiro de pins y refactor del pack) y la gramática de tags. Cambios de fondo: el bloqueador del hallazgo 41 está resuelto y verificado (Target: en las tareas da check valid); el alcance crece a test/cli.test.mjs (contractText alimenta sus tres barridos y también es no-recursivo, exploit reproducido en ambas suites); la duplicación empeoró a 8 sedes de enumeración sin helper (las 5 recursivas se pegaron después del draft original); los referentes de CR3 se actualizaron (el inventario de digests ya no existe — lo borró el retiro de pins; la búsqueda por nombre es contractFragment, sin escaneo). Tareas en la gramática nueva con Target/Verify/Criteria.
