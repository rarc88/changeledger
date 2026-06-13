---
id: "20260613-205854"
title: Capa specs: verdad persistente y graduación
type: feature
status: draft
created: 2026-06-13T20:58:54Z
depends_on: ["20260613-134548"]
---

## Request

Estrenar la capa **`specs/`**: la verdad persistente del sistema (estado actual,
arquitectura, dominio). Los `changes` son deltas con ciclo de vida; los `specs`
son el destino estable. Cuando un change se completa, su verdad **gradúa** a un
spec. El código refleja los specs.

## Investigation

- OpenSpec separa *specs* (estado actual) de *changes* (deltas). Lo diferimos
  hasta tener changes funcionando; ya es el momento.
- Diferencia clave: los specs **no tienen ciclo de vida** (no draft/done) — son
  documentos vivos que se actualizan. Solo `title` + `updated`.
- Ya tenemos `specs_dir` en config y el visor; falta el formato, el parser y la
  vista.

## Proposal

- **`.sl/specs/*.md`**: cada spec un archivo con frontmatter mínimo:
  ```yaml
  ---
  title: ...
  updated: <ISO UTC>
  tags: []
  ---
  ```
  Cuerpo markdown libre (referencia: capacidades, arquitectura, dominio). Sin
  `status`. Headings libres (no son etapas).
- **Visor**: sección **Specs** que lista los specs y los renderiza (markdown +
  mermaid), incluida en la búsqueda full-text.
- **Graduación**: regla en `AGENTS.md` — al cerrar un change, actualizar/crear el
  spec que refleje la nueva verdad. (Un comando `sl graduate` queda fuera de
  alcance; primero el flujo manual.)
- **Dogfood**: escribir el primer spec — la arquitectura de Spec Ledger,
  graduada de los changes ya `done`.

## Specification

### CR1 — Parser de specs
- **Given** un `.sl/specs/x.md` con frontmatter + cuerpo
- **When** se carga el repo
- **Then** el spec queda disponible (title, updated, tags, body)

### CR2 — Vista de specs en el visor
- **Given** specs en el repo
- **When** abro la sección Specs
- **Then** se listan y al abrir uno se renderiza (no markdown crudo)

### CR3 — Specs en la búsqueda
- **Given** un término presente solo en un spec
- **When** busco ese término
- **Then** el spec aparece

### CR4 — Regla de graduación
- **Given** un change que pasa a `done`
- **When** consulto `AGENTS.md`
- **Then** la regla indica actualizar/crear el spec correspondiente

## Plan

- [ ] Parser de spec (frontmatter + cuerpo) y carga desde `specs_dir`
- [ ] Exponer specs en el JSON del visor
- [ ] Sección Specs en el visor (lista + render + búsqueda) (CR2, CR3)
- [ ] Regla de graduación en `AGENTS.md` (CR4)
- [ ] Primer spec: arquitectura de Spec Ledger (dogfood)
- [ ] Tests del parser de spec (CR1)

## Log

- **2026-06-13T20:58:54Z** — Creado en draft. Estrena la capa persistente diferida
  desde 0001. Specs sin ciclo de vida; graduación manual por ahora.
