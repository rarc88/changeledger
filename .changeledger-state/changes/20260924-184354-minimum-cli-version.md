---
id: "20260924-184354"
title: Exigir una versión mínima de ChangeLedger por repositorio
type: feature
status: in-progress
created: 2026-09-24T18:43:54Z
depends_on: []
branch: feature/20260924-184354
related_to: ["20260628-113218", "20260628-113219", "20260731-161652"]
owner: Roberto Ruiz
release_impact: minor
---

## Request

Cada desarrollador debe poder instalar ChangeLedger globalmente y ejecutar la
misma CLI en sus repositorios. `backend-laravel` conservó una dependencia local
`^0.11.0`, mientras el binario global observado era `0.16.1`; los documentos
creados con gramática antigua explican 379 de los 380 errores observados. El
repositorio debe declarar qué versión mínima de ChangeLedger necesita y la
propia herramienta debe rechazar el trabajo con una versión inferior, con un
mensaje que indique ambas versiones y pida actualizar la instalación global.

La validación pertenece a la CLI y al servidor local que ésta lanza, no al CI.
Debe empezar a funcionar con la primera versión que incorpora este guard: una
CLI anterior no puede aprender retroactivamente a leer la nueva declaración.
Quedan fuera de este change la limpieza de dependencias en `backend-laravel`, la
migración de sus 380 errores y la publicación o instalación global del paquete.

## Investigation

La configuración vigente tiene `schema_version: 5`, sin requisito de versión
del binario. `changeledger --version` lee la versión del `package.json`
distribuido. `assertSupportedSchema` rechaza schemas futuros en varias rutas de
escritura, pero no distingue dos versiones de CLI que comparten un schema.
`loadEffectiveConfig` elige el archivo del worktree en repos no activados y el
blob de la ref de estado en repos activados; la CLI también tiene rutas que
cargan config por otras costuras, por lo que el guard no debe depender de una
sola de ellas. `view` puede servir proyectos registrados distintos del cwd y
sus escrituras necesitan comprobar la configuración efectiva del proyecto
destino.

Los changes `20260628-113218` (versión del binario), `20260628-113219`
(migraciones de config) y `20260731-161652` (schemas futuros) son contexto
relacionado ya cerrado, sin dependencia de ejecución.

Una igualdad exacta haría que una actualización global compatible dejase de
funcionar hasta editar cada repo. Un mínimo SemVer permite avanzar sin esa
coordinación y obliga a actualizar sólo cuando el repo adopta una capacidad que
la versión anterior no entiende. Las versiones publicadas antes del guard no
leen `min_cli_version`: ninguna puede bloquearse, y la validación empieza con
la primera versión que lo incorpora. Por la misma razón ningún repo schema 5
tiene una declaración previa que conservar.

Interfaces externas: la versión del `package.json` distribuido es el dato
estable que expone `changeledger --version`; la configuración y la respuesta
HTTP del viewer son contratos versionados de la herramienta. La ruta o salida
de `npm`/`pnpm` global no es estable y no se lee para decidir compatibilidad.

## Proposal

Añadir `min_cli_version` al schema 6. `init` y la migración explícita desde
schema 5 escriben la versión del paquete que ejecuta la operación. El guard
sólo actúa en schema 6: en schemas anteriores se mantiene la compatibilidad
actual; en schema 6 la clave es obligatoria y debe ser una versión SemVer
concreta, incluidos prereleases. La comparación usa precedencia SemVer, no
igualdad textual ni salida de gestores de paquetes.

Antes de ejecutar cualquier comando, la CLI compara la versión instalada con el
mínimo de la configuración efectiva y falla sin efectos cuando está por debajo.
La lista de excepciones es cerrada: `help`/`--help`, `--version` y
`config migrate --dry-run` siguen disponibles para diagnóstico; `init` conserva
su propio error, porque sólo trabaja donde aún no hay configuración; y `view`
puede abrirse para lectura, pero cada mutación de un proyecto registrado
comprueba el mínimo de ese proyecto antes de escribir. La comprobación comparte una sola función y un diagnóstico
accionable. El guard no instala paquetes, no consulta la red y no añade CI.

## Specification

### CR1 — Un repo nuevo declara la versión que lo inicializó
- **Given** una instalación de ChangeLedger con versión distribuida `0.17.0`
- **When** se ejecuta `changeledger init` en un repo nuevo
- **Then** `.changeledger/config.yml` contiene `schema_version: 6` y `min_cli_version: 0.17.0`
- **And** `changeledger check` con esa instalación termina con código cero

### CR2 — La migración declara la versión que la ejecuta
- **Given** un repo schema 5 sin `min_cli_version` y la CLI `0.17.0`
- **When** se ejecuta `changeledger config migrate --dry-run` y después `changeledger config migrate`
- **Then** el preview no escribe y el resultado aplicado declara `schema_version: 6` y `min_cli_version: 0.17.0`
- **And** una segunda migración es byte-idéntica

### CR3 — Una CLI inferior se detiene antes de trabajar
- **Given** un repo schema 6 con `min_cli_version: 0.18.0`, un change `approved` y una CLI `0.17.0`
- **When** se ejecutan `changeledger context` y `changeledger status <id> in-progress` sobre ese change
- **Then** ambos terminan con código distinto de cero y muestran `ChangeLedger CLI 0.17.0 is below this repository's minimum 0.18.0; update the global installation.`
- **And** no cambian archivos, locks ni refs del repo

