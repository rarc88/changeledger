---
id: "20260810-181805"
title: Graduar las lecciones de la espiral de confirmación al contrato
type: quick
status: draft
created: 2026-08-10T18:18:05Z
depends_on: []
related_to: ["20260809-194233"]
owner: rarc88
---

## Request

Retrospectiva de las 5 rondas de `20260809-194233` (2026-08-10): la regla
"una confirmación falla solo por el defecto nombrado o una regresión" ya
existía en `templates/contract/review.md` y aun así la espiral ocurrió — el
orquestador convirtió follow-ups en rondas nuevas porque quien decide en
caliente es quien recibe el hallazgo persuasivo. Dos graduaciones al
contrato, ambas verificables:

- **Cortacircuitos de rondas** en `review.md`: a la tercera ronda de
  corrección del mismo change, parar y devolver al humano la decisión de
  re-alcance vs. follow-up. Contable en el Log (entradas `[review] fail`).
  No cierra el camino de `blocked.md` ("the number of rounds does not close
  this path"): sube la decisión, no la niega.
- **Modelo de confianza explícito en INTENT.md**: commit = confianza —
  ChangeLedger no defiende contra quien ya puede escribir en el repositorio;
  esa defensa pertenece a la plataforma git. `review.md` lo referencia en
  una línea para que los probes adversariales de comitero-malicioso se
  clasifiquen contra él antes de convertirse en hallazgos.

Aplica la disciplina de tests de contrato de AGENTS.md: guardar la
obligación (concept guard tolerante a redacción), nunca su fraseo; respetar
los budgets de `templates/contract/budgets.yml`.

## Log
