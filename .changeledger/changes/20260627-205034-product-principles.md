---
id: "20260627-205034"
title: Filtros de decisión y no-goals de producto
type: chore
status: in-validation
created: 2026-06-27T20:50:34Z
depends_on: []
owner: Roberto Ruiz
---

## Request

Hay valor en fijar de forma explícita los **filtros de decisión** que frenan el
crecimiento del core de ChangeLedger:

- **Presupuesto de complejidad**: toda feature debe reducir complejidad o añadir
  capacidad real; si no, no pertenece al core.
- **Preguntas de evaluación** antes de añadir algo: ¿problema real?, ¿se resuelve
  fuera de ChangeLedger?, ¿simplifica el modelo mental?, ¿seguirá teniendo sentido
  en 5 años?
- **No-goals**: sin orquestación de IA, sin sistemas de memoria, sin agentes
  autónomos, sin automatización oculta, sin dependencias de nube en el core
  (pueden existir como integraciones opcionales, nunca como requisito).

**Ubicación correcta — producto, no protocolo.** Estos filtros gobiernan cómo
evoluciona *el producto ChangeLedger*; **no** son reglas que un repo consumidor
necesite cargar para gestionar sus changes. `templates/AGENTS.md` es el contrato
genérico que se distribuye a otros repos: incluir allí decisiones sobre "el core
de ChangeLedger" confunde producto con protocolo y vuelve a engordar el núcleo
que el contexto dinámico busca adelgazar.

Objetivo autorizado: capturar estos filtros en las superficies propias de este
repo, no en el contrato distribuido. Durante implementación, `INTENT.md` conserva
la explicación completa y el `AGENTS.md` raíz expone una regla breve para el
agente. La spec persistente se crea o actualiza únicamente después de aceptación
humana mediante el gate normal de graduación; no se adelanta verdad a
`.changeledger/specs/` mientras el change sigue activo.

## Plan

- [x] Ampliar `INTENT.md` con el presupuesto de complejidad, las preguntas de evaluación y los no-goals, sin duplicar los principios que ya contiene; verify: `node bin/changeledger.mjs check` (support) — 2026-06-28T01:03:17Z
- [x] Añadir en el `AGENTS.md` raíz de este repo una versión breve que remita a `INTENT.md`, para que influya en decisiones de desarrollo sin cargar el detalle en repos consumidores; verify: `node bin/changeledger.mjs check` (support) — 2026-06-28T01:03:18Z

## Log

- **2026-06-28T01:01:00Z** — status: draft → approved
- **2026-06-28T01:02:57Z** — status: approved → in-progress
- **2026-06-28T01:02:57Z** — owner → Roberto Ruiz (auto)
- **2026-06-28T01:03:18Z** — status: in-progress → in-validation
