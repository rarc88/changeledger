---
id: "20260812-020449"
title: El cutover aborta en Windows por la limpieza cosmética
type: bug
status: in-progress
created: 2026-08-12T02:04:49Z
depends_on: []
branch: bug/20260812-020449
related_to: ["20260812-003311", "20260809-113240"]
owner: rarc88
---

## Request

CI de Windows (run 31555192809, ambos node): `cutover` sale con exit 1 en
el test CR1 de `20260809-113240`, con stdout vacío — determinista, solo
Windows, aparecido con `20260812-003311`. Sospecha primaria: el
`fs.rmdirSync` de la limpieza con catch estricto (solo ENOENT/ENOTEMPTY
tolerados) lanza en Windows un código distinto (EPERM/EBUSY por handles o
delete-pending) y aborta el cutover entero.

Defecto de diseño independiente del código exacto: la retirada del
directorio vacío es cosmética, pero el throw ocurre entre el `git rm` y el
commit de limpieza — deja el corte en la ventana interrumpida (refs
publicadas, limpieza staged sin commitear) por una nimiedad. El arreglo:
`commitCleanup` degrada cualquier fallo del rmdir distinto de ENOENT a un
warning con directorio y código, y continúa; y los asserts de exit code del
suite de cutover incluyen stderr en su mensaje, porque hoy el CI reporta
`1 !== 0` sin causa (el helper `cli` captura stderr aparte y los asserts
solo pasan stdout).

## Investigation

- El catch estricto se eligió en `20260812-003311` para no tragar errores
  reales (la lección del ReferenceError tragado); el error fue acotarlo a
  una lista de códigos POSIX en una operación cuyo fallo nunca justifica
  abortar un corte ya publicado.
- macOS y ubuntu pasan con el mismo código: la diferencia es la semántica
  de borrado de directorios de Windows (handles abiertos, delete-pending),
  no la lógica del corte.
- El código exacto del error de Windows se confirmará con CR2 en el propio
  CI: no es reproducible en las máquinas locales disponibles.

## Specification

### CR1 — Un fallo del rmdir no aborta el corte
- **Given** un cutover cuya retirada de directorios de limpieza lanza un error distinto de ENOENT (fallo inyectado)
- **When** se ejecuta `changeledger cutover`
- **Then** el corte termina con exit 0, el commit de limpieza existe, y stderr lleva un warning nombrando el directorio y el código

### CR2 — Los fallos de exit code llegan con causa
- **Given** los asserts de exit code de `test/cutover.test.mjs`
- **When** un cutover de test falla con stdout vacío
- **Then** el mensaje del assert incluye el stderr capturado

## Plan

- [x] Warn-and-continue en commitCleanup, con inyección para el test
  - **Target:** `src/commands/cutover.mjs`, `test/cutover.test.mjs`
  - **Verify:** `node --test test/cutover.test.mjs`
  - **Criteria:** CR1
  - **Resolved:** `2026-08-12T02:10:05Z`
- [x] stderr en los mensajes de assert de exit code del suite
  - **Target:** `test/cutover.test.mjs`
  - **Verify:** `node --test test/cutover.test.mjs`
  - **Criteria:** CR2
  - **Resolved:** `2026-08-12T02:10:05Z`
- [x] Gate completo
  - **Target:** `test/cutover.test.mjs`
  - **Verify:** `pnpm test`
  - **Criteria:** CR1, CR2
  - **Resolved:** `2026-08-12T02:10:05Z`

## Log
- **2026-08-12T02:05:28Z** `[status]` draft → approved (human via conversation)
- **2026-08-12T02:06:10Z** `[status]` approved → in-progress
- **2026-08-12T02:06:10Z** `[branch]` set: bug/20260812-020449 (auto)
