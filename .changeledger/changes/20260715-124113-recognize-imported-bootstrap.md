---
id: "20260715-124113"
title: Reconocer bootstrap importado desde CLAUDE.md
type: bug
status: in-validation
created: 2026-07-15T12:41:13Z
depends_on: [ "20260614-151759", "20260714-153633" ]
owner: Roberto Ruiz
---

## Request

Un repositorio consumidor mantiene el bootstrap vigente de ChangeLedger en
`AGENTS.md` y usa `CLAUDE.md` únicamente como puente con la línea
`@AGENTS.md`. Claude Code expande ese import al iniciar, por lo que recibe el
contrato correctamente, pero `changeledger check` inspecciona cada archivo de
forma aislada y falla con:

```text
error  AGENTS.md: CLAUDE.md has no ChangeLedger reference — run `changeledger register`
```

El check debe reconocer el discovery indirecto documentado por Claude Code sin
debilitar la obligación de mantener el bootstrap canónico en `AGENTS.md`.

## Investigation

- `src/contract.mjs` define `CONTRACT_FILES = ['AGENTS.md', 'CLAUDE.md']`.
  `checkContract()` aplica `applyBootstrap()` a cada archivo regular y reporta
  error cuando cualquiera carece del bloque administrado. No modela imports.
- `ensureReference()`, usado por `init` y `register`, tiene la misma suposición:
  ante un `CLAUDE.md` con `@AGENTS.md`, inserta una segunda copia completa del
  bootstrap aunque Claude ya carga el contenido importado.
- La garantía original del change `20260614-151759` sigue siendo correcta:
  cada superficie de instrucciones presente debe conducir al contrato. El
  defecto está en equiparar “conducir al contrato” con “contener literalmente
  el bloque”.
- La documentación oficial de Claude Code indica que `CLAUDE.md` puede importar
  archivos mediante `@path`, que las rutas relativas se resuelven respecto al
  archivo importador y recomienda expresamente `@AGENTS.md` para compartir
  instrucciones con otros agentes sin duplicarlas.
- `AGENTS.md` continúa siendo obligatorio y debe contener un bootstrap directo,
  porque es la superficie canónica de ChangeLedger y otros agentes no procesan
  necesariamente imports de Claude. Solo `CLAUDE.md` admite satisfacción
  indirecta mediante el puntero canónico al `AGENTS.md` hermano.
- Para evitar resolver rutas arbitrarias o reimplementar imports recursivos, el
  reconocimiento se limita al token de ruta relativo `@AGENTS.md` que apunta al
  archivo hermano canónico. El token puede ser una línea propia o aparecer en
  prose, como permite Claude; `@docs/AGENTS.md`, `@../AGENTS.md`, rutas absolutas
  y nombres que solo contienen ese texto no sustituyen el bootstrap administrado.
- Si `CLAUDE.md` contiene además un bloque ChangeLedger directo, ese bloque se
  sigue validando y actualizando: un import no debe ocultar una copia directa
  obsoleta o alterada que Claude también cargaría.

## Specification

### CR1 — Import canónico satisface discovery de Claude
- **Given** un repositorio con `AGENTS.md` regular y bootstrap ChangeLedger vigente
- **And** un `CLAUDE.md` regular cuyo contenido incluye el import relativo `@AGENTS.md`, como línea propia o dentro de prose
- **When** se ejecuta `changeledger check`
- **Then** no reporta que `CLAUDE.md` carece de referencia ChangeLedger
- **And** continúa validando normalmente el bootstrap directo de `AGENTS.md`

### CR2 — Register no duplica el bootstrap importado
- **Given** un `AGENTS.md` con bootstrap vigente y un `CLAUDE.md` que contiene `@AGENTS.md` pero ningún bloque ChangeLedger directo
- **When** se ejecuta `changeledger register`
- **Then** `CLAUDE.md` permanece byte-for-byte idéntico
- **And** no se inserta una segunda copia del bootstrap

### CR3 — El import solo delega al contrato canónico válido
- **Given** un `CLAUDE.md` con `@AGENTS.md`
- **When** falta `AGENTS.md` o su bootstrap está ausente, obsoleto o semánticamente alterado
- **Then** `changeledger check` falla por el contrato canónico de `AGENTS.md`
- **And** el import no convierte un destino inválido en discovery válido

