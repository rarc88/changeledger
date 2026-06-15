---
id: "20260615-211456"
title: El contrato es agnóstico a la delegación de etapas
type: chore
status: done
created: 2026-06-15T21:14:56Z
depends_on: []
archived: true
reviewed: true
owner: raruiz-hiberuscom
---

## Request

Aclarar en el contrato (`AGENTS.md` §6) que Spec Ledger es **agnóstico a la
delegación**: cualquier etapa puede delegarse a subagentes (con el modelo que el
agente host estime según complejidad), y eso es decisión del agente y su
harness, nunca del tool. La única delegación que el contrato exige es la
**independencia del review** (§6.6), porque ahí el contexto limpio es un
requisito de correctitud, no una optimización. Hoy esto es implícito y genera la
duda de si habría que normar la delegación de investigación/implementación — que
sería especificar un *cómo* y se sale del propósito.

## Plan

- [x] Añadir un punto en `templates/AGENTS.md` §6 que declare la agnosticidad a la delegación y reafirme que solo la independencia del review es requisito de contrato — 2026-06-15T21:15:50Z
- [x] Ejecutar `pnpm verify` (el contrato es texto; sin tests asociados) — 2026-06-15T21:15:50Z

## Log
- **2026-06-15T21:15:29Z** — status: draft → approved
- **2026-06-15T21:15:29Z** — status: approved → in-progress
- **2026-06-15T21:15:30Z** — owner → raruiz-hiberuscom (auto)
- **2026-06-15T21:15:51Z** — status: in-progress → done
- **2026-06-15T21:15:51Z** — graduation skipped: aclaración del contrato; sin verdad persistente nueva en specs/
- **2026-06-15T21:17:59Z** — archived
