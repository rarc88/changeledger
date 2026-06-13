---
id: "20260613-134548"
title: Bootstrap de Spec Ledger
type: feature
status: done
created: 2026-06-13T13:45:48Z
depends_on: []
---

## Request

Construir **Spec Ledger** (`sl`): una herramienta para planificar antes de
codificar. Cada cambio en un repo (feature, bug, auditoría, refactor) nace de una
conversación con un agente y queda plasmado como documento tangible, trackeable y
accionable. Los documentos son la fuente de verdad; el código, su reflejo.

**Por qué.** Intentos previos con sistemas SDD (OpenSpec, SpecKit) fallaron por
dos razones: (1) muchos archivos dispersos sin orden ni relaciones claras, y
(2) el markdown crudo genera fricción al consumirlo. El humano hoy pasa más
tiempo leyendo estos documentos que el código, así que la experiencia de consumo
humano es prioritaria, sin perder potencia para el agente.

## Investigation

- **OpenSpec / SpecKit / Conductor** resuelven el almacén pero no la capa de
  consumo: se leen `.md` a pelo. Acierto a rescatar de OpenSpec: separar
  *verdad persistente* (specs) de *deltas* (changes).
- **Dolor raíz identificado:** mezclar almacén y presentación en el mismo
  markdown. Solución: separarlos.
- **Restricción:** debe funcionar cross-agente. El contrato no puede ser tooling
  atado a un agente; es una convención de texto (`AGENTS.md`) que cualquier
  agente lee.
- **Runtime disponible:** Node v26 en la máquina. Sin bun/deno.

## Proposal

**Separar almacén de presentación.**

- **Almacén:** archivos simples bajo `.sl/`, fuente de verdad, optimizados para
  agente y git.
- **Presentación:** un visor local (`sl view`) que los renderiza en un tablero
  navegable, filtrable y ordenado por el ciclo de vida. El humano casi nunca toca
  el markdown.

**Unidad:** el *change*, un solo archivo por cambio (no carpeta con varios
docs → mata el "no sé el orden ni cómo se relacionan"). Riqueza interna via
**etapas** = ciclo de vida, opcionales según tipo.

**Distribución:** CLI global. El código del visor vive en la instalación global;
en cada repo solo viven docs + config.

_Alternativas descartadas:_
- _Pure YAML/JSON como fuente:_ prosa en YAML es horrible de escribir/leer.
- _HTML estático generado:_ se queda obsoleto; elegido server en vivo.
- _Tasks en frontmatter estructurado:_ más ceremonia, los agentes lo rompen;
  elegido checklist markdown.
- _Capa `specs/` desde el inicio:_ sobre-ingeniería temprana; llega al graduar
  el primer change.

## Specification

### CR1 — Init crea la estructura
- **Given** un repo sin inicializar
- **When** ejecuto `sl init`
- **Then** se crea `.sl/` con `config.yml`
- **And** se materializa `AGENTS.md`

### CR2 — View levanta el visor
- **Given** un repo con changes
- **When** ejecuto `sl view`
- **Then** se levanta un server local
- **And** se abre el navegador con el tablero

### CR3 — Kanban con filtros y búsqueda
- **Given** changes en el repo
- **When** abro el visor
- **Then** los muestra en kanban por `status`
- **And** puedo filtrar por tipo, estado y texto

### CR4 — Render por etapas, no markdown crudo
- **Given** un change de un tipo dado
- **When** lo abro en el visor
- **Then** se renderiza como pipeline de etapas
- **And** solo muestra las etapas activas de su tipo

### CR5 — Progreso desde el checklist
- **Given** un change con tareas `[ ]`/`[x]`/`[!]`
- **When** el visor lo procesa
- **Then** deriva el progreso de tareas
- **And** marca estado "bloqueado" si existe alguna `[!]`

### CR6 — Grafo de dependencias
- **Given** changes con `depends_on`
- **When** abro el visor
- **Then** dibuja el grafo de dependencias

### CR7 — Contrato autosuficiente
- **Given** un agente nuevo en el repo
- **When** lee `AGENTS.md`
- **Then** puede seguir la convención sin tooling propietario

## Plan

- [x] Definir contrato `AGENTS.md` (formato, ciclo, tipos, etapas, reglas) (CR7) — 2026-06-13T13:30:00Z
- [x] Definir `config.yml` (idioma + tipos + etapas activas) y template (CR1) — 2026-06-13T13:35:00Z
- [x] Change bootstrap (este documento) como formato vivo — 2026-06-13T13:40:00Z
- [x] Definir política de idioma (estructura inglés, contenido según `language`) — 2026-06-13T13:45:48Z
- [x] CLI `sl` con `init` / `view` / `new <tipo>` (CR1, CR2) — 2026-06-13T14:30:00Z
- [x] Visor: server Node (`node:http`) que lee `.sl/` y expone JSON — 2026-06-13T14:35:00Z
- [x] Visor: UI kanban + pipeline de etapas + filtros y búsqueda (CR3, CR4) — 2026-06-13T14:38:00Z
- [x] Visor: grafo `depends_on` + progreso de tareas (CR5, CR6) — 2026-06-13T14:40:44Z

## Log

- **2026-06-13T13:00:00Z** — Definido el modelo en conversación inicial.
  Decisiones clave: un archivo por change; etapas opcionales por tipo; tasks como
  checklist; visor como server en vivo; CLI mínimo de 3 comandos; contrato en
  `AGENTS.md`; capa `specs/` diferida.
- **2026-06-13T13:20:00Z** — Naming: de "Agent Workflow Canon / awc" a
  **Spec Ledger** (comando `sl`). Razón: "Ledger" captura *fuente de verdad
  trackeable*; "Spec" captura SDD. "Agent" descartado por enmarcar como
  tooling-de-agente cuando la verdad es del proyecto y human-first.
- **2026-06-13T13:45:48Z** — Correcciones de feedback humano: directorio de datos
  `.awc/` → `.sl/`; headings de etapas a inglés fijo (`Request`, `Investigation`,
  `Proposal`, `Specification`, `Plan`, `Log`); añadida política de idioma
  (estructura inglés, contenido según `config.language`); `created` ahora es
  timestamp ISO 8601 UTC completo. `AGENTS.md` reescrito como spec canónica en
  inglés. Historial de los 4 commits iniciales rehecho limpio (sin residuo "awc").
- **2026-06-13T14:10:00Z** — Contrato: criterios de aceptación ahora en formato
  G/W/T estructurado fijo (un `### CRn` por escenario, pasos por línea), sin
  inline. Añadida trazabilidad criterio↔tarea (las tareas referencian `(CRn)`).
  TDD parqueado para análisis posterior. Specification de este change migrada al
  nuevo formato.
- **2026-06-13T14:20:00Z** — Contrato: las tareas `[x]` llevan timestamp de
  resolución ISO 8601 UTC completo (solo-día no preserva el orden de tareas del
  mismo día). Tareas ya completadas re-estampadas con timestamps reconstruidos
  y ordenados; de aquí en más se registra el momento real.
- **2026-06-13T14:40:44Z** — Base implementada con TDD (22 tests verde): parser
  YAML, parser de change, carga de repo, CLI `sl init`/`new`/`view`, server
  `node:http` y visor (kanban, filtros, pipeline de etapas, progreso, grafo
  `depends_on`). CR1–CR7 verificados (incl. visualmente en el visor). `marked`
  vendorizado (MIT). Change cerrado: `in-progress → done`. Próximo: graduar
  verdad a `specs/` e implementar 0002 (`sl check`).
