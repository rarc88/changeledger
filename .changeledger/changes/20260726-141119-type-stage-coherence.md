---
id: "20260726-141119"
title: Acoplar review_required con las stages verificables
type: bug
status: done
created: 2026-07-26T14:11:19Z
depends_on: ["20260726-194220"]
archived: true
reviewed: true
related_to: ["20260726-141120", "20260726-141121"]
owner: raruiz-hiberuscom
---

## Request

`## Specification` no es una stage narrativa más: es la que sostiene toda la
maquinaria de verificación. `checkCoverage` corta en seco si el tipo no la
activa, y `parseChange` sólo extrae bloques `### CRn` de esa stage. Aun así, la
configuración permite declarar `review_required: true` sobre un tipo que no
activa ni `specification` ni `plan`, sin ningún error de configuración.

El resultado observado es un tipo que exige revisión independiente y a la vez no
puede contener nada verificable: el revisor recibe un encargo sin criterios que
comprobar. Este repo ya está en esa situación con `refactor`.

Se pide cerrar el hueco por el esquema —que `changeledger check` rechace esa
combinación— y corregir `refactor`, que es el caso real que la configuración
distribuida propaga a todos los repos consumidores.

`bug` no activa `## Proposal`, así que la solución elegida, sus alternativas
descartadas y sus contrapartidas viven aquí, en Investigation.

## Investigation

### Cadena de evidencia

1. `.changeledger/config.yml:67-69` declara el tipo `refactor` con
   `stages: [request, proposal, plan, log]` y `review_required: true`. Exige
   revisión y no activa `specification`.
2. `src/check.mjs:503` — `if (!active?.includes('specification')) return;`
   cortocircuita el bloque completo de cobertura y readiness (`checkCoverage`,
   aproximadamente líneas 501-548). Con ese retorno temprano se vuelven
   inalcanzables cuatro diagnósticos: criterio sin Given/When/Then, referencia a
   un `CRn` inexistente, tarea con `(CRn)` sin target ni verificación, y huecos
   de cobertura.
3. `src/change.mjs:19-21` — los bloques de criterio se parsean únicamente de la
   stage `specification`, de modo que unos `CRn` escritos bajo `## Proposal`
   producen `criteria = []`.
4. `src/check.mjs:83-85` — escribir el encabezado `## Specification` en un
   `refactor` no es una salida: es un error duro,
   `stage "## specification" is not active for type refactor`. El autor no puede
   arreglarlo desde el documento.
5. `src/check.mjs:635-687` — `checkConfig` valida sólo que cada stage declarada
   pertenezca a la lista canónica y que `review_required` sea booleano. Nada
   acopla ambas cosas. Verificado en un repo de prueba: añadir
   `review_required: true` al tipo `quick` (`stages: [request, log]`) no produce
   ningún error de configuración.

   ```text
   $ node bin/changeledger.mjs check
   ✓ 0 change(s) valid
   ```

6. `templates/config.yml:52-70` declara stages y `review_required` idénticos a
   `.changeledger/config.yml:58-73`, así que el defecto se hereda en cada repo
   creado con `changeledger init`.
7. `templates/contract/spec.md:87` publica la matriz de activación por defecto
   con la fila `| refactor | ✓ | — | ✓ | — | ✓ | ✓ |`, es decir el contrato
   documenta el hueco como si fuera intencional.

### Consecuencia reproducida

Un `refactor` cuyo Plan cita un `(CR1)` inexistente y contiene una tarea sin
target ni verificación pasa la validación sin una sola advertencia:

```text
$ node bin/changeledger.mjs check
✓ 1 change(s) valid
```

### Solución elegida: dos partes acopladas

Ambas partes tienen que entrar juntas, porque la primera invalida la propia
configuración de este repo si no se aplica la segunda.

1. `checkConfig` emite un error cuando un tipo declara `review_required: true`
   sin tener `specification` y `plan` entre sus stages activas. El mensaje nombra
   el tipo y las stages ausentes en orden canónico.
