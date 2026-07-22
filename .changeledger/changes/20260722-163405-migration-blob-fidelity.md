---
id: "20260722-163405"
title: La migración transcodifica blobs no UTF-8 y publica un baseline inactivable
type: bug
status: done
created: 2026-07-22T16:34:05Z
depends_on: []
owner: raruiz-hiberuscom
related_to: ["20260721-193103", "20260721-193106"]
release_impact: patch
---

## Request

Una auditoría adversarial externa previa a producción encontró que `state
migrate` lee cada blob fuente como texto UTF-8 con pérdida. Un documento legacy
con bytes no UTF-8 (por ejemplo acentos en latin-1, habituales en contenido en
español antiguo) se transcodifica en silencio a U+FFFD y el re-hash produce un
OID distinto del blob original. La consecuencia es fatal para el cutover: el
baseline se publica en la ref pública, pero la activación no puede aceptarlo
nunca y el error no menciona la causa real.

## Investigation

Causa raíz: todo el pipeline de migración asume la identidad
`re-hash(cat-file blob) === OID original`, que solo se cumple para contenido
UTF-8 válido.

- `blobText` (`src/state-migration.mjs:169`) ejecuta `cat-file blob` con
  `encoding: 'utf8'`; bytes inválidos se sustituyen por U+FFFD sin error.
- `treeFromWrites` (`src/state-migration.mjs:576`) y `createBranchCommit`
  (`src/state-migration.mjs:926`) re-hashean ese string con
  `hash-object -w --stdin`, produciendo un blob nuevo con OID distinto.
- `createStateBaseline` (`src/state-migration.mjs:604-667`) no compara los OIDs
  publicados contra el plan: su única puerta es `checkRepo` sobre el texto ya
  transcodificado, que parsea bien y pasa. El baseline corrupto se publica con
  CAS en `refs/heads/changeledger/state`, que por diseño nunca se force-pushea.
- `validateManifestDecisions` (`src/state-migration.mjs:744`) sí compara
  `target.blob !== selected.blob` durante `state activate --prepare`; con
  contenido no UTF-8 siempre difieren y la activación falla con
  `state manifest decision mismatch`, un diagnóstico que no nombra la causa.

Reproducido de forma independiente: un blob con `caf\xe9` (latin-1) re-hashea
de `14f4b502…` a `938cc45b…` tras el round-trip utf8.

Impacto: CR3 de `20260721-193103` promete entradas hostiles fail-closed, pero
esta clase de entrada ni falla ni se preserva: corrompe y publica. Es un
hallazgo crítico según la escala de `20260721-193106` (pérdida/corrupción de
verdad más cutover irrecuperable).

Dirección del fix: verificado que `decode(bytes) → hash-object --stdin` es
bijectivo para todo contenido UTF-8 válido sin BOM — reproduce el OID fuente
exacto porque Node decodifica sin normalizar y `execFileSync` escribe el string
a stdin como UTF-8 canónico. El fix no necesita copiar blobs por OID: basta con
validar el buffer crudo con `node:buffer#isUtf8` antes del decode lossy y
fallar cerrado si no es válido. Verificado empíricamente antes de implementar:
contenido UTF-8 válido re-hashea al mismo OID; contenido inválido nunca llega a
re-hashearse porque la validación lo rechaza primero.

## Specification

### CR1 — El baseline preserva los blobs fuente byte a byte
- **Given** una source con un change legacy cuyo blob contiene el byte `0xE9`
  (latin-1, UTF-8 inválido) y OID original `B0`
- **When** se ejecuta `state migrate --preview` seguido de
  `state migrate --create --plan <plan>`
- **Then** preview falla cerrado nombrando OID y path con el mensaje
  `migration source <name> at <commit>:<path> is not valid UTF-8`
- **And** no se publica ningún baseline ni se escribe ningún objeto publicable

### CR2 — El contenido UTF-8 válido conserva su OID exacto
- **Given** un plan resuelto cuyos candidatos son todos UTF-8 válido
- **When** `state migrate --create` publica el baseline
- **Then** cada blob del árbol `.changeledger-state` importado sin reemplazo es
  exactamente el OID fuente registrado en el plan
- **And** `state activate --prepare --baseline <S0>` acepta el baseline sin
  `state manifest decision mismatch`

### CR3 — La verificación cubre SHA-1 y SHA-256
- **Given** los escenarios de CR1 y CR2
- **When** se ejecutan sobre fixtures de repositorio SHA-1 y SHA-256
- **Then** el resultado es idéntico en ambos formatos de objeto

## Plan

- [x] Validar UTF-8 estricto (`node:buffer#isUtf8`) sobre el buffer crudo en `blobText` de `src/state-migration.mjs` antes del decode lossy, fallando cerrado con blob OID; escritos antes los tests fallidos de rechazo (latin-1) y de identidad de OID preservada (contenido válido no-ASCII) en fixture SHA-1/SHA-256; verify: `node --test test/state-migration.test.mjs test/ledger-store.test.mjs` (CR1, CR2, CR3)
  - **Resolved:** `2026-07-22T17:05:00Z`
- [x] Ejecutar el gate completo; verify: `pnpm verify` (support)
  - **Resolved:** `2026-07-22T17:12:00Z`

## Log

- **2026-07-22T16:34:05Z** `[note]` Draft creado desde una auditoría adversarial externa pre-producción sobre codex/state-replica-v2; hallazgo crítico verificado de forma independiente (round-trip utf8 cambia el OID: 14f4b502… → 938cc45b…).
- **2026-07-22T16:48:57Z** `[status]` draft → approved
- **2026-07-22T16:50:49Z** `[status]` approved → in-progress
- **2026-07-22T16:50:49Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-22T17:12:00Z** `[note]` `blobText` valida UTF-8 estricto (`node:buffer#isUtf8`) sobre el buffer crudo de `cat-file blob` antes del decode lossy; contenido inválido falla cerrado nombrando OID y path, contenido válido conserva su OID fuente exacto en el baseline (verificado en SHA-1/SHA-256, activación acepta sin decision mismatch). Gate completo: 904/904 tests, lint y 218 changes válidos.
- **2026-07-22T16:58:20Z** `[status]` in-progress → in-review
- **2026-07-22T17:03:35Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-22T17:59:07Z** `[validation]` in-validation → done (human accepted)
