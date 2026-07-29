---
id: "20260729-143656"
title: Retirar los pins de hash del contrato en favor de guards de obligación
type: refactor
status: in-review
created: 2026-07-29T14:36:56Z
depends_on: []
related_to: ["20260728-164620"]
owner: raruiz-hiberuscom
---

## Request

Decisión de Roberto (2026-07-29): retirar el mecanismo de pins de hash sobre los
fragmentos del contrato, porque su coste supera su protección — *"veo que eso
hace que cambiar 1 linea nos cueste 1 hora y 1M de tokens, es demasiado
ceremorioso"* y *"seguramente no se estan retirando los tests que ya no son
necesarios porque algunos archivos tienen ya mas de 3000 lineas y aparte son
excesivos en comentarios"*.

Datos medidos el 2026-07-29 que fundan la decisión:

- `test/context.test.mjs` tiene 3883 líneas y **29% son comentarios** (1140
  líneas); el resto de suites grandes están al 1–6%. El exceso vive donde la
  maquinaria de pins.
- El mapa del test `234939 CR10/CR11` pinnea **12 fragmentos** por SHA-256
  normalizado, y cada entrada arrastra el historial completo de clasificaciones
  de cada change archivado (20+ entradas de comentario por fragmento,
  append-only, nunca se retiran). Es historia que el ledger ya registra,
  duplicada en un test — la clase 19/48 dentro del propio mecanismo de guardas.
- Existen meta-tests que leen el código fuente de la propia suite para asertar
  sobre sus comentarios (`194234 CR5`, `164620 CR5`, `164620 H3`): tests de
  comentarios de tests.
- El comentario de clasificación **no lo verifica nadie**: salió falso en cuatro
  entradas admitidas por `124835` y nadie lo notó hasta que la criba lo listó.
  Un hash dice *que* algo cambió, no *qué* se perdió.
- Cada edición de una línea de prosa obliga a repinnear el hash + clasificar
  cada regla afectada + que el review escrute el comentario. El gate real contra
  pérdida silenciosa ya existe y es doble: toda edición de fragmento viaja
  dentro de un change con review obligatorio, y las obligaciones nombradas
  tienen guards por grep que sí dicen qué se perdió.

## Proposal

**Retirar el nivel de pins SHA-256 y quedarse con los otros dos niveles**, que
protegen más y cuestan menos:

1. **Matriz semántica de outputs propietarios** (los mapas `outputs`/
   `ownedHeadings` de `test/context.test.mjs`): cada regla, comando, ejemplo y
   antipatrón exigido en su pack propietario. Intacta.
2. **Guards de obligación por grep** (p. ej. `124837 CR1`, `194234 CR4`): una
   frase retirada no reaparece; una obligación viva se encuentra en su sede.
   Intactos, y las obligaciones que hoy sostienen los meta-tests se convierten
   en aserciones directas contra el fragmento dueño.
3. **Presupuestos** (`budgets.yml`, `assertWithinBudget`): intactos.

Lo que se pierde, aceptado a propósito: la detección de *cualquier* edición de
prosa no vigilada por un guard. Esa protección era redundante con el review
obligatorio del change que transporta la edición, y su parte declarativa (el
comentario de clasificación) demostró ser inverificable.

Alternativas descartadas:

- **Conservar pins sin comentarios**: mantiene el coste de repinnear en cada
  edición y pierde lo único que aportaba (la clasificación); el hash solo no
  dice qué se perdió.
