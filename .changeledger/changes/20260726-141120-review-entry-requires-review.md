---
id: "20260726-141120"
title: Impedir in-review en tipos sin review
type: bug
status: done
created: 2026-07-26T14:11:20Z
depends_on: ["20260726-141119"]
reviewed: true
related_to: ["20260726-141121"]
owner: raruiz-hiberuscom
---

## Request

El grafo del ciclo de vida permite que cualquier tipo entre en `in-review`,
incluidos los que no declaran `review_required`. Como esos tipos tampoco activan
`specification` ni `plan`, el revisor se despacha contra un cambio que no
contiene ni un solo criterio verificable ni una sola tarea trazable.

Eso es el origen mecánico de que los revisores acaben usados como oráculos de
diseño: la cápsula de revisión les exige comprobar criterios y tareas que el
documento no puede contener, así que lo único que les queda es opinar sobre el
diseño. El contrato ya prohíbe esa situación en prosa; el grafo no la impide.

Se pide que la entrada a `in-review` sea imposible para un tipo sin
`review_required`, en el mismo sitio donde ya vive la autoridad sobre las
transiciones.

`bug` no activa `## Proposal`, así que la solución elegida y su contrapartida
viven aquí, en Investigation.

## Investigation

### Cadena de evidencia

1. `src/lifecycle.mjs:28` —
   `'in-progress': ['in-review', 'in-validation', 'blocked', 'discarded']` es
   incondicional. `in-review` es un sucesor legal para todos los tipos.
2. `src/lifecycle.mjs:55` — el único guard sensible al tipo prohíbe el **salto**,
   no la **entrada**: rechaza `in-progress → in-validation` cuando el tipo exige
   revisión. La entrada indebida no se contempla.
3. `templates/contract/review.md:37-38` afirma que los tipos sin
   `review_required` pasan directamente de `in-progress` a `in-validation` y que
   no debe inventarse una puerta de revisión para ellos.
   `templates/contract/implement.md:84-86` dice lo mismo desde el lado del
   implementador. El grafo no hace cumplir ninguna de las dos frases.
4. Reproducido en un repo de prueba con `audit`, `chore` y `quick`, ninguno con
   `review_required`:

   ```text
   $ node bin/changeledger.mjs status 20260726-141421 in-review
   #20260726-141421 → in-review
   $ node bin/changeledger.mjs status 20260726-141422 in-review
   #20260726-141422 → in-review
   $ node bin/changeledger.mjs status 20260726-141423 in-review
   #20260726-141423 → in-review
   $ node bin/changeledger.mjs check
   ✓ 3 change(s) valid
   ```

5. `src/commands/agent-context.mjs:11-15` admite el rol `review` para cualquier
   cambio en `in-review`, sin consultar el tipo. Sobre el `quick` anterior,
   `node bin/changeledger.mjs agent-context review <id>` construye una cápsula de
   revisión completa, y esa cápsula exige en
   `templates/contract/agent-contexts/review.md:11` inspeccionar
   `every CRn, every Plan task` en un tipo que no declara ninguna de las dos
   stages.
6. `src/commands/context.mjs:21` mapea el estado `in-review` a
   `{ mode: 'review' }` sin condición de tipo, así que el contexto principal
   también vuelca al mismo cambio en modo revisión.

### Solución elegida

`assertTransition` rechaza `in-progress → in-review` cuando el
`review_required` del tipo no es `true`, con el mensaje simétrico al guard de
salto ya existente:

```text
audit changes do not require review — move to in-validation instead
```

El sitio es el correcto por tres razones. Primera, `src/lifecycle.mjs` es la
autoridad única del grafo y ya recibe `reviewRequired` en `opts`
(`src/lifecycle.mjs:49`), sin necesidad de nueva fontanería. Segunda,
`src/commands/agent.mjs:47-56` invoca `assertTransition` **antes** de cualquier
mutación en memoria, dentro de `mutateFileAtomic`, así que el rechazo deja el
fichero byte a byte intacto sin código adicional. Tercera, cerrar la entrada
hace inalcanzables por construcción las dos rutas de despacho del punto 5 y 6:
si un `quick` no puede estar en `in-review`, no hay estado desde el que pedir la
cápsula de revisión.

Alternativa descartada: filtrar por tipo en `src/commands/agent-context.mjs` y
`src/commands/context.mjs`. Se descarta porque deja el estado inválido escrito en
el documento y sólo tapa dos de sus consumidores; el grafo seguiría admitiendo la
transición y el Log registraría una revisión que no existe.

### Contrapartida

Un repo que usaba `in-review` manualmente sobre un tipo ligero pierde esa
posibilidad. La respuesta coherente es declarar `review_required` en ese tipo,
lo cual —tras `20260726-141119`— le obliga además a declarar `specification` y
`plan`. Es decir: la revisión deja de ser un gesto suelto y pasa a exigir el
material verificable que la justifica. Por eso este cambio depende de
`20260726-141119`; aplicarlo antes permitiría declarar `review_required` en un
tipo ligero y reintroducir el mismo problema por la puerta de la configuración.

`20260726-141121` toca la composición de fragmentos de contexto por tipo y
comparte los consumidores de los puntos 5 y 6, sin imponer orden de ejecución.

## Specification

### CR1 — La entrada a in-review se rechaza para un tipo sin review

- **Given** un repo cuyo tipo `audit` no declara `review_required`, con un cambio
  `audit` en estado `in-progress`
