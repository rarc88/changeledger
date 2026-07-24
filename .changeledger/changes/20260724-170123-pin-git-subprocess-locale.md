---
id: "20260724-170123"
title: Fijar locale neutro en los subprocesos de Git
type: quick
status: in-validation
created: 2026-07-24T17:01:23Z
depends_on: []
owner: raruiz-hiberuscom
related_to: []
---

## Request

En máquinas cuyo locale de sistema no es inglés (o cuando el proceso no exporta
`LANG`/`LC_ALL`), Git emite sus diagnósticos localizados ("Se necesitó una
revisión singular") y los tests que asertan el stderr inglés fallan en falso
rojo (`test/git.test.mjs` CR1 y 170613); cualquier código futuro que clasifique
errores por mensaje heredaría la misma fragilidad. Fix: `sanitizedGitEnv` y
`receiveGitEnv` (`src/git.mjs`) fijan `LC_ALL: 'C'` antes de los overrides, de
modo que todo subproceso de Git del producto habla inglés determinista;
regresión que fuerza `LC_ALL=es_ES.UTF-8` en el proceso y exige el diagnóstico
inglés del runner. Reversible y de una sola preocupación; los mensajes de error
que el producto reenvuelve quedan siempre en inglés (coherente con la política
de estructura en inglés).

## Log
- **2026-07-24T17:01:48Z** `[status]` draft → approved (human via conversation)
- **2026-07-24T17:01:48Z** `[note]` Aprobado por el humano en conversación (2026-07-24: 'ok, acepto el fix' sobre la propuesta explícita de pinnear locale neutro en los runners de git).
- **2026-07-24T17:01:49Z** `[status]` approved → in-progress
- **2026-07-24T17:01:49Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-24T17:04:20Z** `[note]` Implementado: sanitizedGitEnv y receiveGitEnv fijan LC_ALL:'C' antes de los overrides; regresión 170123 fuerza es_ES.UTF-8 en el proceso y exige el diagnóstico inglés en defaultRun y mutatingRun (roja antes del pin en esta máquina). pnpm verify completo sin prefijo de locale: 1.140/1.140 y 242 changes válidos.
- **2026-07-24T17:04:20Z** `[status]` in-progress → in-validation
