---
id: "20260725-013425"
title: Fijar el techo de alcance de la réplica de estado
type: refactor
status: done
created: 2026-07-25T01:34:25Z
depends_on: []
owner: raruiz-hiberuscom
related_to: ["20260721-193106", "20260722-203029", "20260722-190137", "20260724-212722"]
release_impact: minor
---

## Request

La réplica de estado empezó como cuatro changes y terminó en 41, con 177 commits
sobre `dev` y un diff de +26.154/−591 líneas: una feature que añadió 26.000
líneas sin simplificar nada. Antes de esto, una rama se abandonó por pérdida de
control (`codex/global-state-branch`) y el trabajo se reinició en
`codex/state-replica-v2`.

El humano identificó la causa en conversación (2026-07-25): el objetivo original
era acotado —que todo lo de ChangeLedger viviera en una rama independiente para
ver el estado actualizado de todos los changes sin saltar de rama, con
sincronización lo más en tiempo real posible, agnóstica al proveedor y con capas
de seguridad que evitaran pisar o perder datos— y lo construido excede ese
objetivo por una razón concreta: **nunca existió un techo**. Cada hallazgo de
audit se autorizó de uno en uno, así que la feature creció de una autorización en
una autorización, y ningún change pudo evaluarse contra el panorama completo
porque el panorama nunca se escribió. Que 37 changes estén en `done` no acredita
lo contrario: `20260722-203029` y `20260722-190137` se reabrieron en la cuarta
ejecución del audit precisamente por eso, y el crítico MIG-04 es el mismo defecto
que `20260724-212722` dio por cerrado al arreglarlo en un solo sitio en vez de en
su clase.

Este change no cambia comportamiento: escribe el techo. Su entregable es que
`INTENT.md` declare la forma final de la réplica y sus no-goals, y que
`README.md` deje de afirmar sobre topologías alojadas lo que el producto no puede
sostener. Todo trabajo posterior sobre la réplica se evalúa contra este
documento; lo que quede fuera es otra feature, no una ampliación de esta.

## Proposal

El presupuesto de complejidad de `INTENT.md` existe pero nunca se aplicó a esta
feature. Aplicarlo ahora, con la evidencia de las cuatro ejecuciones del audit
`20260721-193106` delante, produce una separación nítida entre lo que sirve al
objetivo y lo que responde a preguntas que nadie hizo.

### Lo que entra

1. **Una sola ref de verdad.** El ledger vive en `refs/heads/changeledger/state`
   y se lee sea cual sea la rama del checkout. Es el objetivo original completo.
2. **Mutación local → publicada → confirmada, sobre git puro.** `push` y `fetch`
   y nada más. La agnosticidad de proveedor no es una capacidad aparte: es
   consecuencia de no usar nada que no sea git.
3. **Integridad del lado del cliente.** Continuidad de identidades —ningún
   change, spec ni release puede desaparecer— validada antes de confirmar, y
   anclada al baseline fijado por el commit de activación, de modo que también
   protege a un clon nuevo sin estado local previo. Fail-closed en toda ruta de
   lectura y escritura.
4. **Frescura automática, sin convertir el sync en requisito.** Local-first no es
   local-only (distinción aportada por el humano en la validación de este change,
   2026-07-25): ChangeLedger debe funcionar en local y la sincronización es un
   extra que opera cuando hay proveedor o servidor al que enviar. Cuando lo hay,
   ocurre sin que el humano la pida; cuando no lo hay o falla, el flujo local
   continúa sin bloquearse. Inadmisible es una vista vieja presentada como
   actual, así que la obsolescencia se hace visible en el punto de lectura, y la
   parte automática queda determinista y visible por los filtros de evolución.

   **Ninguna de las dos mitades existe hoy, y son trabajos distintos.** La
   sincronización es manual: solo se reporta `ledger_freshness`. Y el remoto es
   una dependencia dura, no un extra: `migrate --create` y `activate --prepare`
   exigen publicar contra un remoto, `mutateLedgerState` llama a
   `syncStateReplica` sin `try/catch` cuando no hay `--offline` y `stateRemote`
   lanza si no está configurado, y un pending sin resolver bloquea la mutación
   siguiente incluso en offline (`README.md` ya lo documenta). Cerrar solo la
   primera mitad dejaría la segunda en pie, que es lo que prohíbe la regla de
   techo.
