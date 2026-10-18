---
id: "20261018-131621"
title: Retirar los estados in-validation y blocked del ciclo de vida
type: feature
status: in-progress
created: 2026-10-18T13:16:21Z
depends_on: []
branch: feature/20261018-131621
related_to: ["20260726-124835", "20260619-171002", "20260614-151759", "20260715-125139", "20260722-124655"]
owner: raruiz-hiberuscom
release_impact: major
---

## Request

Primer change del plan de recorte registrado en `docs/changeledger-v1-plan.md`.
El ciclo de vida baja de ocho estados a seis: desaparecen `in-validation` y
`blocked`, y con ellos los comandos `validation` y `reopen`.

La aceptación humana **no se pierde**: deja de ser un estado y pasa a ser un
dato. `review pass` lleva el change a `done`, que significa «entregado»; el
merge de su rama en la rama de integración es la aceptación, y queda registrada
en el documento como dato, no como puerta. La única frontera irreversible es el
**release**: mientras el change no figure en un release registrado vuelve a
`in-progress` sin ningún comando especial.

`blocked` lo sustituye lo que ya existe: una tarea `[!]` con su razón en el Log.
La taxonomía de clases de fallo que hoy vive en `blocked.md` no se pierde: se
muda a `review.md` y pasa a cubrir también el rechazo humano.

Fuera de alcance, por pertenecer a otros changes del mismo plan: el aislamiento
de correcciones y las clases de commit, el DoR y el flag `tdd`, la reducción de
tipos, la limpieza de duplicación del contrato, las cápsulas y la revisión por
selección resuelta.

## Investigation

Medido sobre los 1.648 changes de los tres repos que usan ChangeLedger.

- **La puerta de validación hace trabajo real.** 272 rechazos humanos
  registrados: 102 en `ionic-app` sobre 61 changes, 109 en `backend-laravel`
  sobre 86, 44 aquí sobre 36. Por eso la aceptación se conserva como dato: si
  desapareciera entera, se pierde la única señal de cuántas veces el humano
  rechaza lo entregado.
- **`blocked` apenas se usa.** 81 changes pasaron por él: 4 % aquí, 7 % en
  `ionic-app`, 5 % en `backend-laravel`. Lo que sí tiene valor es su taxonomía
  de clases de fallo, introducida por `20260722-124655`.
- **Coste en contrato.** `## Lifecycle` de `core.md` son 334 palabras de 2.141;
  `validation.md` 243 y `blocked.md` 206. La auditoría clasificó las nueve
  reglas de `validation.md` como reformulaciones de invariantes que ya están en
  `core.md`.
- **Coste en tests.** Los dos estados aparecen en 13 y 17 ficheros de test.
  `metrics.mjs` los nombra en `ACTIVE` y deriva `validationWaitMs` de
  `in-validation`.
- **Documentos vivos afectados.** Ninguno en este repo. En los repos
  consumidores hay 17: 14 en `in-validation` y 3 en `blocked`. Los 1.587
  terminales no se validan (`check` omite archivados y descartados), así que el
  histórico no se toca.

## Proposal

### Solución elegida

El estado `in-validation` se sustituye por un campo. `review <id> pass` mueve
`in-review → done`. `done` significa «entregado por el agente, pendiente de que
el humano lo acepte». La aceptación se registra cuando la rama del change está
fusionada en la rama de integración.

```mermaid
stateDiagram-v2
    [*] --> draft
    draft --> approved
    approved --> in_progress
    in_progress --> in_review
    in_review --> in_progress
    in_review --> done
    done --> in_progress
    done --> [*]
    draft --> discarded
    approved --> discarded
    in_progress --> discarded
```

`done → in-progress` sustituye tanto al rechazo humano de hoy como a `reopen`.
La frontera no es la aceptación sino el release: `release record <version>`
congela la membresía de una versión publicada, así que un change incluido en
`.changeledger/releases/<version>.yml` ya no puede crecer sin que esa versión
mienta sobre lo que contiene. Graduación y archivo dejan de ser fronteras —
`--into` no sobrescribe el cuerpo de la spec y el archivo es reversible
editando `archived: false`, según `close.md`.

`blocked` desaparece sin sustituto de estado: un impedimento es una tarea `[!]`
con su razón, que ya es gramática válida del Plan, más una nota en el Log.
`review fail --block` desaparece; queda `review fail`.

### Alternativas descartadas

