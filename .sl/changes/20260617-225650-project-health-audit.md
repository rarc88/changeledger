---
id: "20260617-225650"
title: Auditoría general de salud del proyecto
type: audit
status: done
created: 2026-06-17T22:56:50Z
depends_on: []
owner: Roberto Ruiz
reviewed: true
archived: true
---

## Request

Auditar el estado general del proyecto para evaluar salud, deuda tecnica,
malas practicas, posibles errores y puntos de mejora.

## Investigation

### Veredicto

La salud general es **buena**. El proyecto esta en un estado bastante solido
para pre-1.0: tiene contrato operativo, tests amplios, CI multiplataforma,
smoke test del tarball, politica de seguridad, pre-commit, y una cantidad
inusualmente alta de invariantes delicadas cubiertas por pruebas.

No encontre senales de mala practica sistemica ni deuda grave no reconocida. Si
hay deuda tecnica y de producto, pero esta mayormente acotada y visible.

### Senales positivas

- `pnpm verify` pasa completo: Biome, `node --test` y `sl check`.
- Suite local: 306 tests, 0 fallos.
- `sl check`: 103 changes validos.
- `pnpm audit` ejecutado por el owner: `No known vulnerabilities found`.
- No hay cambios pendientes de graduacion (`sl graduate --pending`).
- El repo esta limpio antes de la auditoria y la rama actual no es `main`.
- El threat model esta documentado en `SECURITY.md` y el codigo refleja buena
  parte de el: loopback, token para escrituras, limite de body, sanitizacion de
  Markdown, Mermaid estricto y containment de paths.
- Los flujos de CI cubren Node 20/22 en Linux, macOS y Windows, y ademas prueban
  el tarball instalable.
- No aparecen `TODO`/`FIXME` reales en codigo de producto.

### Hallazgos

#### Medio — el registry global puede perder escrituras concurrentes

`src/registry.mjs` hace `readRegistry()` + mutacion en memoria +
`writeRegistry()` atomico, pero no hay lock alrededor de la secuencia
read-modify-write. Dos procesos ejecutando `sl register`/`remove` a la vez
pueden leer el mismo snapshot y el ultimo writer gana, perdiendo la actualizacion
del otro. El proyecto ya cuida concurrencia en changes via locks, asi que este
borde del registry local queda como el punto mas claro de deuda tecnica.

Area: `src/registry.mjs` lineas 19-48.

#### Medio — rutas internas de dependencias en `vendorFile`

El viewer evita un bundler y sirve builds de navegador desde `node_modules` con
`require.resolve()`, lo cual es simple y correcto para una herramienta local.
El trade-off es que algunas rutas apuntan a artefactos internos de paquetes
(`marked/lib/marked.umd.js`, `mermaid/dist/mermaid.min.js`,
`dompurify/dist/purify.min.js`). Como las dependencias estan declaradas con
rangos `^`, una actualizacion minor/patch que reorganice esos artefactos podria
romper el viewer con un 404 de vendor aunque el codigo propio no haya cambiado.

Area: `src/viewer/server/router.mjs` funcion `vendorFile`.

Mitigaciones posibles: fijar versiones exactas para dependencias de runtime que
se sirven por ruta interna, agregar smoke test de `/vendor/*` sobre el tarball,
o introducir un paso de empaquetado minimo si el coste de mantener paths internos
empieza a crecer.

#### Bajo — auditoria de vulnerabilidades fuera del gate automatizado

`package.json` tiene `pnpm verify` como lint + tests + `sl check`, y CI ejecuta
ese gate; no hay paso equivalente a `pnpm audit` o revision periodica de
advisories. El owner ejecuto `pnpm audit` y no encontro vulnerabilidades
conocidas, asi que el estado actual es bueno. La mejora pendiente es de proceso:
definir si este check queda como ritual manual antes de releases o como job de
CI, sabiendo que envia metadatos del lockfile al servicio externo de npm.