5. **Adopción de un solo tiro desde una fuente única y explícita**, más una ruta
   incremental para los changes rezagados que aterricen en la rama de integración
   después del corte.
6. **Hook `pre-receive` como extra opcional**, para quien administre su propio
   servidor git. Es más estricto que el cliente, no su espejo: además de rechazar
   en la escritura lo que el cliente rechaza en la lectura, impone sobre la rama
   de integración tres comprobaciones de contenido que el cliente no hace
   —paths legacy protegidos (`legacyRoots`, solo en `state-validation.mjs`),
   autoridad byte-idéntica en todo el rango frente a los seis
   `AUTHORITY_IDENTITY_FIELDS` que compara el cliente, y `assertFastForward`
   sobre la ref de integración, sin equivalente en cliente—, y además rechaza
   por topes de recursos (`max_commits`, `max_object_bytes`, `timeout_ms`) que
   el cliente no aplica. Su valor es disponibilidad —evitar que el remoto se
   atasque—, no integridad. Nunca es puerta de release ni requisito de nivel de
   madurez.

### Lo que sale

1. **Adaptadores de enforcement por proveedor** (APIs de GitHub, GitLab,
   Bitbucket). Exigen autenticación, dependencia de nube y código específico por
   proveedor: los tres prohibidos en el core por los filtros de evolución de
   `INTENT.md`.
2. **Cualquier afirmación de confianza sobre topologías alojadas.** No se puede
   imponer política desde un servidor que no administras, y una comprobación
   hecha por quien empuja no es enforcement. El producto declara lo que el
   cliente garantiza en todas partes y no promete más.
3. **El modelo de capabilities como abstracción.** Existe para *describir*
   niveles de confianza por proveedor; sin afirmaciones sobre proveedores no hay
   nada que describir. Se sustituye por una declaración honesta. La validación y
   el hook se quedan: lo que se retira es la capa que habla de ellos, no la
   protección.
4. **Adopción desde fuentes múltiples**, y con ella la maquinaria de decisión de
   conflictos que se deriva de que dos fuentes discrepen sobre el mismo
   documento. El caso real es adoptar desde la rama de integración; los rezagados
   entran como mutación incremental, no como una segunda fuente. Los hallazgos
   MIG-04 (crítico) y MIG-05 (alto) mueren por construcción con este recorte, no
   por añadir guards.
5. **Garantías de SLO.** El rendimiento se publica como medición reproducible con
   su tamaño de muestra, nunca como umbral prometido. Las mediciones actuales son
   3-7 repeticiones en una máquina.

### Regla de techo

Un hallazgo o una idea que no encaje en «lo que entra» no amplía esta feature: se
propone como change independiente y se decide con su propio presupuesto. Un
change de esta feature que necesite crecer más allá del techo se detiene y vuelve
al humano en vez de absorber el trabajo nuevo. Un hallazgo de audit se cierra a
nivel de clase de defecto —todos los sitios donde vive— o no se cierra.

### Criterios de salida de beta

Beta se declara cuando, y solo cuando:

1. Los cuatro invariantes críticos aguantan bajo audit adversarial con harness de
   dientes demostrados: continuidad de verdad, autoridad independiente del
   checkout, procedencia de receipts, y la afinidad del viewer en sus dos mitades
   —que ninguna respuesta se aplique ni se atribuya al proyecto equivocado y que
   ninguna vista obsoleta se presente como actual—. Los bloqueantes históricos
   fueron ISOL-02 e ISOL-04, carreras de continuación tardía; ISOL-01 e ISOL-03,
   aislamiento entre proyectos, pasaron. Nombrar solo el aislamiento perdería la
   mitad que produjo los críticos.
2. No queda ningún hallazgo de severidad media o superior en la superficie que se
   publica.
3. La ruta de adopción se ejercita end-to-end en sha1 y sha256, incluida la
   entrada incremental de rezagados y el undo.
