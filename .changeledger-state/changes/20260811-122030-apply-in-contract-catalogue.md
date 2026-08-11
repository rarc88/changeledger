---
id: "20260811-122030"
title: Añadir apply al catálogo de comandos del contrato
type: quick
status: done
created: 2026-08-11T12:20:30Z
depends_on: []
reviewed: true
branch: quick/20260811-122030
related_to: ["20260811-110629", "20260810-213634"]
owner: rarc88
---

## Request

Follow-up del review de `20260811-110629`: `apply` no aparece en el
catálogo "Useful mutation commands" de `templates/contract/implement.md`,
así que ningún agente descubrirá el comando desde el contexto — el gemelo
exacto del quick `20260810-213634` que añadió `edit`. Añadir la línea con su
forma (`apply --from <file|-> [--dry-run]`) y qué agrupa (documentos enteros
y eventos propiedad del agente, una entrada de journal por lote; dry-run
como puerta), respetando el techo de `budgets.yml` — si no cabe, parar y
devolver al humano, nunca vaciar otra norma para cuadrar.

## Log
- **2026-08-11T12:21:29Z** `[status]` draft → approved (human via conversation)
- **2026-08-11T12:21:30Z** `[status]` approved → in-progress
- **2026-08-11T12:21:30Z** `[branch]` set: quick/20260811-122030 (auto)
- **2026-08-11T12:21:30Z** `[note]` Arrancado con un solo apply (status+log): la entrada de journal del arranque es una, no tres — walk de CR8 de 20260811-110629
- **2026-08-11T12:23:00Z** `[status]` in-progress → in-validation
- **2026-08-11T12:24:29Z** `[status]` in-validation → in-progress
- **2026-08-11T13:01:10Z** `[note]` Decisión humana (2026-08-11): el pack implement estaba a 2489/2500 con 11 tokens de margen y spec igual de al límite — techos de spec e implement subidos a 3000 tokens en budgets.yml (lines intactos), manteniendo la disciplina: el margen no es licencia para gastarlo, cada entrada sigue optimizada. La entrada de apply se conserva completa (57 tokens)
- **2026-08-11T13:04:38Z** `[status]` in-progress → in-validation
- **2026-08-11T14:16:18Z** `[validation]` in-validation → done (human accepted via conversation)
- **2026-08-11T14:16:49Z** `[graduation]` skipped: la verdad duradera vive en templates/contract/implement.md y budgets.yml versionados; el porqué de los techos, en el pin CR7 retargeteado y el Log
