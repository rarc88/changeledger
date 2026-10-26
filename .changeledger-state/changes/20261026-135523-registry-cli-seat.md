---
id: "20261026-135523"
title: La limpieza del registro no se alcanza sin el viewer
type: change
status: in-progress
created: 2026-10-26T13:55:23Z
depends_on: []
branch: change/20261026-135523
related_to: ["20260815-133442", "20261026-132745", "20261023-181453"]
owner: raruiz-hiberuscom
---

## Request

El registro global de proyectos solo se puede ver y limpiar desde el viewer.
Cuando el viewer no está disponible —sin navegador, en una sesión de agente, o
porque el propio registro está lo bastante roto como para estorbarlo— no hay
recurso: hay que editar `~/.changeledger/.registry.json` a mano. Ha pasado dos
veces, el 2026-10-23 y el 2026-10-26.

### Investigation

`node bin/changeledger.mjs --help` ofrece `init`, `register` y `view` como
comandos relacionados con el registro. No hay ninguno que liste los proyectos
registrados, ni que desregistre, ni que limpie.

La lógica existe y es correcta. `cleanMissingProjects` en `src/registry.mjs`
relee bajo el lock, sondea `<path>/.changeledger/config.yml`, elimina solo
`ENOENT` o `ENOTDIR`, conserva cualquier otro fallo como `EACCES` y escribe una
sola vez. Su único llamador de producción es `src/viewer/domain.mjs`, que la
envuelve tras el endpoint autenticado. `listProjects`, también en
`src/registry.mjs`, es el listado.

`20260815-133442` entregó esa limpieza como acción del panel Projects.
`20261026-132745` arregló que un registro suficientemente sucio la rompiera por
tamaño de cuerpo. Ninguno de los dos le dio una sede fuera del viewer, que es lo
que queda.

Hay una trampa que condiciona el diseño y que conviene decidir antes de
implementar: `listProjects` relanza cuando un repo activado tiene su estado
ilegible, como fija el test `CR12: listProjects fails closed when an activated
state ref is missing`. Un listado o una limpieza construidos sobre él heredan
ese fail-closed, de modo que un solo repo roto dejaría el CLI tan bloqueado como
estaba el viewer. Sería repetir la forma del defecto que este cambio viene a
quitar.

### Proposal

Dar al registro una sede en el CLI que reúse `listProjects` y
`cleanMissingProjects` sin reimplementar nada: el comando hace el papel que hoy
hace el cliente del viewer, observar y pasar las candidatas, y la mutación
conserva intactas sus garantías —binding observado, re-sondeo bajo el lock,
`EACCES` preservado fail-closed—. Sin HTTP no hay tope de cuerpo, así que el
troceo de `20261026-132745` no se replica aquí.

Frente al fail-closed de `listProjects`, se propone que el CLI nombre el repo
que falla y siga con los demás, en vez de abortar. Un repo activado roto es
justamente uno de los motivos por los que alguien llega a este comando.

Se descarta reimplementar el sondeo en el comando: duplicaría el criterio
`ENOENT`/`ENOTDIR`/`EACCES` que ya está probado y escrito en `viewer.md`, y las
dos copias divergirían.

Se descarta añadir también desregistro por id: el viewer ya lo tiene y es otro
concern.

### Objective

Que el registro global se pueda inspeccionar y limpiar desde el CLI, sin viewer
y sin editar el JSON a mano.

Terminado significa que un comando lista los proyectos registrados con su salud,
que otro elimina las ausencias confirmadas con el mismo criterio que el viewer,
y que un repo activado con el estado ilegible no impide ninguna de las dos cosas
sobre los demás.

### Frontier

Entra la sede nueva: el comando en `bin/changeledger.mjs` y `src/commands/`, lo
que haga falta en `src/registry.mjs` para que el listado tolere un repo roto sin
tumbar la operación, y sus tests.

Queda pre-autorizado dentro de esa frontera reconciliar los specs que describan
el listado o la limpieza del registro una vez exista la sede.

Queda fuera:

- El viewer, su endpoint y su cliente.
- El criterio `ENOENT`/`ENOTDIR`/`EACCES`, que no cambia.
- Desregistrar un proyecto por id desde el CLI.
- Las dos divergencias entre specs y código ya reportadas y no reconciliadas:
  `viewer.md` dice que el nombre cacheado sirve «cuando la ruta ya no existe»
  mientras `listProjects` también lo conserva ante `EACCES`, repo no activado y
  activación legacy; y `architecture.md` describe la tolerancia de
  `listProjects` como «la ruta registrada no es un directorio utilizable», que
  sondea el directorio, mientras la limpieza sondea
  `<path>/.changeledger/config.yml`.

## Log
- **2026-10-26T13:55:23Z** `[version]` 1.0.1-dev
- **2026-10-26T13:56:52Z** `[status]` draft → approved (human via conversation)
- **2026-10-26T13:56:56Z** `[status]` approved → in-progress
- **2026-10-26T13:56:56Z** `[branch]` set: change/20261026-135523 (auto)
