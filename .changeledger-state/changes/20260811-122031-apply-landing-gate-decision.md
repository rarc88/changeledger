---
id: "20260811-122031"
title: Decidir si el aterrizaje de apply gatea errores del candidato
type: quick
status: draft
created: 2026-08-11T12:20:31Z
depends_on: []
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
