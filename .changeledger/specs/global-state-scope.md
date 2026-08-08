---
title: Alcance y techo del estado global
updated: 2026-08-08T15:09:56Z
tags: [ global-state, scope, product ]
graduated_from: ["20260808-142200"]
---

# Alcance y techo del estado global

El problema observado: cuando el ledger vive en ficheros dentro de las ramas,
nadie ve todos los changes en su estado más actualizado, porque cada checkout
muestra solo lo que su rama conoce. Y en equipo, cada persona ve una foto
distinta. El estado global existe para eso y solo para eso.

Esta spec es el techo de la capacidad, no una descripción de su
implementación. Aplica el presupuesto de complejidad de
`product-principles.md` a una feature concreta porque sus dos primeras
construcciones (`codex/global-state-branch`, `codex/state-replica-v2`,
julio 2026) crecieron de una autorización en una autorización, sin panorama
contra el que medirlas: de 4 changes planificados a 43, con ~80% de las líneas
sirviendo a preguntas que nadie hizo. Todo trabajo sobre esta superficie se
mide contra esta spec antes de crearse.

## Lo que la capacidad incluye

1. **Una sola ref de verdad.** El ledger completo — manifest, config, changes,
   specs y releases — vive en una ref propia y fija, como árbol exclusivo, y
   se lee sea cual sea la rama del checkout. CLI y viewer leen del mismo
   resolver y el mismo snapshot: nunca dos verdades.
2. **Mutación local sobre git puro.** Lectura por snapshot sin checkout;
   escritura por compare-and-swap contra la revisión observada. Nada más que
   objetos y refs de git — la agnosticidad de proveedor no es una capacidad
   aparte: es consecuencia de no usar nada que no sea git.
3. **Integridad del lado del cliente, fail-closed.** Ninguna identidad —
   change, spec o release — presente en una foto puede desaparecer de su
   descendiente, validado antes de confirmar.
4. **Sincronización opcional, best-effort y gobernada por el contrato.** El
   transporte es `fetch`/`push` planos con compare-and-swap contra el remoto.
   No es automática por commit ni requisito de ninguna operación: sin remoto,
   o con el remoto caído, todo el flujo local funciona. Su cadencia es una
   obligación del contrato que el agente ejecuta en puntos estratégicos — al
   cargar el contexto de un change, tras commitear una selección resuelta, en
   los cierres de etapa —; ante conflicto notifica y la resolución se coordina
   con el humano, nunca se resuelve en silencio. La obsolescencia conocida se
   hace visible en el punto de lectura; lo inadmisible es una vista vieja
   presentada como actual.
5. **Adopción de un solo tiro más entrada incremental, por el mismo camino de
   código.** El cutover lee una fuente única y explícita: la rama de
   integración. `import --from <ref>`, explícito e idempotente, absorbe una
   ref por invocación — cubre igual las ramas en vuelo al momento de la
   migración (equipos con changes en ramas de desarrollo) y los documentos
   rezagados que lleguen después del corte. Un conflicto entre el import y la
   ref de estado se reporta y lo decide el humano. Undo disponible mientras el
   corte siga siendo reversible.
6. **Inactivo por defecto.** Un repositorio sin activación explícita se
   comporta idéntico a uno sin la capacidad; la activación es independiente
   del checkout y de los ficheros del working tree.

## Lo que la capacidad excluye

1. **Enforcement remoto.** Hooks server-side (`pre-receive`) y su validación
   asociada quedan fuera del alcance: fueron una de las fuentes principales de
   complejidad de los dos intentos abandonados (886 líneas solo para esa
   superficie en v2). Retomarlo exigiría un change propio con presupuesto
   propio, nunca una extensión de esta capacidad.
2. **Adaptadores por proveedor.** «Soportar GitHub» y equivalentes es
   documentación (cómo proteger la ref de estado con las herramientas del
   proveedor), nunca código específico por proveedor.
3. **Afirmaciones de confianza sobre servidores que no administras** y
   modelos de niveles de confianza como abstracción. Se declara lo que el
   cliente garantiza en todas partes, y nada más.
4. **Adopción desde fuentes múltiples** en una sola operación, y con ella la
   maquinaria de resolución de conflictos que se deriva de que dos fuentes
   discrepen sobre el mismo documento.
5. **Frescura automática implementada en código.** Sustituida por la
   sincronización por contrato del punto 4 de «incluye»: la cadencia es una
   obligación del agente, no un efecto lateral de red del CLI.
6. **Garantías de SLO.** El rendimiento se publica como medición reproducible
   con su tamaño de muestra, nunca como umbral prometido.

## Construcción por etapas

Cada etapa es utilizable y verificable por sí sola, se trocea en changes que
respetan el techo de complejidad del contrato y cierra con gate humano antes
de abrir la siguiente:

1. **Núcleo local** — ref fija, lectura por snapshot compartida por CLI y
   viewer, mutación CAS; sin red. Reutiliza el núcleo limpio de v2
   (`ledger-store`/`state-store`, lecturas por lotes de `git-batch`) y su
   catálogo de defectos conocidos como tests de día uno.
2. **Adopción** — cutover desde la rama de integración, `import --from <ref>`
   y activación independiente del checkout.
3. **Sincronización** — el transporte descrito en «incluye» más sus
   fragmentos de contrato: los puntos estratégicos de ejecución y el
   protocolo de notificación y coordinación de conflictos.

## Cómo se gobierna

Un hallazgo o una idea que no encaje en «lo que incluye» no amplía la
capacidad: se propone como change independiente y se decide con su propio
presupuesto. Un change que necesite crecer más allá del techo se detiene y
vuelve al humano en lugar de absorber el trabajo nuevo. Y un defecto se cierra
a nivel de clase — todos los sitios donde vive — o no se cierra: arreglarlo
solo donde se reprodujo deja el resto en pie y presenta como cerrado lo que
sigue abierto.

## Cuándo la capacidad se declara beta

1. Las tres etapas cerradas con sus gates humanos.
2. Los invariantes críticos aguantan bajo auditoría adversarial: continuidad
   de verdad entre fotos, activación independiente del checkout, obsolescencia
   conocida visible en la lectura, y flujo local íntegro sin remoto alcanzable.
3. La ruta de adopción ejercitada end-to-end en ambos formatos de objeto git
   (SHA-1 y SHA-256), incluida la entrada incremental de rezagados y el undo.
4. Ningún hallazgo de severidad media o superior abierto en la superficie que
   se publica.
5. El gate de calidad completo pasa y el rendimiento se publica como medición
   reproducible con su tamaño de muestra.
