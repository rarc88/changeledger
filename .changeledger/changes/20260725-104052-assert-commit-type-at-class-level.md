---
id: "20260725-104052"
title: Clasificar el tipo de objeto en todo resolvedor de autoridad y baseline
type: bug
status: in-review
created: 2026-07-25T10:40:52Z
depends_on: []
owner: raruiz-hiberuscom
related_to: ["20260721-193106", "20260724-212722", "20260723-235910", "20260725-013425"]
release_impact: patch
---

## Request

La cuarta ejecución del audit `20260721-193106` reprodujo tres fallos con una
sola causa raíz: **el tipo de objeto se «verifica» pelando en vez de asertando.**

- **MIG-04, crítico.** Un tag anotado apuntado a mano como ref pública de estado
  en un remoto se convierte en el `baseline` del estado y llega committeado a
  `.changeledger/authority.yml`, en sha1 y en sha256. Reproducido end-to-end por
  API pública.
- **MIG-05, alto.** El mismo tag anotado nombrado como fuente de migración
  produce un OID y un `inventory_digest` distintos según se pida por
  `local:<ref>` o por `origin:<ref>`. No requiere corrupción alguna: basta un tag
  de release ordinario. Rompe el determinismo que `state migrate --preview`
  promete.
- **AUTH-12, medio, pre-existente.** Un tree escrito en `refs/changeledger/activation`
  se sirve como repo sano: `list` y `state status` responden con normalidad y
  `exportStateRecovery` materializa una rama de recovery desde una autoridad
  leída de un objeto que no es commit. `install` y `deactivate` sí rechazan, así
  que los resolvedores discrepan entre sí.

`20260724-212722` cerró este mismo defecto **en un solo sitio** —el tip fetched de
la réplica en `syncStateReplica` y `abortStatePending`— y lo dio por resuelto. El
crítico de hoy es la factura de ese cierre parcial. El techo de alcance
`20260725-013425` escribió la regla que lo prohíbe: un defecto se cierra a nivel
de clase, en todos los sitios donde vive, o no se cierra. Este change la aplica.

## Investigation

El defecto no es un olvido puntual: son dos semánticas distintas colapsadas en
una sola herramienta. `exactCommit` (`src/state-migration.mjs:121-125`) valida con
`rev-parse --verify <ref>^{commit}`, que **pela** tags anotados, y devuelve el
commit pelado. Tres llamadores **descartan** ese valor y conservan el OID crudo:

| Sitio | Qué conserva | Consecuencia |
| --- | --- | --- |
| `observeSource`, rama remota (`src/state-migration.mjs:165` y `:172`) | el OID de `ls-remote`, sin pelar | MIG-05: la rama local en `:153` sí usa el valor pelado, así que las dos rutas discrepan |
| `fetchRef` (`src/state-migration.mjs:957`) | `return oid` | MIG-04: `createStateBaseline:996-1002` adopta ese OID como `baseline` |
| `readStateMetadata` (`src/state-migration.mjs:1143`) | `revision`, y `ls-tree` vuelve a pelar | por eso la escalada a `authority.yml` no se caza |

Los llamadores que sí conservan el valor pelado son `:153`, `:1321`, `:1404`,
`:1494`, `:1685`, `:1792` y `:1926`.

Un cuarto sitio no usa `exactCommit` en absoluto:
`activationCommitOid` (`src/ledger-store.mjs:258-260`) devuelve `optionalRefOid`
sin peel y sin comprobación de tipo. `activationAuthority:265-268` lee después
`cat-file blob <oid>:.changeledger/authority.yml`, que resuelve para un **tree** y
falla para un **blob**: los blobs se salvan por accidente de la fontanería, no por
guard. El resolvedor equivalente de la ruta de migración,
`resolveActivationCommitOrNull` (`src/state-migration.mjs:1737-1762`), sí aserta con
`state activation ref refs/changeledger/activation must point to a commit`. Los dos
resolvedores de autoridad discrepan, y el comentario de `assertCommitTip`
(`src/state-store.mjs:164`) afirma paridad con una clasificación que el resolvedor
de lecturas no tiene.

