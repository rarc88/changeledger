---
title: Discovery del contrato
updated: 2026-06-28T01:46:07Z
tags: [ contract ]
---

## Discovery del contrato

> Graduado del change 20260614-151759 (discovery del contrato).
> Graduado del change 20260616-162027 (registry corrupto falla sin sobrescribir).
> Graduado del change 20260626-174204 (ruta rápida del contrato para agentes).
> Graduado del change 20260627-103625 (discovery distingue estado global de raíz de proyecto).
> Graduado del change 20260627-205033 (contexto dinámico y retiro del symlink).

El contrato canónico es un artefacto de la herramienta, separado del contrato
propio de cada repo. Vive como fragmentos normativos únicos en
`templates/contract/`: `core.md`, packs de tarea (`spec`, `implement`, `review`,
`release`), `readiness.md` compartido y overlays de lifecycle (`blocked`,
`validation`, `close`, `discarded`). No existe un monolito paralelo que pueda
divergir.

`changeledger context` los compone de forma determinista:

- sin argumento entrega sólo el núcleo no negociable;
- con modo explícito entrega núcleo + pack;
- con change id infiere pack/overlay desde el status y añade el change completo,
  incluidos criterios, tareas y Log;
- no intenta adivinar specs relacionadas: conserva los enlaces explícitos del
  change, sin heurística ni IA.

El núcleo tiene un presupuesto de 120 líneas y 8192 bytes UTF-8; la versión
graduada ocupa 68 líneas y ~3.3 KB frente al antiguo monolito de 540 líneas y
~30 KB.

## Bootstrap y migración

`init` exige el `AGENTS.md` raíz y añade una caja de alerta con marcador
`<!-- changeledger -->` a `AGENTS.md` y, cuando existe como archivo regular,
`CLAUDE.md`. El bootstrap ordena ejecutar `changeledger context` antes de
modificar archivos y falla cerrado si el CLI no está disponible. No crea
`.changeledger/AGENTS.md`, no necesita permisos de symlink y no añade entradas a
`.gitignore`.

`register` actualiza el bloque administrado y migra repos antiguos. Elimina un
symlink legacy; una copia regular sólo se elimina cuando su SHA-256 coincide
byte a byte con una versión histórica conocida del contrato. Un archivo
desconocido se preserva y la migración falla con un mensaje accionable. De
`.gitignore` sólo se retira la línea literal `.changeledger/AGENTS.md`.

`changeledger check` exige el bootstrap vigente, no sólo el marker: una referencia
ausente o que aún apunte al artefacto legacy es un error de discovery.
