---
id: "20260726-131603"
title: Fijar el locale de los subprocesos de git
type: quick
status: done
created: 2026-07-26T13:16:03Z
depends_on: []
reviewed: true
related_to: ["20260711-204419"]
owner: raruiz-hiberuscom
---

## Request

`sanitizedEnv()` en `src/git.mjs:24` elimina las variables `GIT_*` de
localización pero no fija el locale, así que git emite su stderr en el idioma
del host. En una máquina con locale español devuelve `fatal: Se necesit'o una
revisi'on singular` donde el contrato espera el diagnóstico en inglés.

Consecuencias observadas hoy en `dev`:

- Fallan `CR1 (20260711-204419): a git commit failure surfaces git stderr in the
  error` y `CR1: mutatingRun includes git stderr in the thrown error`
  (`test/git.test.mjs:116`).
- `hooks/pre-commit` ejecuta `pnpm test`, por lo que **ningún commit entra** en
  esta máquina.
- `mutatingRun` existe para que el stderr de git sea el diagnóstico que un
  agente lee y clasifica; si ese texto cambia de idioma según la máquina, la
  clasificación de errores de git deja de ser determinista.

Arreglo: fijar `LC_ALL: 'C'` en el entorno que `sanitizedEnv()` devuelve, de
modo que todo subproceso de git —consulta y mutación— hable un idioma estable
para consumo automático. Los dos tests que lo prueban ya existen y hoy están
rojos, así que pasan sin modificarlos.

Verificación: `node --test test/git.test.mjs` en verde sin prefijar `LC_ALL` en
la invocación, y `pnpm verify` completo.

## Log

- **2026-07-26T13:16:03Z** `[note]` El pin se hizo en el change `20260724-170123`, en una rama que excedió el presupuesto de complejidad y no se integrará; se rehace aquí como cambio de una línea.
- **2026-07-26T13:24:12Z** `[status]` draft → approved
- **2026-07-26T13:47:44Z** `[status]` approved → in-progress
- **2026-07-26T13:49:10Z** `[note]` Gate completo en verde con el locale fijado: 718 tests, check 213 valid. El commit baseline del documento antes del codigo era imposible aqui: el hook pre-commit ejecuta pnpm test y estaba rojo por el propio defecto que este change corrige, asi que documento y fix van en un unico commit consolidado.
- **2026-07-26T13:49:10Z** `[status]` in-progress → in-validation
- **2026-07-26T13:51:40Z** `[validation]` in-validation → done (human accepted)
- **2026-07-26T14:10:12Z** `[graduation]` spec: `git-traceability.md`
