---
id: "20260724-234148"
title: Unificar el envelope JSON de list y search con procedencia siempre
type: feature
status: draft
created: 2026-07-24T23:41:48Z
depends_on: []
related_to: ["20260721-193106", "20260722-203029"]
release_impact: minor
---

## Request

La tercera ejecución del audit `20260721-193106` (fila RECEIPT-03) reprodujo que
`changeledger list --json` y `changeledger search <q> --json` no emiten
procedencia en repos sin réplica de estado activa: la salida es un array JSON
desnudo. Un consumidor máquina que agregue salidas de varios repos no puede
saber de cuál vino cada una. En repos con estado activo los mismos comandos sí
emiten un objeto con `project_id` y `repository_path`, y la salida **humana**
lleva `Project: … (repo: …)` en ambos modos: el hueco es exactamente la
combinación worktree legacy + `--json`.

`20260722-203029` lo dejó como carve-out consciente para no romper a los
consumidores del array, y el audit lo dejó marcado `fail — decisión de producto
pendiente`. El humano resolvió la decisión (2026-07-24, conversación): unificar
siempre al envelope y asumir la ruptura del tipo raíz.

## Investigation

`list()` (`src/commands/agent.mjs:499-553`) y `search()`
(`src/commands/search.mjs:10-24`) devuelven un **array** con la procedencia
adosada mediante `Object.defineProperties`, que crea propiedades no enumerables:
`JSON.stringify(array)` las descarta silenciosamente. Los dos puntos de
impresión compensan con un ternario sobre `items.ledgerRevision` /
`hits.ledgerRevision` (`bin/changeledger.mjs:842-853` y
`src/commands/search.mjs:56-66`) que envuelve en objeto solo cuando hay revisión
de estado, y cae al array crudo cuando no la hay. La causa raíz no es el
ternario: es una forma de datos que miente a `JSON.stringify`.

`show --json` ya resuelve esto bien y sin ternario
(`src/commands/agent.mjs:555-568`): devuelve un objeto plano que esparce
`ledgerReceipt(repo)` y `repoProvenance(cwd)`, de modo que la procedencia viaja
en los dos modos y en modo legacy los campos de ledger valen `null`
(`ledger_revision`, `ledger_freshness`) sin emitir `ledger_confirmation` ni
`ledger_observed_at`. Existe por tanto una forma canónica de receipt ya
establecida en el repo; `list` y `search` son las dos únicas consultas que se
desvían de ella.

Superficie de consumo interna: `list()` tiene un único llamador
(`bin/changeledger.mjs:834`) y `search()` uno (`runSearch`, mismo módulo).
`package.json` no exporta JS (`exports` solo publica `./package.json`), así que
la única API pública comprometida es la salida del binario: la reforma del
retorno interno no rompe consumidores externos.

## Proposal

Corte limpio, sin shim: `list --json` y `search --json` emiten **siempre** el
mismo envelope, con los campos de ledger en `null` cuando no hay réplica activa.
La forma se toma prestada intacta de `show --json` (`ledgerReceipt` +
`repoProvenance`), de modo que las tres consultas comparten un único contrato en
vez de tres.

Se elimina el `Object.defineProperties` de ambas funciones y el ternario de
ambos puntos de impresión: `list()` y `search()` devuelven el objeto envelope
con la colección dentro (`changes` y `hits`, los nombres que el modo estado ya
usa hoy). Se borra código en vez de añadirlo, y desaparece la trampa de
propiedades invisibles a la serialización.

Descartadas explícitamente:

- **Condicionar la forma a `schema_version`.** `schema_version` versiona el
  documento de configuración y tiene migración automatizada
  (`src/config-migration.mjs`); no es una versión del contrato de salida del
  CLI. Usarlo como puerta obligaría a mantener las dos formas vivas
  indefinidamente: un shim de retrocompatibilidad, prohibido por el contrato de
  ingeniería del repo.
- **Flag `--json-envelope`.** Duplica superficie y deja dos contratos vivos para
  el mismo comando.

La ruptura del tipo raíz (array → objeto) es aceptable en 0.x y se anuncia en
dos sitios: la sección de consultas del `README.md` documenta el envelope, y el
change entra en el manifiesto de la próxima release con `release_impact: minor`.

## Specification

### CR1 — `list --json` emite el envelope en modo worktree legacy

- **Given** un repo inicializado sin réplica de estado activa, con un change
  `20260614-090000` en `status: draft`
- **When** se ejecuta `changeledger list --json`
- **Then** stdout parsea a un objeto cuyo `project_id` es el `project_id` de
  `.changeledger/config.yml`, cuyo `repository_path` es la ruta absoluta de la
  raíz del repo, cuyos `ledger_revision` y `ledger_freshness` valen `null`, y
  cuyo `changes` es el array de changes con el id `20260614-090000`
- **And** las claves `ledger_confirmation` y `ledger_observed_at` no están
  presentes

