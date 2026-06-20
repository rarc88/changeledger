# Spec Ledger — ¿Para qué sirve y cómo debe funcionar?

## Propósito

Spec Ledger es una herramienta que ayuda a coordinar el trabajo entre un humano y un agente de IA. Su objetivo principal es que ningún cambio de código ocurra sin antes haber sido pensado, documentado y aprobado por el humano. El documento es la fuente de verdad; el código es su consecuencia.

---

## El flujo esperado

### 1. Conversación primero

Todo parte de una conversación. El humano describe lo que quiere hacer, corregir o explorar. El agente escucha, pregunta, investiga si hace falta. Nadie crea nada todavía.

Cuando la conversación llega a un punto donde hay claridad suficiente, el **humano solicita explícitamente** que se documenten los cambios. Esa solicitud es la única señal para comenzar.

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

En ambos casos el objetivo es el mismo: no ensuciar el historial con intentos fallidos que parecen avances reales.

### 8. Cierre y graduación

Un change cerrado nunca se reabre. Si el trabajo que representaba modificó algo permanente en cómo funciona el sistema, el agente actualiza los documentos de verdad persistente del repositorio. Si no cambió nada estructural, se registra esa decisión y se cierra igualmente.

### 9. Trazabilidad como hábito

- Cada tarea resuelta debería vivir en su propio commit, junto a los archivos que modificó.
- No es obligatorio ser rígido, pero sí es obligatorio no mezclar cambios de distintos temas en el mismo commit.
- Lo importante es que cualquier persona pueda seguir el hilo de cómo se resolvió un change leyendo el historial de git.

### 10. Retrospectiva al final de cada ciclo

Cuando un change se cierra, el agente hace un análisis breve: ¿hubo fricciones en el proceso? ¿Algo fue confuso, repetitivo o podría hacerse mejor? Las observaciones se comparten con el humano como propuestas.

Ninguna propuesta se convierte en un change por cuenta propia. Solo si el humano lo autoriza.

---

## Reglas generales

- **Un change activo puede crecer**, siempre que lo nuevo esté relacionado con su objetivo original.
- **Un change cerrado es terminal.** Lo que se quiera hacer después es un change nuevo.
- **El humano decide en los momentos clave**: qué se hace, si está bien hecho, y si el resultado final es aceptable.
- **El agente decide en la ejecución**: cómo dividir el trabajo, cuándo commitear, qué tamaño de subagente usar para la revisión.