2. El tipo `refactor` gana `specification` en `.changeledger/config.yml`, en
   `templates/config.yml` y en la matriz de `templates/contract/spec.md`.

Justificación de la parte 2: un `refactor` que exige revisión es precisamente el
tipo con mayor probabilidad de cambiar comportamiento en silencio, y sus
criterios son la prueba de que el comportamiento se preservó. La objeción "una
stage más para trabajo mecánico" no aplica: el trabajo mecánico pertenece a
`chore` o `quick`, no a `refactor`.

Alternativa descartada: relajar `src/check.mjs:503` para que `checkCoverage`
corriera en todos los tipos. Se descarta porque `src/change.mjs:19-21` no
parsearía criterios fuera de `specification`, así que todo tipo sin esa stage
recibiría huecos de cobertura imposibles de cerrar.

Alternativa descartada: quitar `review_required: true` de `refactor`. Se descarta
porque el problema real no es la revisión, sino la ausencia de criterios que
revisar.

### Riesgo de migración: sí rompe, y hay que resolverlo en el mismo cambio

`src/check.mjs:80-81` valida la ausencia, no sólo la presencia indebida:

```js
for (const k of active)
  if (!present.includes(k)) err(c, `missing active stage "## ${k}" for type ${fm.type}`);
```

Es un error incondicional, independiente del estado. Reproducido sobre los dos
`refactor` en estado `approved` que ya existen en este ledger, activando
`specification` para el tipo:

```text
error  20260726-124833-remove-have-context-flag.md: missing active stage "## specification" for type refactor
error  20260726-124833-remove-have-context-flag.md: Plan task references unknown criterion "CR1"
error  20260726-124833-remove-have-context-flag.md: Plan task references unknown criterion "CR2"
error  20260726-124833-remove-have-context-flag.md: Plan task references unknown criterion "CR3"
error  20260726-124833-remove-have-context-flag.md: Plan task references unknown criterion "CR4"
error  20260726-124833-remove-have-context-flag.md: Plan task references unknown criterion "CR5"
error  20260726-124837-commit-granularity-per-task.md: missing active stage "## specification" for type refactor
```

Dos hallazgos:

- El error de stage ausente confirma que la parte 2 invalidaría retroactivamente
  ambos documentos aprobados si no se les escribe su `## Specification` en el
  mismo commit. `changeledger fix --structured-sections` no sirve:
  `migrateStructuredSections` en `src/fix.mjs:62-110` sólo migra metadatos de
  tarea y eventos de Log, nunca inserta encabezados de stage. La reparación es
  manual y forma parte de este cambio.
- `remove-have-context-flag.md` ya cita `(CR1)`…`(CR5)` en su Plan sin que exista
  ninguna Specification donde declararlos. Cinco referencias huérfanas que el
  retorno temprano mantenía invisibles. Es la demostración directa del defecto en
  producción, no una hipótesis.

`src/config-migration.mjs` sí tiene que participar. Un repo consumidor en
`schema_version: 3` mantiene `refactor` con `review_required: true` y sin
`specification`, de modo que la parte 1 le produciría un error de configuración
sin ruta de reparación automática. Se añade una migración 3 → 4 que inserta las
stages ausentes en los tipos que declaran `review_required: true`, siguiendo el
patrón aditivo de `migrateToV2` y `migrateToV3` (`src/config-migration.mjs:153-176`)
y elevando `SUPPORTED_SCHEMA_VERSION` a 4. `src/commands/check.mjs:83-88` ya
advierte del esquema desfasado y apunta a `changeledger config migrate`.

Contrapartida asumida: un repo consumidor con documentos `refactor` antiguos
tendrá que escribirles `## Specification` tras migrar. Es coste real, y es la
misma deuda que este repo paga aquí; el alternativo —dejar que `refactor` exija
revisión sin criterios— es peor.

