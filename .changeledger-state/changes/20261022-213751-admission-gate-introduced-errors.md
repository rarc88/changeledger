---
id: "20261022-213751"
title: Converger las puertas de admisión sobre los errores que la escritura introduce
type: bug
status: done
created: 2026-10-22T21:37:51Z
depends_on: ["20261021-223918"]
branch: bug/20261022-213751
related_to: ["20260811-122031"]
owner: raruiz-hiberuscom
---

## Request

Las matrices de equivalencia de `#20261021-223918` destaparon tres
divergencias entre sedes de una misma operación y las dejaron registradas en
su Log y reproducidas en `test/seats-matrix.test.mjs`, sin tocarlas por su
cláusula de frontera. El humano decidió la dirección de cada una:

1. **Admitir un documento con una rotura previa ajena en el repo.** `edit <id>`
   y `new --from` aceptan una escritura limpia; `apply --target change:<id>` y
   `apply --target spec:<slug>` la rechazan; `edit spec:<slug>` aplica una
   tercera regla. Converger las cinco sedes sobre una sola: **solo los errores
   que la escritura introduce la rechazan**, con un ayudante compartido.
2. **`graduate <id> <slug> --new`** escribe una semilla que `edit spec:`
   rechaza. Es diseño de dos fases, declarado en la cabecera de
   `src/commands/graduate.mjs`: no se toca producción; el registro de huecos
   deja de llamarlo divergencia y lo declara como decisión.
3. **`review <id> fail` exige razón y `status <id> in-progress` no.** Ya está
   escrito en `templates/contract/review.md`: la segunda es la vía sin
   veredicto para un fallo de puerta local. Solo se corrige la entrada del
   registro que afirmaba que no estaba escrito en ningún sitio.

Queda fuera: cualquier otra sede, el visor y los repos consumidores.

## Investigation

### Las cinco sedes y sus tres reglas

| sede | función | regla actual |
|---|---|---|
| `new` (scaffold) | `assertScaffoldIntroducesNoErrors` en `src/commands/new.mjs` | `newErrors`: solo lo introducido |
| `new --from` y `apply --target new` | `prepareNewChange` en `src/commands/new.mjs` | `newErrors`: solo lo introducido |
| `edit <id>` y `apply --target change:<id>` | `prepareChangeEdit` en `src/commands/edit.mjs` | `newErrors`: solo lo introducido |
| `edit spec:<slug>` y `apply --target spec:<slug>` | `prepareSpecEdit` en `src/commands/edit.mjs` | filtra a su propio fichero: cualquier error que quede en él |
| `apply`, cualquier entrada, ambos modos | `assertCandidateClean` en `src/commands/apply.mjs` | todos los errores del candidato, previos incluidos |

`apply` corre primero la regla de la sede que la entrada reproduce y después
la suya propia, que es más amplia. La consecuencia: en un repo activado, donde
`edit` y `apply` son las únicas vías de escritura del cuerpo, un error previo
en cualquier documento hace que `apply` rechace cualquier lote, incluido el que
lo arregla y el que no lo toca. Un scaffold pendiente de `graduate --new`
produce exactamente ese error mientras no se reescribe.

### Causa raíz

La regla se decidió dos veces en sitios distintos. `#20260811-122031` cerró el
agujero de «landing con errores y exit 0» y, en la misma nota, adoptó
`newErrors` para `edit` y `new --from` «por consistencia de diseño», pero dejó
`apply` sobre todos los errores para no tocar un test anterior y dejó
`prepareSpecEdit` «intacto, fuera de alcance». Es decir: la asimetría quedó
registrada y aceptada como deuda, nunca como contrato. Ninguna suite sometía
la misma entrada a las sedes, así que nadie la pagó.

Dos textos ya afirman la regla convergida. La spec `architecture.md` describe
la autoría de documentos así: «solo los errores NUEVOS que la escritura
introduce la rechazan (`newErrors`), así que un error pre-existente ajeno
nunca impide escribir el arreglo». Y `apply --help` promete que una entrada
de documento «runs every guard `new --from`/`edit` run». El código de `apply`
y de `prepareSpecEdit` contradice a ambos.

### Decisión que este change revierte