- **Borrar la aceptación entera y confiar en el PR.** Descartada: se pierden los
  272 rechazos como señal medible, y nada garantiza que la revisión del PR
  cubra lo que cubría la validación.
- **Renombrar `in-validation` a otro estado.** Descartada: conserva el overlay,
  el presupuesto, la fila de la matriz y los comandos. El coste no baja.
- **Un comando `accept` explícito.** Descartada: es `validation pass` con otro
  nombre, y sigue dependiendo de que alguien lo escriba. Derivarlo de git lo
  hace verificable y no falsificable.
- **Mantener la aceptación como frontera.** Descartada: medido sobre los 1.290
  changes de los repos de producto, las 16 reaperturas ocurrieron todas antes de
  graduar y ninguna chocó con la regla; lo que sí es incoherente es que el
  contrato liste tres fronteras durables cuando dos son reversibles.
- **Construir una migración para los 17 documentos vivos.** Descartada: v1.0 es
  ruptura limpia y los modos de migración de `fix` se retiran en otro change.
  `check` nombra el estado retirado y el destino, y los 17 se editan a mano.

## Specification

### CR1 — El conjunto de estados pierde los dos retirados
- **Given** `.changeledger/config.yml` de este repo
- **When** se lee la clave `statuses`
- **Then** su valor es exactamente `[draft, approved, in-progress, in-review, done, discarded]`
- **And** ni `in-validation` ni `blocked` aparecen en el fichero

### CR2 — Un documento vivo en un estado retirado se rechaza con mensaje accionable
- **Given** un change no archivado con `status: in-validation`
- **When** se ejecuta `changeledger check <id>`
- **Then** sale con código distinto de cero
- **And** imprime `status "in-validation" is retired: move it to "done" or "in-progress"`
- **And** con `status: blocked` imprime `status "blocked" is retired: move it to "in-progress" and record a [!] task`

### CR3 — El histórico archivado sigue siendo válido
- **Given** los 358 changes archivados o descartados del ledger de este repo, cuyos Log contienen entradas `[validation] in-validation → done` y `[status] ... → blocked`
- **When** se ejecuta `changeledger check`
- **Then** sale con código 0
- **And** no emite ningún diagnóstico sobre esas entradas

### CR4 — `review pass` entrega a `done`
- **Given** un change en `in-review`
- **When** se ejecuta `changeledger review <id> pass`
- **Then** el frontmatter queda `status: done`
- **And** el Log recibe una entrada `[review]` con payload `in-review → done`

### CR5 — `review fail` devuelve a `in-progress` sin flags de clase
- **Given** un change en `in-review`
- **When** se ejecuta `changeledger review <id> fail "motivo"`
- **Then** el frontmatter queda `status: in-progress`
- **And** el Log recibe `[review]` con payload `in-review → in-progress: motivo`

### CR6 — `--block` y `--retry` ya no existen
- **Given** un change en `in-review`
- **When** se ejecuta `changeledger review <id> fail --block "motivo"`
- **Then** sale con código distinto de cero
- **And** imprime `error: unknown option '--block'`
- **And** el documento queda sin modificar
- **And** lo mismo ocurre con `--retry`

### CR7 — Un `done` fuera de todo release vuelve a `in-progress`
- **Given** un change en `done` que no figura en ningún fichero de `.changeledger/releases/`
- **When** se ejecuta `changeledger status <id> in-progress`
- **Then** el frontmatter queda `status: in-progress`
- **And** el Log recibe `[status]` con payload `done → in-progress`

### CR8 — Estar aceptado no cierra la vuelta
- **Given** un change en `done` con `accepted_at: 2026-10-18T10:00:00Z` que no figura en ningún release registrado
- **When** se ejecuta `changeledger status <id> in-progress`
- **Then** el frontmatter queda `status: in-progress`
- **And** el Log recibe `[status]` con payload `done → in-progress`

### CR9 — Un change publicado en un release no vuelve
- **Given** un change en `done` cuyo id figura en la lista `changes:` de `.changeledger/releases/0.19.0.yml`
- **When** se ejecuta `changeledger status <id> in-progress`
- **Then** sale con código distinto de cero
- **And** imprime `change <id> shipped in release 0.19.0: new work needs a new change`
- **And** el documento queda sin modificar

### CR10 — La aceptación se deriva del merge, no de una afirmación
- **Given** un change en `done` sin `accepted_at`, cuya rama `feature/<id>` está fusionada en la rama publicada como `integration_branch`
- **When** se ejecuta `changeledger check <id>`
- **Then** el frontmatter recibe `accepted_at` con el instante del commit de merge en ISO 8601 UTC
- **And** el Log recibe `[validation]` con payload `accepted (merged <sha-corto>)`