### Faceta relacionada, explícitamente fuera de alcance

`.changeledger/config.yml:70-71` activa `plan` para `chore` sin `specification`,
así que sus tareas de Plan no reciben ningún diagnóstico de trazabilidad, ni
siquiera el aviso `references no criterion` de `src/check.mjs:543-547`. `chore` no
declara `review_required`, así que ningún revisor queda mal dirigido: es una
pérdida de trazabilidad, no una incoherencia de rol. Se registra como consecuencia
conocida del mismo retorno temprano y queda fuera del alcance de este cambio.

### Relaciones

`20260726-141120` impide entrar en `in-review` a los tipos sin `review_required` y
depende de este cambio: el acoplamiento del esquema tiene que existir primero para
que declarar `review_required` en un tipo ligero ya sea imposible sin declarar
también las stages verificables. `20260726-141121` toca la composición de
fragmentos de contexto por tipo y comparte la matriz de activación, sin imponer
orden de ejecución.

## Specification

### CR1 — Tipo ligero con revisión: faltan las dos stages

- **Given** un repo cuyo `.changeledger/config.yml` declara
  `quick: { stages: [request, log], review_required: true }` y
  `stages: [request, investigation, proposal, specification, plan, log]`
- **When** se ejecuta `node bin/changeledger.mjs check`
- **Then** la salida contiene el error
  `config type "quick": review_required: true requires active stages: specification, plan`
- **And** el comando termina con código de salida 1

### CR2 — Sólo falta specification

- **Given** un repo cuyo `.changeledger/config.yml` declara
  `refactor: { stages: [request, proposal, plan, log], review_required: true }`
- **When** se ejecuta `node bin/changeledger.mjs check`
- **Then** la salida contiene el error
  `config type "refactor": review_required: true requires active stages: specification`
- **And** no aparece ningún otro error de configuración para el tipo `refactor`

### CR3 — Sólo falta plan

- **Given** un repo cuyo `.changeledger/config.yml` declara
  `audit: { stages: [request, investigation, specification, log], review_required: true }`
- **When** se ejecuta `node bin/changeledger.mjs check`
- **Then** la salida contiene el error
  `config type "audit": review_required: true requires active stages: plan`

### CR4 — Configuraciones legítimas no producen error

- **Given** un repo con la configuración distribuida por `changeledger init`, en la
  que `feature` y `bug` declaran `review_required: true` junto con `specification` y
  `plan`, y `audit`, `chore` y `quick` no declaran `review_required`
- **When** se ejecuta `node bin/changeledger.mjs check`
- **Then** la salida no contiene la cadena `requires active stages`
- **And** añadir `review_required: false` al tipo `quick` con
  `stages: [request, log]` tampoco produce ese error

### CR5 — refactor activa specification en los tres artefactos versionados

- **Given** el árbol de trabajo de este repo tras el cambio
- **When** se leen `.changeledger/config.yml`, `templates/config.yml` y
  `templates/contract/spec.md`
- **Then** el tipo `refactor` declara
  `stages: [request, proposal, specification, plan, log]` en los dos ficheros de
  configuración
- **And** la fila de la matriz de activación en `templates/contract/spec.md` es
  `| refactor | ✓ | — | ✓ | ✓ | ✓ | ✓ |`

### CR6 — La migración de esquema 3 → 4 repara los repos consumidores

- **Given** un `.changeledger/config.yml` con `schema_version: 3` y
  `refactor: { stages: [request, proposal, plan, log], review_required: true }`
- **When** se ejecuta `node bin/changeledger.mjs config migrate`
- **Then** el resumen incluye
  `added stage specification to types.refactor.stages`
- **And** el fichero resultante declara
  `stages: [request, proposal, specification, plan, log]` para `refactor` y
  `schema_version: 4`
- **And** los tipos sin `review_required` conservan sus stages byte a byte, y
  `node bin/changeledger.mjs check` ya no emite `requires active stages`