- **Verificar mecánicamente la clasificación** (la "versión mecánica del
  hallazgo 40" que CH-2 planeaba): construye más maquinaria sobre el mecanismo
  que este change retira. Superada por el retiro.

Consecuencias sobre la lista de la iniciativa (se registran en el acta):

- CH-2 se encoge: la tarea de corregir las cuatro clasificaciones falsas queda
  sin objeto; su "sitio de aserción" para prosa pasa a ser el guard de
  obligación, no un test artesanal por criterio.
- CH-19 se encoge: menos maquinaria que consolidar en sede única.
- La sección de regresión contractual de
  `.changeledger/specs/contract-discovery.md` se reescribe: documenta hoy los
  snapshots y la obligación de reclasificar como verdad vigente.

## Specification

### CR1 — El mapa de pins y su test se retiran

- **Given** `test/context.test.mjs` en HEAD tras la implementación
- **When** se busca el test `234939 CR10/CR11` o cualquier literal de 64
  caracteres hexadecimales asociado a un nombre de fragmento (`grep -E
  "'[a-f0-9]{64}'" test/context.test.mjs`)
- **Then** cero ocurrencias: ni el test ni el mapa existen
- **And** reordenar palabras de una frase sin obligación vigilada en
  `templates/contract/blocked.md` (mutante temporal, restaurado editando) deja
  `node --test test/context.test.mjs` en verde — ninguna comparación por hash
  falla

### CR2 — Las obligaciones de los meta-tests sobreviven como aserciones directas

- **Given** las dos obligaciones que `194234 CR5` afirma hoy vía el comentario
  del pin: `is never a commit of its own` y `**Handoff**: mandatory whenever
  work stops`
- **When** se retira cualquiera de las dos frases de
  `templates/contract/core.md` (mutante temporal, restaurado editando)
- **Then** un test de `test/context.test.mjs` falla nombrando la obligación
  ausente, y ese test lee `core.md` directamente, no el código fuente de la
  suite

### CR3 — Ningún test lee el código fuente de la propia suite

- **Given** `test/context.test.mjs` en HEAD tras la implementación
- **When** se ejecuta `grep -c "readFileSync(new URL('./context.test.mjs'" test/context.test.mjs`
  buscando self-reads (`readFileSync` de la propia suite)
- **Then** cero ocurrencias; los tests `164620 CR5` y `164620 H3` quedan
  retirados — su objeto (comentarios del mapa de pins) deja de existir, y el
  registro histórico que protegían vive en el ledger (`20260728-164620`,
  archivado)

### CR4 — La protección restante sigue matando sus mutantes

- **Given** los dos niveles que se conservan
- **When** se inyecta en `templates/contract/agent-contexts/investigation.md` la
  frase retirada que vigila `124837 CR1`, y por separado se excede el techo
  `base.core` de `templates/contract/budgets.yml` (un mutante a la vez,
  restaurados editando, `git diff --stat` vacío tras cada uno)
- **Then** la suite falla en ambos casos nombrando el guard o el techo — la
  matriz semántica, los guards de frase retirada y los presupuestos no
  dependían del mapa de pins

### CR5 — La verdad persistente describe el modelo vigente

- **Given** `.changeledger/specs/contract-discovery.md` tras la implementación
- **When** se ejecuta `grep -c 'snapshots SHA-256' .changeledger/specs/contract-discovery.md`
  y se lee la sección de regresión contractual
- **Then** cero ocurrencias del mecanismo retirado; la sección describe la
  protección en sus niveles vigentes (matriz semántica, guards de obligación,
  presupuestos) y ya no exige reclasificar reglas ni actualizar snapshots

## Plan

- [x] Reescribir la sección de regresión contractual de `.changeledger/specs/contract-discovery.md` al modelo vigente sin snapshots ni reclasificación; verify: `grep -c 'snapshots SHA-256' .changeledger/specs/contract-discovery.md` devuelve 0 (CR5)
  - **Resolved:** `2026-07-29T14:58:57Z`
- [x] Retirar de `test/context.test.mjs` el mapa de pins con su historial y el test `234939 CR10/CR11`, cuya decisión queda documentada en `.changeledger/specs/contract-discovery.md`; verify: `node --test test/context.test.mjs` y `grep -E "'[a-f0-9]{64}'" test/context.test.mjs` sin ocurrencias (CR1)
  - **Resolved:** `2026-07-29T14:58:57Z`
- [x] Convertir las obligaciones de `templates/contract/core.md` que `194234 CR5` afirma vía comentarios en aserciones directas sobre el fragmento, y retirar los self-reads `164620 CR5` y `164620 H3`; verify: `node --test test/context.test.mjs` y `grep -c "readFileSync(new URL('./context.test.mjs'" test/context.test.mjs` devuelve 0 (CR2, CR3)
  - **Resolved:** `2026-07-29T14:58:57Z`
- [x] Verificar por mutación la protección restante de `templates/contract/` y `templates/contract/budgets.yml`: frase vigilada por `124837 CR1` inyectada y techo `base.core` excedido, un mutante a la vez con fallo literal reportado; verify: `pnpm test` (CR4)
  - **Resolved:** `2026-07-29T14:58:57Z`
- [x] Correr el gate completo tras el retiro; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-29T14:58:58Z`

## Log

- **2026-07-29T14:42:00Z** `[note]` Change autorizado por Roberto en conversación como primero de la tanda reorganizada, antes del change de doctrina (CH-0b+CH-5a+CH-5b). Datos del Request medidos en la misma sesión antes de redactar: conteos por `grep`/`wc` sobre el árbol en HEAD.
- **2026-07-29T14:43:32Z** `[status]` draft → approved
- **2026-07-29T14:44:47Z** `[status]` approved → in-progress
- **2026-07-29T14:45:35Z** `[note]` Implementación delegada en una sola pasada (las 5 tareas son una selección: 4 acopladas por test/context.test.mjs y la spec, más el gate). Baseline 5b2e0503. Modelo mid-tier: trabajo acotado y bien especificado.
- **2026-07-29T14:59:15Z** `[note]` Implementación entregada por delegado (141k tokens, 91 tool calls) y verificada por el orquestador contra el árbol: grep hex64=0, self-reads readFileSync de la propia suite=0, 'snapshots SHA-256' en la spec=0, tests 234939 CR10/CR11, 164620 CR5 y 164620 H3 ausentes, test nuevo 143656 CR2 presente. Gate corrido por el orquestador: pnpm verify verde, 943/943, lint limpio, check 0 errores. Mutantes M1-M4 con fallo/verde literal en el informe del delegado; restauración confirmada por git diff --stat limpio en templates/ y src/.
- **2026-07-29T14:59:16Z** `[note]` Evidencia viva para CH-19, del mutante M3a: la frase retirada vigilada por 124837 CR1 inyectada en templates/contract/agent-contexts/investigation.md deja la suite en verde (97 pass en el fichero) porque el barrido usa readdirSync no recursivo; el mismo mutante sobre core.md sí falla nombrando el guard (M3b). No se tocó: es el hueco documentado de CH-19.
- **2026-07-29T14:59:16Z** `[note]` Defecto de redacción en CR3 hallado por el delegado: el comando literal del criterio (grep -c "context.test.mjs'") devuelve 2 por dos substrings preexistentes ajenos (la lectura cruzada de agent-context.test.mjs y la entrada del array CAPTURE_SUITES), así que el Then=0 es insatisfacible tal como está escrito. La medida del objeto real del criterio (readFileSync de la propia suite) da 0. Enmienda pendiente de decisión humana; el review no se delega hasta resolverla.
- **2026-07-29T15:06:06Z** `[note]` CR3 y su tarea del Plan enmendados con autorización de Roberto (conversación, 2026-07-29): el comando de medida pasa a grep -c "readFileSync(new URL('./context.test.mjs'" que mide el objeto real del criterio. Es corrección de medidor, no de comportamiento: el comando original devolvía 2 por substrings ajenos preexistentes y no podía pasar nunca. Por la letra de la regla de enmiendas convierte fallo en pass, por eso la decidió el humano y no el orquestador.
- **2026-07-29T15:06:17Z** `[status]` in-progress → in-review