### CR11 — Sin merge no hay aceptación
- **Given** un change en `done` sin `accepted_at` cuya rama no está fusionada en la rama de integración
- **When** se ejecuta `changeledger check <id>`
- **Then** el frontmatter sigue sin `accepted_at`
- **And** el Log no recibe ninguna entrada `[validation]`

### CR12 — Un change sin rama registrada no bloquea ni inventa aceptación
- **Given** un change en `done` sin `accepted_at` y sin entrada `[branch]` en su Log
- **When** se ejecuta `changeledger check <id>`
- **Then** sale con código 0
- **And** el frontmatter sigue sin `accepted_at`

### CR13 — El contrato publica seis estados, una sola frontera y ningún overlay retirado
- **Given** la captura de `changeledger context`
- **When** se lee su sección de ciclo de vida
- **Then** enumera exactamente los seis estados de CR1
- **And** nombra el release como única frontera irreversible, sin mencionar graduación ni archivo como tales
- **And** no contiene las cadenas `in-validation` ni `blocked`
- **And** `templates/contract/validation.md` y `templates/contract/blocked.md` no existen

### CR14 — La taxonomía de clases de fallo sobrevive en review
- **Given** la captura de `changeledger context review`
- **When** se lee su contenido
- **Then** distingue la enumeración incompleta dentro de una estrategia ya verificada de una clase nueva de defecto
- **And** declara que esa clasificación se aplica igual a un veredicto `fail` del revisor y a un rechazo humano

### CR15 — Las métricas dejan de derivar de un estado inexistente
- **Given** un ledger con changes en los seis estados
- **When** se calculan las métricas
- **Then** `ACTIVE` de `src/metrics.mjs` es `['approved', 'in-progress', 'in-review']`
- **And** el campo `validationWaitMs` desaparece del resultado
- **And** se expone `rejectionCount`, el número de transiciones `done → in-progress` del ledger

### CR16 — El viewer no ofrece carriles ni acciones retiradas
- **Given** el viewer sirviendo este repo
- **When** se carga el tablero
- **Then** no hay carril para `in-validation` ni para `blocked`
- **And** no se renderizan los paneles de validación ni de reapertura

### CR17 — Los comandos `validation` y `reopen` ya no existen
- **Given** el repo con la CLI instalada
- **When** se ejecuta `changeledger validation 20261018-131621 pass`
- **Then** sale con código distinto de cero
- **And** imprime `error: unknown command 'validation'`
- **And** `changeledger reopen 20261018-131621 "motivo"` imprime `error: unknown command 'reopen'`
- **And** ninguno de los dos aparece en la salida de `changeledger help`

## Plan

- [x] Reducir el conjunto de estados en la configuración y rechazar los retirados en `check`
  - **Target:** `.changeledger/config.yml`, `src/check.mjs`
  - **Verify:** `node --test test/check.test.mjs`
  - **Criteria:** CR1, CR2, CR3
  - **Resolved:** `2026-10-18T15:02:09Z`
- [x] Reorientar las transiciones de `review` y retirar sus flags de clase
  - **Target:** `src/lifecycle.mjs`, `src/commands/agent.mjs`, `bin/changeledger.mjs`
  - **Verify:** `node --test test/lifecycle.test.mjs test/agent.test.mjs`
  - **Criteria:** CR4, CR5, CR6
  - **Resolved:** `2026-10-18T16:15:20Z`
- [ ] Hacer del release la única frontera de la vuelta de `done` a `in-progress`
  - **Target:** `src/change.mjs`, `src/lifecycle.mjs`, `src/release.mjs`, `src/commands/agent.mjs`
  - **Verify:** `node --test test/lifecycle.test.mjs test/release.test.mjs`
  - **Criteria:** CR7, CR8, CR9
- [ ] Derivar `accepted_at` del merge de la rama del change
  - **Target:** `src/git.mjs`, `src/check.mjs`
  - **Verify:** `node --test test/check.test.mjs test/git.test.mjs`
  - **Criteria:** CR10, CR11, CR12
- [x] Retirar los comandos `validation` y `reopen`
  - **Target:** `bin/changeledger.mjs`, `src/commands/agent.mjs`
  - **Verify:** `node --test test/cli-bin.test.mjs`
  - **Criteria:** CR17
  - **Resolved:** `2026-10-18T16:15:21Z`
