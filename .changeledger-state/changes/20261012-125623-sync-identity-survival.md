---
id: "20261012-125623"
title: Auditar la supervivencia de identidades en sync
type: audit
status: in-progress
created: 2026-10-12T12:56:23Z
depends_on: []
branch: audit/20261012-125623
related_to: ["20261002-133728", "20261002-161641", "20260808-142200"]
owner: rarc88
---

## Request

Varias revisiones de esta serie (`20261002-133728`, `20261002-161641`) señalaron
el mismo hueco: el fast-forward y la reconciliación de `changeledger sync` no
comprueban que las identidades presentes en la foto local (changes, specs,
releases, registros de consumo y entradas de colecciones desconocidas)
sobrevivan en la revisión que adoptan, mientras `global-state-scope` (incluye
#3) declara que ninguna identidad presente en una foto puede desaparecer de su
descendiente. `20261002-161641` cubrió sólo las entradas desconocidas en el
merge. Se pide auditar el hueco: dónde se pierde integridad, qué borrados son
legítimos y cuánto costaría cerrarlo, para decidir el alcance antes de crear el
change de corrección. Toca el techo de `global-state-scope`, así que el humano
decide el alcance.

## Investigation

Punto de partida, por verificar en la auditoría: `mutateState` en
`src/state-store.mjs` rechaza que desaparezca una identidad sin un
`stage.remove` explícito; `advanceStateRef` (fast-forward) y `commitMergedState`
(reconciliación, que desde `20261002-161641` comprueba por ruta las entradas
desconocidas de ambos padres) no comparan las identidades conocidas. Preguntas:
qué operaciones de la CLI borran identidades de forma legítima y cómo se ven en
una historia remota; si un fast-forward puede distinguir un borrado legítimo de
uno indebido sin datos nuevos; qué hace hoy `sync` ante cada caso, con
reproducciones; y el coste y el riesgo de cada opción frente al techo.

## Log
- **2026-10-12T12:56:23Z** `[version]` 0.18.0-dev
- **2026-10-12T12:58:48Z** `[status]` draft → approved (human via conversation)
- **2026-10-12T14:04:08Z** `[status]` approved → in-progress
- **2026-10-12T14:04:08Z** `[branch]` set: audit/20261012-125623 (auto)