**La distinción que faltaba.** Hay dos situaciones y exigen respuestas opuestas:

1. **Una ref que nombra un humano** (`--source local:refs/tags/v1`). Pelar es lo
   que un usuario de git espera: pedir el ledger tal como estaba en un release es
   intención legítima. El requisito real es que **las dos rutas pelen igual**.
2. **Una ref que el sistema lee como su propia verdad** (la ref pública de
   estado, un baseline, la activation ref). Aquí un objeto que no es commit es
   estado inválido, nunca verdad adoptable — la clasificación que
   `20260724-212722` ya aplicó al tip de la réplica y que `20260723-235910` aplicó
   a la activation ref en la ruta de migración.

El defecto fue conflar las dos. Este change las separa y aplica cada una en todos
sus sitios.

## Specification

### CR1 — Una fuente de migración que nombra un tag anotado registra su commit, por las dos rutas

- **Given** un repo legacy con un remoto configurado y un tag anotado `refs/tags/v1`
  sobre el commit `C` de la rama de integración
- **When** se ejecuta `previewStateMigration` con `sources: ['local:refs/tags/v1']`
  y, por separado, con `sources: ['origin:refs/tags/v1']`
- **Then** ambos planes registran `sources[0].commit === C` (el commit, no el OID
  del tag) y cada `documents[].candidates[].commit` vale también `C`
- **And** los dos planes son idénticos salvo en los campos que nombran la fuente
  —`sources[].name`, `sources[].kind`, `sources[].remote` y el `source` de cada
  candidato— y en el `inventory_digest`, que los cubre

  **Corrección de este criterio durante la implementación (2026-07-25):** su
  primera redacción exigía además el mismo `inventory_digest` por las dos rutas.
  Es imposible y no debe cumplirse: el digest cubre `sources` verbatim
  (`migrationInventory`, `src/state-migration.mjs:556-567`), incluidos `name`,
  `kind` y `remote`, y cada candidato lleva su `source`. Nombrar la misma fuente
  por dos rutas es procedencia distinta, y registrarla así es correcto. La
  redacción original trasladó la frase del audit («OID e inventory_digest
  distintos») a un criterio sin comprobar qué parte de esa diferencia era el
  defecto: lo era el OID, no el digest. Verificado empíricamente antes de
  corregir.

### CR2 — La ref pública de estado no adopta un objeto que no sea commit

- **Given** un remoto cuya `refs/heads/changeledger/state` fue apuntada a mano a un
  tag anotado, un blob o un tree
- **When** se ejecuta `state migrate --create --plan <plan>`
- **Then** falla con `state baseline ref refs/heads/changeledger/state must point to a commit`
  antes de escribir ninguna ref, autoridad ni rama de activación
- **And** `.changeledger/authority.yml` no se crea ni se modifica, y no se crea
  ninguna rama de activación
- **And** el objeto sí se trae al repositorio local antes de rechazarlo, porque
  `cat-file -t` no puede clasificar lo que no está: la promesa es que no se
  escribe estado, no que no se descargue el objeto

### CR2b — Una autoridad local que nombra un baseline no-commit se rechaza

- **Given** una activación preparada cuya `.changeledger/authority.yml` se
  reescribe para que `baseline:` apunte a un tag anotado sobre el baseline real
- **When** se ejecuta `installStateActivation` (o `deactivate`, o `doctor`, que
  leen ese baseline local y nunca lo traen de la red)
- **Then** falla con `state baseline <oid> must point to a commit`, nombrando el
  objeto corrupto y no una ref donde la corrupción no está
- **And** `refs/changeledger/activation` no se crea

### CR3 — `activate --prepare` rechaza un baseline publicado que no sea commit

