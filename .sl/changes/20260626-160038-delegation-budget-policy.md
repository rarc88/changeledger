---
id: "20260626-160038"
title: Política de delegación inteligente por granularidad y modelo
type: feature
status: in-validation
created: 2026-06-26T16:00:38Z
depends_on: []
release_impact: minor
owner: Roberto Ruiz
---

## Request

Reforzar el contrato de Spec Ledger para que la delegación a subagentes sea una
herramienta de eficiencia, no un reflejo automático ni un gasto descontrolado.

El contrato actual permite delegar cualquier stage y exige un subagente limpio
para review, pero no guía al agente principal sobre:

- qué trabajo conviene delegar;
- qué trabajo conviene mantener en el hilo principal;
- cuándo usar un solo subagente frente a varios en paralelo;
- cómo elegir modelos según dificultad y coste;
- cómo evitar explosiones de subagentes que queman presupuesto y contexto.

Caso observado: un agente desplegó aproximadamente 120 subagentes, 60 para leer
un archivo cada uno y 60 para editar una línea por archivo. El trabajo era
mecánico y podía resolverse con un solo subagente o con una edición centralizada.
La delegación agotó un límite de cinco horas en minutos y no aportó calidad ni
paralelismo útil.

El objetivo no es desalentar la delegación: es hacerla deliberada. El modelo
principal puede usar modelos fuertes como GPT-5.5 u Opus para elaborar el change,
pero exploración, investigación e implementación pueden ejecutarse con modelos
suficientes y más económicos cuando la tarea está bien acotada. El contrato debe
ayudar al agente principal a decidir granularidad, paralelismo y modelo.

## Investigation

### Estado actual

- `templates/AGENTS.md` §6.11 dice que cualquier stage puede delegarse a
  subagentes, dimensionados a la dificultad, a discreción del agente principal.
- `templates/AGENTS.md` §6.6 exige review independiente con subagente limpio
  cuando `review_required: true`.
- No hay heurísticas de coste, número de subagentes, granularidad mínima, ni
  selección de modelo.
- La ausencia de límites prácticos deja dos fallos simétricos:
  - agentes que casi nunca delegan y saturan el contexto principal;
  - agentes que delegan demasiado fino y multiplican coordinación, coste y
    latencia sin mejorar el resultado.

### Principio operativo

Delegar debe tener una razón explícita:

- reducir presión de contexto del agente principal;
- paralelizar investigaciones independientes;
- separar write sets claros para implementación;
- obtener revisión limpia e independiente;
- usar un modelo suficiente y más barato para trabajo acotado.

No debe delegarse cuando:

- la tarea es una edición mecánica homogénea que un solo agente o script puede
  hacer de forma segura;
- el coste de coordinar subagentes excede el trabajo real;
- varios subagentes tocarían el mismo archivo o superficie sin necesidad;
- se delega un archivo por subagente sin independencia semántica real;
- el agente principal no puede describir ownership, salida esperada y criterio de
  integración.

### Modelo y dificultad

El contrato no debe fijar nombres concretos de modelos como requisito portable,
pero sí puede exigir una regla conceptual:

- modelos fuertes para definir scope, redactar cambios complejos, decisiones de
  arquitectura, investigaciones ambiguas o revisiones difíciles;
- modelos medios o pequeños para lectura localizada, inventarios, cambios
  mecánicos, pruebas acotadas y tareas con instrucciones completas;
- escalar modelo solo cuando la incertidumbre, riesgo o ambigüedad lo justifica.

## Proposal

Actualizar `templates/AGENTS.md` §6.11 con una política de delegación pragmática:

- mantener que la delegación es decisión del agente principal;
- hacer explícito que se espera delegar cuando reduce contexto o coste sin crear
  sobrecoordinación;
- añadir heurísticas por stage:
  - Request/Investigation: delegar exploraciones independientes;
  - Proposal/Specification: usar modelos fuertes cuando la ambigüedad sea alta;
  - Plan/Implementation: delegar por ownership de superficies, no por archivo
    suelto;
  - Verification/Review: review limpio obligatorio cuando aplica, verificación
    delegable si no duplica trabajo.
- añadir anti-patrones:
  - un subagente por archivo para trabajo mecánico;
  - subagentes con write sets solapados;
  - delegaciones sin criterio de salida;
  - elegir modelos fuertes para tareas triviales o modelos débiles para decisiones
    de alto riesgo.
- exigir que cada delegación tenga una razón breve y un output esperado.

No se propone que `sl check` valide esto: la política vive en el contrato de
agentes, porque depende del harness y del coste disponible en cada entorno.

## Specification

### CR1 — Delegación esperada cuando ahorra contexto o coste

- **Given** un agente lee `templates/AGENTS.md` §6.11
- **When** el trabajo contiene exploraciones independientes, contexto amplio o tareas acotables
- **Then** el contrato indica que se espera considerar delegación para reducir presión de contexto, coste o latencia sin perder control de integración

### CR2 — Anti-patrón de granularidad excesiva

- **Given** una tarea mecánica toca muchos archivos con el mismo cambio pequeño
- **When** el agente decide cómo delegar
- **Then** el contrato desalienta explícitamente crear un subagente por archivo o por línea y recomienda agrupar el trabajo en una sola delegación, lote o script cuando sea seguro

### CR3 — Paralelismo por independencia real

- **Given** hay múltiples subtareas posibles
- **When** el agente decide ejecutarlas en paralelo
- **Then** el contrato exige que sean independientes por pregunta, ownership o write set y que no coordinen sobre la misma superficie sin necesidad

### CR4 — Selección de modelo por dificultad

- **Given** el agente principal puede elegir modelos de distinta capacidad y coste
- **When** delega una tarea
- **Then** el contrato guía a usar modelos fuertes para ambigüedad, arquitectura o riesgo alto, y modelos suficientes más económicos para exploración localizada, inventarios, cambios mecánicos y verificación acotada

### CR5 — Delegación con razón y salida esperada

- **Given** el agente delega una subtarea
- **When** redacta la instrucción al subagente
- **Then** debe incluir ownership o alcance, motivo de la delegación, salida esperada y criterio de integración

## Plan

- [x] Actualizar `templates/AGENTS.md` §6.11 con heurísticas de cuándo delegar, cuándo no, y cómo agrupar tareas; verificar con `node bin/sl.mjs check 20260626-160038` (CR1, CR2, CR3) — 2026-06-26T17:23:07Z
- [x] Documentar en `templates/AGENTS.md` §6.11 la selección de modelo por dificultad/coste sin fijar proveedores concretos; verificar con `node bin/sl.mjs check 20260626-160038` (CR4) — 2026-06-26T17:23:12Z
- [x] Añadir en `templates/AGENTS.md` §6.11 requisitos mínimos para prompts de subagentes: ownership, razón, salida esperada y criterio de integración; verificar con `node bin/sl.mjs check 20260626-160038` (CR5) — 2026-06-26T17:23:17Z
- [x] Ejecutar `pnpm verify` para confirmar que la política contractual y el ledger siguen válidos (support) — 2026-06-26T17:23:35Z

## Log

- 2026-06-26T16:00:38Z — Change creado en estado draft.
- **2026-06-26T17:19:43Z** — status: draft → approved
- **2026-06-26T17:22:36Z** — status: approved → in-progress
- **2026-06-26T17:22:36Z** — owner → Roberto Ruiz (auto)
- **2026-06-26T17:24:20Z** — status: in-progress → in-review
- **2026-06-26T17:26:00Z** — review → in-validation (delegated subagent, clean context)
