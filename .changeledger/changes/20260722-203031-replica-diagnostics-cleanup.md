---
id: "20260722-203031"
title: Corregir la taxonomía de fallos de la réplica
type: bug
status: approved
created: 2026-07-22T20:30:31Z
depends_on: []
related_to: ["20260721-193106", "20260722-204130", "20260722-204131"]
release_impact: patch
---

## Request

La ejecución paralela de la auditoría `20260721-193106` encontró tres caminos de
`state sync`/replay cuyo diagnóstico atribuye mal la causa o expone un error Git
crudo: IO/ENOSPC aparece como conflicto de réplica, el CAS no indica reintento y
un `confirmed` local corrupto culpa al remoto. Aunque son LOW sin pérdida de
datos, comparten la misma frontera en `src/state-store.mjs`: clasificación y
presentación accionable de fallos de sincronización.

## Investigation

Los catch de replay/sync colapsan errores de filesystem bajo el encabezado de
conflicto semántico; la ruta CAS de sync propaga `cannot lock ref` mientras la
ruta de mutación ya lo envuelve con una instrucción de reintento; y la
comparación confirmed/observed presupone que la divergencia pertenece al remoto
aunque el confirmado local puede ser el corrupto. La causa común es que
`state-store` presenta detalles de Git sin clasificarlos por frontera y sin
preservar cuál lado falló.

## Specification

### CR1 — Los fallos de IO conservan su causa
- **Given** replay o sync falla por `EACCES` o `ENOSPC`
- **When** se emite el error
- **Then** identifica la operación y la causa de filesystem exacta
- **And** no usa el encabezado `state replica conflict`

### CR2 — El CAS fallido indica recuperación
- **Given** sync pierde el compare-and-swap de una ref local
- **When** Git devuelve `cannot lock ref`
- **Then** el CLI emite el mismo diagnóstico accionable de estado concurrente y
  reintento que la ruta de mutación
- **And** conserva el detalle Git como causa, no como mensaje principal

### CR3 — La divergencia atribuye el lado corrupto solo con evidencia propia
- **Given** el remoto devuelve una revisión que no desciende de `confirmed`
- **When** `confirmed` falla su propia validación de snapshot (schema, ancestría
  al baseline de authority o `checkRepo`), independientemente de la comparación
  contra el remoto
- **Then** el diagnóstico nombra ambos OIDs y señala que el confirmado local es
  el lado corrupto, sin acusar al remoto
- **Given**, en cambio, `confirmed` pasa su propia validación de snapshot pero
  no desciende de la revisión remota
- **When** sync diagnostica la divergencia
- **Then** el mensaje la describe como no resuelta entre ambos lados (posible
  rewind remoto genuino) sin atribuir la causa a ninguno, conservando el
  diagnóstico `does not descend from confirmed` existente

## Plan

- [ ] Añadir tests fallidos de EACCES/ENOSPC y clasificar esos errores en replay/sync de `src/state-store.mjs`; verify: `node --test test/state-store.test.mjs` conserva operación y causa sin presentarlos como conflicto (CR1)
- [ ] Añadir un test fallido del CAS de sync y reutilizar en `src/state-store.mjs` el diagnóstico accionable de reintento de mutación; verify: `node --test test/state-store.test.mjs` conserva `cannot lock ref` solo como causa (CR2)
- [ ] Añadir tests de confirmed local que falla su propia validación (atribución local) y de confirmed válido no-ancestro del remoto (divergencia no resuelta), y corregir la atribución en `src/state-store.mjs` validando confirmed de forma independiente antes de acusar; verify: `node --test test/state-store.test.mjs` distingue ambos casos sin invertir un rewind remoto genuino (CR3)
- [ ] Ejecutar el gate completo; verify: `pnpm verify` (support)

## Log

- **2026-07-22T20:30:31Z** `[note]` Draft creado por la revisión cruzada de los drafts de remediación de 20260721-193106: agrupa los seis LOW de código de la ejecución paralela (FLT/THR/CONV) para una decisión única; divisible o re-tipable a bug antes de aprobar.
- **2026-07-22T20:41:30Z** `[note]` Paquete dividido y re-tipado: este bug conserva solo la taxonomía de state-store; orientación CLI pasa a 20260722-204130 y borrado de integration ref a 20260722-204131.
- **2026-07-22T20:50:00Z** `[note]` CR3 endurecida con criterio verificable: solo se acusa al confirmado local cuando falla su propia validación de snapshot (schema/baseline/checkRepo), no por la mera no-ancestría con el remoto — esa señal por sí sola es ambigua (podría ser un rewind remoto genuino) y ahora se reporta como divergencia no resuelta en vez de invertir la acusación.
- **2026-07-23T09:28:28Z** `[status]` draft → approved
