---
id: "20260617-190006"
title: "acquireIdLock: spin infinito posible + branches de lock sin tests"
type: bug
status: approved
created: 2026-06-17T19:00:06Z
depends_on: []
---

## Request

`acquireIdLock` en `src/commands/new.mjs` tiene un `for(;;)` sin cota de iteraciones.
En condiciones de carrera extremas (lock perpetuamente fresco) el loop no termina.
Además, las branches críticas de `isStaleLock` y `processIsAlive` (EPERM, JSON parse
inválido, mtime fallback, ENOENT) no tienen cobertura de tests — riesgo de regresión
silenciosa.

## Investigation

`new.mjs:67-83`:

```js
function acquireIdLock(changesDir, id) {
  const lock = path.join(changesDir, `.${id}.lock`);
  for (;;) {                                          // sin límite
    try {
      const fd = fs.openSync(lock, 'wx');
      // ...
      return { fd, path: lock };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (!isStaleLock(lock)) return null;            // retorna null → outer loop bump
      fs.rmSync(lock, { force: true });
      // vuelve al inicio del for(;;)
    }
  }
}
```

Escenario de riesgo: si `fs.rmSync` borra el lock pero otro proceso lo recrea antes
de `openSync(lock, 'wx')`, el loop puede iterar muchas veces. En la práctica el outer
loop en `newChange` siempre bumpa el segundo al recibir `null`, pero si `isStaleLock`
siempre retorna `true` (bug en la lógica), el inner loop nunca termina.

Branches sin tests en `isStaleLock` (`new.mjs:90-103`):
- `JSON.parse` falla → fallback a `statSync().mtimeMs`
- `statSync` lanza `ENOENT` (lock borrado por otro proceso) → retorna `true`
- `processIsAlive` lanza `EPERM` → retorna `true` (proceso vivo, sin permiso de señal)

`STALE_LOCK_MS` (línea 7) solo aplica al fallback de mtime; el nombre implica que
es el timeout primario del lock, lo que es engañoso.

## Specification

### CR1 — acquireIdLock tiene cota máxima de iteraciones
- **Given** el lock persiste y `isStaleLock` siempre retorna `true`
- **When** se llama `acquireIdLock`
- **Then** la función retorna `null` (o lanza) después de como máximo N intentos (N razonable: 3-5)
- **And** el caller (outer loop en `newChange`) bumpa el segundo normalmente

### CR2 — isStaleLock: branch JSON parse inválido usa mtime fallback
- **Given** el archivo de lock existe pero contiene JSON inválido
- **When** se llama `isStaleLock`
- **Then** usa `statSync().mtimeMs` para determinar staleness
- **And** retorna `true` si el archivo tiene más de `STALE_LOCK_MS` ms

### CR3 — isStaleLock: branch ENOENT retorna true
- **Given** el archivo de lock es borrado por otro proceso justo antes de `statSync`
- **When** `statSync` lanza `ENOENT`
- **Then** `isStaleLock` retorna `true` (el lock ya no existe, se puede continuar)

### CR4 — processIsAlive: EPERM retorna true
- **Given** el proceso owner del lock existe pero no tenemos permiso de señal (`EPERM`)
- **When** se llama `processIsAlive`
- **Then** retorna `true` (proceso vivo)

### CR5 — Sin regresión en tests de new existentes
- **Given** el fix aplicado
- **When** `pnpm test -- test/change.test.mjs` (o el test que cubra `new`)
- **Then** todos los tests pasan

### CR6 — Estrategia de lock documentada en código
- **Given** `src/commands/new.mjs` usa PID-liveness y `src/atomic-write.mjs` usa timeout como estrategias de staleness
- **When** un mantenedor lee el código de cada implementación
- **Then** encuentra un comentario que explica POR QUÉ usa esa estrategia (la razón no es obvia: PID-liveness es más robusto para colisión de ids; timeout es más simple para escritura concurrente de archivos)
- **And** `STALE_LOCK_MS` es renombrado a `LOCK_MTIME_STALE_MS` en `src/commands/new.mjs` para reflejar que solo aplica al fallback de mtime

## Plan

- [ ] Agregar cota de iteraciones y renombrar `STALE_LOCK_MS` → `LOCK_MTIME_STALE_MS` en `src/commands/new.mjs`, verificar con `test/change.test.mjs` (CR1, CR6)
- [ ] Agregar test en `test/change.test.mjs` para `isStaleLock` en `src/commands/new.mjs` con JSON inválido, verifica mtime fallback (CR2)
- [ ] Agregar test en `test/change.test.mjs` para `isStaleLock` en `src/commands/new.mjs` cuando `statSync` lanza ENOENT (CR3)
- [ ] Agregar test en `test/change.test.mjs` para `processIsAlive` en `src/commands/new.mjs` con EPERM retorna `true` (CR4)
- [ ] Agregar comentario inline en `src/commands/new.mjs` y `src/atomic-write.mjs` explicando POR QUÉ cada uno usa su estrategia de staleness, verificar con `test/change.test.mjs` (CR6)
- [ ] Correr `pnpm test -- test/change.test.mjs` sobre `src/commands/new.mjs` sin regresiones (CR5)

## Log

- **2026-06-17T19:00:06Z** — Detectado en auditoría. `fb8f6ce` introdujo el lock pero sin tests de branches de error. `STALE_LOCK_MS` nombre engañoso también reportado.
- **2026-06-17T19:39:19Z** — Absorbe decisión de documentación de estrategia de lock de `20260617-190011` (descartado por fusión).
- **2026-06-17T20:04:26Z** — status: draft → approved
