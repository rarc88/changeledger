---
id: "20260617-231426"
title: Definir auditoría de advisories de dependencias
type: chore
status: done
created: 2026-06-17T23:14:26Z
depends_on: [ "20260617-225650" ]
owner: raruiz-hiberuscom
reviewed: true
archived: true
---

## Request

Definir un ritual explicito para auditoria de advisories de dependencias. El
owner ya ejecuto `pnpm audit` y el estado actual es limpio, pero el proyecto no
tiene documentado si ese check es manual, pre-release o parte de CI.

## Plan

- [x] Documentar en `CONTRIBUTING.md` cuando correr `pnpm audit --audit-level moderate`, incluyendo que envia metadatos del lockfile a npm; verificar con `node bin/sl.mjs check` — 2026-06-18T10:08:50Z
- [x] Agregar un script `audit:deps` en `package.json` para estandarizar el comando sin meterlo aun en `pnpm verify`; verificar con `pnpm audit:deps` cuando haya red disponible — 2026-06-18T10:08:50Z
- [x] Decidir si `.github/workflows/ci.yml` debe ejecutar `pnpm audit:deps` en releases o scheduled job; verificar con `pnpm verify` — 2026-06-18T10:08:50Z

## Log

- **2026-06-18T09:52:54Z** — status: draft → approved
- **2026-06-18T09:56:49Z** — status: approved → in-progress
- **2026-06-18T09:56:49Z** — owner → raruiz-hiberuscom (auto)
- **2026-06-18T10:05:45Z** — status: in-progress → done
- **2026-06-18T10:06:37Z** — graduation skipped: Process documentation; no spec needed
- **2026-06-18T10:09:09Z** — archived
