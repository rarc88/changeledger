---
id: "20260808-171107"
title: Robustecer los caminos de error del store de estado
type: bug
status: approved
created: 2026-08-08T17:11:07Z
depends_on: ["20260808-151640", "20260808-151641", "20260808-151643", "20260809-113240"]
related_to: ["20260809-113242"]
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

Ampliación (2026-08-09, cierre de etapa 1): se suman tres restos menores de
la misma familia error/presentación/higiene de la pila del estado global,
para que ningún hallazgo quede solo en conversación:

4. **El prefijo del mensaje de conflicto es convención, no constante.** El bin
   dice `state changed since load — re-run the command` y el viewer
   `state changed since load — reload and save again`; CR8 de
   `20260808-151643` exige el prefijo común, pero nada lo hace estructural.
   Exportar una base compartida con colas por superficie.
5. **Borde de diagnóstico**: un id desconocido en un repo que además contiene
   un documento malformado reporta hoy el error de parseo del documento roto
   en lugar de «change desconocido» (ambos exit ≠ 0; solo empeora el
   diagnóstico). Detectado por la confirmación de `20260808-151641`.
6. **Higiene de tests**: el smoke test de concurrencia degradado de
   `test/cli.test.mjs` (renombrado en `20260808-151643`) ya no aporta prueba —
   el test determinista lleva el criterio; puede eliminarse.

Todo vive en la pila del estado global (`state-store`, `repo`,
`change-store`, presentación) — una sola superficie, un solo change.

## Investigation

Los seis hallazgos siguen presentes sobre el baseline combinado. El test
`CORRECTION 4` elimina un objeto que `batchBlobReader` intenta dimensionar al
construirse, antes del `try` del lector lazy que afirma cubrir; el rechazo de
UTF-8 inválido ya está probado por CR7 y por `test/git-batch.test.mjs`, por lo
que corresponde retirar el test vacuo sin inventar otra costura.

Los catches de `initState`, `advanceOrConflict` y `writeActivation` vuelven a
leer la ref para distinguir un conflicto de otro fallo de `update-ref`. Si esa
lectura también falla, su error reemplaza hoy al fallo primario. La corrección
debe conservar el mensaje exterior de lectura y enlazar como `cause` directo
el error primario, sin convertirlo en `LedgerConflictError`.

`optionalRefOid` solo clasifica ausencia con exit 1 y stderr vacío. Se conserva
esa política fail-closed: filtrar `warning:` ocultaría también una ref corrupta
real. La sensibilidad a cualquier stderr queda declarada y fijada por test.

El prefijo de conflicto CAS está duplicado entre el bin y el viewer. Se
centraliza junto a `LedgerConflictError`, conservando byte a byte las colas de
cada superficie. Por otra parte, `context` y `agent-context` cargan y parsean
todos los changes antes de resolver un id: un documento roto no relacionado
enmascara el diagnóstico de id desconocido. El aislamiento será opt-in solo
para esas dos resoluciones; `loadRepo` y `check` mantienen su fail-fast normal.

El smoke concurrente de `test/cli.test.mjs` no fuerza una lectura rancia y
acepta tanto conflicto como serialización. Los tests deterministas adyacentes
ya cubren el retry único y su límite; se elimina únicamente el smoke.

No cambian comandos, payloads HTTP, refs, layouts ni mensajes públicos CAS. El
nuevo prefijo exportado es interno; el doble fallo solo gana una cadena `cause`
y la resolución de id desconocido cambia deliberadamente la precedencia de su
diagnóstico. El alcance cabe bajo `global-state-scope`: no añade locks, retries,
taxonomía de warnings, red ni resolución automática de conflictos.

## Specification

### CR1 — La cobertura UTF-8 no atribuye un fallo imposible
- **Given** un blob de change con bytes `0xff 0xfe`
- **When** `readSnapshot` lo materializa mediante el lector lazy
- **Then** lanza `state path .changeledger-state/changes/legacy.md is not valid UTF-8` sin U+FFFD
- **And** no existe el test `CORRECTION 4` que atribuía al lector lazy un fallo ocurrido al construir `batchBlobReader`

