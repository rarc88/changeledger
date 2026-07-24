---
id: "20260724-212722"
title: Rechazar un tip remoto de réplica que no apunta a un commit
type: bug
status: in-progress
created: 2026-07-24T21:27:22Z
depends_on: []
owner: raruiz-hiberuscom
related_to: ["20260721-193106", "20260723-235910", "20260721-193102"]
release_impact: patch
---

## Request

La tercera ejecución del audit `20260721-193106` (fila FAULT-N5) reprodujo que
un remoto corrompido fuera de Git —la ref pública de estado apuntada a mano a
un tag anotado— es adoptado por `state sync` como `confirmed`: el plan ejecuta
`advance-confirmed` sobre el OID del tag, `state status` reporta
`fresh/confirmed`, y toda mutación posterior se atasca (atómicamente, sin
pending) en `commit-tree -p <tag>`. Sin pérdida de verdad (el tag pela al mismo
snapshot) y auto-sana al reparar el remoto, pero incumple fail-closed: un tip
existente que no pela a commit es estado inválido, nunca verdad adoptable.

## Investigation

`syncStateReplica` y `abortStatePending` (`src/state-store.mjs`) resuelven
`FETCH_HEAD` con `resolveRef` y lo validan con validadores cuya fontanería Git
(`ls-tree`, `show`, `merge-base`) pela tags automáticamente: ningún camino
aserta que el objeto fetched sea de tipo commit antes de la transacción que
confirma. El guard equivalente ya existe para la activation ref
(`20260723-235910`: resolución en dos etapas con peel explícito) pero no para
el tip de la réplica. `git update-ref` y `receive-pack` rehúsan crear la
condición por vías normales («trying to write non-commit object»), así que el
vector requiere un remoto hostil o corrompido a mano; severidad baja, gap de
fail-closed sin ruptura de integridad.

## Specification

### CR1 — Sync rechaza un tip fetched no-commit
- **Given** una réplica v2 activada cuyo remoto tiene la ref pública de estado
  apuntada (fuera de Git) a un objeto tag, blob o tree
- **When** se ejecuta `state sync`
- **Then** falla con `state replica tip <oid> must point to a commit`
- **And** `confirmed`, `observed` y `pending` conservan exactamente sus OIDs
  anteriores y no se crea ningún ref ni objeto local nuevo

### CR2 — Abort aplica la misma clasificación
- **Given** la misma corrupción remota y un pending local publicado o no
- **When** se ejecuta `state abort --pending`
- **Then** falla con el mismo diagnóstico sin mover `confirmed` ni borrar
  `pending`

### CR3 — Un tip commit legítimo no se ve afectado
- **Given** un remoto cuyo tip de estado es un commit normal
- **When** se ejecuta `state sync` o `state abort --pending`
- **Then** el comportamiento actual (adopción, publicación, reconciliación o
  abort) se conserva sin cambios

## Plan

- [ ] Añadir tests rojos con la ref del remoto corrompida a mano hacia tag/blob (sha1) y verificar refs intactos, e implementar la aserción de tipo commit sobre el tip fetched en `src/state-store.mjs` antes de cualquier transacción que confirme (sync y abort); verify: `node --test test/ledger-store.test.mjs test/state-store.test.mjs` (CR1, CR2, CR3)
- [ ] Ejecutar el gate completo; verify: `pnpm verify` (support)

## Log

- **2026-07-24T21:27:22Z** `[note]` Draft creado desde el hallazgo FAULT-N5 de la tercera ejecución del audit 20260721-193106; frontera: clasificación de tipo del tip fetched de la réplica, espejo del guard de activation de 20260723-235910.
- **2026-07-24T21:28:03Z** `[status]` draft → approved (human via conversation)
- **2026-07-24T21:28:03Z** `[note]` Aprobado por el humano en conversación (2026-07-24: 'procede a crear los draft... y en cualquier caso procede a hacer las correcciones' sobre los hallazgos enumerados del audit).
- **2026-07-24T21:28:04Z** `[status]` approved → in-progress
- **2026-07-24T21:28:04Z** `[owner]` set: raruiz-hiberuscom (auto)
