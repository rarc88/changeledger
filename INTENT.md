# ChangeLedger — ¿Para qué sirve y cómo debe funcionar?

## Propósito

ChangeLedger es una herramienta que ayuda a coordinar el trabajo entre un humano y un agente de IA. Su objetivo principal es que ningún cambio de código ocurra sin antes haber sido pensado, documentado y aprobado por el humano. El documento es la fuente de verdad; el código es su consecuencia.

---

## El flujo esperado

### 1. Conversación primero

Todo parte de una conversación. El humano describe lo que quiere hacer, corregir o explorar. El agente escucha, pregunta y puede investigar en modo de solo lectura. Todavía no crea changes, modifica archivos ni produce artefactos de implementación.

La creación comienza únicamente cuando coinciden dos condiciones: hay claridad suficiente para escribir un borrador fiel y el **humano solicita explícitamente** que se documenten los cambios. Una petición directa como «crea el change» ya es autorización; si todavía falta información esencial, el agente aclara primero en lugar de inventar requisitos.

### 2. Creación del borrador

El agente crea uno o varios *changes* según lo que se haya conversado. Si la conversación mezcla temas distintos, el agente los separa en changes independientes — esa decisión es suya, pero debe ser transparente con el humano al hacerlo.

Los changes comienzan como borradores. No hay implementación todavía.

### 3. Aprobación humana

El humano aprueba de un borrador dos cosas y nada más: el **objetivo** —qué problema se resuelve y qué significa terminado— y la **frontera** —qué superficie entra, qué queda fuera y qué queda pre-autorizado dentro de ella—. Solo cuando un change está aprobado, el agente puede comenzar a trabajarlo. Sin aprobación, no hay código.

La Specification y el Plan no pasan por esa aprobación: se escriben ya en progreso, con el código delante, y reescribirlos mientras se implementa es el comportamiento esperado. Git versiona el documento; el humano aprobó el objetivo y la frontera, no un plan hecho antes de investigar.

### 4. Implementación

Antes de tocar código, el agente hace un commit con el documento aprobado. Así queda registrado que el trabajo comenzó desde un acuerdo, no desde una suposición.

El agente resuelve el trabajo por selecciones: un conjunto de tareas que se verifica y se commitea junto, sin esperar al resto. A medida que avanza, actualiza el documento: tareas completadas, decisiones tomadas, novedades del Log. Lo que encuentra fuera de la frontera no lo arregla de paso ni lo mete en el change: lo registra como hallazgo en el Log y sigue; el humano decide después si ese hallazgo se convierte en un change.

### 5. Revisión independiente (cuando la rama toca código)

Al terminar la implementación, si la rama del change toca algo fuera del ledger, una revisión por un subagente con contexto limpio —sin haber participado en la implementación— verifica que el comportamiento declarado se cumple. Un change que solo toca documentos del ledger se entrega sin revisión. No es el tipo del change lo que decide la revisión, sino lo que su rama cambia; el riesgo decide la profundidad de la revisión, nunca su existencia.

Si la revisión encuentra defectos, el change vuelve a en progreso con la razón. Un defecto que revela una dimensión que la estrategia no cubría se decide con el humano antes de corregir; a la tercera ronda sobre el mismo change, la elección entre reencuadrar y abrir trabajo nuevo vuelve al humano. Si todo está bien, el change queda entregado.

### 6. Aceptación por fusión

La aceptación humana es la fusión de la rama del change en la rama de integración. No hay una etapa aparte de validación: el humano revisa la entrega y la fusiona, o la devuelve a en progreso con la razón del rechazo. ChangeLedger registra el instante de la aceptación como dato, no como puerta.

### 7. Correcciones

Una corrección —venga del subagente revisor o del rechazo humano— es una selección resuelta más: se committea cuando pasa su verificación local y el change vuelve a revisión, donde un revisor fresco inspecta de nuevo todo lo entregado. El historial muestra el intento y su confirmación; no se mantiene trabajo aislado en el worktree esperando una confirmación.

### 8. Cierre y graduación

