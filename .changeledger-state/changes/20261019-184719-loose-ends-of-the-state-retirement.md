---
id: "20261019-184719"
title: Cerrar los cabos sueltos que dejó la retirada de los dos estados
type: bug
status: draft
created: 2026-10-19T18:47:19Z
depends_on: []
related_to: ["20261018-131621"]
owner: raruiz-hiberuscom
release_impact: patch
---

## Request

`20261018-131621` retiró `in-validation` y `blocked` y pasó sus dos revisiones,
pero dejó ocho cabos sueltos: uno es un agujero real en el validador, dos son
afirmaciones que el propio producto publica y que ahora son falsas, y el resto
es deriva. Todos están nombrados en el Log de aquel change o en los informes de
sus revisiones.

Fuera de alcance: el rol `post-review`, que es inalcanzable desde que no existe
`in-validation` y cuyo dueño es el change de cápsulas; y la ausencia de un
comando de CLI que escriba la configuración autoritativa de un repo activado,
que es una capacidad que falta y no un cabo suelto de este trabajo.

## Investigation

- **El validador perdió poder de discriminación.** En `dev`, un documento con
  `status: done` y un Log que acabara en `[status] in-review → done` se
  rechazaba, porque esa arista no estaba en `TRANSITIONS`. El change la añadió
  para que `review pass` pudiera recorrerla, y `checkLifecycleSequence` dejó de
  poder distinguir una entrega con veredicto de una sin él. Las tres sedes de
  comando sí lo rechazan desde CR27; el hueco es el fichero editado a mano, que
  `spec.md` declara una vía legítima y que es la normal en los tres repos
  consumidores, todos en layout de worktree.
- **El sello de aceptación sólo ocurre si el merge precede a la graduación.**
  `sealAcceptance` se ejecuta en `--into` y `--skip`, consulta el merge en ese
  instante y nada lo reintenta después. `20261018-131621` cerró sin
  `accepted_at`: graduó y archivó con su rama sin fusionar. El aviso de CR22 lo
  habría señalado, pero `check` omite los archivados.
- **Dos publicaciones falsas.** `bin/changeledger.mjs` declara que ningún
  comando escribe `[validation]`, cuando `graduate` escribe su arma de
  aceptación; y `apply.mjs` mapea `validation` y `reopen` a comandos que ya no
  existen, con un comentario que además describe una negativa que
  `assertStatusDestinationAllowed` ya no hace.
- **La corrección del comentario de `review_required` cayó en el espejo
  inerte.** En un repo activado manda la configuración de la ref de estado, y
  allí sigue leyéndose «before universal human validation». Es el mismo reparto
  que produjo F2.
- **`LEGACY_EDGES` quedó parcialmente redundante.** `in-review → done` e
  `in-progress → done` son hoy aristas canónicas; sólo `draft → in-progress`
  sigue haciendo trabajo.
- **Dos métricas discrepan sobre el actor sin que nadie lo documente.**
  `rejectionCount` filtra por humano; las aristas de retrabajo de
  `usage-analysis` no, así que una reapertura del agente es retrabajo pero no
  rechazo.
- **Un pin de prosa demasiado ajustado.** `test/agent-context.test.mjs:447`
  fija la redacción exacta de una frase de `agent-contexts/review.md`, en
  contra de lo que pide `AGENTS.md`; y `:403` quedó subsumido por `:402`.

## Specification

