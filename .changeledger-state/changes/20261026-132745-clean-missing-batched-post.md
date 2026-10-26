---
id: "20261026-132745"
title: La limpieza de proyectos ausentes falla justo cuando más se necesita
type: change
status: in-progress
created: 2026-10-26T13:27:45Z
depends_on: []
branch: change/20261026-132745
related_to: ["20260815-133442", "20261023-181453"]
owner: raruiz-hiberuscom
---

## Request

El humano pulsó `Clean missing (N)` en el panel Projects con 2.447 entradas
ausentes y la operación falló sin limpiar nada. La limpieza deja de funcionar
por encima de unas pocas centenas de ausencias, que es exactamente cuando hace
falta: cuanto más sucio está el registro, menos sirve el limpiador.

### Investigation

El cliente envía todas las candidatas en un único POST a
`/api/projects/clean-missing`, como pares `{id, path}`:
`cleanMissingProjectsFromView` en `src/viewer/public/app.js` toma
`state.projectsList.filter(item => item.missing === true)` y
`postCleanMissingProjects` en `src/viewer/public/api.js` lo manda entero.

`router.mjs` acumula el cuerpo y lo corta en `MAX_BODY`, 64 KiB, respondiendo
`413 {"error":"body too large"}` antes de llegar al dominio. El tope es
deliberado: su comentario dice que un payload de estado es diminuto y que el
límite existe para mantenerse defensivo.

Medido sobre la copia real del registro en el momento del fallo
(`.registry.json.bak-20261026-081605`): 2.447 candidatas ausentes producen un
cuerpo de 322.911 bytes, 4,9 veces el tope. Con esas rutas el umbral está en
unas 519 candidatas.

Nada más de la limpieza está roto. `cleanMissingProjects` en
`src/registry.mjs` hace lo correcto bajo el lock —relee, sondea
`<path>/.changeledger/config.yml`, elimina solo `ENOENT` o `ENOTDIR`, cuenta
`skipped` cualquier otro fallo, escribe una sola vez— y el viewer global sí
lista todas las entradas del registro. La petición nunca llega ahí.

`20260815-133442` entregó esta limpieza y descartó encadenar desregistros
individuales por fila porque multiplica peticiones y admite éxito parcial. Ese
descarte sigue vigente: lo que se propone no es una petición por entrada.

### Proposal

Trocear el envío en lotes que quepan bajo `MAX_BODY` y agregarlos en un solo
resultado para la UI. Cada lote conserva el modelo de seguridad ya entregado y
especificado en `viewer.md`: candidatas observadas, re-sondeo bajo el lock,
borrado solo si el binding conserva la ruta observada, y `EACCES` u otros
fallos no concluyentes conservados fail-closed.

Se descarta subir `MAX_BODY`: el tope es defensivo por diseño y cualquier
valor vuelve a quedarse corto con el registro suficientemente sucio.

Se descarta que el servidor observe por su cuenta a partir del registro, sin
candidatas: eliminaría la precondición de binding observado que protege de
borrar una entrada que reapareció entre el listado y la acción.

El resultado parcial deja de ser un defecto y pasa a ser un estado que la UI
debe saber contar: un lote que falle no puede presentarse como limpieza
completa ni dejar el panel mintiendo sobre lo que queda.

### Objective

Que `Clean missing (N)` limpie el registro sea cual sea el número de ausencias,
sin que el tamaño del cuerpo de la petición imponga un techo.

Terminado significa que una limpieza con un número de candidatas muy por encima
del umbral de 64 KiB elimina todas las ausencias confirmadas, y que si algún
lote falla la UI informa de cuántas se limpiaron y cuántas no.

### Frontier

Entra el camino de la limpieza en el viewer: el cliente que compone y envía la
petición (`src/viewer/public/app.js`, `src/viewer/public/api.js`), lo que haga
falta en `src/viewer/server/router.mjs` o `src/viewer/domain.mjs` para agregar
lotes, y sus tests.

Queda pre-autorizado dentro de esa frontera reconciliar en `viewer.md` el
párrafo que describe hoy la limpieza como una única mutación.

Queda fuera:

- `cleanMissingProjects` en `src/registry.mjs`: hace lo correcto y no se toca.
- El valor de `MAX_BODY`.
- Dar a la limpieza una sede en el CLI. Hoy no existe ningún comando que la
  alcance, lo que obligó a editar el JSON a mano, pero es una carencia distinta
  de este defecto.