### CR4 — La precedencia SemVer decide compatibilidad
- **Given** una comparación de versiones instalada/requerida
- **When** se prueban `0.17.0`/`0.17.0`, `0.17.1`/`0.17.0`, `0.17.0-dev`/`0.17.0` y `0.16.9`/`0.17.0`
- **Then** los dos primeros pares son compatibles y los dos últimos son incompatibles

### CR5 — Una declaración inválida falla cerrada sin ocultar diagnóstico
- **Given** un repo schema 6 con un change `approved` y `min_cli_version: latest` o sin esa clave
- **When** se ejecuta `changeledger check` o `changeledger status <id> in-progress` sobre ese change
- **Then** ambos terminan con código distinto de cero y nombran `min_cli_version` y el valor inválido o ausente
- **And** `changeledger --version` y `changeledger help` siguen disponibles

### CR6 — La ref activada es la autoridad del mínimo
- **Given** un repo activado cuyo worktree declara `0.16.1` y cuya ref de estado declara `0.18.0`
- **When** la CLI `0.17.0` ejecuta un comando ligado al repo
- **Then** se rechaza por el mínimo `0.18.0` de la ref antes de cualquier mutación
- **And** cambiar sólo el marcador o config del worktree no evita el rechazo

### CR7 — El viewer protege al proyecto que recibe la escritura
- **Given** un viewer abierto con dos proyectos registrados, uno con mínimo `0.18.0` y otro con mínimo `0.17.0`, servido por la CLI `0.17.0`
- **When** se intenta editar config o ejecutar una transición en cada proyecto
- **Then** el proyecto incompatible responde HTTP 409 con el diagnóstico de CR3 y no cambia su estado
- **And** el proyecto compatible conserva su comportamiento normal y ambos siguen siendo legibles

### CR8 — El primer uso después de inicializar y actualizar
- **Given** un repo inicializado por la CLI `0.17.0`, con el mínimo `0.17.0`
- **When** otro desarrollador usa una CLI global `0.17.1` y ejecuta `changeledger context` seguido de `changeledger check`
- **Then** obtiene el contexto y un check exitoso sin editar la configuración del repo
- **And** si el repo eleva su mínimo a `0.18.0`, la CLI `0.17.1` recibe el diagnóstico de CR3 con esas dos versiones hasta que se actualice

### CR9 — Las excepciones al guard son una lista cerrada
- **Given** un repo schema 6 con `min_cli_version: 0.18.0` y una CLI `0.17.0`
- **When** se ejecutan `changeledger --version`, `changeledger help`, `changeledger config migrate --dry-run` e `changeledger init`
- **Then** `--version` imprime `0.17.0`, `help` y `config migrate --dry-run` terminan con código cero sin escribir, e `init` termina con código distinto de cero y muestra `` .changeledger/ already exists. Use `changeledger register` to refresh this repo. ``
- **And** cada comando registrado en la CLI fuera de esa lista y de `view` (CR7), invocado con los argumentos que su ayuda declara obligatorios, termina con código distinto de cero y el diagnóstico de CR3

## Plan

- [x] Escribir pruebas fallidas de schema 6, init y migración explícita
  - **Target:** `test/config-migration.test.mjs, test/cli-bin.test.mjs`
  - **Verify:** `node --test test/config-migration.test.mjs test/cli-bin.test.mjs`
  - **Criteria:** CR1, CR2, CR5
  - **Resolved:** `2026-09-25T11:10:00Z`
- [ ] Publicar `min_cli_version` en schema 6 y escribirlo en init y migración
  - **Target:** `templates/config.yml, src/config-migration.mjs, src/commands/init.mjs, src/check.mjs`
  - **Verify:** `node --test test/config-migration.test.mjs test/check.test.mjs`
  - **Criteria:** CR1, CR2, CR5
- [ ] Reorientar las pruebas que fijan el schema futuro al nuevo schema soportado
  - **Target:** `test/cli.test.mjs, test/fix.test.mjs, test/agent.test.mjs, test/view.test.mjs`
  - **Verify:** `node --test test/cli.test.mjs test/fix.test.mjs test/agent.test.mjs test/view.test.mjs`
  - **Support:**
- [ ] Probar la precedencia, el rechazo temprano en CLI activa e inactiva y las excepciones
  - **Target:** `test/cli-bin.test.mjs, test/config.test.mjs, test/agent.test.mjs`
  - **Verify:** `node --test test/cli-bin.test.mjs test/config.test.mjs test/agent.test.mjs`
  - **Criteria:** CR3, CR4, CR5, CR6, CR8, CR9
- [ ] Implementar un guard compartido en el despacho CLI con config efectiva
  - **Target:** `src/config.mjs, src/version-guard.mjs, bin/changeledger.mjs`
  - **Verify:** `node --test test/cli-bin.test.mjs test/config.test.mjs`
  - **Criteria:** CR3, CR4, CR5, CR6, CR8, CR9
- [ ] Probar y proteger las mutaciones por proyecto del viewer
  - **Target:** `test/view.test.mjs, src/viewer/domain.mjs`
  - **Verify:** `node --test test/view.test.mjs`
  - **Criteria:** CR7
- [ ] Actualizar contrato, ayuda y specs afectadas, luego ejecutar el gate completo
  - **Target:** `templates/contract/implement.md, src/contract.mjs, .changeledger/specs/`
  - **Verify:** `pnpm test && pnpm verify`
  - **Criteria:** CR1, CR3, CR5, CR7, CR8, CR9

## Log
- **2026-09-25T10:18:38Z** `[status]` draft → approved (human via conversation)
- **2026-09-25T10:19:26Z** `[status]` approved → in-progress
- **2026-09-25T10:19:26Z** `[branch]` set: feature/20260924-184354 (auto)
