---
id: "0005"
title: Diagramas — renderizar mermaid y priorizar lo visual
type: feature
status: approved
created: 2026-06-13T15:05:00Z
depends_on: ["0001"]
---

## Request

Cuando algo se explica mejor con un gráfico, debe documentarse como gráfico —
los humanos entienden más rápido visualmente. Necesitamos (a) una regla de
autoría que lo fomente y (b) que el visor renderice diagramas.

## Investigation

- Mermaid cubre los diagramas típicos de documentación (flowchart, sequence,
  state, ER) en texto, versionable en git — encaja con "docs = fuente de verdad".
- Es una dependencia client-side pesada; se vendoriza en el visor, no afecta al
  repo consumidor.

## Proposal

- Regla en `AGENTS.md`: si un gráfico explica mejor que prosa, usarlo, en bloques
  ` ```mermaid `. El texto del diagrama es la fuente; el visor lo renderiza.
- Visor: detectar bloques `mermaid` y renderizarlos con mermaid vendorizado.

_Alternativa descartada:_ d3 — más potente pero requiere escribir JS por diagrama;
mermaid es declarativo en texto, mejor para documentación versionada.

## Specification

### CR1 — Render de mermaid
- **Given** una etapa con un bloque ` ```mermaid `
- **When** abro el change en el visor
- **Then** el diagrama se renderiza como gráfico, no como código

### CR2 — Regla de autoría
- **Given** el contrato `AGENTS.md`
- **When** un agente documenta algo más claro en visual
- **Then** la regla indica preferir un diagrama mermaid

## Plan

- [ ] Vendorizar mermaid en el visor (CR1)
- [ ] Renderizar bloques `mermaid` tras `marked` (CR1)
- [ ] Regla de diagramas en `AGENTS.md` (CR2)

## Log

- **2026-06-13T15:05:00Z** — Creado en draft a partir de feedback humano: priorizar
  explicaciones visuales con mermaid.
- **2026-06-13T15:08:09Z** — Aprobado (draft → approved).