El test `landing refuses a candidate that carries check errors, same as
dry-run` de `test/apply.test.mjs` y su pareja de dry-run fijan la regla
amplia con una spec rota **antes** del lote. Aprobar este draft revierte esa
parte de `#20260811-122031`: un error que el lote no introduce deja de
rechazarlo, en ambos modos. Lo que esa decisión protegía de verdad —que un
lote con errores propios nunca aterrice, ni con `--dry-run` ni sin él— se
conserva íntegro.

### Dirección

- Un ayudante `introducedErrors(repo, candidate)` junto a `newErrors` en
  `src/check.mjs`, que devuelve los errores de `checkRepo(candidate)` ausentes
  en `checkRepo(repo)`. Las cinco sedes lo llaman; cada una conserva su
  mensaje de rechazo, que nombra a la sede y queda fijado en los criterios.
- `prepareSpecEdit` abandona el filtro por fichero. Cambia un caso observable:
  una edición que conserva un error previo del propio spec y no añade ninguno
  pasa a aceptarse. Es la misma regla que `edit <id>` aplica desde
  `#20260811-122031`. No garantiza arreglar una spec por partes: `check`
  nombra solo el primer heading `CRn`, así que reescribir el primero destapa
  el siguiente como error nuevo (follow-up registrado en el Log).
- `apply` devuelve en `errors` los errores introducidos, que son los que
  gatean; `warnings` no cambia.
- En `test/seats-matrix.test.mjs` la rotura previa ajena pasa de hueco a
  **fila de la matriz de admisión**: las dos reproducciones de divergencia se
  borran porque la divergencia desaparece, que es lo que el registro pide; la
  de `graduate --new` se convierte en entrada declarada del registro con
  predicado sobre `scaffoldSpec`; la entrada de `review fail` se reescribe
  como contrato.
- Verdad persistente: `architecture.md` ya enuncia la regla para `edit`; al
  cerrar se amplía la frase para nombrar el ayudante y las cinco sedes, con
  `--into architecture`.

Interfaces externas: ninguna. Los mensajes de `apply` y `edit` son salida de
CLI que ya consumen scripts; su forma se declara estable y sus primeras líneas
se fijan en los criterios.

## Specification

### CR1 — `apply` aterriza una escritura limpia aunque el repo arrastre un error ajeno
- **Given** un repo activado con la spec `demo-spec.md` del fixture `erroringSpec` de `test/apply.test.mjs`, que `check` reporta como `demo-spec.md: spec contains change-local criterion heading "CR1"`, y un change en `draft` cuyo cuerpo no referencia esa spec
- **When** `apply --from` recibe un manifiesto con una entrada `{"target": "change:<id>", "content": <el mismo documento con el cuerpo cambiado>}`
- **Then** aterriza: el tip de `refs/heads/changeledger/state` avanza, `result.changed` tiene un elemento y `result.errors` es `[]`
- **And** con `dryRun: true` sobre el mismo manifiesto, `result.changed` tiene un elemento, `result.errors` es `[]` y el tip no se mueve
- **And** lo mismo con una entrada `{"target": "spec:<otra-spec-limpia>", ...}` cuyo cuerpo cambia un párrafo y no introduce error

### CR2 — `apply` sigue rechazando el error que el lote introduce, en ambos modos
- **Given** el mismo repo de CR1
- **When** la entrada `change:<id>` lleva `depends_on: ["20200101-000001"]`
- **Then** rechaza, con y sin `--dry-run`, con la primera línea `apply refused, nothing was written — entry 1 (change:<id>): edit <id> refused, nothing was written — 1 validation error(s):` y una única línea de detalle `  <fichero del change>: depends_on references missing change "20200101-000001"`, sin ninguna línea sobre `demo-spec.md`; el tip no se mueve y el documento almacenado es byte-idéntico
- **And** la línea es la misma en ambos modos porque una entrada de documento se rechaza en su propia sede antes de que `apply` llegue a su guard de candidato, `assertCandidateClean`; ese guard sigue respondiendo por lo que una entrada de evento deja detrás —`{"op": "task", "action": "block"}` sobre un change `done` se rechaza ahí con `the resulting candidate carries 1 validation error(s):`— y se declara en el registro de huecos (CR6)
- **And** el `bin` sale con código distinto de cero en los dos modos

