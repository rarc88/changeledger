---
id: "20261026-184128"
title: Hacer determinista el test de conflicto CAS de la CLI
type: change
status: in-progress
created: 2026-10-26T18:41:28Z
depends_on: []
branch: change/20261026-184128
related_to: ["20260808-151643", "20260615-222620", "20261026-165839"]
owner: raruiz-hiberuscom
---

## Request

### Investigation

El test `CR2: two concurrent CLI writes — exactly one succeeds, the loser gets
the actionable message`, en `test/cli-bin.test.mjs`, falló en CI en el job de
`node 24` con ambos procesos en código 0. El mismo commit pasó en el job de
`node 26`, y en local pasa 5 de 5. Se detectó desde `#20261026-165839`, cuyo
diff no toca ese fichero; el test nació en `#20260808-151643`, que es quien lo
posee.

La causa raíz está escrita en el propio comentario del test: *spawning both
together (no artificial delay) gives them every chance to overlap in practice*.
El test lanza los dos procesos con `Promise.all` y **da por supuesto que se
solapan**, pero nada los sincroniza. El conflicto de compare-and-swap solo
existe si el segundo proceso carga el estado antes de que el primero termine su
escritura. Si no llega a tiempo, no hay conflicto, los dos escriben en serie y
los dos salen en 0 — que es exactamente la firma observada,
`[{code:0},{code:0}]`. Dos escrituras secuenciales que ambas tienen éxito no son
un fallo del CAS: son su funcionamiento normal. En un runner cargado el
solapamiento no está garantizado, así que el test no mide lo que afirma medir.

Lo que el test afirma —exactamente uno gana, el perdedor recibe el mensaje
accionable, no hay escritura parcial— es una propiedad real del CAS y debe
seguir verificándose. El defecto no es la aserción, es que la precondición de la
carrera se deja al azar del planificador.

Hay precedente en el repo: `#20260615-222620` resolvió el mismo problema en el
test concurrente de `new` con una barrera `ready/go` en ficheros, que sigue viva
en `test/cli.test.mjs`. Allí los hijos son código en línea; aquí se lanza el
binario real, así que la técnica no se copia tal cual.

Queda por decidir, con el código delante, si basta con sincronizar el arranque
—que estrecha la ventana pero no la cierra— o si hace falta forzar el conflicto
de forma determinista. Esa decisión se documenta en la Specification.

### Objective

El test de conflicto CAS de la CLI deja de depender del planificador. Hoy afirma
una carrera que no provoca, así que falla de forma intermitente en CI y enseña a
relanzar sin mirar, que es justo lo contrario de lo que debe enseñar un test de
concurrencia.

Terminado significa: el test sigue probando las tres propiedades que ya prueba
—exactamente un ganador, el perdedor con el mensaje literal `state changed since
load — re-run the command` y sin `state ref moved`, y una sola de las dos notas
en el estado superviviente— y además su precondición, que las dos escrituras
compitan de verdad, está garantizada por el test y no por el azar. Un fallo suyo
vuelve a significar que algo está roto.

### Frontier

Dentro:

- `test/cli-bin.test.mjs`, el test `CR2: two concurrent CLI writes` y su
  comentario, que hoy documenta la suposición que se retira.
- Los helpers de test que ese test necesite, incluido reutilizar o extraer la
  barrera `ready/go` que ya vive en `test/cli.test.mjs`, si las dos convergen.

Fuera:

- El comportamiento del CAS en `src/`. Es correcto; lo que falla es la prueba.
- Los findings F3, F4 y F5 de `#20261026-165839`, sobre el scanner del test del
  visor: otra superficie y otro concern.
- Los demás tests del fichero.

Si la única forma de hacerlo determinista resulta ser abrir una costura de test
en el código de producción —una pausa instrumentable entre carga y escritura—
el trabajo se detiene y vuelve al humano: eso cambia la frontera y el coste, y
no se asume por iniciativa del agente.

## Specification

## Plan

## Log
- **2026-10-26T18:41:28Z** `[version]` 1.0.0
- **2026-10-26T18:43:34Z** `[status]` draft → approved (human via conversation)
- **2026-10-26T18:43:59Z** `[status]` approved → in-progress
- **2026-10-26T18:43:59Z** `[branch]` set: change/20261026-184128 (auto)
