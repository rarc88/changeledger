---
id: "20260810-175519"
title: Retarget del sweep de la spec graduada a la autoridad de lectura
type: quick
status: done
created: 2026-08-10T17:55:19Z
depends_on: []
archived: true
reviewed: true
branch: quick/20260810-175519
related_to: []
owner: rarc88
---

## Request

Hallazgo del experimento de activación del 2026-08-10 (1ª ronda): el test
`111349 CR6` (`test/context.test.mjs`, helper `graduatedGitSpec`) lee la spec
graduada `.changeledger/specs/git-traceability.md` del worktree del propio
repo con `readFileSync`, y tras el cutover las specs viven solo en la ref de
estado — la suite queda 1384/1385 y el hook de pre-commit bloquearía todo
commit. Fue la causa del undo de la 1ª ronda.

Retarget: `graduatedGitSpec` resuelve el texto de la spec por la misma
autoridad de lectura que el producto (`loadRepo` sobre la raíz real del repo:
worktree en modo inactivo, snapshot de la ref en modo activado), en vez del
`readFileSync` directo. El sweep de frases retiradas no cambia ni una
aserción; solo cambia de dónde sale el texto. Clase acotada: es la única
lectura del ledger propio que el cutover invalida (las demás lecturas
auto-referenciales son `config.yml` — que sobrevive como marcador —,
`AGENTS.md` y `templates/`). Test-only; sin superficie pública ni verdad
persistente.

## Log
- **2026-08-10T17:55:47Z** `[status]` draft → approved (human via conversation)
- **2026-08-10T17:56:50Z** `[status]` approved → in-progress
- **2026-08-10T17:56:50Z** `[branch]` set: quick/20260810-175519 (auto)
- **2026-08-10T17:56:51Z** `[owner]` set: claude
- **2026-08-10T17:59:48Z** `[note]` Retarget inline: graduatedGitSpec resuelve por loadRepo(raíz real) y barre spec.body; aserción de existencia sustituye al guard implícito del ENOENT. Borde ejecutado: con la spec ausente el test falla con 'missing from the ledger' (no pasa vacuo); restaurada, pasa. Gate 1385/1385. La rama activada del enrutado la prueba el propio experimento
- **2026-08-10T17:59:49Z** `[status]` in-progress → in-validation
- **2026-08-11T00:35:19Z** `[validation]` in-validation → done (human accepted via conversation)
- **2026-08-11T00:36:09Z** `[graduation]` skipped: test-only: retarget de un test a la autoridad de lectura, sin verdad persistente
- **2026-08-11T00:36:12Z** `[archive]` archived
- **2026-08-11T11:57:28Z** `[owner]` set: rarc88
