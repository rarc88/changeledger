---
title: Releases portables
updated: 2026-06-27T21:25:58Z
tags: [ releases ]
---

## Releases portables

`changeledger release init <version>` crea el baseline de adopción con todos los changes
que ya están `done`. A partir de ahí, `changeledger release plan [--json]` selecciona los
`done` ausentes del historial, resuelve el impacto desde
`release_impact` o `release.impacts.<type>` y calcula el siguiente SemVer por el
impacto máximo. Los changes con impacto `none` acompañan una entrega cuando otro
change exige bump; si todos son `none`, el plan es un no-op exitoso.

`changeledger release record <version>` recalcula bajo un lock global del historial y crea
atómicamente el manifiesto solo si la versión coincide. El CLI no conoce ni
modifica manifests de Node, Flutter, Rust u otras tecnologías, y tampoco crea
commits, tags, releases remotas, pushes o publicaciones. La salida JSON es el
contrato para que el agente aplique la versión y ejecute el delivery propio del
repositorio.

**Revisión de graduación.** Tras `done`, cada change se resuelve: gradúa a un spec
o se descarta (bug/chore sin verdad persistente). Ambos casos fijan `reviewed: true`
(`writer.setReviewed`). `changeledger graduate --pending` (`pendingGraduation`) lista los
`done` con `reviewed !== true`; `changeledger graduate <id> --skip [razón]` (`skipGraduation`,
solo en `done`) descarta dejando `graduation skipped` en el Log; `graduate()` a spec
también fija `reviewed`. "Graduado a spec" sigue siendo derivable de la marca
`graduado a spec` del Log — `reviewed` solo registra que la pregunta quedó zanjada.
`check` valida que `reviewed`, si está, sea booleano; no avisa de pendientes (es
bajo demanda).

`changeledger archive --graduated [--dry-run]` limpia el board de forma explícita y
conservadora: selecciona solo changes `done`, `reviewed: true`, no archivados, y
con resolución de graduación en `## Log` (`graduado a spec` o `graduation
skipped`). El dry-run lista los candidatos y total sin escribir. El archivado
masivo reutiliza el parser del repo y escribe `archived: true` más una entrada
`archived` en el Log; no toca estados activos, bloqueados, descartados, cambios
sin reviewed ni cambios ya archivados.

`graduate()` tiene dos rutas. Por defecto **crea** un spec nuevo (semilla desde
Specification/Proposal) y falla si ya existe. Con `--into` (`{ into: true }`)
**gradúa a un spec existente**: exige que exista (error simétrico si no), refresca
su `updated` (`writer.setSpecUpdated`) y deja el cuerpo al agente — no lo
sobrescribe. Ambas rutas comparten el registro en el change (marker + `reviewed`).
La sustitución es explícita (flag), nunca por auto-detección, para que un slug mal
tecleado no enlace por error.

Las mutaciones de frontmatter en `writer.mjs` preservan el formato textual del
documento, pero fallan explícitamente si no encuentran la línea ancla que deben
editar o usar para insertar (`status`, `depends_on`, `updated`). Así una orden
del CLI no puede aparentar éxito cuando el frontmatter está parcialmente roto.
Las escrituras que reemplazan documentos o estado local pasan por
`writeFileAtomic`: escriben a un temporal en el mismo directorio, sincronizan el
descriptor, hacen `rename` sobre el destino y limpian el temporal si algo falla.
Las creaciones que dependen de exclusividad, como `changeledger new`, conservan `flag:
'wx'` para no perder la reserva atomica del id.

Las mutaciones read-modify-write de un documento usan `mutateFileAtomic`: toman
un lock por archivo (`.<basename>.lock`), releen la versión actual bajo esa
sección crítica, aplican la transformación y escriben con `writeFileAtomic`.
Así dos comandos sobre el mismo change se serializan sin perder tareas ni Log,
mientras cambios distintos usan locks distintos y no comparten un bloqueo global.
El lock se borra en `finally`; si otro proceso encuentra un lock existente, espera
hasta un timeout y falla sin borrarlo, porque expirar un lock solo por edad puede
romper la exclusión si una mutación legítima tarda más de lo esperado.

El `## Log` es el **ledger del ciclo de vida**, ortogonal a las etapas de
contenido del tipo: registra cada transición de `status` con su timestamp y se
crea automáticamente al primer cambio de estado aunque el tipo no lo declare
(p.ej. `chore`). El `owner` se autoasigna al pasar a `in-progress` (cuando empieza
el trabajo) vía `ownerHandle`: username de GitHub (`gh api user --jq .login`), con
fallback a `git config user.name` si `gh` falta o no está autenticado; tolerante
(vacío si ninguno). No pisa un owner fijado a mano (`changeledger owner`).

Una entrada de `depends_on` con la forma `<proyecto>:<changeId>` es una
dependencia **cross-proyecto**: `check` no la valida localmente (apunta a otro
repo) ni la mete en el grafo de ciclos; el visor global la resuelve por id o
nombre de proyecto y navega a ese change.

El contrato separa intención y ejecución. Antes de crear un change permite
conversación e investigación de solo lectura, pero exige conjuntamente claridad
suficiente y autorización humana explícita; una petición directa de creación ya
autoriza, sin permitir que el agente invente requisitos faltantes. El humano
autoriza alcance, aprueba drafts y acepta resultados; el agente divide y ejecuta
el trabajo dentro de ese alcance.