### CR2 — El doble fallo conserva la causa primaria
- **Given** que `update-ref` lanza un error primario y la relectura de desambiguación lanza uno secundario
- **When** ocurre en `initState`, `mutateState` o `writeActivation`
- **Then** se lanza un `Error` ordinario cuyo mensaje es `cannot read Git ref <ref>: <error secundario>`
- **And** su `cause` es exactamente el error primario de `update-ref`
- **And** ninguna ref incorpora la mutación perdedora

### CR3 — Stderr durante ausencia falla cerrado
- **Given** que `rev-parse --verify --quiet` termina con status 1 y stderr `warning: benign advice`
- **When** `readStateRef` clasifica el resultado
- **Then** no devuelve `null` y lanza `cannot read Git ref refs/heads/changeledger/state: warning: benign advice`
- **And** `optionalRefOid` declara esta sensibilidad como una decisión fail-closed

### CR4 — CLI y viewer comparten la base del conflicto
- **Given** un conflicto CAS real
- **When** lo presenta el CLI o cualquiera de las tres escrituras de config del viewer
- **Then** el CLI emite `state changed since load — re-run the command`
- **And** el viewer responde 409 con `state changed since load — reload and save again`
- **And** ambos mensajes se componen desde una única base `state changed since load`

### CR5 — El id desconocido precede al documento roto no relacionado
- **Given** un repo activo o inactivo con `broken.md` malformado y sin el id `20990101-000000`
- **When** se ejecutan `context 20990101-000000` y `agent-context implementation 20990101-000000`
- **Then** cada comando informa su diagnóstico actual de id desconocido sin emitir el sentinel `BEGIN`
- **And** `loadRepo` y `check` sin aislamiento opt-in siguen fallando por `broken.md`

### CR6 — Solo quedan pruebas deterministas del retry
- **Given** los tests que fuerzan un conflicto real y un segundo conflicto consecutivo
- **When** se ejecuta `test/cli.test.mjs`
- **Then** prueban respectivamente retry exitoso y propagación tras un único retry
- **And** ya no existe el smoke que aceptaba indistintamente conflicto o serialización

## Plan

- [ ] Escribir primero las regresiones de doble fallo, mensajes CAS y resolución aislada
  - **Target:** `test/state-store.test.mjs`, `test/context.test.mjs`, `test/agent-context.test.mjs`, `test/cli-bin.test.mjs`, `test/view.test.mjs`
  - **Verify:** `node --test test/state-store.test.mjs test/context.test.mjs test/agent-context.test.mjs test/cli-bin.test.mjs test/view.test.mjs`
  - **Criteria:** CR2, CR3, CR4, CR5
- [ ] Preservar la causa primaria, compartir el prefijo CAS y aislar solo la resolución por id
  - **Target:** `src/state-store.mjs`, `src/repo.mjs`, `src/commands/context.mjs`, `src/commands/agent-context.mjs`, `bin/changeledger.mjs`, `src/viewer/domain.mjs`
  - **Verify:** `node --test test/state-store.test.mjs test/context.test.mjs test/agent-context.test.mjs test/cli-bin.test.mjs test/view.test.mjs`
  - **Criteria:** CR2, CR3, CR4, CR5
- [ ] Retirar los dos tests sin valor y conservar las coberturas deterministas
  - **Target:** `test/state-store.test.mjs`, `test/cli.test.mjs`
  - **Verify:** `node --test test/git-batch.test.mjs test/state-store.test.mjs test/cli.test.mjs`
  - **Criteria:** CR1, CR6
- [ ] Ejecutar el gate completo
  - **Support:**
  - **Verify:** `pnpm verify`

## Log

- **2026-08-08T17:11:07Z** `[note]` Draft creado por decisión humana tras
  aceptar `20260808-151640`: capturar los tres follow-ups de la review de
  confirmación mientras la evidencia está fresca, y resolverlos en su debido
  momento. No es trabajo autorizado a implementar: queda en draft.
- **2026-08-09T16:18:33Z** `[status]` draft → approved (human via conversation)
