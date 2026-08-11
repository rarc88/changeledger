---
id: "20260811-122031"
title: Decidir si el aterrizaje de apply gatea errores del candidato
type: quick
status: done
created: 2026-08-11T12:20:31Z
depends_on: []
reviewed: true
branch: quick/20260811-122031
related_to: ["20260811-110629"]
owner: rarc88
---

## Request

Decisión de producto pendiente del review de `20260811-110629`: en modo
aterrizaje (sin `--dry-run`), `apply` imprime los errores de `check` del
candidato pero aterriza con exit 0 — paridad deliberada con `edit`. Solo el
dry-run es puerta.

Dirección recomendada al humano: gatear TAMBIÉN el aterrizaje (un lote con
errores no aterriza; `--dry-run` deja de ser la única defensa), porque
`apply` está diseñado para composición scriptada donde nadie lee stderr. El
argumento de paridad con `edit` se resuelve decidiendo si `edit` debe
gatear igual (misma decisión, dos asientos). Aprobar este draft adopta la
dirección recomendada; si el humano prefiere mantener la paridad laxa, se
descarta este change con esa razón.

## Log
- **2026-08-11T14:16:18Z** `[status]` draft → approved (human via conversation)
- **2026-08-11T14:17:06Z** `[status]` approved → in-progress
- **2026-08-11T14:17:06Z** `[branch]` set: quick/20260811-122031 (auto)
- **2026-08-11T14:28:02Z** `[note]` Cerrado: apply gatea errores tambien en aterrizaje (assertCandidateClean corre en ambos modos, mensaje sin 'dry run'); edit y new --from ampliaron su gate de checkSelectedChange (scoped) a checkRepo (repo-wide) para atrapar rupturas de grafo/spec que el scope de un solo documento no ve. Diseno de errores preexistentes: newErrors() en check.mjs difiere (multiset por file+message) errores del candidato contra los de check Repo(repo) actual, de forma que un error ya presente en el repo (roto por otro documento) nunca bloquea una escritura que no lo toca ni la que lo arregla; solo los errores NUEVOS que la operacion introduce gatean. Aplicado igual en las tres seams (apply, edit, new --from) por consistencia de diseno. Decisiones no especificadas por el draft: (1) apply mantiene su comparacion completa (sin filtrar preexistentes) para dry-run, ya cubierta por el test CR7 existente -- la exencion de preexistentes se anadio solo al nuevo path de landing, con la misma logica newErrors, sin romper ese contrato. (2) prepareSpecEdit se dejo intacto (sigue filtrado por e.file===name): el draft no lo nombro y ampliarlo es una asimetria aparte, fuera de alcance. (3) el separador de errorKey usa un caracter nulo (\\u0000) para evitar colisiones file+message. Gate: pnpm lint 0, pnpm test 1423/1423, changeledger check 0.
- **2026-08-11T14:28:19Z** `[note]` Correccion a la nota anterior: apply NO aplica la exencion de preexistentes en ningun modo (ni dry-run ni landing) -- ambos gatean sobre TODOS los errores del candidato, sin diff contra el estado actual, preservando el contrato ya fijado por el test CR7 existente ('dry-run refuses a candidate that carries check errors' sobre un spec ya roto antes del batch). Solo edit y new --from usan newErrors() para exceptuar errores preexistentes no tocados por la operacion. Motivo: el draft solo pidio la exencion explicitamente para el gate de edit (item 2 y su bloque TDD); apply mantiene el gate tal como ya estaba especificado/testeado, solo extendido a landing con el mismo criterio (todos los errores, sin filtrar).
- **2026-08-11T14:30:18Z** `[status]` in-progress → in-validation
- **2026-08-11T15:04:46Z** `[validation]` in-validation → done (human accepted via conversation)
- **2026-08-11T15:04:47Z** `[graduation]` spec: `architecture.md`
