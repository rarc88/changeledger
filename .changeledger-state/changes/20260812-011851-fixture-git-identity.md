---
id: "20260812-011851"
title: Los fixtures llevan identidad git determinista
type: quick
status: in-validation
created: 2026-08-12T01:18:51Z
depends_on: []
branch: quick/20260812-011851
related_to: ["20260810-010554"]
owner: rarc88
---

## Request

CI rojo en main tras la release 0.16.0 (run 31552561564, los 6 jobs de
verify en los 3 OS): `activatedConfigFixture` (test/view.test.mjs) hace
`git init` crudo y committea sin identidad — en las máquinas de desarrollo
el autodetect de git produce `usuario@host` válido y pasa por accidente; en
los runners produce `runneradmin@…(none)` y git rechaza con "Author
identity unknown". El CI solo corre en pushes a main, así que la clase
entró con la etapa 2 sin que nadie la viera hasta el merge de la release.

Cierre de la CLASE, no del síntoma: `sanitizedEnv` (test/helpers/git-env.mjs,
el asiento por el que el guard estático de `20260810-010554` ya obliga a
pasar toda invocación git de fixture) inyecta identidad determinista
GIT_AUTHOR_*/GIT_COMMITTER_* con la convención existente
(`Test User <test@example.com>`), sobreescribible vía `extra` para los
tests que prueban resolución de identidad. Pin unitario del contrato del
helper + suite verde con la config global deshabilitada.

## Log
- **2026-08-12T01:19:07Z** `[status]` draft → approved (human via conversation)
- **2026-08-12T01:19:07Z** `[status]` approved → in-progress
- **2026-08-12T01:19:07Z** `[branch]` set: quick/20260812-011851 (auto)
- **2026-08-12T01:23:15Z** `[note]` Identidad determinista inyectada en sanitizedEnv (GIT_AUTHOR_*/GIT_COMMITTER_* = Test User <test@example.com>, extra sobreescribe); pin unitario visto fallar antes; suite completa 1456/1456 CON GIT_CONFIG_GLOBAL=/dev/null (la condición del runner reproducida). El autodetect de git era suerte de entorno: válido en dev, fatal (none) en runners
- **2026-08-12T01:23:16Z** `[status]` in-progress → in-validation