Entregado un change, si el trabajo modificó algo permanente, el agente actualiza la verdad persistente en las specs; si no, registra esa decisión. Los hijos de una épica no gradúan por separado: la épica reconcilia las specs una sola vez al cerrar.

Mientras un change no figure en una release registrada, puede volver a en progreso con una razón: la graduación y el archivo se deshacen por su propia documentación. La release es la única frontera irreversible, porque congela la membresía de una versión publicada. `discarded` es terminal desde el principio.

### 9. Trazabilidad como hábito

- Cada selección resuelta queda en un commit trazable junto a los archivos que modificó, con el marcador del change en el asunto. Una tarea sola rara vez es esa unidad; una transición de estado nunca lo es.
- No es obligatorio ser rígido, pero sí es obligatorio no mezclar cambios de distintos temas en el mismo commit.
- La referencia va siempre del change al código, nunca al revés: el código no cita changes ni criterios. Lo importante es que cualquier persona pueda seguir el hilo de cómo se resolvió un change leyendo el historial de git.

### 10. Retrospectiva al final de cada ciclo

Cuando un change se entrega, el agente hace un análisis breve: ¿hubo fricciones en el proceso? ¿Algo fue confuso, repetitivo o podría hacerse mejor? Las observaciones se comparten con el humano como propuestas; lo que queda fuera de la frontera ya está registrado como hallazgo.

Ninguna propuesta ni hallazgo se convierte en un change por cuenta propia. Solo si el humano lo autoriza.

---

## Reglas generales

- **Un change activo puede crecer** con trabajo que tiene que ser cierto para que su objetivo se cumpla. Lo que, sin hacerse, deja el objetivo cumplido igual, queda fuera: se registra como hallazgo o se propone como otro change. Cambiar el objetivo o la frontera vuelve al humano.
- **La release es la única frontera irreversible.** Antes de una release registrada, un change entregado puede volver a en progreso con razón; después, el trabajo nuevo es un change nuevo.
- **El humano decide en los momentos clave**: qué objetivo y qué frontera se aprueban, si un hallazgo se promueve a change y si una entrega se acepta fusionándola o se devuelve.
- **El agente decide en la ejecución dentro de la frontera autorizada**: cómo dividir el trabajo en selecciones, cuándo commitear y qué tamaño de subagente usar para la revisión.
- **Commit es confianza.** ChangeLedger no defiende contra quien ya puede escribir en el repositorio: esa defensa pertenece a la plataforma git y a sus protecciones de rama. Todo endurecimiento adversarial se mide contra este modelo de confianza antes de incorporarse.

---

## Estado global

Cuando el ledger vive en las ramas, cada checkout ve solo lo que su rama
conoce y en equipo cada persona ve una foto distinta. Espero poder ver todos
los changes en su estado más actualizado sin saltar de rama: el ledger
completo en una rama propia dedicada solo a eso. Debe funcionar igual sin
remoto — la sincronización es git puro, opcional, y cuando hay conflicto se
avisa y se decide, no se resuelve solo. Los límites duros de esta capacidad
viven en la spec `global-state-scope` (`.changeledger/specs/`).

---

## Filtros de evolución del producto

La complejidad del core es un presupuesto limitado. Una capacidad nueva debe
reducir la complejidad total o aportar una mejora real demostrada por el uso; si
no hace ninguna de las dos, no pertenece al core.

Antes de incorporarla hay que responder:

- ¿Resuelve un problema observado en proyectos reales?
- ¿Puede resolverse limpiamente fuera de ChangeLedger?
- ¿Simplifica el modelo mental lo suficiente para justificar conceptos nuevos?
- ¿Seguirá teniendo sentido aunque cambien los agentes y editores actuales?

ChangeLedger no es un orquestador de IA, un sistema de memoria ni una plataforma
de agentes autónomos. El core no introduce automatización oculta ni dependencias
obligatorias de nube, autenticación o proveedores. Esas capacidades pueden vivir
en integraciones opcionales, pero el flujo canónico permanece determinista,
local-first, explícito y agnóstico al agente.
