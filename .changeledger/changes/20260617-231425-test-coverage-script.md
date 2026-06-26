---
id: "20260617-231425"
title: Agregar script explícito de cobertura de tests
type: chore
status: done
created: 2026-06-17T23:14:25Z
depends_on: [ "20260617-225650" ]
owner: raruiz-hiberuscom
reviewed: true
archived: true
---

## Request

Agregar una forma explicita de consultar cobertura de tests sin cambiar el ciclo
rapido de `pnpm test`.

## Plan

- [x] Agregar `test:coverage` en `package.json` usando `node --test --experimental-test-coverage`; verificar con `pnpm test:coverage` — 2026-06-18T10:08:49Z
- [x] Documentar en `README.md`/`CONTRIBUTING.md` que `pnpm test` sigue siendo el ciclo rapido y `pnpm test:coverage` es una senal diagnostica; verificar con `node bin/sl.mjs check` — 2026-06-18T10:08:49Z
- [x] Evaluar si `.github/workflows/ci.yml` debe ejecutar coverage como informacion no bloqueante o dejarlo manual; verificar con `pnpm verify` — 2026-06-18T10:08:50Z

## Log

- **2026-06-18T09:52:07Z** — status: draft → approved
- **2026-06-18T09:56:48Z** — status: approved → in-progress
- **2026-06-18T09:56:48Z** — owner → raruiz-hiberuscom (auto)
- **2026-06-18T10:05:45Z** — status: in-progress → done
- **2026-06-18T10:06:37Z** — graduation skipped: Script addition in package.json; no spec needed
- **2026-06-18T10:09:09Z** — archived