- [ ] Reescribir el ciclo de vida del core y borrar los dos overlays
  - **Target:** `templates/contract/core.md`, `templates/contract/validation.md`, `templates/contract/blocked.md`, `templates/contract/budgets.yml`
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR13
- [ ] Mudar la taxonomía de clases de fallo a la revisión
  - **Target:** `templates/contract/review.md`
  - **Verify:** `node --test test/context.test.mjs`
  - **Criteria:** CR14
- [ ] Rehacer las métricas que derivaban de `in-validation`
  - **Target:** `src/metrics.mjs`
  - **Verify:** `node --test test/metrics.test.mjs`
  - **Criteria:** CR15
- [ ] Retirar carriles y paneles del viewer
  - **Target:** `src/viewer/domain.mjs`, `src/viewer/public/app.js`
  - **Verify:** `node --test test/viewer-metadata.test.mjs test/view.test.mjs`
  - **Criteria:** CR16
- [ ] Barrer de la suite los casos atados a los dos estados
  - **Support:**
  - **Target:** `test/**`
  - **Verify:** `pnpm verify`

## Log
- **2026-10-18T14:44:55Z** `[version]` 0.18.0
- **2026-10-18T14:44:55Z** `[status]` draft → approved (human via conversation)
- **2026-10-18T14:45:53Z** `[status]` approved → in-progress
- **2026-10-18T14:45:53Z** `[branch]` set: feature/20261018-131621 (auto)
- **2026-10-18T15:02:09Z** `[note]` Selección 1 (CR1-CR3): statuses baja a seis en config.yml; check sustituye el mensaje genérico de estado desconocido por RETIRED_STATUS_FIXES con los dos literales accionables, y pierde las dos reglas de checkConfig que exigían in-validation antes de done y el aviso de blocked sin tarea [!]. Cuatro tests nuevos en check.test.mjs; borrado 171002 CR1/CR5 porque su regla ya no existe. Verificado por el orquestador: check.test.mjs 225/0, biome limpio, changeledger check verde. CR3 pasa porque frozenReason omite archivados y descartados — sobre el ledger real es vacuo (los 358 nunca se parsean), lo ejercita el fixture. Regresión conocida y acotada: agent.test.mjs 20261001-155216 CR10 pasa de 183/0 a 182/1 porque review pass sigue yendo a in-validation; la cierra la selección 2. Preexistente en dev y ajeno a este change: agent-prompt.test.mjs CR6 (npm pack --dry-run sin files). Residuo: check.test.mjs 2507-2580 y checkLifecycleSequence siguen apoyados en CANONICAL_STATUSES de lifecycle.mjs.
- **2026-10-18T16:15:21Z** `[note]` Selección 2 (CR4, CR5, CR6, CR17): review pass va a done y fail a in-progress sin flag de clase; --retry y --block fuera; comandos validation y reopen fuera del bin. CANONICAL_STATUSES baja a seis y TRANSITIONS se reescribe. Decisión de bordes legacy: no se amplía LEGACY_EDGES porque checkLifecycleSequence retorna antes al ver un estado fuera del conjunto canónico, así que las aristas históricas quedan toleradas por la regla que ya existía para estados personalizados; ampliarlo habría sido código inalcanzable. Verificado por el orquestador: 530/0 en lifecycle+agent+cli-bin+check, biome limpio, changeledger check y context siguen funcionando. Dos decisiones fuera del texto de los criterios, ambas correctas y ambas sin criterio que las cubriera: in-progress → done pasa a ser arista legal (sin ella los tipos sin review_required se quedaban sin ruta a done al desaparecer in-validation), y la puerta de entrega assertChangeTextValid se reinstaló en agent.mjs:320 y :410 porque vivía en validation pass. Se documentan como CR19 y CR20. Residuo con dueño nombrado: templates/config.yml sigue declarando ocho estados, así que un repo recién creado con init nace con los retirados — CR1 solo nombró .changeledger/config.yml; se cubre con CR18. validation() y reopen() siguen exportados porque src/viewer/domain.mjs los importa: se borran junto a sus llamadas en la selección de CR16. post-review sigue exigiendo in-validation y queda inalcanzable hasta el change de cápsulas. pnpm test 1995/8: cinco del viewer (CR16), dos retargets de mensaje en agent-context.test.mjs y apply.test.mjs, y agent-prompt CR6 preexistente en dev.
