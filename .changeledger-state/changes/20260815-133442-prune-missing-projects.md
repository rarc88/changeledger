---
id: "20260815-133442"
title: Limpiar proyectos ausentes del registro
type: feature
status: in-progress
created: 2026-08-15T13:34:42Z
depends_on: []
branch: feature/20260815-133442
related_to:
  - "20260627-111218"
  - "20260731-161656"
  - "20260617-231423"
  - "20260616-162027"
  - "20260809-194234"
owner: Roberto Ruiz
release_impact: minor
---

## Request

El viewer global acumula entradas de proyectos temporales usados por agentes y
pruebas después de que sus directorios desaparecen. Retirarlas una por una desde
Projects es lento y molesto. Se solicita una acción sencilla que limpie en bloque
los proyectos realmente ausentes sin borrar directorios ni afectar proyectos
disponibles o rutas que solo sean inaccesibles.

## Investigation

- `resolveProjects()` y `projectsViewTemplate()` clasifican actualmente una
  entrada como `Missing` cuando no pueden encontrar `.changeledger/config.yml`.
  La comprobación visual basada en `existsSync()` también puede devolver falso
  ante un fallo de permisos, por lo que no es una prueba suficiente para borrar
  la entrada del registro.
- El desregistro individual ya cruza `app.js` → `api.js` → `router.mjs` →
  `unregisterProjectImpl()` → `registry.remove()`. Exige loopback, token, body
  limitado, confirmación y una ruta observada; bajo lock solo elimina la clave
  del JSON y nunca toca el repositorio.
- `writeRegistry()` ya ofrece escritura atómica y las mutaciones del registro se
  serializan. La limpieza debe releer y volver a sondear dentro del mismo lock
  para evitar eliminar un proyecto que reapareció entre el listado y la acción.
- Ejecutar un desregistro HTTP por fila permitiría resultados parciales y
  múltiples carreras. La operación masiva necesita una única mutación dedicada.
- La API HTTP del viewer es una interfaz interna autenticada. La forma JSON
  declarada en esta Specification es estable para el cliente y sus tests, no un
  API público para terceros.
- Los cambios terminados `20260627-111218`, `20260731-161656`,
  `20260617-231423`, `20260616-162027` y `20260809-194234` aportan contexto sobre
  desregistro seguro, CAS de ruta, serialización, corrupción y fallos de probe;
  ninguno es un prerrequisito pendiente.

## Proposal

Añadir a Projects una acción `Clean missing (N)` visible únicamente en el viewer
global cuando exista al menos una ausencia confirmada. Una sola confirmación
explicará el número de entradas, que solo se modifica el registro local y que no
se elimina ningún archivo o directorio.

Un endpoint POST autenticado invocará una operación masiva del registro. Bajo el
lock, releerá el registro y sondeará cada `.changeledger/config.yml`: eliminará
solo `ENOENT` o `ENOTDIR`, conservará entradas disponibles y omitirá cualquier
otro error como `EACCES`. Escribirá el registro una sola vez y devolverá los ids
eliminados, el conteo eliminado y el conteo omitido. La UI refrescará listado,
contador, selector y panel administrado desde la respuesta canónica de
`GET /api/projects`.

Se descarta encadenar el desregistro individual porque multiplica requests y
escrituras y admite éxito parcial. También se descarta limpiar literalmente
todo lo etiquetado `Missing`: una ruta sin permisos podría contener todavía un
proyecto válido y debe conservarse de forma fail-closed.

## Specification

### CR1 — Primera limpieza completa de residuos
- **Given** un viewer global cuyo registro contiene `alpha` con `.changeledger/config.yml` accesible, `old-probe` cuya ruta devuelve `ENOENT` y `denied` cuyo probe devuelve `EACCES`
- **When** abro Projects, pulso `Clean missing (1)`, acepto la confirmación y el POST termina correctamente
- **Then** la respuesta estable contiene `removedIds: ["old-probe"]`, `removed: 1` y `skipped: 1`
- **And** `old-probe` desaparece del registro, el listado y el selector
- **And** `alpha` y `denied` permanecen registrados con los mismos ids y rutas
- **And** ningún archivo o directorio bajo las rutas registradas se modifica o elimina

### CR2 — Revalidación atómica antes de eliminar
- **Given** que `old-probe` estaba ausente al renderizar Projects pero su `.changeledger/config.yml` reaparece antes de que la limpieza obtenga el lock del registro
- **When** el servidor ejecuta la limpieza confirmada
- **Then** relee el registro y vuelve a sondear `old-probe` dentro del lock
- **And** conserva `old-probe` y devuelve `removed: 0`
- **And** una entrada registrada concurrentemente no se pierde

