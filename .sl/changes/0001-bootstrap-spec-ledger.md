---
id: "0001"
title: Bootstrap de Spec Ledger
type: feature
status: in-progress
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

- **CR1** — Dado un repo sin inicializar, cuando ejecuto `sl init`, entonces se
  crea `.sl/` con `config.yml` y se materializa `AGENTS.md`.
- **CR2** — Dado un repo con changes, cuando ejecuto `sl view`, entonces se
  levanta un server local y se abre el navegador con el tablero.
- **CR3** — El visor muestra los changes en kanban por `status`, con filtros
  (tipo, estado, texto) y búsqueda.
- **CR4** — Al abrir un change, el visor lo renderiza como pipeline de etapas
  (solo las activas del tipo), no como markdown crudo.
- **CR5** — El visor deriva progreso y estado "bloqueado" de las marcas de
  checklist (`[ ]`/`[x]`/`[!]`).
- **CR6** — El visor dibuja el grafo de dependencias desde `depends_on`.
- **CR7** — El contrato (`AGENTS.md`) es legible y suficiente para que cualquier
  agente siga la convención sin tooling propietario.

## Plan

- [x] Definir contrato `AGENTS.md` (formato, ciclo, tipos, etapas, reglas)
- [x] Definir política de idioma (estructura inglés, contenido según `language`)
- [x] Definir `config.yml` (idioma + tipos + etapas activas) y template
- [x] Change bootstrap (este documento) como formato vivo
- [ ] CLI `sl` con `init` / `view` / `new <tipo>`
- [ ] Visor: server Node (`node:http`) que lee `.sl/` y expone JSON
- [ ] Visor: UI kanban + pipeline de etapas + filtros y búsqueda
- [ ] Visor: grafo `depends_on` + progreso de tareas

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
