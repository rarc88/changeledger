---
id: "20260809-110951"
title: Aislar los fixtures de tests que corren en paralelo
type: bug
status: in-validation
created: 2026-08-09T11:09:51Z
depends_on: []
branch: bug/20260809-110951
related_to: ["20260729-203257", "20260808-151641"]
owner: rarc88
---

## Request

Flakiness preexistente observado una vez durante la etapa 1 del estado global
(2026-08-08, delegado de implementación; no reproducido en reruns): el test
`203257 correction: no raw control bytes in source files` falló con `ENOENT`
sobre `src/viewer/public-sibling-secret.txt` bajo ejecución paralela de
archivos de test — una carrera de aislamiento entre el fixture de archivo
temporal que `test/view.test.mjs` crea junto a `src/viewer/public/` y el
barrido de directorios que `test/cli.test.mjs` hace sobre `src/`. Ninguno de
los dos es incorrecto por separado: el fixture escribe y borra un archivo
real dentro del árbol fuente, y el barrido lo lista y luego intenta leerlo
cuando ya no existe.

Se pide eliminar la carrera de clase, no de incidente: ningún test debe crear
archivos dentro del árbol fuente versionado (`src/**`) — los fixtures que hoy
lo hacen se mueven a un directorio temporal, o el barrido tolera
explícitamente la desaparición entre listado y lectura, con la primera opción
como preferida (un árbol fuente que muta durante los tests es la causa raíz,
no el lector).

## Investigation

La carrera sigue presente. `node --test` ejecuta archivos en paralelo;
`test/view.test.mjs` crea y elimina dos veces
`src/viewer/public-sibling-secret.txt`, mientras el guard de bytes de control de
`test/cli.test.mjs` enumera y después lee todo `src/`. Si el fixture desaparece
entre ambas operaciones, el lector lanza el `ENOENT` observado.

El inventario de mutadores de los módulos de test encontró solo esos dos
escritores bajo el `src/**` versionado. Otros paths llamados `src` pertenecen a
repos temporales. Tolerar `ENOENT` en el guard ocultaría futuras mutaciones y no
resuelve la causa.

La solución mínima permite inyectar un root opcional en el resolver interno
`staticFile` y mueve ambos fixtures a un `mkdtemp`. Los tests ejercitan el
resolver directamente, incluyendo un asset interno de control; el smoke HTTP
existente conserva el enlace con producción. La firma pública, rutas, MIME y
contenido no cambian: el root por defecto sigue siendo `publicDir` y el nuevo
parámetro no está exportado por el paquete.

## Specification

### CR1 — El traversal codificado queda dentro del fixture temporal
- **Given** un root temporal con `public/asset.txt` y un secreto hermano
- **When** se resuelven `/asset.txt` y `/..%2Fpublic-sibling-secret.txt` contra ese `public/`
- **Then** el asset interno se resuelve y el traversal codificado devuelve `null`

### CR2 — Un hermano con prefijo compartido no se sirve
- **Given** un root temporal donde `public-sibling-secret.txt` comparte el prefijo textual `public`
- **When** `staticFile('/../public-sibling-secret.txt', temporaryPublicDir)` se evalúa directamente
- **Then** devuelve `null`

### CR3 — Ningún fixture muta el árbol fuente
- **Given** la ejecución de los tests de traversal y prefijo compartido
- **When** crean y eliminan sus archivos
- **Then** todos los paths mutados descienden del directorio temporal
- **And** ninguno desciende del `src` del checkout

### CR4 — Producción conserva el root por defecto
- **Given** el listener de producción sin root inyectado
- **When** se solicita `/app.js`
- **Then** responde 200 con MIME JavaScript y el contenido real

### CR5 — El barrido sigue siendo estricto
- **Given** un checkout estable
- **When** corre `203257 correction: no raw control bytes in source files`
- **Then** inspecciona `src` sin tolerar `ENOENT`

## Plan

- [x] Escribir primero los fixtures temporales y demostrar que el resolver actual ignora el root inyectado
  - **Target:** `test/view.test.mjs`
  - **Verify:** `node --test --test-name-pattern="151234 CR1|151234 CR2|151234 CR3" test/view.test.mjs`
  - **Criteria:** CR1, CR2, CR3, CR4
  - **Resolved:** `2026-08-09T17:17:26Z`
- [x] Añadir el root opcional a `staticFile` y mantener estricto el barrido
  - **Target:** `src/viewer/server/router.mjs`, `test/view.test.mjs`
  - **Verify:** `node --test --test-name-pattern="151234 CR1|151234 CR2|151234 CR3" test/view.test.mjs && CHANGELEDGER_NO_GH=1 node --test --test-name-pattern="203257 correction: no raw control bytes in source files" test/cli.test.mjs`
  - **Criteria:** CR1, CR2, CR3, CR4, CR5
  - **Resolved:** `2026-08-09T17:17:26Z`
- [x] Ejecutar el gate completo
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-08-09T17:17:26Z`

## Log

- **2026-08-09T11:09:51Z** `[note]` Draft creado al cierre de la etapa 1 del
  estado global para no perder el hallazgo: carrera preexistente y ajena a esa
  capacidad, observada una sola vez por un delegado y anotada solo en
  conversación hasta ahora. Queda en draft hasta su debido momento.
- **2026-08-09T16:18:33Z** `[status]` draft → approved (human via conversation)
- **2026-08-09T16:22:39Z** `[status]` approved → in-progress
- **2026-08-09T16:22:39Z** `[branch]` set: bug/20260809-110951 (auto)
- **2026-08-09T17:17:26Z** `[note]` Implementación TDD completada: rojo 1/3 con dos fallos esperados, focales 3/3, 1/1 y 1/1, y pnpm verify 1320/1320.
- **2026-08-09T17:18:10Z** `[status]` in-progress → in-review
- **2026-08-09T17:19:05Z** `[note]` Mandato de review: auditoría completa de CR1-CR5 sobre 54a22b11..HEAD, verificando fixtures solo temporales, traversal y prefijo falsificados contra root inyectado, root de producción intacto y guard de control bytes sin tolerancia a ENOENT.
- **2026-08-09T17:26:43Z** `[review]` in-review → in-validation (delegated subagent, clean context)