### CR2 — `search --json` emite el envelope en modo worktree legacy

- **Given** el mismo repo, con un change cuyo título contiene `wallet`
- **When** se ejecuta `changeledger search wallet --json`
- **Then** stdout parsea a un objeto con `project_id`, `repository_path`,
  `ledger_revision: null` y `ledger_freshness: null`, y con `hits` como array de
  resultados cada uno con `ref`, `title`, `score` y `snippet`
- **And** las claves `ledger_confirmation` y `ledger_observed_at` no están
  presentes

### CR3 — Cero resultados sigue siendo un envelope, no un array vacío

- **Given** el mismo repo legacy
- **When** se ejecuta `changeledger search terminoinexistente --json` y
  `changeledger list --status blocked --json`
- **Then** ambas salidas parsean a objetos con la procedencia completa y con
  `hits: []` y `changes: []` respectivamente
- **And** ninguna de las dos imprime `no matches` ni un array desnudo

### CR4 — El envelope de modo estado no cambia

- **Given** un repo con réplica de estado v2 activa y `confirmed` publicado
- **When** se ejecutan `changeledger list --json` y `changeledger search <q>
  --json`
- **Then** cada salida conserva exactamente las claves que emite hoy
  (`project_id`, `repository_path`, `ledger_revision`, `ledger_freshness`,
  `ledger_confirmation`, `ledger_observed_at` y `changes`/`hits`) con los mismos
  valores

### CR5 — La salida humana no cambia en ningún modo

- **Given** los repos de CR1 y CR4
- **When** se ejecutan `changeledger list` y `changeledger search wallet` sin
  `--json`
- **Then** la primera línea sigue siendo `Project: <id> (repo: <path>)`, la
  línea `Ledger revision: …` sigue apareciendo solo con réplica activa, y
  `search` sin coincidencias sigue imprimiendo `no matches`

### CR6 — El contrato queda documentado y es autodescriptivo

- **Given** el `README.md`
- **When** se lee la sección de consultas sobre changes
- **Then** documenta que `list --json`, `search --json` y `show --json` emiten
  siempre `project_id` y `repository_path`, que los campos `ledger_*` valen
  `null` sin réplica activa, y que la colección viaja en `changes`/`hits`
- **And** declara explícitamente la ruptura respecto de versiones anteriores,
  donde ambos comandos devolvían un array desnudo en modo worktree

### CR7 — La ayuda de `--json` describe el envelope

- **Given** un repo cualquiera
- **When** se ejecutan `changeledger list --help` y `changeledger search --help`
- **Then** la descripción de la opción `--json` de cada comando nombra el
  envelope con procedencia en vez del genérico `print JSON`, mencionando la clave
  de colección que emite (`changes` y `hits` respectivamente)

## Plan

- [ ] Añadir tests rojos de envelope legacy para `list --json` y `search --json` (incluida la ausencia de `ledger_confirmation`/`ledger_observed_at` y el caso de cero resultados) y reformar `list()` en `src/commands/agent.mjs` para devolver el objeto envelope con `ledgerReceipt` + `repoProvenance` y `changes` dentro, eliminando `Object.defineProperties` y el ternario de `bin/changeledger.mjs`; verify: `node --test test/cli-bin.test.mjs test/agent.test.mjs` (CR1, CR3, CR4)
- [ ] Reformar `search()` y `runSearch` en `src/commands/search.mjs` con el mismo envelope y `hits` dentro, eliminando `Object.defineProperties` y el ternario; verify: `node --test test/search.test.mjs test/cli-bin.test.mjs` (CR2, CR3, CR4)
- [ ] Anclar con regresión que la salida humana de `bin/changeledger.mjs` y `src/commands/search.mjs` es idéntica en modo legacy y en modo estado; verify: `node --test test/cli-bin.test.mjs test/search.test.mjs` (CR5)
- [ ] Documentar el envelope y la ruptura en la sección de consultas de `README.md`, y reescribir la descripción de la opción `--json` de `list` y `search` en `bin/changeledger.mjs` para nombrar el envelope y su clave de colección; verify: `node --test test/cli-bin.test.mjs` (CR6, CR7)
- [ ] Ejecutar el gate completo; verify: `pnpm verify` (support)

## Log

- **2026-07-24T23:41:48Z** `[note]` Draft creado desde el hallazgo RECEIPT-03 del audit 20260721-193106, tras la decisión de producto del humano (2026-07-24, conversación) de unificar siempre al envelope. Desviación respecto de la opción tal como se le presentó: la puerta no es un bump de `schema_version` —eso versiona el documento de configuración y obligaría a mantener dos formas vivas, un shim prohibido por el contrato del repo— sino un corte limpio anunciado en README y en el manifiesto de release con `release_impact: minor`. Frontera: solo la forma de `--json` de `list` y `search`; la salida humana y el contrato de `show` no se tocan.
