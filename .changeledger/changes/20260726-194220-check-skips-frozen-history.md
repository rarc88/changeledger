---
id: "20260726-194220"
title: Excluir la historia congelada de la validación de check
type: bug
status: done
created: 2026-07-26T19:42:20Z
depends_on: []
archived: true
reviewed: true
owner: raruiz-hiberuscom
related_to: ["20260726-141119", "20260613-222915", "20260711-103802"]
---

## Request

`changeledger check` valida los 219 documentos del ledger con las reglas de hoy,
sin distinguir los que ya no se pueden arreglar. De esos 219, **203 son historia
congelada**: 200 con `status: done` y `archived: true`, y 3 con
`status: discarded`.

Un diagnóstico sobre uno de esos 203 no es accionable. `archived` es de una sola
dirección desde que `20260711-103802` retiró el comando `unarchive`, y
`discarded` es un tombstone que el contrato prohíbe reabrir. La única forma de
"arreglar" el documento sería reescribir historia terminada, es decir inventar
criterios de un trabajo que ya cerró.

El coste no es cosmético: el hook `pre-commit` versionado corre `check`
repo-wide, así que un documento de junio invalidado por una regla de julio
**bloquea todo commit del repo**, incluido el trabajo que no lo toca. La
consecuencia real ya está reproducida abajo: activar una stage para un tipo
—cambio de una línea en el config— produjo 21 errores, ninguno accionable, y
dejó el gate rojo.

Se pide que `check` deje de emitir diagnósticos **sobre** un documento congelado,
sin dejar de consumirlo **como dato** en los invariantes que lo cruzan con
documentos vivos, y que nombre en su salida lo que no ha validado en vez de
contarlo como válido.

`bug` no activa `## Proposal`, así que la solución elegida, sus alternativas
descartadas y sus contrapartidas viven aquí, en Investigation.

## Investigation

### Cadena de evidencia

1. `src/repo.mjs:37-70` — `loadRepo` lee todos los `.md` de `changes_dir` sin
   filtrar. Archivados, descartados y vivos entran en `repo.changes` igual.
2. `src/check.mjs:28-32` — `checkRepo` reduce el conjunto a validar únicamente
   por `opts.id`. No hay ningún filtro previo por `status` ni por `archived`.
3. `src/check.mjs:37-103` — el bucle por documento aplica a cada elemento de ese
   conjunto todas las reglas de campos obligatorios, forma de stages, tareas,
   criterios, marcadores de conflicto, gramática del Log y secuencia de
   lifecycle.
4. `src/check.mjs:12` declara `CLOSED_STATUSES = new Set(['done', 'discarded'])`
   y se referencia **una sola vez** en todo el fichero: en `src/check.mjs:187`,
   dentro de `checkUnclassifiedMentions`, donde protege exclusivamente el aviso
   de `src/check.mjs:209`. Es decir: el repo ya tiene el patrón de exención
   escrito y aplicado a una única regla de las cuarenta y tantas del bucle.
5. `src/check.mjs:502-504` — `checkCoverage` ya se salta los documentos cuyo
   status no está en `['draft', 'approved', 'in-progress']`, así que toda la
   familia de readiness es inmune por accidente. El defecto está en las reglas
   que no tienen ese guarda, no en el diseño de readiness.
6. `src/commands/check.mjs:106` — la línea de resumen usa
   `${repo.changes.length} change(s)`, o sea el total leído del disco, no el
   total realmente validado.

### Consecuencia reproducida

Activar `specification` para el tipo `refactor` (una línea de
`.changeledger/config.yml`, el trabajo de `20260726-141119`) hace que
`src/check.mjs:81` reclame la stage ausente en todo documento `refactor` del
ledger, sin mirar su status:

```text
$ node bin/changeledger.mjs check
21 error(s), 0 warning(s) — 219 change(s)
```

Los 21 son historia congelada: 19 con `status: done` y `archived: true`, con
fechas de creación repartidas entre junio y julio de 2026, y 2 con
`status: discarded`. Ninguno de los documentos vivos falla. Sin este cambio, `20260726-141119` no puede
commitear su propio trabajo.

