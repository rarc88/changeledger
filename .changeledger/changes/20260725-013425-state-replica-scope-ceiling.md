---
id: "20260725-013425"
title: Fijar el techo de alcance de la réplica de estado
type: refactor
status: in-review
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
4. **Frescura automática.** La sincronización ocurre sin que el humano la pida, o
   la obsolescencia se hace visible en el punto de lectura. Hoy esto **no
   existe**: `sync` es manual y solo se reporta `ledger_freshness`. Es el
   requisito que el humano nombró explícitamente y el único del objetivo original
   que sigue sin construirse.
5. **Adopción de un solo tiro desde una fuente única y explícita**, más una ruta
   incremental para los changes rezagados que aterricen en la rama de integración
   después del corte.
6. **Hook `pre-receive` como extra opcional**, para quien administre su propio
   servidor git. Rechaza en la escritura lo que el cliente ya rechaza en la
   lectura: su valor es disponibilidad —evitar que el remoto se atasque—, no
   integridad. Nunca es puerta de release ni requisito de nivel de madurez.

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
   checkout, afinidad del viewer y procedencia de receipts.
2. No queda ningún hallazgo de severidad media o superior en la superficie que se
   publica.
3. La ruta de adopción se ejercita end-to-end en sha1 y sha256, incluida la
   entrada incremental de rezagados y el undo.
4. La frescura automática funciona.
5. `pnpm verify` verde y el perfil declarado dentro de la envolvente publicada.

El hook `pre-receive` no aparece en esta lista: es opcional por definición.

### Consecuencias sobre el trabajo pendiente

El recorte reordena los hallazgos abiertos de la cuarta ejecución. MIG-04 y
MIG-05 se cierran quitando la superficie que los produce. AUTH-12 sigue siendo un
fix real —el resolvedor de lecturas debe clasificar el tipo del objeto igual que
lo hace el de migración— y se aborda a nivel de clase para no repetir el error de
`20260724-212722`. RECEIPT-06, CHECK-01, ISOL-33 y DIAG-01 son menores acotados.
La frescura automática es trabajo nuevo dentro del techo. La cola de graduación se
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
