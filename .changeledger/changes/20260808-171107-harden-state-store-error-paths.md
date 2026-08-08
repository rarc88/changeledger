---
id: "20260808-171107"
title: Robustecer los caminos de error del store de estado
type: bug
status: draft
created: 2026-08-08T17:11:07Z
depends_on: ["20260808-151640"]
related_to: []
owner: rarc88
---

## Request

La review de confirmación de `20260808-151640` reportó tres follow-ups
menores, fuera del alcance de aquel change y aparcados por decisión humana
(2026-08-08) para resolverse en su debido momento:

1. **Test de regresión vacuo.** El test `CORRECTION 4` de
   `test/state-store.test.mjs` no ejercita la línea que dice guardar: su
   escenario (objeto git ausente) lanza en la construcción de
   `batchBlobReader`, fuera del `try` de `readPath`, así que pasa idéntico
   sobre el código pre-fix (verificado por el revisor con una copia parcheada
   lado a lado). O se construye un escenario que alcance el throw no-UTF-8 del
   reader lazy, o se elimina el test y el contrato queda en CR7 más el
   argumento by-construction — un test que no puede fallar es peor que
   ninguno.
2. **La desambiguación puede enmascarar la causa original.** Los `catch` de
   `update-ref` en `advanceOrConflict` e `initState` llaman a
   `optionalRefOid` para distinguir conflicto real de fallo; si esa segunda
   lectura lanza a su vez (ref corrupta, permisos), su error reemplaza al del
   `update-ref` original. Envolver la lectura de desambiguación para que el
   fallo primario sobreviva como `cause`.
3. **Ausencia sensible a stderr benigno.** `optionalRefOid` trata cualquier
   stderr en exit 1 como fallo; una línea de advice/warning de git en una
   ausencia genuina se leería como fallo de lectura. Dirección fail-closed y
   riesgo bajo, pero conviene o filtrar clases de stderr conocidas-benignas o
   documentar la sensibilidad como decisión.

Los tres viven en `src/state-store.mjs` y su test — una sola superficie, un
solo change. La Investigation, Specification y Plan se completan cuando el
change se retome; la evidencia de origen queda en el Log de
`20260808-151640` (nota de follow-ups del 2026-08-08) y en el informe de su
review de confirmación.

## Investigation

Pendiente — se completa al retomar el change. Punto de partida: la nota de
follow-ups en el Log de `20260808-151640` y los comentarios existentes en
`optionalRefOid`, `advanceOrConflict` y el test `CORRECTION 4`.

## Specification

Pendiente — se redacta con la Investigation al retomar el change.

## Plan

- [ ] Completar Investigation, Specification y este Plan al retomar el change,
      partiendo de la nota de follow-ups del Log de `20260808-151640`
  - **Support:**

## Log

- **2026-08-08T17:11:07Z** `[note]` Draft creado por decisión humana tras
  aceptar `20260808-151640`: capturar los tres follow-ups de la review de
  confirmación mientras la evidencia está fresca, y resolverlos en su debido
  momento. No es trabajo autorizado a implementar: queda en draft.
