---
id: "20261023-181453"
title: Los tests contaminan el registro global del usuario
type: change
status: draft
created: 2026-10-23T18:14:53Z
depends_on: []
related_to: ["20261007-135154", "20261023-181753"]
owner: raruiz-hiberuscom
---

## Request

Ejecutar la suite registra proyectos en el registro global real del usuario.
En esta máquina `~/.changeledger/.registry.json` había acumulado 9.415
entradas (1,5 MB) de las que solo 4 eran repos reales; el resto eran
directorios temporales ya borrados. Con ese volumen el viewer deja de ser
usable.

El registro se limpió a mano el 2026-10-23 y quedó en 4 entradas. El
2026-10-26 vuelve a tener 2.451, de las que 2.426 son `changeledger-seats-*`.
El defecto se reproduce a razón de unas 800 entradas al día.

### Objective

Ninguna ejecución de la suite puede escribir en el registro global del
usuario, y el aislamiento no depende de que cada fichero de test se acuerde de
montarlo por su cuenta.

Terminado significa que una ejecución completa deja
`~/.changeledger/.registry.json` como estaba, incluido el caso de un test que
llame a `init()` sin aislarse.

### Frontier

Entra `scripts/run-tests.mjs` —el envoltorio donde ya vive el aislamiento
hermano del temporal— y los tests y fixtures que prueban ese aislamiento.
Queda pre-autorizado dentro de esa frontera ajustar el helper `repo()` de
`test/seats-matrix.test.mjs` si el arreglo del envoltorio lo deja redundante.

Queda fuera:

- La limpieza del registro de esta máquina, ya hecha a mano (copia en
  `~/.changeledger/.registry.json.bak-20261023-131420`).
- Que el registro no ofrezca una purga de entradas muertas:
  `cleanMissingProjects()` solo borra entradas cuyo binding coincide con un
  candidato observado, así que no habría podido barrer esto. Es otro concern.

### Investigation

`registryDir()` en `src/registry.mjs` resuelve el home con
`process.env.CHANGELEDGER_HOME || os.homedir()`, e `init()` registra siempre el
repo creado (`register({ id, name, path })` en `src/commands/init.mjs`). Un test
que llame a `init()` sin `CHANGELEDGER_HOME` definido escribe, por tanto, en el
home real.

`scripts/run-tests.mjs` aísla el temporal del hijo (`TMPDIR`, `TEMP`, `TMP`
apuntando a su raíz propia), que es justo lo que resolvió `20261007-135154`,
pero **no** aísla `CHANGELEDGER_HOME`. El aislamiento del registro vive hoy en
cada fichero de test, que se lo monta por su cuenta con
`process.env.CHANGELEDGER_HOME = fs.mkdtempSync(...)`.

Esa convención por fichero es la causa raíz: basta que un test la olvide.
`test/seats-matrix.test.mjs` es hoy el único que llama a `init()` sin ella —
su helper `repo()` crea un repo temporal por cada caso de la matriz — y es el
origen de 9.078 de las entradas acumuladas, el nombre `changeledger-seats-*`
con el que crea sus directorios.

Arreglar solo ese fichero deja la trampa puesta para el siguiente test que
llame a `init()`. El arreglo va en el envoltorio, donde ya vive el aislamiento
hermano del temporal: un test que se aísle por su cuenta seguirá haciéndolo
(asigna `process.env` dentro del proceso y gana), y el que no, hereda un home
desechable en vez del del usuario.

## Specification

### CR1 — El envoltorio da al hijo un `CHANGELEDGER_HOME` desechable
- **Given** `scripts/run-tests.mjs` invocado sin `CHANGELEDGER_HOME` en su entorno
- **When** arranca el proceso hijo `node --test`
- **Then** el hijo ve un `CHANGELEDGER_HOME` que es un directorio existente situado dentro de la raíz temporal del envoltorio
- **And** ese valor no es `os.homedir()`

### CR2 — El aislamiento sobrescribe un valor heredado
- **Given** `scripts/run-tests.mjs` invocado con `CHANGELEDGER_HOME` apuntando a un directorio ajeno a su raíz temporal
- **When** arranca el proceso hijo `node --test`
- **Then** el hijo ve un `CHANGELEDGER_HOME` distinto del heredado y situado dentro de la raíz temporal del envoltorio

### CR3 — El home desechable se borra con la raíz
- **Given** una ejecución del envoltorio sobre la fixture que termina con éxito
- **When** el envoltorio sale
- **Then** el directorio que el hijo vio como `CHANGELEDGER_HOME` ya no existe

### CR4 — Un test que registra un proyecto escribe en el home desechable
- **Given** una fixture ejecutada por el envoltorio que llama a `register({ id: 'cr4', name: 'cr4', path: <dir temporal> })` de `src/registry.mjs`
- **When** la fixture termina
- **Then** el `registryPath()` que la fixture observa está dentro de la raíz temporal del envoltorio y el fichero existe con la entrada `cr4`
- **And** `~/.changeledger/.registry.json` no contiene la entrada `cr4`

## Plan

- [ ] Crear la fixture que reporta el `CHANGELEDGER_HOME` observado y el
  `registryPath()` resultante de un `register()`, inerte fuera de
  `RUN_TESTS_FIXTURE` como sus hermanas
  - **Target:** `test/fixtures/run-tests/`
  - **Verify:** `node --test test/run-tests.test.mjs`
  - **Criteria:** CR1, CR2, CR3, CR4
- [ ] Escribir los cuatro criterios como tests sobre el envoltorio, reutilizando
  el `setup(t)` existente
  - **Target:** `test/run-tests.test.mjs`
  - **Verify:** `node --test test/run-tests.test.mjs`
  - **Criteria:** CR1, CR2, CR3, CR4
- [ ] Crear el home desechable bajo la raíz temporal y pasarlo en el `env` del
  hijo junto a `TMPDIR`
  - **Target:** `scripts/run-tests.mjs`
  - **Verify:** `node --test test/run-tests.test.mjs`
  - **Criteria:** CR1, CR2, CR3, CR4
- [ ] Ejecutar la suite completa y comprobar que el registro del usuario no cambia
  - **Support:** `pnpm verify`

## Log
- **2026-10-23T18:14:53Z** `[version]` 0.18.0