- **When** se ejecuta `node bin/changeledger.mjs status <id> in-review`
- **Then** la salida de error es
  `Error: audit changes do not require review — move to in-validation instead`
- **And** el comando termina con código de salida 1

### CR2 — El rechazo no toca el documento ni el Log

- **Given** el mismo cambio `audit` en `in-progress`, con el contenido exacto del
  fichero leído antes de la operación
- **When** se ejecuta `node bin/changeledger.mjs status <id> in-review` y falla
- **Then** el contenido del fichero es byte a byte idéntico al leído antes
- **And** el frontmatter sigue declarando `status: in-progress` y el `## Log` no
  ha recibido ningún evento nuevo

### CR3 — El tipo ligero sigue teniendo su ruta legítima

- **Given** el mismo cambio `audit` en `in-progress`
- **When** se ejecuta `node bin/changeledger.mjs status <id> in-validation`
- **Then** la transición se aplica y la salida es `#<id> → in-validation`
- **And** el `## Log` recibe un evento `[status]` con la carga
  `in-progress → in-validation`

### CR4 — feature y bug no cambian de comportamiento

- **Given** un repo con la configuración distribuida por `changeledger init`, con
  un cambio `feature` y un cambio `bug`, ambos en `in-progress`
- **When** se ejecuta `node bin/changeledger.mjs status <id> in-review` sobre cada
  uno
- **Then** ambas transiciones se aplican y la salida es `#<id> → in-review`
- **And** el guard de salto sigue vigente: `node bin/changeledger.mjs status <id>
  in-validation` sobre el `feature` en `in-progress` falla con
  `Error: feature changes must be reviewed before validation — move to in-review first`

### CR5 — La cápsula de revisión queda inalcanzable para un tipo sin review

- **Given** un repo cuyo tipo `quick` no declara `review_required`, con un cambio
  `quick` en estado `in-progress` que nunca pudo entrar en `in-review`
- **When** se ejecuta `node bin/changeledger.mjs agent-context review <id>`
- **Then** la salida de error es
  `Error: role review requires change status in-review; got in-progress`
- **And** el comando termina con código de salida 1 y no emite ninguna línea
  `CHANGELEDGER AGENT CONTEXT BEGIN`

### CR6 — El contexto del cambio nunca entra en modo review para un tipo sin review

- **Given** el mismo cambio `quick` en estado `in-progress`
- **When** se ejecuta `node bin/changeledger.mjs context <id>`
- **Then** la línea `CHANGELEDGER CONTEXT BEGIN` declara `mode: implement`
- **And** para ningún estado alcanzable por un tipo sin `review_required` la
  salida declara `mode: review`

## Plan

- [x] Añadir a `assertTransition` en `src/lifecycle.mjs` el rechazo de `in-progress → in-review` cuando `reviewRequired` no es `true`; verify: `node --test test/lifecycle.test.mjs` (CR1, CR3, CR4)
  - **Resolved:** `2026-07-26T22:19:36Z`
- [x] Cubrir en `src/commands/agent.mjs` que el rechazo deja el fichero byte a byte intacto y el `## Log` sin evento nuevo; verify: `node --test test/agent.test.mjs` (CR2)
  - **Resolved:** `2026-07-26T22:23:02Z`
- [x] Cubrir en `src/commands/agent-context.mjs` y `src/commands/context.mjs` que el modo revisión es inalcanzable para un tipo sin `review_required`; verify: `node --test test/agent-context.test.mjs` (CR5, CR6)
  - **Resolved:** `2026-07-26T22:25:17Z`
- [x] Ejecutar el gate completo `pnpm verify` (support)
  - **Resolved:** `2026-07-26T22:26:13Z`

## Log
- **2026-07-26T15:05:04Z** `[status]` draft → approved
- **2026-07-26T22:15:38Z** `[status]` approved → in-progress
- **2026-07-26T22:26:13Z** `[note]` Review entry closed in assertTransition: a type without review_required cannot enter in-review, which makes the review capsule and review-mode context unreachable by construction
- **2026-07-26T22:28:40Z** `[status]` in-progress → in-review
- **2026-07-26T22:42:42Z** `[note]` Mandato de review dimensionado como revision completa del diff mas la superficie que gobierna (todos los llamadores de la autoridad de transiciones, incluida la ruta del visor), no auditoria repo-wide, con disciplina de alcance como condicion de pass/fail
- **2026-07-26T22:42:42Z** `[review]` in-review → in-progress (retry): El guard nuevo dispara sobre el default reviewRequired=false, asi que un documento sin type en frontmatter produce 'undefined changes do not require review — move to in-validation instead': el unico mensaje que ve el usuario, no nombra la causa y prescribe un remedio sin sentido. Reproducido por el revisor con el CLI real, no es test-only como afirmaba el informe
- **2026-07-26T22:45:27Z** `[status]` in-progress → in-review
- **2026-07-26T22:50:27Z** `[note]` Mandato de la ronda de confirmacion: minimo, acotado al diff sin commitear de src/lifecycle.mjs y test/lifecycle.test.mjs, con reproduccion independiente del defecto original por CLI y mutante aislado como condicion
- **2026-07-26T22:50:27Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-26T22:53:55Z** `[validation]` in-validation → done (human accepted)
- **2026-07-26T22:55:09Z** `[graduation]` spec: `lifecycle.md`
