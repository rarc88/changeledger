---
id: "20261026-184128"
title: Hacer determinista el test de conflicto CAS de la CLI
type: change
status: in-review
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

### Proposal

La ventana de la carrera está en `mutateState` (`src/state-store.mjs`): el
proceso carga una `expectedRevision`, construye el árbol candidato, lo lee
entero y solo al final llama a `casUpdateStateRef`, que ejecuta
`git update-ref refs/heads/changeledger/state <nuevo> <expectedRevision>`. El
conflicto existe si y solo si la ref ya no vale `expectedRevision` en ese
instante. No hace falta que dos procesos se solapen: hace falta que el
perdedor llegue a su `update-ref` con una revisión que ya caducó.

Reproducción del defecto, antes de tocar nada: lanzando los dos procesos del
test en serie —el segundo arranca cuando el primero ya terminó— el test falla
con la firma exacta de CI, `[{"code":0,"stderr":""},{"code":0,"stderr":""}]` y
`2 !== 1`. Esto confirma que lo que el test deja al azar es justo la
precondición, no la aserción.

La solución elegida detiene al perdedor en su `update-ref` sin tocar `src/`.
`git` se invoca por nombre a través de `PATH` (`execFileSync('git', ...)` en
`defaultRun`, y `sanitizedEnv` conserva `PATH`), así que el test antepone un
directorio con un `git` propio que reenvía al real salvo cuando los argumentos
son el `update-ref` de la ref de estado: entonces, una sola vez, anuncia que
llegó y espera a que el test lo libere. La secuencia queda:

1. el perdedor arranca con el `git` instrumentado, carga la revisión y se
   detiene en la puerta del `update-ref`;
2. el test espera su señal, de modo que la revisión del perdedor ya está fijada;
3. el ganador escribe de principio a fin con el `git` normal y mueve la ref;
4. el test libera al perdedor, cuya `expectedRevision` es ahora, con certeza,
   la anterior.

El orden deja de depender del planificador: la carrera se provoca, no se
espera. Los papeles pasan a ser fijos, lo que además retira el `filter` sobre
dos resultados ambiguos.

Alternativas descartadas:

- **Barrera `ready/go` de arranque**, la de `#20260615-222620` en
  `test/cli.test.mjs`: sincroniza el inicio de los dos procesos, lo que
  estrecha la ventana pero no la cierra. Lo que debe ocurrir antes es la carga
  del estado del perdedor, no su arranque; seguiría siendo una apuesta sobre el
  planificador, que es el defecto que se corrige.
- **Costura de test en producción**, una pausa instrumentable entre carga y
  escritura en `mutateState`: determinista, pero mete un camino de código que
  solo existe para el test en el núcleo del CAS. La frontera la declara fuera.
- **Reescribir la aserción** para aceptar dos éxitos: pondría el CI en verde
  borrando la propiedad que el test existe para proteger.

### CR1 — El perdedor es rechazado con el mensaje accionable

- **Given** un repo activado por `activatedCliRepo`, con un proceso `log only-ref`
  detenido por la barrera justo antes de su `update-ref` sobre
  `refs/heads/changeledger/state`, sosteniendo ya la revisión que cargó
- **When** otro proceso `log only-ref` completa su escritura y mueve la ref, y solo
  entonces se libera la barrera
- **Then** el proceso detenido termina con código 1 y su stderr contiene
  `state changed since load — re-run the command`
- **And** su stderr no contiene `state ref moved`, la redacción interna del store
- **And** el proceso que escribió primero terminó con código 0

### CR2 — Ninguna escritura parcial sobrevive

- **Given** el escenario de CR1 ya ejecutado
- **When** se lee el estado con `show only-ref --json`
- **Then** aparece exactamente una de las dos notas, nunca las dos ni ninguna

### CR3 — La barrera falla ruidosamente si no se alcanza

- **Given** el mismo escenario
- **When** el proceso detenido no llega a la puerta del `update-ref` dentro del
  plazo del test
- **Then** el test falla nombrando esa causa, en lugar de continuar y medir un
  escenario que no es el suyo
- **And** la espera del ganador y la del perdedor tienen cada una su plazo, de modo
  que un cuelgue no se presenta como un fallo de aserción

## Plan

- [x] Reproducir el defecto con los dos procesos en serie y registrar su salida literal
  - **Support:** `node --test test/cli-bin.test.mjs`
  - **Resolved:** `2026-10-26T18:46:49Z`
- [x] Instalar el `git` instrumentado y reescribir el test con la barrera, con papeles fijos
  - **Target:** `test/cli-bin.test.mjs`
  - **Verify:** `node --test test/cli-bin.test.mjs`
  - **Criteria:** CR1, CR2, CR3
  - **Resolved:** `2026-10-26T18:49:07Z`
- [x] Comprobar que el test es discriminante: verde repetido con barrera, rojo sin ella
  - **Support:** `node --test test/cli-bin.test.mjs`
  - **Resolved:** `2026-10-26T18:49:08Z`
- [x] Pasar la puerta local completa
  - **Support:** `pnpm verify`
  - **Resolved:** `2026-10-26T18:53:09Z`

## Log
- **2026-10-26T18:41:28Z** `[version]` 1.0.0
- **2026-10-26T18:43:34Z** `[status]` draft → approved (human via conversation)
- **2026-10-26T18:43:59Z** `[status]` approved → in-progress
- **2026-10-26T18:43:59Z** `[branch]` set: change/20261026-184128 (auto)
- **2026-10-26T18:46:50Z** `[note]` Defecto reproducido antes de tocar nada: con los dos procesos en serie el test falla con la firma exacta de CI, [{"code":0,"stderr":""},{"code":0,"stderr":""}] y 2 !== 1. La precondicion de la carrera, no la asercion, es lo que estaba al azar.
- **2026-10-26T18:49:09Z** `[note]` Test discriminante comprobado en dos direcciones: sin la espera del shim el perdedor sale en 0 y la asercion lo atrapa con actual: 0, expected: 1; sin la senal de llegada el test falla por CR3 nombrando la causa, the second writer never reached the state ref update within 20000ms. Con la barrera completa, cinco de cinco en verde.
- **2026-10-26T18:53:10Z** `[status]` in-progress → in-review