### La clase, no el síntoma

`src/check.mjs:81` es el disparador de hoy, no el problema. Cualquier regla del
bucle por documento cuya definición evolucione reescribe retroactivamente la
validez de los 203. Dos ejes ya identificados en el trabajo en curso:

- El config: activar o desactivar una stage para un tipo mueve
  `src/check.mjs:81` y `src/check.mjs:85`; renombrar un status o un tipo mueve
  `src/check.mjs:48-49`.
- El código: endurecer la gramática de tarea del Plan mueve
  `src/check.mjs:317`, que consume el parser de `src/change.mjs` y no depende del
  config en absoluto.

Por eso la exención se define por documento y cubre el bucle completo, no regla
a regla.

### Solución elegida: sujeto congelado, dato vivo

La distinción que hace correcta la exención es entre el documento como **sujeto**
de una regla y el documento como **dato** de un invariante:

- Un documento congelado deja de ser sujeto: ninguna regla del bucle por
  documento (`src/check.mjs:37-103`) se le aplica.
- Sigue siendo dato: los invariantes de repo consumen `repo.changes` completo,
  sin filtrar.

Predicado, en un solo sitio de `src/check.mjs`, exportado para que nadie lo
re-derive:

```text
congelado = status === 'discarded' || (status === 'done' && archived === true)
```

`done` sin archivar **no** es congelado: son los 2 documentos pendientes de
graduación o archive, trabajo vivo y arreglable. Y un documento que declare
`archived: true` con un status abierto es una anomalía que sólo puede venir de
edición a mano —`archive` sólo archiva `done` graduados o con skip, y `unarchive`
ya no existe—: se valida, para que el gate la nombre en vez de esconderla. Lo que
no se puede decidir no se salta.

### Por qué no un return temprano por documento

La alternativa obvia —sacar los congelados de `repo.changes`, o retornar al
principio de la iteración— es incorrecta, y el inventario del fichero dice
exactamente qué se perdería:

- `src/check.mjs:108-114` — un `id` duplicado entre un documento vivo y uno
  archivado deja de detectarse.
- `src/check.mjs:120-146` — los archivados dejan de ser nodos del grafo: un ciclo
  de `depends_on` que pasa por uno deja de encontrarse (`src/check.mjs:146`), y
  un documento vivo que dependa legítimamente de uno archivado empieza a fallar
  con `depends_on references missing change` (`src/check.mjs:126`), un falso
  positivo nuevo.
- `src/check.mjs:346-361` — `checkSpecs` reconstruye las graduaciones leyendo el
  `## Log` de todos los changes. Sin los archivados, una spec legítimamente
  graduada por historia cerrada aparece como `orphan spec`
  (`src/check.mjs:386`) o dispara `missing graduated_from`
  (`src/check.mjs:384`).
- `src/check.mjs:280-282` — un release que referencie un change archivado deja
  de comprobar que su status sea `done`.
- `src/check.mjs:34-35` — `knownIds` y los backlinks de `related_to` dejan de
  ver a los archivados, así que el aviso de mención sin declarar
  (`src/check.mjs:209`) pierde señal sobre documentos vivos.

Esos cinco son la razón de que el predicado filtre sujetos y no el conjunto de
datos. Es también la razón de que este cambio no sea una línea.

### Alternativa descartada: exención sólo para la forma de stages

Añadir el guarda únicamente a `src/check.mjs:81` y `src/check.mjs:85`
desbloquearía `20260726-141119` con menos superficie tocada. Se descarta porque
deja intacta la clase: la siguiente regla del bucle que evolucione vuelve a
romper el gate con los mismos 203 documentos, y ya hay trabajo aprobado que
tocará la gramática de tarea (`src/check.mjs:317`), que no pasa por el config.

### Alternativa descartada: subir la severidad a warning