### CR3 — `edit spec:` acepta una edición que conserva un error previo del propio spec y no añade ninguno
- **Given** un repo activado con la spec `verdad.md` cuyo cuerpo contiene el heading `### CR1 — una verdad`, que `check` reporta como `verdad.md: spec contains change-local criterion heading "CR1"`
- **When** `edit spec:verdad --from` recibe el mismo documento con un párrafo distinto y el heading intacto
- **Then** acepta: `result.changed` es `true` y el tip avanza
- **And** `apply --from` con `{"target": "spec:verdad", "content": <ese mismo documento>}` acepta también

### CR4 — `edit spec:` rechaza solo el error que la edición introduce
- **Given** el repo de CR3
- **When** el documento entrante añade un heading `### CR2 — otra` **antes** de `### CR1 — una verdad`, porque `check` nombra solo el primer heading `CRn` de una spec y uno añadido detrás no cambia el conjunto de errores
- **Then** rechaza con la primera línea `edit spec:verdad refused, nothing was written — 1 validation error(s):` y una única línea de detalle `  verdad.md: spec contains change-local criterion heading "CR2"; rewrite it as durable current truth`, sin mención a `"CR1"`; el tip no se mueve
- **And** `apply --from` con la misma entrada rechaza con la primera línea `apply refused, nothing was written — entry 1 (spec:verdad): edit spec:verdad refused, nothing was written — 1 validation error(s):` y la misma línea de detalle

### CR5 — La rotura previa ajena es una fila de la matriz de admisión y todas las sedes la aceptan
- **Given** un repo sembrado por el ayudante `unrelatedBreak` de `test/seats-matrix.test.mjs`, con un change que `check` reporta como `20260613-200000-roto.md: parent references missing change "20200101-000000"`
- **When** un documento limpio se somete a cada sede de `ADMISSION_SEATS` como una fila más de `ADMISSION_INPUTS`
- **Then** todas responden `accept` y la fila es falsable por sede: anular el ayudante en una sola sede la pone en rojo nombrando esa sede
- **And** los tests `gap — \`edit <id>\` and \`apply --target change:<id>\` still diverge` y `gap — \`edit spec:\` and \`apply --target spec:\` still diverge` ya no existen: `grep -c "still diverge" test/seats-matrix.test.mjs` imprime `0`

### CR6 — Las otras dos entradas del registro describen diseño y contrato, no divergencia
- **Given** `COVERAGE_GAPS` en `test/seats-matrix.test.mjs`
- **When** se lee el registro
- **Then** el test `gap — \`graduate --new\` still admits a spec \`edit spec:\` refuses` ya no existe y en su lugar hay una entrada cuyo texto declara la graduación en dos fases como decisión y cuyo predicado lee el cuerpo de `scaffoldSpec` en `src/commands/graduate.mjs` buscando `SPEC_SCAFFOLD_MARKER`
- **And** la entrada de `in-review → in-progress` dice que las dos sedes difieren por contrato, nombrando `templates/contract/review.md` como el texto que reserva `review fail` a la razón del revisor y `status <id> in-progress` a la vía sin veredicto, y ya no afirma que no esté escrito
- **And** una entrada nueva declara el guard final de `apply`, `assertCandidateClean`, como puerta que ninguna matriz alcanza: las entradas de documento que la matriz rechaza paran antes en su sede, y la puerta responde por lo que una entrada de evento deja detrás; predicado sobre el cuerpo de `apply` en `src/commands/apply.mjs`
- **And** `node --test test/seats-matrix.test.mjs` pasa

### CR7 — El día después: un scaffold pendiente no bloquea el resto del ledger
- **Given** un repo activado con un change `done` graduable y otro change `in-progress`, tras `graduate <id> <slug> --new` sin haber reescrito aún la semilla, de modo que `check` reporta `<slug>.md: spec contains change-local criterion heading "CR1"`
- **When** `apply --from` recibe un manifiesto con una entrada `{"op": "log", "id": "<el otro change>", "message": "nota"}` y una entrada `{"target": "change:<el otro change>", "content": <su documento con el cuerpo cambiado>}`
- **Then** aterriza en un solo commit de la ref de estado y `result.changed` tiene un elemento
- **And** `changeledger check` sigue reportando el error del scaffold, porque este change no cambia `check`

