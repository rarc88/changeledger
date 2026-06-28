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

El humano revisa los borradores y los aprueba. Solo cuando un change está aprobado, el agente puede comenzar a trabajarlo. Sin aprobación, no hay código.

### 4. Implementación

El agente resuelve las tareas del change. A medida que avanza, actualiza el documento: tareas completadas, decisiones tomadas, novedades del Log.

Antes de tocar código, el agente hace un commit con la documentación aprobada. Así queda registrado que el trabajo comenzó desde un acuerdo, no desde una suposición.

### 5. Revisión independiente (cuando aplica)

Al terminar la implementación, algunos tipos de change requieren una revisión por un subagente con contexto limpio — sin haber participado en la implementación, para evitar sesgos.

Si la revisión detecta problemas:

- **Problemas simples que el agente puede resolver solo** → el change vuelve a en progreso. El agente corrige y repite el ciclo.
- **Problemas que requieren decisión humana** → el change queda bloqueado hasta que el humano dé instrucciones.

Si todo está bien, el change pasa a validación humana.

### 6. Validación humana

El humano prueba el resultado completo. Dos opciones:

- **Aprobado** → el change queda cerrado. Listo.
- **Rechazado** → el change vuelve a en progreso con los ajustes necesarios. El ciclo continúa.

### 7. Correcciones sin commit apresurado

Cuando se detecta un error — ya sea por el subagente revisor o por el humano en validación — la corrección **no se commitea hasta tener confirmación de que resuelve el problema**:

- Si el error lo encontró el **subagente**, la confirmación viene de una nueva revisión limpia que lo dé por cerrado.
- Si el error lo reportó el **humano**, la confirmación viene de su validación final.

Después de que la nueva revisión limpia aprueba una corrección, el agente commitea esa corrección y la actualización del ledger antes de solicitar validación humana. Tras un rechazo humano, la corrección permanece sin commit hasta la aceptación final, momento en que se commitea junto con su verdad relacionada.

En ambos casos el objetivo es el mismo: no ensuciar el historial con intentos fallidos que parecen avances reales ni mantener trabajo ya confirmado aislado innecesariamente en el worktree.

### 8. Cierre y graduación

Un change que llega a `done` nunca se reabre. Después de la aceptación humana, si el trabajo modificó algo permanente en cómo funciona el sistema, el agente actualiza los documentos de verdad persistente del repositorio. Si no cambió nada estructural, registra esa decisión. Un change `discarded` también es terminal, pero representa trabajo decidido en contra, no un ciclo completado.

### 9. Trazabilidad como hábito

- Cada unidad de trabajo resuelta debería quedar en un commit trazable junto a los archivos que modificó. Una tarea suele ser esa unidad, pero varias pueden compartir commit cuando separarlas rompería una modificación atómica.
- No es obligatorio ser rígido, pero sí es obligatorio no mezclar cambios de distintos temas en el mismo commit.
- Lo importante es que cualquier persona pueda seguir el hilo de cómo se resolvió un change leyendo el historial de git.

### 10. Retrospectiva al final de cada ciclo

Cuando un change llega a `done`, el agente hace un análisis breve: ¿hubo fricciones en el proceso? ¿Algo fue confuso, repetitivo o podría hacerse mejor? Las observaciones se comparten con el humano como propuestas.

Además, cuando entrega al humano un resultado completado o bloqueado, clasifica cualquier fricción ya descubierta para decidir si pertenece al trabajo actual, es un paso operacional, merece proponerse como trabajo independiente o todavía es demasiado vaga. Este triage no exige esperar al cierre del change.

Ninguna propuesta se convierte en un change por cuenta propia. Solo si el humano lo autoriza.

---

## Reglas generales

- **Un change activo puede crecer** con trabajo necesario para cumplir su objetivo autorizado. Si lo nuevo amplía materialmente el comportamiento observable, aunque esté relacionado, el humano debe autorizar la ampliación antes de incorporarla. Si es independiente, se propone otro change.
- **Un change cerrado es terminal.** Lo que se quiera hacer después es un change nuevo.
- **El humano decide en los momentos clave**: qué alcance se autoriza, si un borrador se aprueba, si una ampliación material se incorpora y si el resultado final es aceptable.
- **El agente decide en la ejecución dentro del alcance autorizado**: cómo dividir el trabajo, cuándo commitear y qué tamaño de subagente usar para la revisión.

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