- **Given** la misma corrupción remota y un `--baseline <oid>` que apunta al tag
- **When** se ejecuta `state activate --prepare --baseline <oid>`
- **Then** falla con el mismo diagnóstico de CR2, no con
  `published state baseline is <x>, expected <y>`
- **And** no se crea la rama `changeledger/activate-<prefix>`

### CR4 — El resolvedor de lecturas clasifica la activation ref

- **Given** un repo con réplica v2 activada cuya `refs/changeledger/activation` se
  reescribe a mano al OID de un tree
- **When** se ejecuta cualquier lectura (`changeledger list`, `changeledger state status`)
- **Then** falla con `state activation ref refs/changeledger/activation must point to a commit`,
  el mismo mensaje que ya emiten `install` y `deactivate`
- **And** ninguna lectura sirve un snapshot ni reporta el repo como sano

### CR5 — La recovery no se materializa desde una autoridad no-commit

- **Given** el repo de CR4 con la activation ref apuntando a un tree
- **When** se ejecuta `state export --recovery-branch`
- **Then** falla con el diagnóstico de CR4
- **And** no existe ninguna ref `refs/heads/changeledger/recover-*`

### CR6 — La procedencia no se resuelve desde un objeto no-commit

- **Given** el repo de CR4, y además una variante donde la activation ref apunta a
  un tree forjado con `git mktree` que no está contenido en ningún commit, rama ni tag
- **When** se emite cualquier receipt del CLI que lleve procedencia (por ejemplo
  `changeledger check`)
- **Then** falla con el diagnóstico de CR4 en lugar de devolver el `project_id`
  leído de ese objeto

### CR7 — Un blob y un tag en la activation ref reciben el mismo trato que un tree

- **Given** el repo de CR4 con la activation ref apuntando a un blob, y otra
  variante apuntando a un tag anotado sobre el commit de autoridad
- **When** se ejecuta una lectura
- **Then** el blob falla con el diagnóstico de CR4, no con
  `state authority is unavailable: ... has no readable .changeledger/authority.yml`
- **And** el tag anotado resuelve por peel explícito al commit de autoridad y la
  lectura funciona con normalidad, conservando el OID directo en las transacciones CAS

### CR9 — El resolvedor de lecturas clasifica el tip de la réplica

- **Given** un repo con réplica v2 activada donde `refs/changeledger/confirmed`
  —y, en variantes separadas, `refs/changeledger/observed` y
  `refs/changeledger/pending`— se apunta a un tag anotado sobre el baseline con
  `git update-ref`, sin editar `.git` a mano
- **When** se ejecuta cualquier consumidor del resolvedor compartido: la carga del
  snapshot, `state status` y `state export --recovery-branch`
- **Then** los tres fallan con `state replica tip <oid> must point to a commit`
- **And** no se materializa ninguna rama `refs/heads/changeledger/recover-*`
- **And** con una autoridad v1 cuyo `state_ref` apunta a un objeto que no es
  commit, la lectura falla con
  `state replica tip refs/heads/changeledger/state must point to a commit`

  Este criterio se añadió en la corrección del primer retry y se amplió en la del
  segundo. Es el sitio de **vector más débil** de toda la clase, porque
  `git update-ref` acepta un objeto que no es commit fuera de `refs/heads/*`: no
  hace falta remoto hostil ni editar `.git`. La primera versión del change lo dio
  por cerrado heredando la afirmación de `20260724-212722`, que solo guardó la
  escritura. La segunda lo guardó en un **consumidor** (`gitStateRevision`) en vez
  de en el **resolvedor compartido** (`readStateReplica`, con diez llamadores), así
  que `state status` seguía saliendo con éxito reportando el OID del tag y
  `export --recovery-branch` seguía materializando una rama desde él, grabando ese
  OID en el nombre de la rama y en el mensaje del commit. Dos veces el mismo error
  de forma: declarar cerrada una clase mirando el sitio reproducido en vez del
  resolvedor. La clasificación vive ahora en el resolvedor compartido.

