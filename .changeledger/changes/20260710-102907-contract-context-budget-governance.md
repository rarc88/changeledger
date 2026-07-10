---
id: "20260710-102907"
title: Los presupuestos de contexto no tienen una fuente de verdad coherente
type: bug
status: draft
created: 2026-07-10T10:29:07Z
depends_on: []
---

## Request

La auditoría del contrato detectó riesgo de regresión por compactación: los
límites que aplican los tests no coinciden con los publicados como verdad
persistente y mezclan el objetivo de legibilidad con el límite de seguridad.
Hay que fijar una gobernanza única que permita al core conservar lo transversal
y que cargue los detalles dinámicos sólo en quien los necesita.

## Investigation

La fuente persistente `contract-discovery.md` declara estos presupuestos base:
core 120 líneas/8192 bytes, spec 285/11800, implement 170/7300, review 75/3200
y release 45/2200. `test/context.test.mjs` impone otros: core 130/8000,
spec 285/12000, implement 175/8000, review 75/4000 y release 45/3000. Los
overlays sí coinciden entre ambas fuentes. Por tanto ningún consumidor puede
saber cuál es el contrato real de tamaño.

El core actual ocupa 120 líneas y 6674 bytes: está por debajo de ambas variantes,
pero el test sólo protege un techo; no expresa la holgura deliberada ni distingue
un objetivo de lectura de un hard cap. Esto incentiva a recortar reglas para
pasar un límite en vez de decidir qué audiencia necesita cada regla.

Los nuevos capsules de `agent-context` ya demuestran el reparto correcto:
el orquestador conserva el core y los delegados reciben sólo política efectiva,
rol y change seleccionado; sus tests tienen un límite separado (<60 líneas,
<3000 bytes), pero no están inventariados en la spec. La corrección debe medir
composiciones base sin el change seleccionado y declarar de forma única tanto
objetivo como tope duro, incluyendo esos capsules, sin fijar cifras a ciegas
antes de medir los contextos efectivos y sus márgenes.

## Specification

## Plan

## Log
