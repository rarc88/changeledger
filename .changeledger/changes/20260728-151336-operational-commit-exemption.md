---
id: "20260728-151336"
title: Dar forma legal al commit operativo
type: feature
status: done
created: 2026-07-28T15:13:36Z
depends_on: []
archived: true
reviewed: true
related_to: ["20260726-141124", "20260726-124837", "20260727-194234"]
owner: raruiz-hiberuscom
---

## Request

El core permite explícitamente la edición operativa: *"ask the human whether a
purely operational, reversible edit with no persistent truth or observable
behavior change should be done directly"*. Pero sus reglas de commit no dejan
forma legal de commitearla: los únicos exentos del marcador `[#id]` son los merge
commits y `chore(release)`. **El contrato autoriza el edit y prohíbe su commit.**

Roberto, el 2026-07-28: *"no podemos dejar esa deuda técnica, no puede ser que
permitamos cambios operativos sin change y no tengamos como commitearlos"*.

Hace falta una forma declarada, contable y auditable de commitear trabajo que
ningún change cubre, sin abrir un bypass silencioso del marcador.

## Investigation

Reproducido el 2026-07-28 al intentar commitear `docs/workflow-hardening.md`, un
acta de análisis que no es verdad persistente ni trabajo autorizado:

```text
error  (commits): 59d8578 missing [#id] marker: "docs(workflow): record the findings sieve and decisions"
1 error(s) — commits dev..HEAD
```

El commit se deshizo con `git reset --mixed` y el fichero sigue sin trackear,
porque no existe forma legal de meterlo.

**Cómo funciona la puerta hoy.** `lintCommitRange` en `src/git.mjs` recorre el
rango y salta dos casos antes de exigir marcador: `c.isMerge`, y un subject que
case `/^chore\(release\):/`. El resto pasa por `commitMarkerViolation`, que acepta
un marcador único al final del subject, o la línea de body
`ChangeLedger: [#A] [#B]` fijada por `MULTI_BODY_RE`, y devuelve
`missing [#id] marker` cuando no hay ninguno. La exención vigente es por tanto un
**patrón de subject**: contable, no un juicio. La nueva tiene que serlo igual.

**Por qué no basta nombrar la clase en prosa.** Una exención cuyo criterio fuese
"el commit es operativo" se responde siempre sí, que es el modo de fallo de
*juicio en lugar de regla contable*: la regla existiría y se incumpliría sin que
nadie se diera cuenta. Y una exención por omisión —"si no hay change aplicable, no
hace falta marcador"— destruiría la puerta entera, porque olvidar el marcador
pasaría a ser legal.

De ahí la propiedad que gobierna el diseño: **omitir tiene que seguir fallando.**
La exención sólo puede activarse con una declaración positiva y explícita.

**Restricción por tipo convencional, descartada por coste.** Limitar la exención a
tipos no conductuales (`chore`, `docs`, `style`, `ci`) impediría un
`feat(x): … / sin marcador`. Pero `SUBJECT_RE` en `src/commands/commit.mjs` es
`/^[a-zA-Z]+\([^()]+\):\s+\S.*/` y **no conoce ninguna lista de tipos**: cualquier
palabra pasa. Introducirla significa crear un registro canónico de tipos
convencionales que el producto deliberadamente no posee — la convención de commits
es del repositorio anfitrión. Fuera de alcance.

**Presupuesto.** El bloque `## Commits` de `templates/contract/core.md` está a
**28/28 líneas** contra el techo que `commitsBlockLines()` comprueba, y el core a
193/200. La frase de exención mide 95 caracteres en un bloque cuyas líneas llegan
a 108, así que extenderla en el sitio cabe sin añadir línea. Si el contenido
correcto no cupiera, el trabajo para y pregunta en vez de retirar normativa.

## Proposal

Un commit queda exento del marcador cuando su body declara, en línea propia,
`ChangeLedger: none — <razón>` con razón no vacía. La declaración es explícita,
greppable (`git log --grep='ChangeLedger: none'` enumera todo commit operativo del
historial) y reutiliza la maquinaria de body que ya existe junto a
`ChangeLedger: [#A] [#B]`.

La razón es obligatoria por el mismo motivo que la de `discard`: un commit
operativo no tiene documento de change, así que **el body es el único sitio donde
su porqué puede vivir**. Y es donde una declaración falsa se vuelve visible.

`changeledger commit` gana la forma de componerla, porque el contrato ya prefiere
el CLI para los marcadores fáciles de teclear mal, y esta línea es exactamente
eso.

Alternativas descartadas:

- **Scope reservado** (`chore(ops):`, imitando `chore(release)`). Más simple, pero
  quema un nombre de scope que el trabajo real podría querer y no obliga a
  articular la razón.
- **Exención por ruta** (commits que sólo tocan ficheros fuera de las rutas
  declaradas). Frágil y silenciosa: acierta o falla según la configuración del
  repositorio anfitrión.
- **Change `quick` que cubra cada edición operativa.** Es lo que el contrato
  prescribe hoy, y es circular para un acta de análisis del que salen los propios
  changes; además convierte cada edición reversible en burocracia.

Lo que este diseño **no** hace, y conviene declararlo en vez de fingir lo
contrario: no prueba que el commit sea realmente operativo. Hace la afirmación
explícita, obligatoria y auditable. La definición de qué puede contener —sin
verdad persistente y sin cambio de comportamiento observable— sigue siendo prosa
del core.

## Specification

### CR1 — La declaración explícita exime del marcador
- **Given** un rango con un commit cuyo subject es `docs(workflow): record the findings sieve` sin marcador y cuyo body contiene la línea `ChangeLedger: none — acta de análisis, ningún change la cubre`
- **When** se ejecuta `changeledger check --commits <base>`
- **Then** el comando sale con código 0 y no reporta ese commit
- **And** un commit idéntico sin esa línea de body sigue reportando `missing [#id] marker`

### CR2 — La razón es obligatoria
- **Given** un commit sin marcador cuyo body contiene exactamente `ChangeLedger: none`, sin separador ni razón
- **When** se ejecuta `changeledger check --commits <base>`
- **Then** el comando sale con código distinto de cero
- **And** reporta ese commit con el motivo `ChangeLedger: none requires a reason`

### CR3 — La declaración no convive con marcadores
- **Given** un commit cuyo body contiene `ChangeLedger: none — razón` y cuyo subject además lleva `[#20260728-151336]`
- **When** se ejecuta `changeledger check --commits <base>`
- **Then** el comando sale con código distinto de cero
- **And** reporta ese commit con el motivo `ChangeLedger: none cannot coexist with an [#id] marker`

### CR4 — El CLI compone la declaración
- **Given** un árbol con cambios staged y ningún change en `in-progress`
- **When** se ejecuta `changeledger commit -m "docs(workflow): record the sieve" --no-change "acta de análisis, ningún change la cubre"`
- **Then** crea un commit cuyo subject queda sin marcador y cuyo body es exactamente `ChangeLedger: none — acta de análisis, ningún change la cubre`
- **And** `changeledger check --commits <base>` sobre ese rango sale con código 0
- **And** combinar `--no-change` con `--id` falla sin crear commit, con un error que nombra ambas opciones

### CR5 — El core declara la exención sin crecer
- **Given** el fragmento `templates/contract/core.md`
- **When** se compone el contexto core
- **Then** la frase de exenciones nombra el commit operativo declarado junto a los merge commits y `chore(release)`
- **And** el bloque `## Commits` no supera las 28 líneas que su comprobación de tamaño fija

## Plan

- [x] Aceptar la declaración `ChangeLedger: none — <razón>` en `commitMarkerViolation` y `lintCommitRange` de `src/git.mjs`, con razón obligatoria y sin coexistencia con marcadores
  - **Verify:** `node --test test/check.test.mjs`
  - **Criteria:** CR1, CR2, CR3
  - **Resolved:** `2026-07-28T15:30:36Z`
- [x] Añadir `--no-change <razón>` a `src/commands/commit.mjs` y su cableado en `bin/changeledger.mjs`, mutuamente exclusivo con `--id`
  - **Verify:** `node --test test/cli.test.mjs test/cli-bin.test.mjs`
  - **Criteria:** CR4
  - **Resolved:** `2026-07-28T15:49:36Z`
- [x] Extender la frase de exenciones en `templates/contract/core.md` sin añadir línea al bloque `## Commits`
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR5
  - **Resolved:** `2026-07-28T15:59:03Z`
- [x] Ejecutar el gate completo
  - **Verify:** `pnpm verify`
  - **Support:**
  - **Resolved:** `2026-07-28T15:59:38Z`

## Log