### CR4 — Otros destinos no satisfacen discovery
- **Given** un `CLAUDE.md` sin bootstrap directo
- **When** contiene `AGENTS.md` sin `@`, `@docs/AGENTS.md`, `@../AGENTS.md`, una ruta absoluta o un nombre como `@AGENTS.md.bak`
- **Then** `changeledger check` conserva el error accionable de referencia ausente en `CLAUDE.md`
- **And** `changeledger register` instala el bloque administrado como hasta ahora

### CR5 — Un bloque directo sigue siendo autoridad local
- **Given** un `CLAUDE.md` que contiene `@AGENTS.md` y también un bloque ChangeLedger directo obsoleto o alterado
- **When** se ejecuta `changeledger check`
- **Then** reporta el bloque directo como desactualizado
- **And** `changeledger register` actualiza ese bloque sin sustituirlo por la excepción del import

### CR6 — Otras superficies conservan su política
- **Given** cualquier archivo distinto del `CLAUDE.md` raíz o un `CLAUDE.md` symlink
- **When** se ejecutan `init`, `register` o `check`
- **Then** se conservan las reglas actuales de `AGENTS.md` obligatorio, archivos regulares y symlinks ignorados

## Plan

- [x] Añadir en test/contract.test.mjs fixtures TDD para `CLAUDE.md` con import válido standalone/en prose y destinos distintos; implementar en src/contract.mjs la detección estrecha del import efectivo sin resolver rutas arbitrarias; verify: node --test test/contract.test.mjs (CR1, CR3, CR4, CR5, CR6) — 2026-07-15T12:58:29Z
- [x] Cubrir en test/contract.test.mjs que `ensureReference` y `register` preservan byte-for-byte un `CLAUDE.md` delegado y siguen actualizando un bloque directo obsoleto; ajustar src/contract.mjs y src/commands/register.mjs solo si la integración lo exige; verify: node --test test/contract.test.mjs (CR2, CR5, CR6) — 2026-07-15T12:58:29Z
- [x] Actualizar `.changeledger/specs/contract-discovery.md` para distinguir bootstrap directo e import efectivo de Claude sin retirar la autoridad canónica de `AGENTS.md`; verify: `changeledger check 20260715-124113` (CR1, CR3, CR6) — 2026-07-15T12:58:30Z
- [x] Ejecutar `pnpm verify` y confirmar que bootstrap, register y checks repo-level permanecen verdes (support) — 2026-07-15T13:00:27Z

## Log

- **2026-07-15T12:41:13Z** — Draft creado por un falso negativo de discovery reproducible: `CLAUDE.md` delega legítimamente en el `AGENTS.md` raíz mediante `@AGENTS.md`, patrón recomendado por Claude Code. Se conserva la garantía cross-agent y se evita duplicar el bloque administrado.
- **2026-07-15T12:45:15Z** — status: draft → approved
- **2026-07-15T12:55:34Z** — status: approved → in-progress
- **2026-07-15T12:55:34Z** — owner → Roberto Ruiz (auto)
- **2026-07-15T12:55:34Z** — Rama codex/resolve-approved-changes creada desde ef526ba0 porque contiene 20260714-153633, dependencia aún no integrada en dev; CLAUDE.md del humano se incluye en el baseline autorizado.
- **2026-07-15T12:56:13Z** — Baseline bloqueado por el propio defecto: hook obtuvo 669/669 tests verdes y falló solo porque check rechaza CLAUDE.md con @AGENTS.md. Se autoriza excepción acotada --no-verify antes de implementar; el gate completo debe quedar verde tras la corrección.
- **2026-07-15T12:58:30Z** — TDD red-green: 3 regresiones iniciales fallaron; detector acotado acepta @AGENTS.md standalone/en prose, rechaza destinos/sufijos, preserva register byte a byte y no oculta bloques directos obsoletos. test/contract 21/21 y check repo verdes.
- **2026-07-15T13:00:27Z** — Full quality gate passed: pnpm verify (Biome, 674 tests, ChangeLedger check).
- **2026-07-15T13:00:32Z** — status: in-progress → in-review
- **2026-07-15T13:05:28Z** — review → in-validation (delegated subagent, clean context)