### CR8 — Los tips y baselines legítimos no se ven afectados

- **Given** un ciclo completo sobre un remoto honesto: `migrate --preview`,
  `--create`, `activate --prepare`, `--install`, `sync`, una mutación, `sync`,
  `export --recovery-branch` y `activate --deactivate`, en sha1 y en sha256
- **When** se ejecuta cada paso
- **Then** el comportamiento actual se conserva sin cambios, incluidos los OIDs
  publicados y el `inventory_digest`

## Plan

- [x] Añadir un test rojo por ruta que cubra CR1 (tag anotado como fuente por `local:` y por `origin:`, mismo commit registrado y planes idénticos salvo los campos que nombran la fuente) y hacerlo pasar conservando el valor pelado de `exactCommit` en la rama remota de `observeSource` en `src/state-migration.mjs`; verify: `node --test test/state-migration.test.mjs` (CR1)
  - **Resolved:** `2026-07-25T10:55:44Z`
- [x] Añadir tests rojos para CR2 y CR3 con la loose ref del remoto reescrita a mano hacia tag, blob y tree, y hacerlos pasar asertando el tipo commit del tip fetched de la ref pública de estado en `src/state-migration.mjs` (`fetchRef` y `readStateMetadata`) antes de cualquier escritura; verify: `node --test test/state-migration.test.mjs` (CR2, CR3)
  - **Resolved:** `2026-07-25T11:25:47Z`
- [x] Añadir tests rojos para CR4, CR5, CR6 y CR7 y hacerlos pasar clasificando el tipo en `activationCommitOid` de `src/ledger-store.mjs` con la misma resolución en dos etapas que `resolveActivationCommitOrNull`, reusando su diagnóstico exacto; verify: `node --test test/ledger-store.test.mjs test/state-migration.test.mjs` (CR4, CR5, CR6, CR7)
  - **Resolved:** `2026-07-25T11:25:47Z`
- [x] Reconciliar el comentario de `assertCommitTip` en `src/state-store.mjs`, que hoy afirma paridad con una clasificación que el resolvedor de lecturas no tenía; verify: `node --test test/state-store.test.mjs` (support)
  - **Resolved:** `2026-07-25T11:25:47Z`
- [ ] Clasificar en el resolvedor compartido `readStateReplica` de `src/state-store.mjs` las tres refs de la réplica, y el `state_ref` de una autoridad v1 en `src/ledger-store.mjs`, con tests que cubran carga, `state status`, recovery y v1; verify: `node --test test/ledger-store.test.mjs test/state-store.test.mjs` (CR9)
- [x] Añadir el test rojo de CR9 y CR2b y clasificar el tip servido en `gitStateRevision` de `src/ledger-store.mjs`, además de corregir el sujeto del diagnóstico de `readStateMetadata` en `src/state-migration.mjs` para que nombre el baseline y no una ref que tres de sus cuatro llamadores no leen; verify: `node --test test/ledger-store.test.mjs test/state-migration.test.mjs` (CR9, CR2b)
  - **Resolved:** `2026-07-25T12:03:02Z`
- [x] Anclar CR8 con el ciclo completo en ambos formatos de objeto y verificar por mutación sobre `src/state-migration.mjs`, `src/ledger-store.mjs` y `src/state-store.mjs` que retirar cualquiera de las **cinco** clasificaciones rompe exactamente su propio test, con el control corrido sobre la suite completa y no sobre un subconjunto; verify: `pnpm verify` y `node --test test/state-migration.test.mjs` (CR8)
  - **Resolved:** `2026-07-25T12:02:47Z`

## Log

