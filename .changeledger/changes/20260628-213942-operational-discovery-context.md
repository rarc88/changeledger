---
id: "20260628-213942"
title: Orientar el descubrimiento operativo desde el contexto inicial
type: feature
status: approved
created: 2026-06-28T21:39:42Z
depends_on: []
---

## Request

Durante una prueba con un agente externo, se le indicó que había tres changes
aprobados y que debía comenzar a resolverlos. Aunque ejecutó `changeledger
context`, tuvo que recurrir a grep/scripts para descubrirlos porque el contexto
inicial no le indicaba `changeledger list --status approved`. La misma fricción
existe al buscar trabajo aceptado pendiente de graduación, pese a que
`changeledger graduate --pending` ya resuelve esa consulta.

Algunos comandos son parte del camino feliz y deben ser visibles justo cuando
el agente decide qué hacer, sin obligarlo a conocer de antemano toda la ayuda del
CLI ni a inspeccionar `.changeledger/` manualmente.

## Investigation

`changeledger context` sin argumentos compone únicamente `templates/contract/core.md`.
Ese fragmento explica el lifecycle y los modos de contexto, pero no cómo
descubrir trabajo listo o deuda de cierre. `implement.md` contiene comandos de
mutación del change y `close.md` sí menciona `graduate --pending`, pero ambos
aparecen solo después de que el agente ya conoce un modo o change concreto.

El CLI ya proporciona consultas estructuradas y testeadas:

- `changeledger list --status approved` enumera trabajo autorizado y listo para
  iniciar;
- `changeledger graduate --pending` enumera changes `done` cuya decisión de
  graduación aún no se registró.

No hace falta crear otro comando, ejecutar consultas automáticamente ni cargar
listas dinámicas dentro del contexto. Eso mezclaría contrato estable con estado
efímero y aumentaría el contexto. La carencia es de orientación, no de capacidad.

## Proposal

Añadir a `templates/contract/core.md` una sección breve **Operational discovery**
que enseñe los dos comandos exactos y cuándo usarlos. Debe indicar que estas
consultas son el índice preferido antes de buscar archivos con grep/scripts.

La guía será estática, por lo que `changeledger context` seguirá siendo
determinista, no mutará el repositorio y no fingirá que conoce si existen
resultados. Los fragments especializados conservarán sus instrucciones: la
nueva sección es el mapa inicial, no una duplicación de toda la ayuda del CLI.

Se descarta añadir todos los filtros y estados al core: volvería a inflar el
bootstrap que acabamos de reducir. Los dos comandos elegidos corresponden a las
preguntas operativas observadas al iniciar y cerrar trabajo.

## Specification

### CR1 — el contexto inicial descubre trabajo aprobado
- **Given** un agente que acaba de entrar en un repo ChangeLedger
- **When** ejecuta `changeledger context` sin argumentos
- **Then** la salida incluye exactamente `changeledger list --status approved`
- **And** explica que sirve para encontrar changes aprobados listos para implementar

### CR2 — el contexto inicial descubre graduaciones pendientes
- **Given** trabajo humano ya aceptado que puede requerir cierre
- **When** el agente consulta `changeledger context` sin argumentos
- **Then** la salida incluye exactamente `changeledger graduate --pending`
- **And** explica que lista decisiones de graduación aún no resueltas

### CR3 — la orientación prioriza el CLI sin ejecutar acciones
- **Given** un repo con cero o más resultados para esas consultas
- **When** se construye el contexto core
- **Then** recomienda usar los comandos antes de escanear archivos manualmente
- **And** no ejecuta consultas, no incorpora estado dinámico y no modifica ningún archivo

### CR4 — el bootstrap conserva su presupuesto
- **Given** el nuevo bloque de descubrimiento operativo
- **When** se genera dos veces el contexto core del mismo repo
- **Then** ambas salidas son byte-idénticas
- **And** cada salida mantiene como máximo 120 líneas y 8192 bytes

## Plan

- [ ] Añadir pruebas del bloque, determinismo y no-mutación en `test/context.test.mjs`; implementar la guía mínima en `templates/contract/core.md`; verify: `node --test test/context.test.mjs` (CR1, CR2, CR3, CR4)
- [ ] Ejecutar el gate completo y comprobar el output real del binario; verify: `pnpm verify` y `node bin/changeledger.mjs context` (support)

## Log
- **2026-06-28T21:40:56Z** — status: draft → approved