Convertir esos errores en avisos mantendría el gate verde. Se descarta porque
203 avisos permanentes e inaccionables en cada `check` entrenan a ignorar la
salida, y porque `check` seguiría afirmando algo falso sobre historia congelada.

### Alternativa descartada: reescribir los documentos cerrados

Insertar `## Specification` en 203 documentos terminados fabricaría criterios de
trabajo ya cerrado. Contradice el modelo (`discarded` no reabre) y la regla de no
inventar requisitos.

### La salida tiene que nombrar la exención

Si `check` valida 16 documentos y sigue imprimiendo `✓ 219 change(s) valid`,
afirma algo que no comprobó, y la exención se vuelve invisible: nadie puede
notar que un documento dejó de validarse por llevar `archived: true` mal puesto.
`src/commands/check.mjs:106` compone ese texto desde `repo.changes.length`, así
que el recuento tiene que venir del validador —que es quien aplica el
predicado— y no recalcularse en la capa CLI, para que la regla siga viviendo en
un solo sitio.

### Superficie compartida y orden

`20260726-141119` está `in-progress` y su tarea de activación de `specification`
espera sin commitear a que este cambio aterrice; ambos escriben
`src/check.mjs`, así que van en secuencia, este primero, nunca en paralelo. Esa
dependencia de ejecución se declara en el change dependiente:
`20260726-141119` lleva `depends_on: ["20260726-194220"]`. El `related_to`
recíproco de aquí se conserva porque `relatedBacklinks`
(`src/check.mjs:153-166`) deriva backlinks sólo de `related_to`, nunca de
`depends_on`, y sin él las menciones de ese id en esta Investigation quedan sin
declarar.

`20260613-222915` introdujo el flag `archived` y validó únicamente su tipo;
`20260711-103802` retiró `unarchive` y con ello hizo el archivado irreversible.
Ambos son contexto, no prerrequisitos.

### Fuera de alcance

- La salida `--json` (`src/commands/check.mjs:98-101`) sigue publicando sólo
  `errors` y `warnings`; no se le añade el recuento de no validados.
- `src/check.mjs:187` conserva su predicado propio (`CLOSED_STATUSES` ∪
  `archived`), más amplio que el de este cambio porque incluye `done` sin
  archivar. Unificarlos cambiaría el comportamiento de otra regla sin criterio
  que lo cubra.
- Los fragmentos de `templates/contract/` no se tocan: son superficie de otros
  changes aprobados.
- `changeledger fix` seguirá pudiendo reescribir un documento congelado si se le
  pide por id; este cambio sólo altera qué diagnostica `check`.

## Specification

### CR1 — Un documento archivado y done no recibe diagnósticos propios

- **Given** un repo cuyo `.changeledger/config.yml` declara
  `refactor: { stages: [request, proposal, specification, plan, log], review_required: true }`
  y un documento `refactor` con `status: done` y `archived: true` cuyo cuerpo
  tiene `## Request`, `## Proposal`, `## Plan` y `## Log` pero no
  `## Specification`
- **When** se ejecuta `node bin/changeledger.mjs check`
- **Then** la salida no contiene ningún error ni aviso cuyo fichero sea ese
  documento
- **And** el comando termina con código de salida 0

### CR2 — Un done sin archivar sí se valida

- **Given** el mismo repo y el mismo documento, con `status: done` y sin la clave
  `archived`
- **When** se ejecuta `node bin/changeledger.mjs check`
- **Then** la salida contiene el error
  `missing active stage "## specification" for type refactor` para ese documento
- **And** el comando termina con código de salida 1

### CR3 — Un documento discarded no recibe diagnósticos propios

- **Given** el mismo repo y el mismo documento, con `status: discarded` y sin la
  clave `archived`
- **When** se ejecuta `node bin/changeledger.mjs check`
- **Then** la salida no contiene ningún error ni aviso cuyo fichero sea ese
  documento
- **And** el comando termina con código de salida 0

### CR4 — archived con un status abierto se valida igual

- **Given** el mismo repo y el mismo documento, con `archived: true` y
  `status: in-progress`