Areas: `package.json` lineas 30-36, `.github/workflows/ci.yml` lineas 24-25.

#### Bajo — `app.js` sigue siendo el punto de mayor acoplamiento del viewer

El viewer ya esta parcialmente modularizado (`security`, `state`, `view-parts`,
`view-renderers`, `api`), pero `src/viewer/public/app.js` conserva estado global,
polling, filtros, navegacion, handlers, vistas, detalles y busqueda global en un
solo archivo de 553 lineas. No es un bug hoy; es una zona donde cambios futuros
del viewer van a tener mas riesgo de regresion si crece mucho mas.

Area: `src/viewer/public/app.js` lineas 12-31 y flujo de render lineas 115-181.

#### Bajo — falta una vista explicita de coverage

La suite es amplia, pero `pnpm test` solo ejecuta `node --test`; no expone una
senal de cobertura. No lo cambiaria directamente en el script base porque
coverage puede meter ruido o coste extra en el ciclo rapido. Mejor opcion:
agregar `test:coverage` con `node --test --experimental-test-coverage` y decidir
despues si CI lo usa como informacion o como umbral.

Area: `package.json` script `test`.

#### Bajo — `package.json` no declara `exports`

El paquete esta pensado principalmente como CLI (`bin.sl`). Al no declarar
`exports`, consumidores pueden importar rutas internas como si fueran API
publica. No lo considero una barrera de seguridad fuerte, pero si una mejora de
higiene de packaging: definir explicitamente si existe una API publica o cerrar
los internals por defecto.

Area: `package.json`.

#### Bajo — hay housekeeping pendiente en el board

`sl archive --graduated --dry-run` lista 8 cambios `done` y graduados que pueden
archivarse. No afecta calidad tecnica ni `sl check`, pero si el board es la
superficie humana principal, archivarlos reduciria ruido.

### Deuda ya visible en el ledger

- `20260613-222920` sigue `blocked` por tareas de owner relacionadas con npm
  publish/trusted publishing.
- `20260617-190011` fue descartado explicitamente, no queda como deuda activa.
- Los cambios recientes del 17 de junio muestran que varias fricciones criticas
  ya fueron cerradas: atomicidad de graduate, sync I/O en viewer, locks de
  `sl new`, token injection, error leaks y manejo de `res.ok`.

### Limitaciones

- `pnpm audit` no pudo ejecutarse desde mi sandbox por restriccion de red y
  privacidad, pero el owner lo ejecuto fuera del sandbox y reporto:
  `No known vulnerabilities found`.
- No se verifico el estado real del paquete en npm; la conclusion sobre publish
  se basa en el ledger local y su change bloqueado.
- No hice pentest dinamico del viewer en navegador; la revision fue estatica mas
  la suite local existente.

## Log

- **2026-06-17T22:56:50Z** — audit scaffold created.
- **2026-06-17T23:00:18Z** — ejecutado `pnpm verify`: lint OK, 306 tests OK, `sl check` OK.
- **2026-06-17T23:00:18Z** — intento de `pnpm audit --audit-level moderate` fallo por DNS; escalacion bloqueada por riesgo de privacidad al enviar metadatos a npm.
- **2026-06-17T23:00:18Z** — registrados hallazgos y veredicto general.
- **2026-06-17T23:00:31Z** — status: draft → approved
- **2026-06-17T23:00:36Z** — status: approved → in-progress
- **2026-06-17T23:00:36Z** — owner → Roberto Ruiz (auto)
- **2026-06-17T23:00:41Z** — status: in-progress → done
- **2026-06-17T23:11:45Z** — incorporados hallazgos utiles de una segunda auditoria y actualizado el estado de `pnpm audit` segun ejecucion del owner.
- **2026-06-18T10:06:37Z** — graduation skipped: Audit record; no persistent architectural truth
- **2026-06-18T10:09:09Z** — archived