### CR7 — Documento refactor preexistente sin Specification

- **Given** un repo con `refactor` ya activando `specification` y un documento
  `refactor` en estado `approved` cuyo cuerpo tiene `## Request`, `## Proposal`,
  `## Plan` y `## Log` pero no `## Specification`
- **When** se ejecuta `node bin/changeledger.mjs check`
- **Then** la salida contiene el error
  `missing active stage "## specification" for type refactor`
- **And** tras insertar `## Specification` con un bloque `### CR1` que declara
  Given, When y Then, y con la tarea de Plan citando `(CR1)` junto a target y
  verificación, `node bin/changeledger.mjs check` no reporta ningún error para ese
  documento

### CR8 — Los diagnósticos antes inalcanzables se emiten

- **Given** un repo con `refactor` ya activando `specification` y un documento
  `refactor` en estado `approved` con `## Specification` que declara sólo `### CR1`
  y un Plan con la tarea
  `- [ ] Ajustar el comportamiento (CR9)`
- **When** se ejecuta `node bin/changeledger.mjs check`
- **Then** la salida contiene el error
  `Plan task references unknown criterion "CR9"`
- **And** contiene también un error que empieza por
  `Plan task for CR9 must name target and verification (`
- **And** el comando termina con código de salida 1, no con
  `✓ 1 change(s) valid`

## Plan

- [x] Añadir a `checkConfig` en `src/check.mjs` la regla que exige `specification` y `plan` cuando `review_required` es `true`, nombrando las stages ausentes en orden canónico
  - **Verify:** `node --test test/check.test.mjs`
  - **Criteria:** CR1, CR2, CR3, CR4
  - **Resolved:** `2026-07-26T21:33:38Z`
- [x] Activar `specification` para `refactor` en `.changeledger/config.yml`, `templates/config.yml` y la fila de la matriz en `templates/contract/spec.md`, y escribir en el mismo paso la `## Specification` ausente de los dos documentos `refactor` aprobados del ledger, declarando los `CRn` que sus Planes ya citan
  - **Verify:** `node --test test/contract.test.mjs`
  - **Criteria:** CR5, CR7
  - **Resolved:** `2026-07-26T21:27:39Z`
- [x] Añadir la migración de esquema 3 → 4 en `src/config-migration.mjs` que inserta las stages ausentes en los tipos con `review_required: true` y elevar `SUPPORTED_SCHEMA_VERSION`
  - **Verify:** `node --test test/config-migration.test.mjs`
  - **Criteria:** CR6
  - **Resolved:** `2026-07-26T21:40:01Z`
- [x] Cubrir en `src/check.mjs` los diagnósticos que el retorno temprano mantenía inalcanzables para un `refactor` en `approved`
  - **Verify:** `node --test test/check.test.mjs`
  - **Criteria:** CR8
  - **Resolved:** `2026-07-26T21:40:01Z`
- [x] Ejecutar el gate completo `pnpm verify` y comprobar que `changeledger check` no reporta errores nuevos en el ledger real
  - **Support:**
  - **Resolved:** `2026-07-26T21:43:04Z`