- **When** se ejecuta `node bin/changeledger.mjs check`
- **Then** la salida contiene el error
  `missing active stage "## specification" for type refactor` para ese documento
- **And** el comando termina con código de salida 1

### CR5 — El id duplicado entre un documento vivo y uno archivado se sigue detectando

- **Given** un repo con un documento `status: approved` de id `20260101-000000` y
  otro documento `status: done` con `archived: true` que declara el mismo id
  `20260101-000000` en un fichero distinto
- **When** se ejecuta `node bin/changeledger.mjs check`
- **Then** la salida contiene un error que empieza por
  `duplicate id "20260101-000000" (also in `
- **And** el comando termina con código de salida 1

### CR6 — Un depends_on que apunta a un archivado sigue resolviendo

- **Given** un repo con un documento `status: done` y `archived: true` de id
  `20260101-000000`, y un documento `status: approved` que declara
  `depends_on: ["20260101-000000"]`
- **When** se ejecuta `node bin/changeledger.mjs check`
- **Then** la salida no contiene
  `depends_on references missing change "20260101-000000"`

### CR7 — La graduación registrada por un archivado sigue sosteniendo checkSpecs

- **Given** un repo con una spec cuyo frontmatter declara
  `graduated_from: ["20260101-000000"]`, y un documento `status: done` con
  `archived: true` de id `20260101-000000` cuyo `## Log` contiene el evento de
  graduación hacia esa spec
- **When** se ejecuta `node bin/changeledger.mjs check`
- **Then** la salida no contiene `orphan spec`
- **And** no contiene ningún error que empiece por `spec "` y termine en
  `missing graduated_from "20260101-000000"`
- **And** el comando termina con código de salida 0

### CR8 — El resumen repo-wide nombra lo que no ha validado

- **Given** un repo con 2 documentos válidos que se validan y 1 documento con
  `status: done` y `archived: true`, sin ningún error ni aviso
- **When** se ejecuta `node bin/changeledger.mjs check`
- **Then** la última línea de la salida es exactamente
  `✓ 2 change(s) valid — 1 not validated (archived or discarded)`

### CR9 — Sin documentos congelados el resumen no cambia

- **Given** un repo con 2 documentos válidos y ninguno archivado ni descartado,
  sin errores ni avisos
- **When** se ejecuta `node bin/changeledger.mjs check`
- **Then** la última línea de la salida es exactamente `✓ 2 change(s) valid`, sin
  ningún sufijo

### CR10 — check sobre el id de un documento congelado lo dice

- **Given** el repo del CR1, cuyo documento archivado tiene id
  `20260101-000000`, y un segundo documento con `status: discarded` de id
  `20260102-000000`
- **When** se ejecuta `node bin/changeledger.mjs check 20260101-000000` y después
  `node bin/changeledger.mjs check 20260102-000000`
- **Then** la salida de la primera invocación es exactamente
  `✓ change 20260101-000000 not validated (archived)` y la de la segunda es
  exactamente `✓ change 20260102-000000 not validated (discarded)`
- **And** ambas terminan con código de salida 0

### CR11 — La rama de error del resumen también nombra lo no validado

- **Given** un repo con 2 documentos que se validan, 1 documento con
  `status: done` y `archived: true`, y un error en alguno de los validados
- **When** se ejecuta `node bin/changeledger.mjs check`
- **Then** la última línea de la salida es exactamente
  `1 error(s), 0 warning(s) — 2 change(s), 1 not validated (archived or discarded)`
- **And** en el mismo repo sin ningún documento congelado la última línea es
  exactamente `1 error(s), 0 warning(s) — 2 change(s)`, sin sufijo

### CR12 — Un archived que no es el booleano true no congela

- **Given** un repo con un documento cuyo frontmatter declara `status: done`,
  `archived: "true"` (la cadena, no el booleano) y cuyo nombre de fichero no
  coincide con su `id`
- **When** se ejecuta `node bin/changeledger.mjs check`
- **Then** la salida contiene el error `archived must be a boolean` para ese
  documento
