---
id: "20260617-185958"
title: "graduate: spec write puede quedar huérfana si el proceso muere entre writes"
type: bug
status: done
created: 2026-06-17T18:59:58Z
depends_on: []
owner: raruiz-hiberuscom
reviewed: true
---

## Request

`sl graduate` hace dos writes no coordinados: primero escribe la spec (dentro del
callback de `mutateFileAtomic`) y luego el callback retorna el texto modificado del
change para que `mutateFileAtomic` lo persista. Si el proceso muere o hay un error
de disco después del `writeFileAtomic(specFile)` pero antes de que `mutateFileAtomic`
termine de escribir el change, la spec existe pero el change no tiene la entrada de
Log ni el flag `reviewed: true`. Al reintentar, `--into` funciona pero crear una spec
nueva falla con "already exists".

## Investigation

`graduate.mjs:27-68`:

```js
mutateFileAtomic(changeFile, (changeText) => {
  // 1. valida status
  const exists = fs.existsSync(specFile);           // sync IO dentro del callback
  if (into) {
    writeFileAtomic(specFile, ...);                 // WRITE 1 — spec
  } else {
    writeFileAtomic(specFile, content);             // WRITE 1 — spec nueva
  }
  let text = appendLog(changeText, ...);
  text = setReviewed(text, true);
  return text;                                      // WRITE 2 — change (via mutateFileAtomic)
});
```

Problema: si WRITE 1 tiene éxito y WRITE 2 falla, el estado es inconsistente:
- `specFile` existe con contenido nuevo
- `changeFile` no tiene Log entry ni `reviewed: true`
- Retry con `--skip` no es evidente para el operador

Problema secundario: `fs.existsSync(specFile)` es sync IO dentro de un callback
que ya abrió el change file; no bloquea el event loop (es CLI), pero es inconsistente
con el patrón async del viewer.

La validación `status === 'done'` ya está bien ubicada (antes de cualquier write),
pero no valida existencia del specFile hasta dentro del callback donde ya podría
haber iniciado el write.

## Specification

### CR1 — Precondition check antes de cualquier write
- **Given** el operador corre `sl graduate <id> <slug>` o `sl graduate <id> <slug> --into`
- **When** se ejecuta la validación
- **Then** la existencia/ausencia del specFile es verificada ANTES de entrar al callback de `mutateFileAtomic`
- **And** si la validación falla, ningún write ocurre (ni spec ni change)

### CR2 — Spec write falla no corrompe el change
- **Given** el write del specFile lanza un error (disco lleno, permisos, etc.)
- **When** el error es propagado
- **Then** `mutateFileAtomic` no llega a escribir el changeFile (el callback lanzó antes de retornar)
- **And** el change queda en su estado previo, sin entrada de Log ni `reviewed: true`

### CR3 — Spec write falla: changeFile no modificado
- **Given** un spy/mock que falla en `writeFileAtomic(specFile, ...)` pero no en el change
- **When** se ejecuta `graduate`
- **Then** el test verifica que el changeFile no fue modificado (no tiene Log entry)
- **And** el test verifica que la función lanzó el error del spy

### CR4 — Spec write OK, change write falla: spec huérfana es detectable
- **Given** la spec fue escrita exitosamente pero `mutateFileAtomic(changeFile)` lanza (disco lleno, permisos)
- **When** el operador reintenta `sl graduate <id> <slug>`
- **Then** el comando falla con "Spec already exists" (detecta el estado huérfano)
- **And** el operador puede recuperar con `sl graduate <id> <slug> --into`
- **Note** no es posible coordinar dos archivos en una sola operación atómica del FS; el objetivo es que el estado huérfano sea detectable y recuperable, no invisible

### CR5 — Caso feliz sin regresión
- **Given** condiciones normales
- **When** se ejecuta `sl graduate <id> <slug>` y `sl graduate <id> <slug> --into`
- **Then** ambos caminos producen el mismo resultado que antes del fix

## Plan

- [x] Mover las validaciones de existencia de specFile fuera de `mutateFileAtomic` en `src/commands/graduate.mjs`, verificar con `test/graduate.test.mjs` (CR1) — 2026-06-17T20:33:03Z
- [x] Verificar en `src/commands/graduate.mjs` que si `writeFileAtomic(specFile)` lanza el callback propaga y `mutateFileAtomic` no escribe el change, verificar con `test/graduate.test.mjs` (CR2, CR3) — 2026-06-17T20:33:03Z
- [x] Agregar test de failure injection en `test/graduate.test.mjs`: spec write falla, verifica changeFile no modificado en `src/commands/graduate.mjs` (CR3) — 2026-06-17T20:33:03Z
- [x] Agregar test en `test/graduate.test.mjs`: spec existe (huérfana), reintento con `--into` funciona en `src/commands/graduate.mjs` (CR4) — 2026-06-17T20:33:03Z
- [x] Agregar test de caso feliz en `test/graduate.test.mjs` para `--into` y new spec en `src/commands/graduate.mjs` (CR5) — 2026-06-17T20:33:03Z
- [x] Correr `pnpm test -- test/graduate.test.mjs` sobre `src/commands/graduate.mjs` sin regresiones (CR5) — 2026-06-17T20:33:03Z

## Log

- **2026-06-17T18:59:58Z** — Detectado en auditoría de commits desde 407dcdd. El change `e6dcc4d` (atomic-source-writes) no cubre la coordinación entre los dos writes de graduate.
- **2026-06-17T20:04:24Z** — status: draft → approved
- **2026-06-17T20:31:36Z** — status: approved → in-progress
- **2026-06-17T20:31:36Z** — owner → raruiz-hiberuscom (auto)
- **2026-06-17T20:33:04Z** — status: in-progress → in-review
- **2026-06-17T20:33:23Z** — review → done (delegated subagent, clean context)
- **2026-06-17T20:33:23Z** — graduado a spec `architecture.md`
