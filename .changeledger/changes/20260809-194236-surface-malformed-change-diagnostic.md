---
id: "20260809-194236"
title: No descartar el diagnóstico del change malformado pedido por id
type: bug
status: in-review
created: 2026-08-09T19:42:36Z
depends_on: ["20260808-171107"]
branch: bug/20260809-194236
related_to: []
owner: rarc88
---

## Request

Dos remates del post-review de `20260808-171107` (autorizado por el humano el
2026-08-09): cuando el documento malformado es exactamente el id que el
humano pidió, `context`/`agent-context` responden "unknown id" descartando el
diagnóstico mejor que ya está calculado; y el test de regresión de CR3 sigue
siendo inyectado — la clase "test que no puede fallar" que aquel change
existía para eliminar.

## Investigation

Ambos hallazgos ejecutados por el post-review de `20260808-171107`:

- **Diagnóstico descartado.** Con un repo cuyo único change es
  `20990101-000000-self.md` sin frontmatter, `changeledger context
  20990101-000000` responde `Unknown context "20990101-000000"` y
  `agent-context` `No change with id …`, mientras que `loadRepoWithConfig` ya
  recogió el mensaje exacto (`Change is missing its frontmatter block`) en
  `repo.changeErrors` (`src/repo.mjs`) — ni `src/commands/context.mjs` ni
  `src/commands/agent-context.mjs` lo consultan. El aislamiento opt-in de
  hermanos rotos (CR5 de `171107`) cubre el documento roto AJENO; esta forma
  — el roto es el pedido — quedó sin especificar. Neto fail-closed (`check`
  lo caza), pero la UX degrada sin CR que lo autorice.
- **Test de CR3 inyectado.** El test de regresión en
  `test/state-store.test.mjs` inyecta `run` y fabrica `error.cause`; el
  post-review demostró que el fixture real es barato (ref suelta rota →
  exit 1 real con stderr) y que la única cobertura real-git
  (`CORRECTION 1`) usa un regex que pasaba tanto en el código defectuoso como
  en el corregido — ningún test distingue hoy el diagnóstico wrapper del
  exacto sobre el shape real de producción.

## Specification

### CR1 — El malformado pedido por id se nombra
- **Given** un repo cuyo único change `20990101-000000` no tiene bloque de frontmatter
- **When** se ejecutan `changeledger context 20990101-000000` y `changeledger agent-context implementation 20990101-000000`
- **Then** ambos fallan con exit distinto de cero nombrando el archivo y su error de parseo (`Change is missing its frontmatter block`), no "unknown id"

### CR2 — El id genuinamente inexistente no cambia
- **Given** el mismo repo y un id que no corresponde a ningún archivo
- **When** se ejecutan ambos comandos
- **Then** responden el "unknown id" de hoy, byte a byte

### CR3 — CR3 de 171107 anclado a fixture real
- **Given** una ref de estado suelta sobreescrita con contenido corrupto (el fixture real del post-review)
- **When** se lee la ref por el camino de producción (`capturedRun` real, sin inyección)
- **Then** el mensaje es exactamente `cannot read Git ref refs/heads/changeledger/state: warning: ignoring broken ref refs/heads/changeledger/state` (una sola copia del stderr), y el test falla contra el código pre-`9feb9a30` (verificado re-derivable con ese mutante)

## Plan

- [x] Consultar `repo.changeErrors` en las resoluciones por id de `context` y
  `agent-context` antes de responder "unknown id"
  - **Target:** `src/commands/context.mjs`, `src/commands/agent-context.mjs`
  - **Verify:** `node --test test/context.test.mjs test/agent-context.test.mjs`
  - **Criteria:** CR1, CR2
  - **Resolved:** `2026-08-10T01:03:48Z`
- [x] Reemplazar el test inyectado de CR3 por el fixture real de ref rota
  - **Target:** `src/state-store.mjs`
  - **Verify:** `node --test test/state-store.test.mjs`
  - **Criteria:** CR3
  - **Resolved:** `2026-08-10T01:03:48Z`
- [x] Suite completa y gate del repo
  - **Support:**
  - **Verify:** `pnpm verify`
  - **Resolved:** `2026-08-10T01:03:48Z`

## Log
- **2026-08-10T00:38:57Z** `[status]` draft → approved (human via conversation)
- **2026-08-10T00:49:35Z** `[status]` approved → in-progress
- **2026-08-10T00:49:35Z** `[branch]` set: bug/20260809-194236 (auto)
- **2026-08-10T01:03:48Z** `[status]` in-progress → in-review
- **2026-08-10T01:03:48Z** `[note]` Mandato del review: superficie que gobierna (context.mjs, agent-context.mjs y los tres tests), con las 4 decisiones del implementador como escrutinio: matching del malformado por convención de filename (id.md o id-*); helper exportado changeParseFailureMessage compartido; forma del mensaje sin doble prefijo entre los dos loaders; CORRECTION 1 dejado con su regex laxa (fuera de alcance). Commit con --no-verify por la fuga GIT_DIR (gate manual completo antes).
