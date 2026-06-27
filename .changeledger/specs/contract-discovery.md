---
title: Discovery del contrato
updated: 2026-06-27T21:25:58Z
tags: [ contract ]
---

## Discovery del contrato

El **contrato canónico de la herramienta** (instrucciones de uso) vive separado
del contrato propio de cada repo: se distribuye como `templates/AGENTS.md` y
`paths.mjs` lo resuelve como `agentsTemplate`, sin importar la instalación (npm
global, `pnpm link`, node_modules). Es artefacto **de la herramienta**, no del
repo. `init`/`register` lo enlazan en cada repo como `.changeledger/AGENTS.md` — symlink
**por máquina, gitignored**: nunca se copia (no drifta) ni se committea (no queda
dangling al clonar). Separarlo del raíz evita la recursión: el `AGENTS.md` raíz
es el contrato **propio** del proyecto y solo **referencia** al enlazado.

El contrato abre con un **Agent Fast Path** que concentra las decisiones
operativas de mayor prioridad: autorización, aprobación, trazabilidad git,
ejecución, revisión independiente, validación humana y graduación. Las reglas
detalladas siguen debajo como referencia normativa y la sección de CLI conserva
solo el flujo crítico; para sintaxis puntual, el agente consulta `changeledger help` o
`changeledger <command> --help` bajo demanda.

`init` exige el `AGENTS.md` raíz y appendea la referencia como **caja de alerta
GitHub** (`> [!IMPORTANT]`, marcador `<!-- changeledger -->`, idempotente) a cada
archivo de contrato presente que **no sea symlink** — `AGENTS.md` y `CLAUDE.md` —
de modo que cualquier agente (Claude, Codex, opencode, Copilot, Cursor…) lo
descubra sin tooling específico. `contract.mjs` concentra la lógica
(`linkContract`, `ensureReference`, `ensureGitignore`, `checkContract`);
`changeledger check` falla (error, no warning) si falta el raíz, si un contrato presente no
referencia, o si el link no resuelve — el discovery es condición para que la
herramienta funcione en el repo.
