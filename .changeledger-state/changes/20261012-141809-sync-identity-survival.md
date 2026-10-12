---
id: "20261012-141809"
title: sync no adopta una revisión que pierde identidades de la foto local
type: bug
status: approved
created: 2026-10-12T14:18:09Z
depends_on: []
related_to: ["20261012-125623", "20261002-161641", "20261012-125611"]
owner: rarc88
---

## Request

La auditoría `20261012-125623` reprodujo que `changeledger sync` adopta por
fast-forward, y por reconciliación publica, una revisión remota en la que
desaparecen changes, specs, registros de consumo o entradas de colecciones
desconocidas presentes en la foto local, aunque `global-state-scope` (#3)
declara que ninguna identidad presente en una foto puede desaparecer de su
descendiente. Se pide la opción que la auditoría recomendó: que `sync` rechace
esa adopción en el fast-forward y en la reconciliación, comprobando por ruta
entre la foto local y la revisión que adoptaría, con un helper común, sin
escribir ni publicar nada; y que la cabecera de `src/commands/sync.mjs` describa
las comprobaciones que hace antes de adoptar.

Incluido por decisión del humano: rechazar también, en el fast-forward y en la
reconciliación, una revisión que reescribe los bytes de un registro de consumo
presente en la foto local (R6 de la auditoría), porque la spec `usage` los
declara inmutables y `mutateState` ya rechaza reescribirlos.

Excluido por decisión del humano: rechazar la publicación de un tip local que ya
perdió identidades respecto del remoto (R5), porque sólo la produce git crudo
local, un actor en el que la herramienta confía por diseño (INTENT.md), que
también puede publicar con `git push` sin pasar por `sync`; los demás clones la
rechazan al adoptarla por CR1–CR3.

## Investigation

Ver los hallazgos de `20261012-125623`. `advanceStateRef` (fast-forward) en
`src/state-store.mjs` sólo comprueba ancestría y que la foto destino se lea
entera; `commitMergedState` comprueba por ruta sólo las entradas de colecciones
desconocidas de ambos padres (desde `20261002-161641`); `reconcile` en
`src/commands/sync.mjs` borra del árbol mezclado una ruta que un lado borró y el
otro no tocó. Las cinco llamadas a `mutateState` en `src` usan sólo
`stage.write`, y `git log --diff-filter=D -m changeledger/state` no devuelve
ningún borrado en la historia de este repo, así que la comprobación por ruta no
rechaza ninguna historia producida por la CLI actual. El comentario de cabecera
de `src/state-store.mjs` dice hoy que el fast-forward y el merge de `sync` no
ejecutan la comprobación de `mutateState`; habrá que actualizarlo.

Interfaces externas: ninguna nueva; `fetch` y `push` de git ya son contratos de
la herramienta.

## Specification

### CR1 — Un fast-forward no adopta una revisión que borra un change
- **Given** un clon activado con el change `beta`, cuyo remoto publica una revisión descendiente, hecha con git crudo, sin el archivo de `beta`
- **When** se ejecuta `changeledger sync`
- **Then** termina con código distinto de cero con `Error: state revision <oid> drops ".changeledger-state/changes/<archivo de beta>", present in the local state; sync adopted nothing`
- **And** `refs/heads/changeledger/state` conserva su oid y `changeledger list --all` sigue mostrando `beta`

### CR2 — El fast-forward cubre cada colección
- **Given** revisiones remotas descendientes que, cada una, borran sólo una spec, sólo un release, sólo un registro de consumo o sólo una entrada de una colección desconocida presentes en la foto local
- **When** se ejecuta `changeledger sync` frente a cada una
- **Then** cada ejecución falla con el mensaje de CR1 nombrando la ruta borrada y la ref local conserva su oid

### CR3 — Una reconciliación no publica un árbol que pierde identidades
- **Given** un clon activado con un commit local que edita el change `alpha` y un remoto divergente cuyo commit borra el change `beta` y un registro de consumo
- **When** se ejecuta `changeledger sync`
- **Then** termina con código distinto de cero con `Error: merged state drops "<ruta>", present in the local state; sync adopted nothing` para la primera ruta perdida en orden de ruta
- **And** no se crea el commit de merge, la ref local conserva su oid y el remoto no cambia

### CR4 — Una historia sin borrados se sincroniza como hoy
- **Given** un clon activado cuyo remoto publica una revisión descendiente que añade un change y edita otro
- **When** se ejecuta `changeledger sync`
- **Then** termina con código cero y la ref local avanza a la revisión remota

### CR5 — Las entradas desconocidas mantienen su diagnóstico propio en el merge
- **Given** el caso de reconciliación de `20261002-161641` en que el lado remoto borra `.changeledger-state/future/a.json`
- **When** se ejecuta `changeledger sync`
- **Then** termina con el diagnóstico actual `merged state drops ".changeledger-state/future/a.json", an entry of a collection this ChangeLedger does not know (future); update the installation before syncing`

### CR6 — Un registro de consumo reescrito no se adopta
- **Given** un clon activado con un registro de consumo, y una revisión remota que reescribe sus bytes, primero como descendiente de la local y después en un remoto divergente cuyo lado local no tocó ese registro
- **When** se ejecuta `changeledger sync` frente a cada una
- **Then** cada ejecución termina con código distinto de cero con `Error: state revision <oid> rewrites usage record "<ruta>", present in the local state; sync adopted nothing` en el fast-forward y `Error: merged state rewrites usage record "<ruta>", present in the local state; sync adopted nothing` en la reconciliación
- **And** la ref local conserva su oid, no se crea el commit de merge y el remoto no cambia

## Plan

- [ ] Escribir pruebas fallidas del fast-forward y de la reconciliación que pierden identidades
  - **Target:** `test/sync.test.mjs`
  - **Verify:** `pnpm test`
  - **Criteria:** CR1, CR2, CR3, CR4, CR5, CR6
- [ ] Comprobar la supervivencia por ruta con un helper común antes de adoptar
  - **Target:** `src/state-store.mjs, src/commands/sync.mjs`
  - **Verify:** `pnpm test`
  - **Criteria:** CR1, CR2, CR3, CR4, CR5, CR6
- [ ] Actualizar la cabecera de `src/commands/sync.mjs` y los comentarios de `src/state-store.mjs` que describen qué comprueba cada camino
  - **Support:**
- [ ] Ejecutar el gate completo
  - **Verify:** `pnpm verify`
  - **Support:**

## Log
- **2026-10-12T14:18:09Z** `[version]` 0.18.0-dev
- **2026-10-12T15:23:52Z** `[status]` draft → approved (human via conversation)