- Dos divergencias entre specs y código detectadas al investigar, que se
  reportan sin reconciliar: `viewer.md` dice que el nombre cacheado del registro
  sirve «cuando la ruta ya no existe», mientras `listProjects` también lo
  conserva ante `EACCES`, repo no activado y activación legacy; y
  `architecture.md` describe la tolerancia de `listProjects` como «la ruta
  registrada no es un directorio utilizable», que sondea el directorio, mientras
  `viewer.md` y la limpieza sondean `<path>/.changeledger/config.yml`.

## Specification

### CR1 — Un conjunto por encima del tope se trocea y se elimina entero
- **Given** 600 candidatas ausentes cuyas rutas hacen que un solo cuerpo `{confirm, candidates}` supere el presupuesto de troceo del cliente
- **When** se confirma `Clean missing` y todos los lotes responden `200`
- **Then** el cliente emite más de una petición y ningún cuerpo enviado supera ese presupuesto
- **And** el cuerpo agregado que recibe la UI declara `removed: 600` y `skipped: 0`

### CR2 — El presupuesto del cliente no puede superar al del servidor
- **Given** la constante de presupuesto del cliente y `MAX_BODY` de `src/viewer/server/router.mjs`
- **When** se comparan
- **Then** el presupuesto del cliente es menor o igual que `MAX_BODY`

### CR3 — Un conjunto que cabe sigue emitiendo una sola petición
- **Given** 3 candidatas ausentes
- **When** se confirma `Clean missing`
- **Then** se emite exactamente una petición

### CR4 — Un lote que falla no se presenta como limpieza completa
- **Given** 600 candidatas y un servidor que responde `200` al primer lote y `500 {"error":"unable to update project registry"}` al segundo
- **When** termina la operación
- **Then** la UI refresca el listado antes de informar del fallo
- **And** el mensaje de error nombra cuántas entradas se eliminaron antes de parar

### CR5 — El endpoint acepta la limpieza en lotes sucesivos
- **Given** un registro con `alpha` vivo y las ausentes `gone-1` y `gone-2`
- **When** se hacen dos POST autenticados a `/api/projects/clean-missing`, el primero con la candidata `gone-1` y el segundo con `gone-2`
- **Then** cada respuesta declara `removed: 1` y el registro final conserva solo `alpha`

## Plan

- [x] Extraer el presupuesto de troceo como constante del cliente y la función
  que parte las candidatas en lotes que quepan en él
  - **Target:** `src/viewer/public/api.js`
  - **Verify:** `node --test test/viewer-metadata.test.mjs`
  - **Criteria:** CR1, CR2, CR3
  - **Resolved:** `2026-10-26T13:35:15Z`
- [x] Emitir una petición por lote y agregar `removedIds`, `removed` y `skipped`
  en un único cuerpo para la UI, informando del fallo tras refrescar
  - **Target:** `src/viewer/public/app.js`
  - **Verify:** `node --test test/viewer-metadata.test.mjs`
  - **Criteria:** CR1, CR3, CR4
  - **Resolved:** `2026-10-26T13:35:16Z`
- [x] Escribir los criterios como tests
  - **Target:** `test/viewer-metadata.test.mjs`
  - **Verify:** `node --test test/viewer-metadata.test.mjs`
  - **Criteria:** CR1, CR2, CR3, CR4
  - **Resolved:** `2026-10-26T13:35:17Z`
- [x] Cubrir la limpieza en lotes sucesivos contra el servidor real
  - **Target:** `test/view.test.mjs`
  - **Verify:** `node --test test/view.test.mjs`
  - **Criteria:** CR5
  - **Resolved:** `2026-10-26T13:35:18Z`
- [x] Reconciliar en `viewer.md` el párrafo que describe la limpieza como una
  única mutación
  - **Target:** `.changeledger/specs/viewer.md`
  - **Verify:** `node bin/changeledger.mjs check`
  - **Support:**
  - **Resolved:** `2026-10-26T13:35:19Z`
- [x] Ejecutar el gate local completo
  - **Support:** `pnpm test`
  - **Resolved:** `2026-10-26T13:35:19Z`

## Log
- **2026-10-26T13:27:45Z** `[version]` 1.0.1-dev
- **2026-10-26T13:29:35Z** `[status]` draft → approved (human via conversation)
- **2026-10-26T13:29:49Z** `[status]` approved → in-progress
- **2026-10-26T13:29:49Z** `[branch]` set: change/20261026-132745 (auto)
- **2026-10-26T13:35:20Z** `[note]` Los tests se escribieron después del código, no antes: se demostró el rojo a posteriori apartando con `git stash` solo `app.js` y `api.js` — sin el arreglo fallan CR1 y CR4, y el presupuesto de CR2 es `undefined`.
