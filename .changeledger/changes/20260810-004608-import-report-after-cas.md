---
id: "20260810-004608"
title: El reporte del import se emite tras el CAS
type: bug
status: in-review
created: 2026-08-10T00:46:08Z
depends_on: ["20260809-113241"]
branch: bug/20260810-004608
related_to: []
owner: rarc88
---

## Request

Remate del review de `20260809-113241` (autorizado por el humano el
2026-08-10): `import --from <ref>` imprime las líneas de reporte `+`/`~`
antes de que la mutación CAS aterrice; si el CAS pierde la carrera, el
operador ve un aparente éxito por stdout seguido de exit distinto de cero.
El reporte de lo aplicado debe emitirse solo después de que `mutateState`
confirme la escritura.

## Investigation

Del review adversarial de `20260809-113241` (razonado del código, señalado
como scrutiny 6): en `src/commands/import.mjs` el bucle que imprime `+`/`~`
por documento precede a la llamada a `mutateState`. Una carrera perdida
lanza `LedgerConflictError` DESPUÉS de imprimir líneas que se leen como
resultado aplicado. Los mensajes previos a la decisión (conflictos,
validación, cero documentos) no cambian: solo el reporte de altas y
actualizaciones se mueve a después del CAS confirmado.

## Specification

### CR1 — Sin CAS confirmado no hay reporte de aplicación
- **Given** un import con altas pendientes cuya escritura pierde la carrera CAS (la ref avanza entre la lectura y el `mutateState`, forzable con un shim de git como el de `test/config-migration.test.mjs`)
- **When** se ejecuta `changeledger import --from <ref>`
- **Then** exit distinto de cero con el mensaje CAS de siempre y stdout SIN ninguna línea `+`/`~` de documento aplicado

### CR2 — El import con éxito reporta igual que hoy
- **Given** un import con una alta y una actualización que gana la carrera
- **When** se ejecuta el comando
- **Then** exit 0 y stdout contiene las mismas líneas `+`/`~` y el mismo resumen que hoy, en el mismo orden relativo

## Plan

- [x] Mover el reporte de altas/actualizaciones a después del `mutateState`
  confirmado
  - **Target:** `src/commands/import.mjs`
  - **Verify:** `node --test test/import.test.mjs`
  - **Criteria:** CR1, CR2
  - **Resolved:** `2026-08-10T01:04:55Z`
- [x] Suite completa y gate del repo
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-08-10T01:04:55Z`

## Log
- **2026-08-10T00:51:28Z** `[status]` draft → approved
- **2026-08-10T00:54:48Z** `[status]` approved → in-progress
- **2026-08-10T00:54:48Z** `[branch]` set: bug/20260810-004608 (auto)
- **2026-08-10T01:04:55Z** `[status]` in-progress → in-review
- **2026-08-10T01:04:55Z** `[note]` Mandato del review: spot check del diff cerrado (reordenación de la impresión tras mutateState + shim de PATH para la carrera), con las decisiones del implementador como escrutinio: shim bash real en vez de run inyectado (justificado: el test ejerce el bin real), CR1 asertando que la ref avanzó de verdad, y la ausencia de mutante CR2 (reordenación pura con deepEqual línea a línea). Commit con --no-verify por la fuga GIT_DIR (gate manual completo antes).