## Plan

- [x] Ayudante `introducedErrors` en `src/check.mjs` y las cinco sedes sobre él, conservando cada mensaje
  - **Target:** `src/check.mjs`, `src/commands/apply.mjs`, `src/commands/edit.mjs`, `src/commands/new.mjs`
  - **Verify:** `node --test test/apply.test.mjs test/edit.test.mjs`
  - **Criteria:** CR1, CR2, CR3, CR4
  - **Resolved:** `2026-10-22T23:14:31Z`
- [x] Retargetear los dos tests de `test/apply.test.mjs` que fijaban la regla amplia a un error introducido por el lote, y añadir los de `edit spec:`
  - **Target:** `test/apply.test.mjs`, `test/edit.test.mjs`
  - **Verify:** `node --test test/apply.test.mjs test/edit.test.mjs`
  - **Criteria:** CR1, CR2, CR3, CR4
  - **Resolved:** `2026-10-22T23:14:31Z`
- [x] Fila de rotura previa ajena en la matriz de admisión y retirada de las dos reproducciones
  - **Target:** `test/seats-matrix.test.mjs`
  - **Verify:** `node --test test/seats-matrix.test.mjs`
  - **Criteria:** CR5
  - **Resolved:** `2026-10-22T23:25:31Z`
- [x] Reescribir las entradas de `graduate --new`, `review fail` y el guard final de `apply` del registro
  - **Target:** `test/seats-matrix.test.mjs`
  - **Verify:** `node --test test/seats-matrix.test.mjs`
  - **Criteria:** CR6
  - **Resolved:** `2026-10-22T23:25:31Z`
- [x] Recorrido del día después con un scaffold pendiente
  - **Target:** `test/apply.test.mjs`
  - **Verify:** `node --test test/apply.test.mjs`
  - **Criteria:** CR7
  - **Resolved:** `2026-10-22T23:14:32Z`