4. La frescura automática funciona **y** la ausencia o el fallo del remoto no
   bloquea el flujo local: las dos mitades del punto 4, no una.
5. `pnpm verify` verde y el perfil declarado dentro de la envolvente publicada,
   medida con su tamaño de muestra.

El hook `pre-receive` no aparece en esta lista: es opcional por definición.

### Consecuencias sobre el trabajo pendiente

El recorte reordena los hallazgos abiertos de la cuarta ejecución. MIG-04 y
MIG-05 se cierran quitando la superficie que los produce. AUTH-12 sigue siendo un
fix real —el resolvedor de lecturas debe clasificar el tipo del objeto igual que
lo hace el de migración— y se aborda a nivel de clase para no repetir el error de
`20260724-212722`. RECEIPT-06, CHECK-01, ISOL-33 y DIAG-01 son menores acotados.
El punto 4 aporta **dos** trabajos nuevos dentro del techo, no uno: la frescura
automática, y hacer del remoto un extra en vez de una dependencia dura. Van como
changes separados y ninguno cierra al otro. La cola de graduación se
resuelve **después** del recorte: graduar ahora un change que documenta superficie
que se va a borrar consagraría como verdad persistente algo que estamos a punto de
retirar.

## Plan

- [x] Añadir a `INTENT.md` la sección de alcance de la réplica de estado con «lo que entra», «lo que sale», la regla de techo y los criterios de salida de beta, sin tocar los filtros de evolución existentes; verify: `node bin/changeledger.mjs check`
  - **Resolved:** `2026-07-25T01:44:55Z`
- [x] Sustituir en `README.md` la tabla de capabilities por topología y toda afirmación de enforcement sobre proveedores alojados por la declaración honesta de qué garantiza el cliente en todas partes y qué añade opcionalmente un servidor propio; verify: `node bin/changeledger.mjs check`
  - **Resolved:** `2026-07-25T01:47:30Z`
- [x] Registrar en el Log la lista de changes que el techo autoriza a continuación, uno por hallazgo o capacidad, para que cada uno se cree contra este documento y no de forma aislada (support)
  - **Resolved:** `2026-07-25T01:49:12Z`

## Log