- **And** contiene también el error que empieza por `filename does not match id `
  para ese mismo documento, es decir el documento se valida como cualquier otro
- **And** el comando termina con código de salida 1

### CR13 — Los congelados siguen alimentando la detección de menciones

- **Given** un repo con un documento `status: done` y `archived: true` de id
  `20260101-000000`, y un documento `status: approved` de id `20260102-000000`
  que menciona `20260101-000000` en la prosa de una stage semántica sin
  declararlo en `depends_on` ni en `related_to`
- **When** se ejecuta `node bin/changeledger.mjs check`
- **Then** la salida contiene el aviso
  `mentions change "20260101-000000" without declaring it in depends_on or related_to`
  atribuido al documento `approved`
- **And** si el documento congelado declara `related_to: ["20260102-000000"]`, su
  backlink se sigue derivando y la salida **no** contiene ese aviso, porque la
  relación ya está declarada desde el lado congelado

### CR14 — Un ciclo de depends_on que pasa por un congelado se detecta

- **Given** un repo con un documento `status: done` y `archived: true` de id
  `20260101-000000` que declara `depends_on: ["20260102-000000"]`, y un documento
  `status: approved` de id `20260102-000000` que declara
  `depends_on: ["20260101-000000"]`
- **When** se ejecuta `node bin/changeledger.mjs check`
- **Then** la salida contiene un error que empieza por `dependency cycle: ` y
  nombra ambos ids
- **And** el comando termina con código de salida 1

### CR15 — Los releases siguen leyendo el status de un congelado

- **Given** un repo con un documento `status: discarded` de id
  `20260102-000000` y un manifiesto de release que lo incluye en su lista
  `changes`
- **When** se ejecuta `node bin/changeledger.mjs check`
- **Then** la salida contiene el error
  `references change "20260102-000000" whose status is not done`
- **And** el comando termina con código de salida 1

## Plan

- [x] Definir en `src/check.mjs` el predicado de documento congelado en un único sitio exportado, aplicarlo para separar los sujetos del bucle por documento (`src/check.mjs:37-103`) del conjunto de datos que consumen los invariantes de repo, y devolver desde `checkRepo` los recuentos de validados y no validados; verify: `node --test test/check.test.mjs` (CR1, CR2, CR3, CR4, CR5, CR6, CR7)
  - **Resolved:** `2026-07-26T20:03:49Z`
- [x] Consumir esos recuentos en `src/commands/check.mjs` para que el resumen repo-wide nombre los documentos no validados y `check <id>` sobre un congelado lo declare en vez de llamarlo válido; verify: `node --test test/check.test.mjs test/cli.test.mjs` (CR8, CR9, CR10)
  - **Resolved:** `2026-07-26T20:07:40Z`