- [x] Suite completa y puertas del repo
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-10-22T23:27:45Z`

## Log
- **2026-10-22T21:37:51Z** `[version]` 0.18.0
- **2026-10-22T21:44:58Z** `[status]` draft → approved (human via conversation)
- **2026-10-22T21:46:10Z** `[status]` approved → in-progress
- **2026-10-22T21:46:10Z** `[branch]` set: bug/20261022-213751 (auto)
- **2026-10-22T22:12:49Z** `[note]` Selección A implementada y verde en local (57/57 en test/apply.test.mjs y test/edit.test.mjs; mutante del ayudante pone en rojo las cuatro sedes de documento). Sin commit: el implementador reportó dos defectos de la Specification que exigen decisión humana antes de dar la selección por resuelta. (1) La primera línea literal de CR2 y de la mitad apply de CR4 es inalcanzable: toda entrada change:/spec: pasa primero por su propia sede, que rechaza el error introducido, y apply la envuelve como 'apply refused, nothing was written — entry 1 (change:<id>): edit <id> refused, nothing was written — 1 validation error(s):'. Eso ya era así antes del change. La línea 'the resulting candidate carries' de assertCandidateClean no la alcanza ninguna entrada hoy: es un respaldo que ningún test ejercita. (2) CR4 solo se cumple si el heading CR2 va ANTES de CR1: check (specDurabilityIssue) nombra solo el primer heading CRn de una spec, así que un heading añadido detrás del primero no cambia el conjunto de errores y la edición se acepta. Residual fuera de alcance: check no ve headings CRn posteriores al primero. (3) El Verify de la tarea 1 nombra test/new.test.mjs, que no existe; las sedes de new se cubren en edit.test.mjs, cli.test.mjs y agent.test.mjs. Impedimento de base: test/seats-matrix.test.mjs no existe en dev, solo en la rama de #20261021-223918; tareas 3 y 4 bloqueadas y depends_on pendiente de declarar.
- **2026-10-22T23:14:30Z** `[note]` Enmienda autorizada por el humano tras el hallazgo del implementador: CR2 y la mitad apply de CR4 fijan ahora la línea de envoltura que apply produce de verdad ('entry 1 (<target>): edit ... refused'), CR4 fija el heading antes de CR1, el Verify de la tarea 1 deja de nombrar test/new.test.mjs, y depends_on declara #20261021-223918 (PR 18 fusionado en dev por orden del humano; dev traído a esta rama). CR6 añade la declaración del guard final de apply como respaldo sin entrada que lo alcance. Tareas 3 y 4 desbloqueadas.
- **2026-10-22T23:15:05Z** `[note]` Corrección de la nota anterior: aquella enmienda NO aterrizó (el script de reemplazo falló en la primera sustitución y edit reportó byte-idéntico), aunque la nota se escribió después como si hubiera ocurrido. La enmienda descrita aterriza en esta edición: CR2, CR4, Verify de la tarea 1, depends_on, CR6 ampliado y tareas 3 y 4 desbloqueadas. El commit de la selección A es correcto y no se ve afectado.
- **2026-10-22T23:25:30Z** `[note]` Selección B verde (11/11 en test/seats-matrix.test.mjs, cero 'still diverge'; mutante por sede: cada sustitución de introducedErrors por la forma de todos-los-errores pone en rojo la fila nueva exactamente en las sedes que corren esa llamada). Corrección de alcance sobre mi enmienda anterior: 'ninguna entrada alcanza assertCandidateClean' era falso. Ejecutado: un manifiesto [{op:'task', action:'block', n:1}] sobre un change done con todas las tareas hechas se rechaza en ese guard, en ambos modos, con 'the resulting candidate carries 1 validation error(s): … status is "done" but 1 task(s) are not done'. CR2 y CR6 se estrechan a lo ejecutado: ninguna entrada de DOCUMENTO lo alcanza; las de evento sí. Divergencia nueva, fuera de alcance por la cláusula 'cualquier otra sede': la sede suelta task <id> block escribe ese mismo bloqueo y deja el repo con ese error de check, mientras apply {op:task} lo rechaza. Se propone como follow-up; no se toca aquí. Residual del implementador: edit spec: y apply --target spec: no son sedes de la matriz de admisión, así que el mutante de prepareSpecEdit sobrevive a este fichero; la rotura previa ajena para specs queda cubierta solo por CR1 y CR3 en test/apply.test.mjs y test/edit.test.mjs.
- **2026-10-22T23:27:46Z** `[note]` Tarea 6: pnpm verify — biome limpio (134 ficheros), suite 2123/2124; el único fallo es 'CR6: the skeletons ship in the publishable package' en test/agent-prompt.test.mjs, preexistente en dev y ajeno a este change (npm 12 imprime npm pack --json como objeto por nombre de paquete y el test lee [0].files); changeledger check en verde por separado.
- **2026-10-22T23:27:46Z** `[status]` in-progress → in-review
- **2026-10-22T23:27:51Z** `[note]` Mandato de la revisión (ronda 1): auditoría completa del diff dev..HEAD de la rama bug/20261022-213751 —dos commits, src/check.mjs, src/commands/{apply,edit,new}.mjs, test/{apply,edit,seats-matrix}.test.mjs— contra CR1-CR7 y contra la superficie que el change gobierna: las cinco sedes de admisión y su regla única. Fuera del mandato se reporta sin inspeccionar.
- **2026-10-22T23:42:33Z** `[review]` in-review → in-progress: ronda 1 (auditoría completa): comportamiento de las cinco sedes correcto y confirmado con mutantes por sede; cinco defectos de verificación y prosa. D1: assertCandidateClean se quedó sin ningún test (convertirlo en no-op deja 0 fallos; en dev 3), regresión de cobertura al retargetear los tests antiguos; la cláusula And de CR2 (task block sobre done) no la ejercita nadie. D2: el comentario de edit.mjs 'a broken spec can be fixed in parts' es falso — con CR1 y CR2 en la spec, reescribir CR1 primero se rechaza por CR2 porque check solo nombra el primer heading; misma exageración en la Investigation. D3: los tests de CR4 no discriminan — con el heading delante, el error previo CR1 desaparece del candidato y 'only' se cumple también con la forma de todos-los-errores y con el filtro antiguo. D4: CR2 y la mitad apply de CR4 fijan la primera línea con una regex que sobrevive a cambiar el texto de la envoltura. D5: el Given de CR5 nombra repoWithUnrelatedBreak, borrado por este change (ahora unrelatedBreak). Clasificación: enumeración incompleta dentro de la estrategia verificada; corrección normal sobre el mismo diff.
- **2026-10-22T23:43:31Z** `[note]` D5 y D2 (parte documento) corregidos en el documento: el Given de CR5 nombra el ayudante real unrelatedBreak; la Investigation deja de afirmar que la regla permite arreglar una spec por partes y nombra la causa (check solo ve el primer heading CRn). Follow-up fuera de alcance: specDurabilityIssue en src/check.mjs nombra solo el primer heading CRn de una spec, lo que hace que CR4 dependa del orden y que una spec con varios CR no pueda reescribirse de uno en uno.
- **2026-10-22T23:54:09Z** `[note]` Corrección de la ronda 1, sin commit hasta confirmación. D1: dos tests nuevos en test/apply.test.mjs (task block sobre un change done, aterrizaje y dry run) fijan el mensaje completo de assertCandidateClean; con el guard anulado fallan con 'Missing expected exception'. D4: REFUSED_ENTRY retirado; CR2 y la mitad apply de CR4 comparan el mensaje completo contra el literal construido con id/target, incluido el stderr del bin; un mutante que inserta texto dentro de la envoltura pone cinco tests en rojo. D3: tests discriminantes nuevos para edit spec: y apply --target spec: con un error previo que persiste en el candidato (updated: ayer → 'updated not ISO 8601 UTC: ayer') más un heading CR1 introducido; la forma de todos-los-errores y el filtro antiguo por fichero los ponen en rojo listando dos líneas; los tests originales de CR4 se conservan y siguen sin discriminar, como dijo la revisión. D2: el comentario de prepareSpecEdit se estrecha a 'un error que check ya reportaba antes de la edición no rechaza una edición que no añade ninguno', con su borde ejecutado (CR1+CR2: reescribir CR1 primero se rechaza por CR2). En clase: guard assertCarries en los tests de CR1-CR4 para que el fixture demuestre su error previo antes de operar. Decisiones no especificadas: manifiesto de D1 con id obligatorio; fixture de D1 de tipo feature porque quick no tiene Plan; error persistente de D3 en updated. Residual: el comentario de apply.mjs no dice que introducedErrors compara por fichero+mensaje, así que un error previo cuyo texto cambia cuenta como introducido.
- **2026-10-22T23:54:09Z** `[status]` in-progress → in-review
- **2026-10-22T23:59:10Z** `[review]` in-review → done (delegated subagent, clean context)
- **2026-10-23T00:01:31Z** `[note]` Graduation-review ronda 1 sobre architecture.md: todo lo comprobable contra el código confirmado; recomendación 'correct' por un universal falso ('la única regla de admisión' sin acotar: el visor y las sedes de ciclo de vida gatean distinto) y dos opcionales (solo las entradas de DOCUMENTO de apply tienen sede propia; newErrors compara fichero+mensaje, así que un error previo cuyo texto cambia cuenta como introducido). Las tres frases corregidas en el spec; se delega de nuevo a un revisor limpio.
- **2026-10-23T00:03:18Z** `[note]` Graduation-review ronda 2 (revisor nuevo): las tres correcciones y el resto de los dos pasajes confirmados contra el código; recomendación 'correct' solo editorial — el inciso entre rayas quedó sin cerrar y arrastraba la cláusula de id/created. Corregido: el inciso cierra con punto y la cláusula de inmutabilidad lleva sujeto propio. Residual anotado por el revisor: graduate --new escribe una semilla sin puerta de admisión por diseño de dos fases y queda fuera de 'las cinco' por el calificador 'sedes de documento'.
- **2026-10-23T00:04:02Z** `[note]` Graduation-review ronda 3 (revisor nuevo): corrección editorial confirmada sin cambio de fondo, prosa cerrada, anclas factuales intactas, frontmatter sin tocar. Recomendación apply.