- **2026-07-25T01:34:25Z** `[note]` Draft creado a partir de la conversación del 2026-07-25 sobre el coste de la feature (41 changes, 177 commits, +26.154/−591) y la revisión del objetivo original con el humano. Frontera: este change no cambia comportamiento ni borra código; solo fija el techo que gobierna el trabajo posterior. Los recortes que declara se implementan en changes propios.
- **2026-07-25T01:42:34Z** `[status]` draft → approved
- **2026-07-25T01:42:57Z** `[status]` approved → in-progress
- **2026-07-25T01:42:57Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-25T01:49:12Z** `[note]` Techo aplicado. Changes que autoriza a continuación, en orden de dependencia; cada uno se crea contra este documento y ninguno se amplía sin volver al humano. (1) Recorte de la adopción a fuente única con OID de commit explícito: retira observeSource remoto, fetchRef, los ficheros de plan multi-fuente y la maquinaria de decisión de conflictos (groupCandidates, validateManifestDecisions, chosenContent); cierra MIG-04 critico y MIG-05 alto por construcción. Va primero porque todo lo demás se asienta sobre la superficie que quede. (2) Clasificación de tipo de objeto a nivel de clase sobre lo que sobreviva al recorte: activationCommitOid en ledger-store no aserta nada y sirve un repo cuya autoridad se lee de un tree (AUTH-12); se barren todos los resolvedores de autoridad y baseline en la misma pasada, no solo el sitio donde el audit lo reprodujo. (3) Retirada del modelo de capabilities en código, para que la implementación deje de emitir lo que README e INTENT ya no afirman. (4) state import --from <ref>: entrada incremental de los documentos rezagados que aterricen en la rama de integración después del corte, reusando la mutación existente. (5) Frescura automática: el único requisito del objetivo original que sigue sin construirse. (6) Menores acotados: RECEIPT-06 reabriendo 20260722-203029 (state status --json y sync --json no existen, su CR1 está incumplido), ISOL-33 reabriendo 20260722-190137 (/api/git pierde la atribución del 400 por orden de sentencias), CHECK-01 y DIAG-01 como drafts nuevos. El draft 20260724-234148 queda fuera de esta capacidad: es contrato de salida JSON de list y search, con su propio alcance. La cola de graduación se resuelve después de (1), (2) y (3).
- **2026-07-25T01:50:47Z** `[note]` Gate completo verde tras las dos ediciones: 1.148/1.148 tests, Biome limpio y 245 changes válidos. Ajuste deliberado dentro del alcance: además de la tabla de capabilities y las afirmaciones sobre hosted, se calificó la envolvente de presupuestos del README con su tamaño de muestra (tres repeticiones por celda en una máquina) porque dejarla como afirmación sin cualificar contradecía en el mismo change el punto 5 de 'lo que sale' que este documento acaba de escribir en INTENT.md. No se tocó código.
- **2026-07-25T01:50:47Z** `[status]` in-progress → in-review
- **2026-07-25T01:59:57Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-25T02:09:07Z** `[validation]` in-validation → in-progress (human rejected via conversation): El humano corrige dos cosas (2026-07-25): el README debe describir la salida real de hoy en lugar de omitir provider y capabilities, y el punto 4 del techo debe distinguir local-first de local-only. ChangeLedger funciona localmente; el sync es un extra que opera cuando hay proveedor o servidor al que enviar, y su ausencia o su fallo nunca bloquea el flujo local. La tensión con los filtros de evolución no era la automatizacion sino esa confusion.
- **2026-07-25T02:11:26Z** `[note]` Corrección del rechazo humano. INTENT punto 4 reescrito con la distinción que aportó el humano: local-first no es local-only. El sync es un extra que opera cuando hay proveedor o servidor al que enviar; cuando no lo hay o falla, el flujo local continúa sin bloquearse. Lo inadmisible no es la automatización sino una vista vieja presentada como actual, así que la obsolescencia se hace visible en el punto de lectura y la parte automática queda determinista y visible —qué se sincronizó y cuándo—, nunca una llamada de red silenciosa. Eso cierra la tensión que el revisor señaló contra los filtros de evolución, que no era sobre automatización sino sobre esa confusión. README: la lista de receipts vuelve a describir la salida real de hoy (el validador que corrió y el bloque que nombra las comprobaciones realizadas) en lugar de omitirlos, con la aclaración de que esos nombres reportan lo inspeccionado en esa ejecución y no son una calificación de confianza de ningún proveedor de hosting. Gate verde: 1.148/1.148, Biome limpio, 245 changes válidos. Sigue sin tocarse código. Por la regla 7 de INTENT, la corrección de un error reportado por el humano permanece sin commit hasta su aceptación final.
- **2026-07-25T02:11:26Z** `[status]` in-progress → in-review
- **2026-07-25T02:20:27Z** `[review]` in-review → in-progress (retry): Cinco hallazgos, dos bloqueantes verificados contra el código. F1: el punto 4 de INTENT afirma en indicativo presente que el sync es un extra no bloqueante, pero hoy el remoto es obligatorio para adoptar y activar la réplica y una mutación sin remoto alcanzable falla (syncStateReplica sin try/catch en ledger-store 835-841, stateRemote required lanza), y el pending bloquea la siguiente mutación incluso con --offline; el propio README lo documenta en 150-153. Además el Log declara la frescura automática como el único requisito sin construir, lo que ahora es falso y dejaría el remoto obligatorio en pie tras el follow-up, violando la regla de cierre por clase que este mismo techo escribe. F2: la frase corregida del README describe el bloque como los checks realizados, pero validate-update lo construye con stateCapabilities() sin evidencia y las cuatro entradas salen unknown/unavailable, y en validate-receive los valores son niveles de confianza graduados, exactamente el modelo que el techo excluye. F3: la tarea 1 del Plan se marcó resuelta declarando los criterios de salida de beta en INTENT y no están. F4: el Proposal conserva la redacción previa a la corrección mientras INTENT dice algo materialmente distinto. F5: el criterio 4 de beta no cubre lo que el punto 4 añadió.
- **2026-07-25T02:21:59Z** `[note]` Corrección del retry, cinco hallazgos cerrados. F1: el punto 4 de INTENT pasa a voz de requisito y añade el marcador de honestidad que faltaba, declarando que NINGUNA de sus dos mitades existe hoy y que son trabajos distintos: la sincronización es manual, y el remoto es una dependencia dura (migrate --create y activate --prepare exigen publicar, mutateLedgerState llama a syncStateReplica sin try/catch fuera de --offline y stateRemote lanza si falta, y un pending sin resolver bloquea la mutación siguiente incluso en offline). Corregida la afirmación falsa del note anterior: la frescura automática NO es el único requisito sin construir; hacer del remoto un extra es trabajo separado y va como change propio, con lo que la lista de follow-up pasa de seis a siete y ninguno cierra al otro. F3: los criterios de salida de beta ya estaban prometidos por la tarea 1 y no estaban en INTENT; ahora viven allí como sección propia. F5: el criterio 4 exige explícitamente las dos mitades del punto 4, así que beta no puede declararse con el remoto obligatorio en pie. F2: la frase del README describe la salida real —provider con sus dos valores de topología y el bloque capabilities de cuatro entradas— y declara el bloque deprecado, con el hecho concreto de que un validate-update exitoso reporta content_validation unavailable porque se construye sin evidencia; queda dicho que lo que una validación prueba está en el resto del receipt. F4: el Proposal del change recoge la redacción entregada en lugar de la previa a la corrección. Gate verde: 1.148/1.148, Biome limpio, 245 changes válidos. Cero código. Sigue sin commitear por la regla 7 de INTENT.
- **2026-07-25T02:21:59Z** `[status]` in-progress → in-review
- **2026-07-25T02:31:00Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-25T02:31:17Z** `[note]` Tercera revisión limpia: pass. Los cinco hallazgos del retry verificados cerrados contra el código y por ejecución real de los comandos (fixture v2 en scratch, push real contra el hook, ambos formatos de salida en éxito y fallo). Tres hallazgos bajos abiertos, ninguno bloqueante, y se documenta aquí su disposición porque dos son de la misma clase que este change existe para cerrar. (a) La nota de deprecación del README solo nombra validate-update y validate-receive, pero state doctor emite el mismo bloque de cuatro entradas e imprime una línea Capability por cada una, siempre unknown/unavailable al no haber superficie CLI para adapter-evidence: retracción incompleta. Se cierra en el follow-up (3), que borra el bloque entero incluido doctor; queda anotado aquí para que no se pierda. (b) El criterio 1 de beta en INTENT renombra el tercer invariante como aislamiento entre proyectos, cuando el audit lo definió como afinidad del viewer: ISOL-01 pasó como aislamiento y los bloqueantes fueron ISOL-02 e ISOL-04, ambos carreras de afinidad de continuación, así que la redacción nombra la mitad que nunca falló y omite la que produjo el crítico. Es redacción del techo y por tanto decisión del humano, no la cambio por cuenta propia. (c) La enumeración ordenada de follow-up del note de 01:49:12Z quedó superada sin reemitirse. Se reemite completa aquí, en orden de dependencia: (1) recorte de la adopción a fuente única, cierra MIG-04 y MIG-05 por construcción; (2) clasificación de tipo de objeto a nivel de clase sobre lo que sobreviva, incluye AUTH-12; (3) retirada del modelo de capabilities en código, incluida la salida de state doctor; (4) state import --from para la entrada incremental de rezagados; (5) frescura automática; (6) el remoto como extra en vez de dependencia dura, trabajo separado de (5) y ninguno cierra al otro; (7) menores: RECEIPT-06 reabriendo 20260722-203029, ISOL-33 reabriendo 20260722-190137, CHECK-01 y DIAG-01 como drafts nuevos.
- **2026-07-25T02:33:23Z** `[validation]` in-validation → in-progress (agent rejected): El humano pregunta si todos los hallazgos quedaron arreglados y la respuesta es no. Tres siguen abiertos y dos de las decisiones que los dejaron abiertos no se sostienen: el renombrado del invariante en el criterio 1 de beta no es redacción de producto sino un nombre que el audit ya definió y yo corrompí, y diferir al follow-up la retracción incompleta del README deja el documento de hoy inexacto sobre state doctor. Se suma el hallazgo de la primera ronda que nunca se tocó: el punto 6 afirma que el hook rechaza en escritura lo que el cliente rechaza en lectura, pero legacyRoots solo existe en state-validation, sin equivalente en cliente, así que el hook hace una comprobación más.
- **2026-07-25T02:35:33Z** `[note]` Cerrados los tres hallazgos que quedaban abiertos, incluido el de la primera ronda que nunca se tocó. (a) La nota de deprecación del README nombra también state doctor y sus líneas Capability, y aclara que tanto validate-update como doctor construyen el bloque sin evidencia: la retracción deja de ser parcial en lugar de esperar al follow-up (3). (b) El criterio 1 de beta deja de renombrar el invariante: en vez de aislamiento entre proyectos exige que ninguna respuesta se aplique ni se atribuya al proyecto equivocado y que ninguna vista obsoleta se presente como actual, con la nota de que los bloqueantes históricos fueron carreras de continuación tardía y no fugas entre proyectos, que es la mitad que la redacción anterior perdía. Diferirlo a decisión humana fue un error mío: el audit ya había definido ese invariante y renombrarlo mal es corromper una definición existente, no ejercer criterio de producto. (c) El punto 6 deja de afirmar duplicación pura: el hook rechaza lo que el cliente rechaza más una comprobación de higiene que el cliente no hace, la reintroducción de ficheros legacy en la rama de integración, verificado porque legacyRoots solo existe en state-validation sin equivalente en cliente. Gate verde: 1.148/1.148, Biome limpio, 245 changes válidos. Cero código. Sin commitear por la regla 7.
- **2026-07-25T02:35:33Z** `[status]` in-progress → in-review
- **2026-07-25T02:46:48Z** `[review]` in-review → in-progress (retry): F1 bloqueante: el Proposal punto 6 del propio change sigue afirmando la duplicación pura que INTENT corrigió esta misma vuelta, contradiciendo su propio Log cien líneas más abajo. Es la forma idéntica del F4 de la ronda 2, ya aceptado entonces como motivo de retry en este change: reincidencia, no despiste. F2: 'una comprobación de higiene' subcuenta; el hook hace tres que el cliente no hace sobre la rama de integración —paths legacy protegidos, autoridad byte-idéntica en todo el rango frente a los seis campos de identidad que compara el cliente, y fast-forward— verificado en state-validation 540 y 554-563 contra AUTHORITY_IDENTITY_FIELDS en ledger-store 41-48. F3: el criterio 1 de beta divergió entre el change y INTENT. F4: línea de 108 caracteres en README 327.
- **2026-07-25T02:50:00Z** `[note]` Corrección del cuarto retry, cuatro hallazgos cerrados. F1: el Proposal punto 6 ya recoge lo entregado. Este fallo fue reincidencia, no descuido: el F4 de la ronda 2 era exactamente la misma forma —Proposal desalineado con lo entregado— y yo mismo lo acepté entonces como motivo de retry. La lección operativa queda anotada aquí: al corregir texto de INTENT o README hay que actualizar en el mismo movimiento la sección del change que lo enuncia, porque el documento del change es el enunciado autorizado y no un resumen. F2: 'una comprobación de higiene' subcontaba. Verificado que el hook impone sobre la rama de integración tres cosas que el cliente no comprueba: paths legacy protegidos (legacyRoots existe solo en state-validation), autoridad byte-idéntica en todo el rango frente a los seis AUTHORITY_IDENTITY_FIELDS que compara assertWorktreeMatchesActivation —así que un cambio cosmético en authority.yml lo rechaza el hook y lo acepta el cliente— y assertFastForward sobre la ref de integración, sin equivalente en cliente. El punto 6 pasa de afirmar espejo a afirmar que el hook es más estricto, lo que además es la dirección honesta del error. F3: el criterio 1 de beta del change recoge la definición conductual entregada en INTENT y nombra las filas históricas: los bloqueantes fueron ISOL-02 e ISOL-04, carreras de continuación tardía, mientras ISOL-01 e ISOL-03 de aislamiento pasaron. F4: reajustada la línea larga del README y reenvuelto el punto 6 de INTENT a 80 columnas. Gate verde: 1.148/1.148, Biome limpio, 245 changes válidos. Cero código. Sin commitear por la regla 7.
- **2026-07-25T02:50:00Z** `[status]` in-progress → in-review
- **2026-07-25T03:01:35Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-25T03:07:40Z** `[note]` Cerrados los dos nits bajos de la quinta revisión DESPUÉS de haberla registrado como pass, de modo que estas dos ediciones no pasaron por revisor y quedan declaradas aquí para que el humano las juzgue en validación. Delta semántico: una cláusula en el punto 6 —el hook además rechaza por topes de recursos que el cliente no aplica— porque 'tres' se leía como exhaustivo cuando max_commits, max_object_bytes y timeout_ms también hacen rechazar pushes que el cliente acepta. El resto es reflujo tipográfico a 80 columnas de las líneas añadidas en INTENT y README, sin cambio de contenido. Incidente propio en el proceso: mi primer script de reenvuelto fusionó las listas numeradas de la sección de INTENT en párrafos corridos, rompiendo la estructura markdown; lo detecté al inspeccionar el resultado y reconstruí la sección entera a mano verificando que ninguna línea pasa de 80 y que los filtros de evolución preexistentes siguen intactos. Gate verde tras la reconstrucción: 1.148/1.148, Biome limpio, 245 changes válidos. Sigue sin commitear por la regla 7.
- **2026-07-25T10:20:05Z** `[validation]` in-validation → in-progress (agent rejected): Las dos ediciones que cerraron los nits de la quinta revisión se hicieron después de registrar el pass, así que el contenido en validación no es el que se revisó. Además la reconstrucción a mano de la sección de INTENT tras romperla con un script de reenvuelto reescribió unas cien líneas: un diff que ningún revisor ha verificado y donde una frase puede haberse perdido o alterado sin que el gate lo note. Se devuelve a revisión con mandato acotado al delta en lugar de dejar la comprobación en manos del humano.
- **2026-07-25T10:20:05Z** `[status]` in-progress → in-review
- **2026-07-25T10:25:43Z** `[review]` in-review → in-validation (delegated subagent, clean context)
- **2026-07-25T10:25:44Z** `[note]` Revisión de delta acotada: pass sin hallazgos. Verificado con word-diff token a token que la reconstrucción manual de las cien líneas de INTENT fue fiel: la cláusula del clon nuevo del punto 3, el marcador de honestidad del punto 4 con sus tres hechos, la sección de gobierno, los cinco excluidos y los cinco criterios de beta sobrevivieron sin pérdida ni cambio de sentido; la estructura markdown queda intacta con el párrafo anidado del punto 4 correctamente indentado; las líneas 1-125 de INTENT, que cubren los filtros de evolución, son byte-idénticas a HEAD; el reflujo del README no perdió prosa (solo se reubicó una conjunción por gramática de lista); e INTENT y el Proposal concuerdan en el punto 6. La cláusula nueva verificada cierta contra state-validation (max_commits en 165, max_object_bytes en 186, timeout en 77 y 100) y contra ledger-store, que no importa state-validation ni referencia ningún tope. Nota de precisión que el revisor deja como informativa y no como defecto: 'el cliente' en esta sección designa la ruta automática de lectura y escritura, no el comando explícito state validate-update, que sí aplica esos topes y esas comprobaciones por compartir validationContext; la ambigüedad afecta igual a la tríada ya revisada en rondas anteriores, así que estrecharla exigiría reabrir texto ya aprobado y queda anotada aquí en lugar de corregirse. Coste del mandato acotado a delta: 78k tokens frente a 125-140k de los mandatos anchos anteriores.
- **2026-07-25T10:28:42Z** `[validation]` in-validation → done (human accepted)