- **2026-07-25T10:40:52Z** `[note]` Draft creado desde los hallazgos MIG-04 (crítico), MIG-05 (alto) y AUTH-12 (medio) de la cuarta ejecución del audit `20260721-193106`, y bajo la regla de cierre por clase del techo `20260725-013425`. La superficie se inventarió con un delegado de solo lectura antes de escribir este documento: los cuatro sitios del defecto son `observeSource` rama remota (`state-migration.mjs:165`,`:172`), `fetchRef` (`:957`), `readStateMetadata` (`:1143`) y `activationCommitOid` (`ledger-store.mjs:258-260`), y los cuatro **sobreviven** al recorte de fuentes múltiples, así que este change no depende de él. Corrección de la ordenación propuesta antes en conversación: se creía que asertar antes del recorte era trabajo tirado, lo que era una suposición sin verificar. Además, pelar de forma consistente en las dos rutas de `observeSource` cierra MIG-05 sin necesidad de quitar fuentes múltiples, así que el recorte queda justificado por reducción de complejidad y no por cierre de defectos.
- **2026-07-25T10:48:30Z** `[status]` draft → approved
- **2026-07-25T10:50:27Z** `[status]` approved → in-progress
- **2026-07-25T10:50:27Z** `[owner]` set: raruiz-hiberuscom (auto)
- **2026-07-25T10:55:44Z** `[note]` CR1 cerrado. observeSource conserva ahora el valor pelado de exactCommit en la rama remota: el OID crudo de ls-remote se retiene solo como 'tip' para la comprobación de drift contra lo que el remoto publica, mientras la fuente se registra por su commit pelado, igual que ya hacía la rama local. recordSourceActivity se llama dos veces por diseño: antes del fetch con el OID observado, para que un receipt de fallo conserve evidencia, y de nuevo tras pelar con éxito, ya que hace upsert por nombre. Corregido el propio CR1 durante la implementación: exigía el mismo inventory_digest por las dos rutas, lo cual es imposible y además incorrecto porque el digest cubre sources verbatim con name, kind y remote, y cada candidato lleva su source. Verificado empíricamente que los dos planes son idénticos salvo esos campos de nombrado, y el test ancla eso además de asertar que los digests SÍ difieren, para que nadie 'arregle' esa diferencia en el futuro. Suite de migración completa: 79/79.
- **2026-07-25T11:26:06Z** `[note]` Tareas 2 a 5 cerradas. Añadido assertCommitObject a src/git.mjs como primitiva compartida: cat-file -t con un sujeto que el llamador aporta, para que los mensajes ya publicados no cambien y ningún sitio futuro invente su propia comprobación. Cableada en fetchRef y readStateMetadata de state-migration con el sujeto 'state baseline ref <ref>', y en activationCommitOid de ledger-store con resolución en dos etapas que acepta commit, pela un tag anotado y rechaza tree o blob con el mismo diagnóstico que ya emitían install y deactivate. Reconciliado el comentario de assertCommitTip, que afirmaba paridad con una clasificación inexistente en el resolvedor de lecturas; ahora dice qué era falso, por qué, y que la paridad es real desde este change. CR8: el ciclo honesto en sha1 y sha256 ya lo cubre la suite existente via preparedForInstall y el test de 235910 que ancla el tag conservando su OID directo a través de install y deactivate, así que no se duplicó. Matriz de mutación 4/4 sobre copia scratch completa con control verde previo (174/174): retirar la retención del valor pelado en observeSource mata solo CR1; retirar la aserción de fetchRef mata solo los tres CR2 de tag, blob y tree; retirar la de readStateMetadata mata solo el CR2 de autoridad local; retirar la clasificación de activationCommitOid mata CR4/CR7, CR5 y CR6. Incidente de método: una primera pasada combinada dio falso negativo para M3 y M4 por un fallo de mi harness, no del código, y lo detecté al extrañarme de que M4 no matara nada; se repitió cada mutación por separado verificando que el parche se aplicaba antes de correr. Hallazgo propio corregido en el camino: la aserción de readStateMetadata quedaba sin anclar porque fetchRef la cubría en las rutas probadas, así que se añadió un test por la ruta que fetchRef no alcanza, una autoridad local forjada que nombra un tag como baseline y que llega a install, deactivate y doctor sin red. Gate 1.158/1.158, Biome limpio, 246 changes válidos.
- **2026-07-25T11:26:06Z** `[status]` in-progress → in-review
- **2026-07-25T11:45:06Z** `[review]` in-review → in-progress (retry): F1 bloqueante y verificado: existe un quinto sitio. gitStateRevision en ledger-store lee CONFIRMED_REF y PENDING_REF con optionalRefOid sin clasificar el tipo, y esa OID cruda es la revisión que sirve toda lectura. Comprobado que el vector es MÁS débil que los cuatro guardados: git update-ref refs/changeledger/confirmed <tag> tiene éxito sin editar .git a mano, porque git solo rehúsa no-commits bajo refs/heads. Es la misma clase y heredé de 20260724-212722 la afirmación de que el tip de la réplica estaba cerrado sin comprobar la ruta de lectura, que es precisamente el fallo que este change existe para corregir; peor aún, el comentario que yo mismo añadí a assertCommitTip afirma que la paridad clasifica todos los sitios, y es falso. F2: la tarea 1 del Plan sigue diciendo 'mismo commit y mismo digest' pese a que CR1 se enmendó para rechazar eso. F3: CR2 promete 'antes de escribir cualquier ref u objeto local' y el fetch precede necesariamente a cat-file -t. F4: readStateMetadata fija STATE_REF como sujeto del diagnóstico aunque tres de sus cuatro llamadores leen el baseline de una autoridad local, así que manda al operador a una ref donde no está la corrupción. F6: el Log llama completa a la matriz de mutación cuyo control fueron 174 tests, el subconjunto de dos ficheros. F7: assertCommitTip sigue con comprobación propia pudiendo usar la primitiva compartida.
- **2026-07-25T12:03:22Z** `[note]` Corrección del retry. F1 era real y verificado por mí antes de aceptarlo: git update-ref refs/changeledger/confirmed <tag> tiene éxito sin editar .git a mano, porque git solo rehúsa no-commits bajo refs/heads, así que el quinto sitio tenía el vector MÁS débil de toda la clase. gitStateRevision clasifica ahora confirmed y pending con la primitiva compartida y el mismo diagnóstico del lado de escritura. Añadido CR9 a la spec con la explicación de por qué faltaba: heredé de 20260724-212722 la afirmación de que el tip estaba cerrado sin comprobar la ruta de lectura, que es exactamente el fallo que este change existe para corregir, cometido dentro del propio change; y el comentario que yo mismo escribí en assertCommitTip afirmaba una completitud falsa, ahora reescrito para enumerar los cinco sitios y decir qué se le escapó. F2: la tarea 1 ya no promete el digest que CR1 rechaza. F3: CR2 ya no promete que no se escriba ningún objeto local, porque cat-file -t no puede clasificar lo que no está descargado; la promesa acotada es que no se escribe estado. F4: el sujeto del diagnóstico de readStateMetadata nombra el baseline y no la ref pública, porque tres de sus cuatro llamadores leen ese baseline de una autoridad local y nunca lo traen de la red; el caso quedó promovido a criterio propio CR2b. F6: matriz repetida con control sobre la suite COMPLETA (1.159/1.159), no sobre el subconjunto de dos ficheros. F7: assertCommitTip usa ya la primitiva compartida en vez de su comprobación propia. Matriz 5/5 sin colateral: M1 observeSource mata CR1; M2 fetchRef mata los tres CR2 y CR3; M3 readStateMetadata mata CR2b; M4 activationCommitOid mata CR4/CR7, CR5 y CR6; M5 gitStateRevision mata CR9. Nota: M2 ahora mata también CR3, que antes sobrevivía porque readStateMetadata lo cubría; con el sujeto corregido, CR3 ancla específicamente el diagnóstico de la ruta de fetch. Gate 1.159/1.159, Biome limpio, 246 changes válidos.
- **2026-07-25T12:03:22Z** `[status]` in-progress → in-review
- **2026-07-25T12:30:49Z** `[review]` in-review → in-progress (retry): F1 bloqueante y reproducido: existe un sexto sitio, y es el mismo error de forma que el quinto. Puse el guard en un consumidor (gitStateRevision) en vez de en el resolvedor compartido readStateReplica, que tiene diez llamadores; por eso state status sale con exit 0 sirviendo el OID del tag como revisión y state export --recovery-branch materializa una rama de recovery desde un tip que no es commit, grabando ese OID en el nombre de la rama y en el mensaje del commit. Incumple la segunda cláusula de CR9 y el CR4, que nombra state status explícitamente. F2: el segundo assert de CR9 es una tautología, verificado que repoProvenance NO falla bajo esa corrupción, así que el && nunca cortocircuita y la expresión se reduce a la llamada ya aserada tres líneas antes, sin matcher de error. F3: la rama v1 de gitStateRevision sirve authority.state_ref sin clasificar. F4: refs/changeledger/observed no se clasifica en ningún sitio y su corrupción se reporta como freshness unknown en vez de como error. F5: el comentario reescrito de assertCommitTip se contradice a cuatro líneas de distancia y su enumeración de sitios ya vuelve a estar incompleta, que es exactamente el modo de fallo del F1 de la ronda anterior.
- **2026-07-25T12:48:51Z** `[note]` Corrección del segundo retry. F1 era real y lo reproduje: existía un sexto sitio y era el MISMO error de forma que el quinto. Guardé un consumidor (gitStateRevision) en vez del resolvedor compartido readStateReplica, que tiene diez llamadores, así que state status salía con éxito reportando el OID del tag como revisión y export --recovery-branch materializaba una rama desde ese tip grabándolo en el nombre de la rama y en el mensaje del commit. La clasificación vive ahora en readStateReplica y cubre las tres refs, incluida observed (F4), que no estaba en mi inventario de cinco. Consecuencia deliberada: una réplica local corrupta ya no se auto-sana en silencio con sync; falla con el diagnóstico y la reparación es explícita, que es lo coherente con la regla fail-closed y con lo que 212722 ya hacía para un tip remoto corrupto. F3: clasificado también el state_ref de una autoridad v1, y anclado con su propio test tras comprobar por mutación que sin él nada fallaba. F2: sustituida la tautología del test de CR9 —verificado que repoProvenance NO falla bajo esa corrupción, así que el && nunca cortocircuitaba— por asertos reales sobre carga, state status y recovery, más la ausencia de rama recover-*. F5: el comentario de assertCommitTip deja de enumerar sitios y dice por qué: una enumeración en comentario se queda obsoleta en silencio, y eso hizo falsas dos afirmaciones de completitud seguidas; la primitiva compartida y sus llamadores son la respuesta, no una lista escrita a mano. Matriz ampliada a siete mutaciones con control de suite completa (1.160/1.160): M1 observeSource mata CR1; M2 fetchRef mata los tres CR2 y CR3; M3 readStateMetadata mata CR2b; M4 activationCommitOid mata CR4/CR7, CR5 y CR6; M5 gitStateRevision mata CR9; M6 classifiedTip del resolvedor compartido mata CR9; M7 state_ref v1 mata su test propio. Dos notas de método honestas: un primer intento de M6 rompió la sintaxis y tumbó la suite entera, lo cual no es un kill sino una mutación inválida, y se rehízo; y M5 muestra dos colaterales de 202058 que casi con seguridad son artefacto de mi parche textual sobre bloques adyacentes, no evidencia, así que no los cuento como resultado. Gate 1.160/1.160, Biome limpio, 246 changes válidos.
- **2026-07-25T12:48:52Z** `[status]` in-progress → in-review