- [x] Ejecutar el gate completo y comprobar que el ledger real reporta 17 validados y 203 no validados sin errores; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-26T20:10:33Z`
- [x] Extender el resumen de `src/commands/check.mjs` para que la rama con errores o avisos publique el recuento de no validados con el mismo vocabulario que la rama limpia, sin tocar la forma de la rama limpia ya fijada por CR8 y CR9; verify: `node --test test/cli.test.mjs` (CR11)
  - **Resolved:** `2026-07-26T20:44:50Z`
- [x] Fijar las cuatro conductas de `src/check.mjs` que hoy son correctas pero sobreviven a mutación —`archived` no booleano en el predicado, y las alimentaciones de `knownIds`/backlinks, del grafo de ciclos y de `checkReleases`— corrigiendo ahí mismo cualquiera que no lo esté, y demostrando el valor de cada test con el mutante concreto que mata en vez de con un fallo previo al arreglo; verify: `node --test test/check.test.mjs` (CR12, CR13, CR14, CR15)
  - **Resolved:** `2026-07-26T20:48:18Z`

## Log
- **2026-07-26T19:50:20Z** `[status]` draft → approved
- **2026-07-26T19:53:35Z** `[status]` approved → in-progress
- **2026-07-26T19:53:35Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-26T20:07:33Z** `[note]` Frozen documents (discarded, or done+archived) leave the per-document loop as subjects via the single exported frozenReason; repo-wide invariants keep consuming every change, and the summary reports validated vs not validated counts from the validator
- **2026-07-26T20:10:06Z** `[note]` Corregido el recuento esperado de la tarea de gate: 17 validados, no 16. El 16 se escribió sobre el censo de 219 documentos previo a la creación de este propio documento, que es el 17.º vivo; los 203 congelados coinciden exactamente con lo previsto
- **2026-07-26T20:11:46Z** `[status]` in-progress → in-review
- **2026-07-26T20:22:40Z** `[note]` Mandato de review dimensionado como revision completa del diff mas la superficie que gobierna (consumidores de checkRepo y de los arrays que itera), explicitamente no auditoria repo-wide, con disciplina de alcance como condicion de pass/fail
- **2026-07-26T20:22:41Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-26T20:30:37Z** `[validation]` in-validation → in-progress (human rejected via conversation): Roberto rechaza para no acumular deuda: la rama de error del resumen no revela los documentos no validados y quedan sin fijar el trato de un archived no booleano y tres alimentaciones de datos que sobreviven a mutacion. Se extiende el alcance con criterios nuevos y re-aprobacion; la fuga de los invariantes con el congelado como sujeto sale como change propio
- **2026-07-26T20:31:22Z** `[note]` Alcance extendido tras el rechazo humano: CR11 lleva el recuento de no validados a la rama de error del resumen, y CR12-CR15 fijan con mutantes concretos el trato de un archived no booleano y las tres alimentaciones de datos que sobrevivian (knownIds/backlinks, grafo de ciclos, checkReleases). Fuera de esta extension y pendiente de change propio: los cuatro invariantes de repo que atribuyen errores inarreglables a un documento congelado como sujeto (src/check.mjs:149, 161-163, 374)
- **2026-07-26T20:48:18Z** `[note]` CR11 lleva el recuento de no validados a la rama de error compartiendo una sola frase con la rama limpia; CR12-CR15 quedan fijados con los cuatro mutantes concretos (archived truthy, knownIds/backlinks, grafo de ciclos y checkReleases sobre los sujetos filtrados), todos matados y el fuente restaurado sin cambios: ninguna de las cuatro conductas estaba mal
- **2026-07-26T20:51:18Z** `[status]` in-progress → in-review
- **2026-07-26T21:01:24Z** `[review]` in-review → in-progress (retry): El mutante agrupado de CR13 enmascaro un superviviente real: narrowing relatedBacklinks(changes) a targets deja la suite completa en verde (755/755), asi que la mitad de backlinks que la tarea 5 dice fijar no esta fijada, y la nota de Log que afirma los cuatro mutantes matados es media verdad
- **2026-07-26T21:01:51Z** `[note]` Correccion de la nota anterior: los cuatro mutantes NO quedaron todos matados. El mutante de CR13 agrupaba knownIds y relatedBacklinks, y narrowing solo relatedBacklinks(changes) a targets sobrevive a la suite completa. CR13 gana el escenario reciproco que faltaba: el backlink declarado desde el lado congelado protege al documento vivo de un aviso falso. Sin cambio de comportamiento; la alimentacion de backlinks ya estaba nombrada en la tarea 5 y en la Investigation
- **2026-07-26T21:05:18Z** `[status]` in-progress → in-review
- **2026-07-26T21:09:12Z** `[note]` Mandato de la ronda de confirmacion: minimo, acotado al diff sin commitear de test/check.test.mjs y al criterio CR13, con re-derivacion adversarial del mutante aislado como condicion
- **2026-07-26T21:09:12Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-26T21:21:13Z** `[validation]` in-validation → done (human accepted)
- **2026-07-26T21:24:30Z** `[graduation]` spec: `validation.md`
- **2026-07-28T13:31:39Z** `[archive]` archived
