---
id: "20260616-162017"
title: Hacer atomicas las escrituras de documentos
type: refactor
status: done
created: 2026-06-16T16:20:17Z
depends_on: []
reviewed: true
owner: Roberto Ruiz
archived: true
---

## Request

Reducir el riesgo de corrupcion de documentos y registry haciendo atomicas las
escrituras que actualizan la fuente de verdad de Spec Ledger.

## Proposal

Introducir un helper pequeno de escritura atomica en `src/` y usarlo en las
rutas que reemplazan archivos existentes:

- cambios bajo `.sl/changes/`
- specs bajo `.sl/specs/`
- registry local `registry.json`
- archivos de contrato/configuracion que se actualizan por helpers

La estrategia propuesta es:

1. escribir el contenido completo a un archivo temporal en el mismo directorio;
2. cerrar/sincronizar el descriptor cuando sea razonable en Node;
3. renombrar el temporal sobre el destino;
4. limpiar el temporal si ocurre un error antes del rename.

Las creaciones con `flag: 'wx'` que dependen de atomicidad de creacion, como
`sl new`, deben conservar su semantica. El refactor no debe cambiar el formato
de ningun documento.

## Plan

- [x] Añadir tests en `test/writer.test.mjs` o un nuevo `test/atomic-write.test.mjs` que verifiquen que el helper escribe el contenido completo y elimina temporales tras un fallo inyectado — 2026-06-16T16:38:34Z
- [x] Crear `src/atomic-write.mjs` con un helper reutilizable de escritura atomica para archivos de texto — 2026-06-16T16:38:41Z
- [x] Migrar escrituras existentes en `src/commands/agent.mjs`, `src/commands/graduate.mjs`, `src/registry.mjs`, `src/contract.mjs` y comandos relacionados sin cambiar sus salidas observables — 2026-06-16T16:38:47Z
- [x] Mantener las creaciones exclusivas de `src/commands/new.mjs` con `flag: 'wx'` y documentar por que no usan el helper general — 2026-06-16T16:38:50Z
- [x] Ejecutar `pnpm test` y `node bin/sl.mjs check` para confirmar que el refactor conserva comportamiento — 2026-06-16T16:38:57Z

## Log
- **2026-06-16T16:25:17Z** — status: draft → approved
- **2026-06-16T16:36:39Z** — status: approved → in-progress
- **2026-06-16T16:36:39Z** — owner → Roberto Ruiz (auto)
- **2026-06-16T16:39:03Z** — status: in-progress → in-review
- **2026-06-16T16:43:43Z** — review → done (delegated subagent, clean context)
- **2026-06-16T16:45:08Z** — graduado a spec `architecture.md`
- **2026-06-16T21:19:25Z** — archived
