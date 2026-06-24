---
id: "20260624-005437"
title: Validation controls stay disabled after accepting another change
type: bug
status: approved
created: 2026-06-24T00:54:37Z
depends_on: []
---

## Request

Corregir el estado obsoleto de los controles de validación humana cuando existen
varios changes en `in-validation`. Después de aceptar uno, al abrir el siguiente
el componente de aprobación puede permanecer bloqueado; recargar la página
restaura el funcionamiento.

El usuario debe poder validar changes consecutivos desde el viewer sin refrescar
manualmente ni quedar condicionado por el estado pendiente de una interacción
anterior.

## Investigation

Reproducción observada:

1. Hay dos changes en `in-validation`.
2. El usuario acepta el primero desde el viewer.
3. Abre el segundo change sin recargar la página.
4. Los controles de aprobación/rechazo aparecen bloqueados.
5. Después de recargar, los controles del segundo change funcionan.

El hecho de que una recarga lo resuelva apunta a estado cliente transitorio que
no se limpia o recalcula al cerrar la primera validación y seleccionar otro
change. Deben inspeccionarse el estado `pending`, la invalidación del cache del
repositorio y el ciclo de apertura/cierre del detalle. La causa raíz se
confirmará antes de modificar el comportamiento.

## Specification

### CR1 — Validaciones consecutivas sin recarga
- **Given** dos changes distintos en estado `in-validation`
- **And** el usuario acepta o rechaza el primero desde el viewer
- **When** abre el segundo sin recargar la página
- **Then** los controles de validación del segundo están habilitados y responden normalmente

### CR2 — Estado pendiente aislado por interacción
- **Given** una petición de validación en curso para un change
- **When** la petición termina correctamente o con error y el usuario abre otro change
- **Then** el estado pendiente del primero no deshabilita los controles del segundo
- **And** cada formulario conserva únicamente su propio estado de envío y error

### CR3 — UI sincronizada después de validar
- **Given** que el servidor acepta una decisión de validación
- **When** el viewer refresca sus datos y elimina o actualiza el change validado
- **Then** la selección, el detalle y los controles reflejan el nuevo repositorio sin requerir recarga manual

## Plan

- [ ] Reproducir el bloqueo y localizar la transición de estado responsable en `src/viewer/public/app-state.js`, `src/viewer/public/app.js` y `src/viewer/public/view-parts.js`; documentar la causa y verificar con `node --test` (support)
- [ ] Añadir una regresión de dos validaciones consecutivas para `src/viewer/public/**` en `test/app-state.test.mjs` o `test/viewer-metadata.test.mjs`; verificar que falle antes de la corrección con `node --test` (CR1, CR2, CR3)
- [ ] Aislar y limpiar el estado de validación en `src/viewer/public/**` al completar, fallar o cambiar de change; comprobar la regresión con `node --test` (CR1, CR2, CR3)
- [ ] Ejecutar `pnpm verify` y validar manualmente dos changes consecutivos en `sl view` sin refrescar (support)

## Log
- **2026-06-24T00:57:06Z** — status: draft → approved