- **2026-07-28T15:13:36Z** `[note]` Draft creado. Nace de reproducir el error al commitear un acta operativa: el core autoriza la edición y sus reglas de commit no dejan forma de commitearla. Diseño gobernado por una propiedad: omitir el marcador tiene que seguir fallando, así que la exención sólo se activa con declaración positiva y razón obligatoria.
- **2026-07-28T15:18:11Z** `[status]` draft → approved
- **2026-07-28T15:18:48Z** `[status]` approved → in-progress
- **2026-07-28T15:30:36Z** `[note]` Tarea 1: src/git.mjs acepta la declaracion. Dos regex nuevas, NONE_BARE_RE y NONE_REASON_RE, y las comprobaciones corren ANTES de las reglas de forma del marcador porque la declaracion es otra gramatica, no un marcador mal formado. Cuatro mutaciones una a una, todas muertas: raya rota en NONE_REASON_RE, sufijo en el fallback missing marker, cadena de requires a reason, y debilitar la coexistencia de >0 a >1. El delegado cazo un defecto propio: su asercion negativa por regex parcial dejaba pasar la mutacion del fallback, y la endurecio a igualdad exacta. Verificado por el orquestador que la razon solo-espacios se rechaza por el \S de la propia regex, NO por el cleanup de git como afirmaba el informe: el guard no depende de ningun eje de configuracion externo. Hueco de calidad de mensaje para el revisor: ChangeLedger: none con raya y sin razon devuelve malformed ChangeLedger body en vez de requires a reason; CR2 solo especifica el caso sin raya.
- **2026-07-28T15:49:37Z** `[note]` Tarea 2: changeledger commit --no-change <razon> compone la declaracion. Seis mutaciones una a una; DOS sobrevivieron al primer intento y expusieron huecos reales que el delegado cerro: (a) el gate de estado ambiente sobrevivia con un solo change in-progress porque la asercion no lo veia, y necesito un test con DOS in-progress para morder; (b) la extraccion del valor en bin/ sobrevivia porque ningun test ejercitaba un commit normal a traves del binario. Hallazgo de framework: Commander trata toda opcion larga que empiece por --no- como booleano negado aunque declare argumento obligatorio, asi que el valor aterriza en options.change y su default ausente es el booleano true, no undefined. Verificado por el orquestador que NO hay alias positivo silencioso -changeledger commit --change devuelve unknown option '--change' (Did you mean --no-change?)- y que la opcion sin valor falla con option '--no-change <reason>' argument missing. Decisiones no especificadas, al revisor: --no-change ignora por completo la resolucion de id sea cual sea el numero de changes in-progress; razon vacia y razon con salto de linea se rechazan en el CLI antes de tocar git; el body es exactamente una linea. Cada refutacion prueba por rev-list que no creo commit.
- **2026-07-28T15:59:03Z** `[note]` Tarea 3: la frase de exenciones de core.md nombra el body ChangeLedger: none. Extendida en el sitio, de 95 a 137 chars, sin anadir linea: bloque Commits 28/28 igual, core 193/200 lineas y 11728 a 11770 bytes. Pin de snapshot re-pinneado con clasificacion REPLACED respaldada por grep. Mutacion que prueba que el guard de conteo muerde: partir la frase en dos lineas fisicas da 'the core Commits block is 29 lines, not <= 28'. Tres pins literales actualizados; el primer elemento del par de 124837 CR8 se deja intacto porque etiqueta la redaccion historica retirada de implement.md, no el texto de hoy. HALLAZGO CRUZADO del orquestador, no del delegado: 137 chars es la linea mas larga del bloque por 28 de margen sobre la siguiente, asi que el encaje depende de que NO se envuelva. CH-10 (Prettier) la reflowaria a 80 columnas, el bloque pasaria a 29 y el guard dispararia. El techo de 28 esta medido en lineas fisicas, luego es rehen del ancho de linea, que es la dimension que CH-0 retira como unidad de presupuesto. Decidir en CH-0 o CH-10 si ese techo pasa a tokens o desaparece en favor del techo del core.
- **2026-07-28T15:59:38Z** `[status]` in-progress → in-review
- **2026-07-28T15:59:38Z** `[note]` Mandato de review: superficie que gobierna -src/git.mjs, src/commands/commit.mjs, bin/changeledger.mjs y la frase de exenciones de core.md-, no auditoria completa. Puntos de escrutinio: (1) el pin de snapshot de core.md y su clasificacion; (2) las cuatro decisiones no especificadas de la tarea 2, sobre todo que --no-change ignora la resolucion de id sea cual sea el numero de changes in-progress; (3) el hueco de mensaje: ChangeLedger: none con raya y sin razon devuelve malformed ChangeLedger body en vez de requires a reason, y CR2 solo especifica el caso sin raya; (4) el orden de comprobaciones, requires-a-reason por delante de cannot-coexist; (5) CR3 solo mira marcadores del subject; (6) el workaround del negate de Commander y si deja alguna via alternativa; (7) el hallazgo cruzado de los 137 chars y CH-10. Delegacion por tarea, tres commits, uno por tarea del Plan.
- **2026-07-28T16:13:53Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-28T16:13:53Z** `[note]` CORRECCION DEL REGISTRO. Mi nota de la tarea 1 afirmaba, como verificado por el orquestador, que la razon solo-espacios se rechaza por el \S de NONE_REASON_RE. Es FALSO y el review lo probo: la mutacion \S.* a .* deja los 10 tests verdes. El rechazo lo hace body.trim() en src/git.mjs:212, porque tras el trim el body acaba en la raya y no casa ninguna de las dos regex. Mi propio test llevaba el .trim() dentro y atribui el resultado al mecanismo equivocado. La conclusion sigue en pie y es mas fuerte de lo que escribi: el guard depende de la normalizacion propia de ChangeLedger, no de ningun eje de configuracion externo ni del cleanup de git. Consecuencia: \S es un mutante superviviente, su unico efecto observable es rechazar espacio extra entre la raya y una razon real, y ningun test lo fija.
- **2026-07-28T16:13:53Z** `[note]` Review de contexto limpio: PASS. ~50 intentos de escape contra la propiedad de diseno -espacios, mayusculas, substring, multiparrafo, CRLF, homoglifos U+2013 U+2212 U+2015, cinco modos de cleanup de git, diez variantes de argv- y ninguno alcanzo la exencion sin la declaracion literal. Cinco mutaciones re-derivadas; cuatro muertas y M4 superviviente (el \S). Verificado que el pin de snapshot de core.md es honesto por los dos extremos: recomputar la normalizacion del propio test da el hash nuevo sobre el arbol y el viejo sobre da99c5bb. Clasificacion REPLACED confirmada con grep re-derivado. Alcance: particion exacta en tres, ningun commit mezcla codigo de dos tareas, ningun pin debilitado -los dos literales cambiados son mas largos y mas especificos-. Dos residuos abiertos, ninguno bloqueante: el \S sin fijar, y los marcadores dentro de la razon.
- **2026-07-28T16:25:31Z** `[validation]` in-validation → in-progress (human rejected via conversation): Roberto pide fijar el mutante superviviente \S de NONE_REASON_RE con ronda de confirmacion: su unico efecto observable -rechazar espacio extra entre la raya y una razon real- no lo fija ningun test, y dejar un superviviente aplicaria un estandar mas flojo del que se exige a cada delegado
- **2026-07-28T16:26:52Z** `[status]` in-progress → in-review
- **2026-07-28T16:26:52Z** `[note]` Correccion del orquestador, sin commitear, para ronda de confirmacion con mandato minimo. Un test nuevo en test/check.test.mjs que fija el \S de NONE_REASON_RE: body 'ChangeLedger: none —  padded reason' con dos espacios tras la raya debe dar malformed ChangeLedger body. Verificado por mi: pasa con el codigo actual (124/124) y muere con la mutacion \S.* a .* (124 tests, 1 fallo, justo ese). src/git.mjs restaurado byte-exacto, git diff vacio. Gate completo 857/857. El comentario del test declara por que existe: body.trim() en commitsInRange ya rechaza una razon enteramente blanca, asi que el unico efecto observable del \S es rechazar relleno entre la raya y una razon real. Esa afirmacion viene del review, no de mi, y hay que verificarla antes de dejarla en un comentario permanente: ya escribi una vez el mecanismo equivocado en este mismo change.
- **2026-07-28T16:33:41Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-28T16:33:42Z** `[note]` Ronda de confirmacion con mandato minimo: PASS, sin defectos. El test nuevo pasa 124/124 y muere solo (123 pass, 1 fail) con la mutacion \S.* a .*; ningun otro test depende de ella. El comentario queda verificado en sus dos mitades por ejecucion, no por lectura: body.trim() en src/git.mjs:212 rechaza la razon enteramente blanca con y sin \S, y de siete cuerpos probados solo cambian de veredicto los dos de relleno -tabulador y NBSP-, que es la clase que el comentario nombra. El revisor escaneo todos los code points y confirmo que en Node v24.18.0 los conjuntos de whitespace de \s y String.trim() son identicos hasta U+3000, asi que la discrepancia que sospechaba no existe y no esconde ningun efecto adicional. Confirmado por segunda vez el hueco del espacio de ancho cero: una razon U+200B se acepta con y sin \S porque no es whitespace para ninguna definicion; va al follow-up junto a los marcadores dentro de la razon.
- **2026-07-28T16:37:30Z** `[validation]` in-validation → done (human accepted)
- **2026-07-28T16:39:23Z** `[graduation]` spec: `git-traceability.md`
- **2026-07-28T19:41:27Z** `[archive]` archived
