---
id: "20260722-190137"
title: Evitar que respuestas tardías del viewer crucen proyectos
type: bug
status: in-progress
created: 2026-07-22T19:01:37Z
depends_on: []
owner: raruiz-hiberuscom
related_to: ["20260721-193106", "20260627-111218", "20260627-111219"]
---

## Request

La auditoría de producción `20260721-193106` reprodujo que una respuesta lenta
del viewer puede cruzar proyectos. Si `load()` solicita A, el usuario cambia a
B y la respuesta de B llega primero, la llegada posterior de A reemplaza
`state.repo` aunque `state.currentProject` siga siendo B. La UI termina mostrando
la revisión y los changes de A bajo la selección visible B.

Cada operación asíncrona ligada a un proyecto debe conservar la afinidad del
target capturado al iniciarse y descartar respuestas obsoletas. El servidor y el
cliente deben transportar procedencia suficiente para que la UI pueda verificar
la atribución antes de aplicar un resultado.

## Investigation

`load()` (`src/viewer/public/app.js:93-111`) evalúa `state.currentProject` al
construir `getRepo(...)`, pero después del `await` ejecuta `setRepo(text)` sin
comparar el proyecto solicitado con la selección actual ni con una generación
de request. No existe cancelación ni regla latest-wins. Además, `serialize()` no
incluye `project_id`, por lo que el payload tampoco permite verificar afinidad.

Reproducción con el módulo real del viewer bajo JSDOM y `fetch` controlado:

1. bootstrap selecciona A e inicia `/api/repo?project=project-a`, retenido;
2. el selector cambia a B y `/api/repo?project=project-b` responde primero;
3. el estado queda correctamente `selected=B, rendered=B, revision=revision-b`;
4. se libera A y el estado termina `selected=B, rendered=A,
   revision=revision-a`.

La misma forma de carrera existe en otras continuaciones que leen globals tras
un `await`: `loadGitRefs` aplica refs usando el proyecto actual sin conservar el
target; `openManagedProject` puede sobrescribir `managedConfig` después de que
`managedProject` cambió; y callbacks de mutación de configuración capturan el
target de escritura, pero pueden aplicar su receipt al proyecto administrado
actual. Un guard exclusivo en `load()` dejaría superficies equivalentes
abiertas.

La capa de escritura del servidor no cruza paths: una prueba concurrente separó
correctamente una aprobación del viewer en A y un Log del CLI con cwd B. El
defecto está en la atribución/aplicación asíncrona del cliente, no en que el CLI
consuma la selección del viewer. Según `20260721-193106` es crítico porque una
respuesta queda atribuida al proyecto incorrecto y puede inducir una decisión
humana sobre otra verdad.

## Specification

### CR1 — La última selección gobierna la respuesta visible
- **Given** una lectura de A en vuelo y una selección posterior de B
- **When** B responde primero y A responde después
- **Then** la UI conserva repositorio, revisión y filtros de B
- **And** la respuesta obsoleta de A no muta cache, DOM ni estado persistido

### CR2 — Cada payload declara su identidad
- **Given** cualquier lectura de repositorio o configuración por proyecto
- **When** el servidor responde
- **Then** el receipt incluye el `project_id` y la revisión del ledger usados
- **And** el cliente rechaza o descarta una identidad distinta del target
  capturado

### CR3 — Latest-wins también dentro del mismo proyecto
- **Given** dos lecturas consecutivas del mismo proyecto con revisiones distintas
- **When** la respuesta más antigua llega al final
- **Then** no puede rebajar la UI ni `lastJson` a la revisión anterior

### CR4 — Todas las continuaciones project-scoped conservan afinidad
- **Given** repo, Git refs, configuración, sync o mutación en vuelo para A
- **When** cambia la selección general o el proyecto administrado a B
- **Then** el resultado de A solo actualiza el contexto A todavía vigente o se
  descarta
- **And** errores, toasts y receipts identifican inequívocamente su target

### CR5 — El CLI permanece independiente
- **Given** viewer seleccionado en A y un CLI cuyo cwd es B
- **When** ambas superficies leen o mutan concurrentemente
- **Then** la selección y las respuestas del viewer no cambian la resolución del
  CLI
- **And** refs, worktrees y receipts demuestran que cada operación tocó solo su
  repositorio

## Plan

- [ ] Añadir en `test/viewer-metadata.test.mjs` un harness asíncrono del comportamiento de `src/viewer/public/app.js` que invierta respuestas A/B y dos revisiones de A; verify: `node --test test/viewer-metadata.test.mjs` (CR1, CR3)
- [ ] Incorporar en `src/viewer/public/app.js` una identidad/generación de request capturada y aplicarla a repo, Git refs, config, sync y callbacks de mutación; verify: `node --test test/viewer-metadata.test.mjs test/view.test.mjs` (CR1, CR3, CR4)
- [ ] Exponer `project_id` junto a la revisión desde `src/viewer/domain.mjs` y validarlo en `src/viewer/public/app.js`; verify: `node --test test/view.test.mjs test/viewer-metadata.test.mjs` (CR2, CR4)
- [ ] Cubrir en `test/view.test.mjs` la concurrencia entre `src/viewer/domain.mjs` para A y `src/commands/agent.mjs` con cwd B, comprobando refs, worktrees y receipts; verify: `node --test test/view.test.mjs test/ledger-mutations.test.mjs` (CR5)
- [ ] Ejecutar `pnpm verify` (support)

## Log

- **2026-07-22T19:01:37Z** `[note]` Draft creado por el hallazgo crítico ISOL-02 de la auditoría 20260721-193106; reproducción determinista con el app real bajo JSDOM: selección B terminó mostrando payload/revisión de A.
- **2026-07-23T09:28:17Z** `[status]` draft → approved
- **2026-07-23T13:43:51Z** `[status]` approved → in-progress
- **2026-07-23T13:43:51Z** `[owner]` set: raruiz-hiberuscom (auto)