### CR3 — Fallos de probe y registro preservan los datos
- **Given** una entrada cuyo probe devuelve `EACCES` o un `registry.json` corrupto
- **When** intento limpiar los proyectos ausentes
- **Then** la entrada inaccesible se omite y el registro corrupto produce un error visible
- **And** el servidor no reemplaza el registro corrupto ni elimina ninguna entrada en esos casos

### CR4 — Confirmación y frontera del viewer
- **Given** Projects muestra una ausencia confirmada
- **When** cancelo el diálogo, envío `confirm: false`, omito el token o uso un viewer iniciado con `--local`
- **Then** cancelar no envía ningún POST y los otros requests se rechazan sin mutar el registro
- **And** `Clean missing` no aparece en `--local`

### CR5 — Estado coherente después de limpiar
- **Given** que la entrada administrada en el panel derecho forma parte de dos ausencias confirmadas
- **When** confirmo la limpieza y el servidor devuelve `removed: 2`
- **Then** la UI realiza un único POST y vuelve a consultar `/api/projects`
- **And** actualiza el total, las filas y las opciones del selector, limpia el panel de la entrada retirada y muestra el resultado `2 missing projects removed`
- **And** cuando no quedan ausencias confirmadas oculta `Clean missing`

## Plan

- [x] Escribir primero tests de limpieza masiva y después implementar el sondeo fail-closed y la mutación única bajo lock
  - **Target:** `src/registry.mjs`, `src/viewer/domain.mjs`, `test/registry.test.mjs`, `test/view.test.mjs`
  - **Verify:** `node --test test/registry.test.mjs test/view.test.mjs`
  - **Criteria:** CR1, CR2, CR3
  - **Resolved:** `2026-08-15T13:56:12Z`
- [x] Escribir primero tests HTTP y después exponer el POST autenticado con confirmación y rechazo en modo local
  - **Target:** `src/viewer/server/router.mjs`, `test/view.test.mjs`
  - **Verify:** `node --test test/view.test.mjs`
  - **Criteria:** CR1, CR3, CR4
  - **Resolved:** `2026-08-15T13:56:14Z`
- [x] Escribir primero tests DOM y después añadir el control, confirmación, feedback y refresco coherente de Projects
  - **Target:** `src/viewer/public/app.js`, `src/viewer/public/api.js`, `src/viewer/public/styles.css`, `test/viewer-metadata.test.mjs`
  - **Verify:** `node --test test/viewer-metadata.test.mjs`
  - **Criteria:** CR1, CR4, CR5
  - **Resolved:** `2026-08-15T13:56:18Z`
- [x] Ejecutar la verificación completa y comprobar manualmente la limpieza con proyectos disponible, ausente e inaccesible
  - **Verify:** `pnpm verify`
  - **Support:**
  - **Resolved:** `2026-08-15T13:56:20Z`

## Log

- **2026-08-15T13:34:42Z** `[note]` Borrador creado con autorización humana. La investigación separó este feature del defecto visual del selector y acotó la limpieza a ausencias confirmadas para preservar rutas inaccesibles.
- **2026-08-15T13:37:15Z** `[status]` draft → approved (human via conversation)
- **2026-08-15T13:38:22Z** `[status]` approved → in-progress
- **2026-08-15T13:38:22Z** `[branch]` set: feature/20260815-133442 (auto)
- **2026-08-15T13:56:28Z** `[note]` Implementación TDD completa: limpieza fail-closed bajo lock, POST autenticado y UI coherente. Verificación independiente: Biome limpio, suite completa con código 0, changeledger check válido y navegador aislado con una ausencia confirmada, una ruta disponible y una inaccesible; cancelar preservó las tres entradas.
- **2026-08-15T13:56:39Z** `[status]` in-progress → in-review
- **2026-08-15T13:59:55Z** `[note]` Mandato de revisión: auditoría completa de dev..f779b316 sobre CR1–CR5, incluyendo sondeo fail-closed, lock y concurrencia, preservación del registry, frontera HTTP, coherencia UI, pruebas y las decisiones de implementación no especificadas.
- **2026-08-15T14:05:38Z** `[review]` in-review → in-progress (retry): CR2: la limpieza elimina entradas missing concurrentes no incluidas en la confirmación; además debe recargar el proyecto fallback si la selección desaparece durante la carrera.
