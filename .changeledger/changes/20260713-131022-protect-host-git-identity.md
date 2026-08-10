---
id: "20260713-131022"
title: Evitar que las pruebas contaminen la identidad Git
type: quick
status: done
created: 2026-07-13T13:10:22Z
depends_on: []
owner: Roberto Ruiz
reviewed: true
archived: true
---

## Request

Evitar que una prueba o comando Git ejecutado desde el hook de pre-commit pueda
escribir `user.name` o `user.email` en el repositorio anfitrión al heredar
variables `GIT_*` que contradicen el `cwd` del repositorio temporal.

Conservar el contrato actual de resolución de owner: intentar primero el login
de `gh` y usar `git config user.name` únicamente cuando esa consulta falle o
devuelva vacío. El incidente afectó al valor del fallback, no a su prioridad.

Añadir una regresión con dos repositorios temporales: el entorno apunta al host
y la operación al fixture; solo el fixture debe recibir la configuración.
Reparar los owners contaminados usando la identidad autenticada que resuelva
ChangeLedger en tiempo de ejecución, sin identidades literales en automatización.

## Log

- **2026-07-13T13:10:22Z** `[note]` La identidad local `Test <test@example.com>` se eliminó;
  el repositorio vuelve a heredar `Roberto Ruiz <raruiz@hiberus.com>`.
- **2026-07-13T13:10:22Z** `[note]` El historial cambia de Roberto a Test entre 06:08 y
  06:11 del 11 de julio, durante el change 20260711-103757, cuyo hallazgo raíz
  fue sanear variables `GIT_*` heredadas por hooks anidados.
- **2026-07-13T13:17:19Z** `[status]` draft → approved
- **2026-07-13T13:18:13Z** `[status]` approved → in-progress
- **2026-07-13T13:18:13Z** `[owner]` set: Roberto Ruiz (auto)
- **2026-07-13T13:20:23Z** `[note]` Regresión añadida con host y fixture temporales; pnpm verify pasó con 659 pruebas. La reparación consultó gh primero y, al fallar su token, usó dinámicamente git config user.name para corregir dos owners visibles en dev.
- **2026-07-13T13:20:24Z** `[status]` in-progress → in-validation
- **2026-07-13T13:36:26Z** `[validation]` in-validation → done (human accepted)
- **2026-07-13T13:36:46Z** `[graduation]` skipped: Regresión y reparación operativa sin nueva verdad persistente
- **2026-07-13T13:36:47Z** `[archive]` archived