## Log
- **2026-07-26T15:05:03Z** `[status]` draft → approved
- **2026-07-26T18:45:30Z** `[status]` approved → in-progress
- **2026-07-26T18:45:41Z** `[note]` Ejecución en orden 2→1→3→4→5: la regla de checkConfig invalida el config de este repo hasta que refactor active specification, así que la tarea 2 va primero para que cada commit pase el gate
- **2026-07-26T18:54:09Z** `[note]` Tarea 2 (parcial, bloqueada): refactor ya activa specification en .changeledger/config.yml, templates/config.yml y la matriz de templates/contract/spec.md; escritas las Specification de 20260726-124833 (los CR1-CR5 que su Plan ya citaba, elevados de Proposal a su stage) y de 20260726-124837 (CR1-CR5 derivados de sus Criterios verificables). Ambos documentos pasan check limpios. BLOQUEO: la Investigation subestimó el alcance de la migración — el error de src/check.mjs:81 es ciego al status y a archived, así que la activación invalida los 21 documentos refactor cerrados del ledger (19 done, 2 discarded), no solo los 2 aprobados. pnpm lint y las 742 pruebas pasan; changeledger check falla con 21 error(s). Requiere decisión humana: acotar el error de stage ausente a draft/approved/in-progress (src/check.mjs, fuera del alcance de esta tarea y no cubierto por ningún CRn aprobado) u otra vía.
- **2026-07-26T19:53:35Z** `[status]` in-progress → blocked
- **2026-07-26T21:27:39Z** `[status]` blocked → in-progress
- **2026-07-26T21:27:39Z** `[note]` Desbloqueado: 20260726-194220 exime la historia congelada, asi que activar specification para refactor ya no invalida los 203 documentos cerrados y check queda verde con los 2 aprobados llevando su Specification. Al recuperar el trabajo del stash, la fusion con lo aterrizado despues dejo dos conflictos aditivos (Log de este documento y test/check.test.mjs); al resolverlos, los dos bloques de test compartian el mismo cierre y hubo que cerrar el test de CR15 aparte
- **2026-07-26T21:40:48Z** `[note]` Tareas 1, 3 y 4: checkConfig acopla review_required con specification+plan (mensaje con las stages ausentes en orden canonico); migracion 3 -> 4 en src/config-migration.mjs que inserta las stages que faltan en los tipos con review_required: true leyendo el doc vivo (no el snapshot previo, para que un review_required anadido por migrateToV1 en la misma corrida tambien se repare), SUPPORTED_SCHEMA_VERSION a 4, config propio migrado con changeledger config migrate y templates/config.yml a 4; CR8 ya funcionaba tras la tarea 2, asi que la entrega es el guard, matado revirtiendo la activacion de specification en el config del fixture
- **2026-07-26T21:42:37Z** `[note]` Tareas 1, 3 y 4 en un commit combinado: test/check.test.mjs lleva los guardas de las tres y el salto de SUPPORTED_SCHEMA_VERSION a 4 las hace inseparables ahi (un commit por tarea exigiria staging por hunks, y cada commit parcial dejaria la suite roja: el literal schema_version 4 del fixture es incompatible con SUPPORTED 3, y los tests de CR1-CR4 requieren la regla de checkConfig ya presente)
- **2026-07-26T21:43:49Z** `[status]` in-progress → in-review
- **2026-07-26T21:57:13Z** `[note]` Mandato de review dimensionado como revision completa del diff mas la superficie que gobierna (consumidores de SUPPORTED_SCHEMA_VERSION, de la constante exportada y de la cadena de migracion), no auditoria repo-wide, con disciplina de alcance como condicion de pass/fail
- **2026-07-26T21:57:13Z** `[review]` in-review → in-progress (retry): migrateToV4 inserta una stage que la lista canonica del propio config no contiene: con stages sin specification, la inserta en el indice 0 y deja el config invalido con 'references unknown stage', mientras config migrate declara que ya no hay nada que hacer. La remediacion que la herramienta prescribe corrompe un config valido
- **2026-07-26T22:00:06Z** `[status]` in-progress → in-review
- **2026-07-26T22:03:59Z** `[note]` Mandato de la ronda de confirmacion: minimo, acotado al diff sin commitear de src/config-migration.mjs y test/config-migration.test.mjs, con reproduccion independiente del defecto original y mutante aislado como condicion
- **2026-07-26T22:03:59Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-26T22:10:50Z** `[validation]` in-validation → done (human accepted)
- **2026-07-26T22:13:09Z** `[graduation]` spec: `lifecycle.md`
- **2026-07-26T22:13:09Z** `[graduation]` spec: `architecture.md`
- **2026-07-28T13:31:39Z** `[archive]` archived