### CR1 — El validador distingue una entrega con veredicto de una sin él
- **Given** un change de un tipo con `review_required`, con `status: done` en el frontmatter y un Log cuya última transición es `- **<ts>** `[status]` in-review → done`
- **When** se ejecuta `changeledger check <id>`
- **Then** sale con código distinto de cero
- **And** el mensaje nombra que la entrega desde `in-review` la registra `changeledger review <id> pass`
- **And** el mismo documento con `[review]` in-review → done` en su lugar sale con código 0

### CR2 — El sello de aceptación se reintenta mientras el change siga abierto
- **Given** un change `done` ya graduado y sin `accepted_at`, cuya rama se fusiona en la rama de integración después de la graduación
- **When** se ejecuta `changeledger check <id>`
- **Then** el aviso de aceptación pendiente lo nombra
- **And** `changeledger graduate <id> --skip` sobre un change ya graduado no es la vía: el sello lo aplica `changeledger accept <id>`, que estampa `accepted_at` y su entrada `[validation]` y falla con código distinto de cero si la rama no está fusionada

### CR3 — El aviso de aceptación pendiente alcanza a los archivados
- **Given** un change archivado, `done`, sin `accepted_at` y con su rama fusionada
- **When** se ejecuta `changeledger check`
- **Then** el aviso lo nombra igual que a uno no archivado

### CR4 — La ayuda no declara falsedades sobre quién escribe `[validation]`
- **Given** la salida de `changeledger log --help`
- **When** se lee la línea del tipo `validation`
- **Then** nombra `changeledger graduate` como productor de su arma de aceptación
- **And** no afirma que ningún comando lo escriba

### CR5 — `apply` no cita comandos retirados
- **Given** un manifiesto con una entrada `op: "validation"`
- **When** se ejecuta `changeledger apply --from`
- **Then** se rechaza sin escribir
- **And** el mensaje no nombra `changeledger validation` ni `changeledger reopen`

### CR6 — La configuración autoritativa no describe la puerta retirada
- **Given** este repo, activado
- **When** se lee el comentario de `review_required` de la configuración que resuelve la herramienta
- **Then** no contiene la cadena `human validation`

### CR7 — `LEGACY_EDGES` sólo lista aristas que no son canónicas
- **Given** `CANONICAL_STATUSES` y `TRANSITIONS` de `src/lifecycle.mjs`
- **When** se lee `LEGACY_EDGES` de `src/check.mjs`
- **Then** ninguna de sus aristas está ya en `TRANSITIONS`

### CR8 — El pin de prosa del revisor tolera la redacción
- **Given** `test/agent-context.test.mjs`
- **When** se reescribe la frase del veredicto de `agent-contexts/review.md` conservando su obligación — un veredicto `pass` o `fail`, y la clasificación del defecto como guía y no como segundo veredicto
- **Then** el test sigue pasando
- **And** no queda ninguna aserción subsumida por otra en ese bloque

## Plan

- [ ] Estrechar la secuencia de ciclo de vida para exigir veredicto en la entrega desde `in-review`
  - **Target:** `src/check.mjs`
  - **Verify:** `node --test test/check.test.mjs`
  - **Criteria:** CR1
- [ ] Separar el sello de aceptación de la graduación y darle un comando propio
  - **Target:** `src/commands/graduate.mjs`, `src/check.mjs`, `bin/changeledger.mjs`
  - **Verify:** `node --test test/graduate.test.mjs test/check.test.mjs test/cli-bin.test.mjs`
  - **Criteria:** CR2, CR3
- [ ] Corregir lo que la CLI publica sobre `[validation]` y sobre las operaciones retiradas
  - **Target:** `bin/changeledger.mjs`, `src/commands/apply.mjs`
  - **Verify:** `node --test test/cli-bin.test.mjs test/apply.test.mjs`
  - **Criteria:** CR4, CR5
- [ ] Llevar la corrección del comentario a la configuración que la herramienta lee
  - **Target:** `.changeledger/config.yml`
  - **Verify:** verify: el comentario de la ref de estado no contiene `human validation`
  - **Criteria:** CR6
- [ ] Podar `LEGACY_EDGES` de lo que ya es canónico
  - **Target:** `src/check.mjs`
  - **Verify:** `node --test test/check.test.mjs`
  - **Criteria:** CR7
- [ ] Aflojar el pin de prosa del veredicto del revisor
  - **Target:** `test/agent-context.test.mjs`
  - **Verify:** `node --test test/agent-context.test.mjs`
  - **Criteria:** CR8
- [ ] Documentar en la spec de métricas que el filtro de actor difiere entre rechazo y retrabajo
  - **Support:**
  - **Target:** `.changeledger/specs/metrics.md`
  - **Verify:** `node bin/changeledger.mjs check`

## Log
- **2026-10-19T18:47:19Z** `[version]` 0.18.0
