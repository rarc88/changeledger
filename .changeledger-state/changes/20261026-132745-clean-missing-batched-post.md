---
id: "20261026-132745"
title: La limpieza de proyectos ausentes falla justo cuando más se necesita
type: change
status: approved
created: 2026-10-26T13:27:45Z
depends_on: []
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

## Log
- **2026-10-26T13:27:45Z** `[version]` 1.0.1-dev
- **2026-10-26T13:29:35Z** `[status]` draft → approved (human via conversation)
