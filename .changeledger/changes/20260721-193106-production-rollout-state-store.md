---
id: "20260721-193106"
title: Calificar el almacén global para producción
type: audit
status: in-progress
created: 2026-07-21T19:31:06Z
depends_on: ["20260721-193101", "20260721-193102", "20260721-193103"]
owner: Roberto Ruiz
related_to:
  - "20260721-193104"
  - "20260627-111218"
  - "20260627-111219"
  - "20260722-163405"
  - "20260722-163406"
  - "20260722-163407"
  - "20260722-163408"
  - "20260722-163409"
  - "20260722-181234"
  - "20260722-181235"
  - "20260722-185043"
  - "20260722-190137"
---

## Request

Antes de declarar estable el almacén global, se necesita evidencia integral de
que centraliza el ledger sin pérdida, converge entre clones, sobrevive fallos y
expone honestamente los límites de cada proveedor. El resultado debe decidir
qué nivel puede lanzarse —experimental, beta o GA— y bloquear el release si una
invariante crítica carece de prueba.

## Investigation

La rama prototipo `codex/global-state-branch@6ac08826` pasa su gate completo,
pero una auditoría integral encontró fallos que los tests no representaban: un
clon limpio no podía avanzar de `S1` a `S2`, una autoridad inválida podía caer
al storage legacy, abort podía ignorar pending, el cutover no era
crash-consistent y la atestación de owner no demostraba identidad autenticada.
Por tanto, cantidad de tests y estado `in-validation` no bastan para afirmar
viabilidad productiva.

Esta auditoría depende de los tres contratos que forman el core v2 porque debe
evaluar el sistema integrado, no aprobar piezas aisladas. El enforcement remoto
es contexto opcional: su estado limita las garantías de cada topología, pero no
bloquea un core que se presente honestamente como coordinación advisory. La
evidencia mínima abarcará:

- matriz de dos y tres clones con lecturas, pending, avances disjuntos,
  conflictos, rewinds y pushes de resultado ambiguo;
- snapshots con cambios, specs, graduación y releases en la misma revisión;
- migración desde refs dispersas, activación, revert pre-mutation y recuperación
  post-mutation;
- fault injection en cada frontera Git (fetch, object write, ref CAS, push,
  respuesta perdida, filesystem lleno y proceso interrumpido);
- repositorios SHA-1/SHA-256, worktrees reales y config distinta entre clones;
- performance con volúmenes representativos y límites del hook;
- matriz de amenazas: usuario con write, cliente antiguo, actor falsificado,
  force-push, paths legacy y servidor sin identidad autenticada;
- compatibilidad de upgrade/downgrade y documentación operacional.

### Protocolo de evidencia

La auditoría empieza sobre un árbol limpio y congela un baseline reproducible:
commit de código, versión del CLI y de Node/pnpm/Git, sistema operativo,
algoritmo de objetos, configuración efectiva, proveedor/adaptador y OIDs de cada
ref involucrada. Un cambio de código, contrato o configuración durante la
auditoría invalida las filas afectadas y exige ejecutarlas otra vez sobre un
baseline nuevo; no se combinan resultados de baselines distintos.

Cada caso se registra en una matriz con identificador, invariante, topología,
fixture o repositorio, preparación, comando exacto, estado inicial de refs y
worktree, resultado esperado, resultado observado, duración, evidencia y uno de
`pass`, `fail` o `blocked`. `Blocked` y la ausencia de evidencia cuentan como
`fail` para calificar el perfil que exige esa invariante. El Log mantiene el
índice durable de ejecuciones y de sus artefactos; un total de tests verde, sin
vinculación entre caso e invariante, no constituye evidencia.

Las pruebas de fallo deben capturar el antes y después de refs, trees, worktree
y archivos Git locales. Cada frontera se falla de forma determinista antes y
después del efecto observable; luego se reinicia desde disco y se demuestra
recuperación o un diagnóstico accionable. No se acepta inferir éxito de una
respuesta de red ni inferir ausencia de escritura solo por el exit code.

### Repositorios legacy reales

La matriz de migración incluye una fixture versionada que reproduzca documentos
legacy observados —incluido un change equivalente a `20260716-124623`, con
metadata de tareas antigua y eventos de Log no tipados— y, cuando esté
disponible, un preflight read-only sobre al menos un repositorio registrado real.
Se distingue explícitamente entre incompatibilidad del documento, divergencia
entre refs y fallo del protocolo de migración.

El preview debe inventariar todos los candidatos y diagnósticos sin modificar
worktree, config, branches, remote-tracking refs ni el estado público. La
auditoría prueba una migración acotada, una migración con conflicto, activación,
revert pre-mutation y recovery post-mutation. Nunca ejecuta una reparación
repo-wide implícita para hacer pasar el caso. Si un ledger que una versión
estable aceptaba no puede previsualizarse o migrarse con un procedimiento
seguro, reproducible y recuperable, se registra al menos como hallazgo alto.

### Aislamiento entre proyectos y superficies

Se registran dos repositorios `A` y `B` con `project_id`, remotos y revisiones
distintos. Con el viewer seleccionado en `A` y un CLI cuyo cwd pertenece a `B`,
se intercalan y concurren una sincronización y una mutación en cada superficie.
Cada request debe quedar vinculada al proyecto capturado al iniciarse, incluso
si el usuario cambia la selección visible antes de recibir la respuesta.

La evidencia compara refs, trees, worktrees y receipts de ambos repositorios:
una operación del viewer solo puede cambiar `A`, una operación del CLI solo
puede cambiar `B`, y cada resultado o error debe permitir identificar sin
ambigüedad `project_id`, repositorio y revisión de ledger usados. Cualquier
escritura cruzada, reutilización de una revisión de otro proyecto o respuesta
atribuida al proyecto incorrecto es un hallazgo crítico. La selección y el
estado persistido del viewer nunca cambian el cwd ni la resolución del CLI.

### Severidad y decisión

- **Crítico:** pérdida o corrupción de verdad, escritura entre proyectos,
  bypass/fallback de authority, publicación no confirmada tratada como
  confirmada, cutover irrecuperable o garantía enforced falsa.
- **Alto:** no convergencia, conflicto silencioso, migración/recovery segura no
  disponible para un ledger soportado, rewind o cliente antiguo capaz de
  reintroducir verdad legacy, o protección remota prometida pero eludible.
- **Medio:** degradación operacional recuperable, performance fuera del SLO,
  observabilidad insuficiente o procedimiento manual incompleto sin riesgo de
  pérdida.
- **Bajo:** ergonomía, claridad o cobertura secundaria sin afectar invariantes.

Una invariante crítica no probada bloquea cualquier release público. Un hallazgo
crítico abierto bloquea todos los perfiles; un alto abierto limita como máximo
a Experimental cuando existe contención explícita, backup y recovery ensayado.
Beta exige que todas las invariantes críticas y altas de su contrato estén en
`pass`; GA además exige cero críticos/altos abiertos, SLO publicado y cumplido,
migración/recovery automatizada y la matriz completa de proveedor. Si no existe
un SLO aprobado, la auditoría mide volúmenes de 250, 1 000 y 5 000 changes con
sus specs/releases y reporta percentiles, pero no puede recomendar GA.

La decisión usará tres perfiles independientes:

- **Experimental:** opt-in, backup exigido, advisory permitido y sin promesa de
  exclusividad remota.
- **Beta:** recuperación ensayada, convergencia probada y protección de historia
  verificable; límites del proveedor visibles.
- **GA:** cero riesgo crítico/alto abierto dentro del contrato prometido,
  migración/recuperación automatizada, SLO de performance cumplido y garantías
  advisory/enforced diferenciadas por topología sin afirmar capacidades ausentes.

Hallazgos críticos o altos no se corrigen dentro de este audit. Se crea un bug o
se devuelve el change dueño a `draft/blocked` para redefinir su contrato. Tras
un segundo rechazo sobre el mismo change no se hace un tercer retry: se detiene,
se analiza la causa de definición y se divide o reemplaza el change.

La salida es un informe único dentro de este change: baseline, matriz completa,
hallazgos con owner change, riesgos residuales, límites por topología y decisión
`no-release`, Experimental, Beta o GA. La auditoría termina únicamente cuando
toda fila crítica tiene resultado y cada `fail` crítico/alto está vinculado a un
bug nuevo o al change dueño reabierto; no se fuerza una clasificación positiva
para poder cerrar el audit.

### Resultados en curso

| ID | Invariante y topología | Preparación y comando | Estado inicial | Esperado | Observado y duración | Evidencia | Resultado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BASE-01 | Baseline reproducible; repo de desarrollo | Árbol limpio; captura de versiones, config y OIDs | `da24a644525c9945481ab766ece7e31d821559f5`, SHA-1, sin authority local | Baseline completo antes de ejecutar casos | Baseline capturado antes de pruebas | Log `18:45:28Z` y commit `96301c68` | pass |
| FIX-01 | Las siete correcciones externas representan sus defectos | Revisar commits `2d188f69`, `ec1d9b50`, `76ee346d`, `076a8336`, `5334d38a`, `eedb74a6`, `ba1bfbba`; tests focalizados y `pnpm verify` | Baseline `da24a644`; seis bugs y un chore en `done` | Cada fix corresponde a su causa y no rompe el gate | 64/64 focalizados y 920/920 completos; lint y 220 changes válidos | Log `18:43:15Z` | pass |
| LEGACY-01 | Preview real es read-only y expone divergencias | En `backend-laravel`: `changeledger state migrate --preview --source local:refs/heads/dev --source local:refs/heads/chore/graduate-trip-active-flag --json` | HEAD `87337cf4`; dev `7ee1c69e`; graduation `d73df41f`; worktree limpio; digest de refs `c3c897f3…` | Inventario sin escrituras y divergencias visibles | 229 documentos, 14 sin resolución, incluye `20260716-124623`; digest `94be746a…`; `network:false`, `written:false`; refs, HEAD y worktree iguales; 5.13 s | Receipt JSON capturado por runner y comprobación before/after | pass |
| LEGACY-02 | Crear baseline desde un ledger aceptado previamente | Clon SHA-1 y bare remote desechables; preview `--source local:refs/heads/audit-source --output plan.yml --json`; luego `changeledger state migrate --create --plan plan.yml --json` | Source `d73df41f`; 184 documentos, cero divergencias; digest `79e1b65c…`; state ref remota ausente | Baseline válido o compatibilidad legacy explícita y segura | `--create` abortó por metadata antigua de tareas, timestamps ausentes y Log no tipado; `baseline:null`, `written:false`, `network:false`, 0 commits/bytes publicados; state ref siguió ausente; 3.45 s | Receipts `preview.json`/`create.out`, stderr y `for-each-ref` del runner desechable | **fail — alto, owner `20260722-185043`** |
| ISOL-01 | Mutaciones concurrentes viewer A / CLI cwd B | Dos repos v2 SHA-1 con `project-a`/`project-b`; target viewer A capturado, selección cambia a B y `changeStatus(A)` intercala `changeledger log` en cwd B | A `c5e040d6`, draft; B `599bd41c`, draft; ambos worktrees limpios | Cada superficie modifica solo su target | A avanzó a `fd4b1ce2`/approved; B a `435dcded`/draft con solo la nota CLI; receipts coinciden y ambos worktrees siguen limpios; 3.26 s | Runner `/tmp/changeledger-audit-cross-project.mjs`, asserts de contenido, refs y receipts | pass para aislamiento de mutación; sync queda pendiente |
| ISOL-02 | Respuesta asíncrona conserva proyecto/revisión | App real bajo JSDOM; retener respuesta `/api/repo` de A, cambiar selector a B, resolver B y luego A | Tras B: `selected=project-b`, `rendered=project-b`, `revision-b` | A tardía se descarta | Tras A tardía: `selected=project-b`, pero `rendered=project-a`, `revision-a`; 1.18 s | Runner `/tmp/changeledger-audit-viewer-race.mjs` y flujo `app.js:93-111` | **fail — crítico, owner `20260722-190137`** |
| CONV-01 | Tres clones: avances disjuntos, conflicto y rewind; SHA-1/SHA-256 | Bare self-managed, tres clones activados; A/B crean pending offline en paths distintos, sincronizan en orden, C converge; luego A/B solapan un path y se fuerza rewind; C usa remoto local `state-upstream` distinto | Baseline SHA-1 `ad54e7da…`; SHA-256 `b3b78d37…`; refs locales inicializadas y worktrees limpios | Disjuntos convergen; overlap/rewind fallan cerrados conservando verdad | Los tres confirmaron `a153e99a…` (SHA-1) y `272985f6…` (SHA-256); overlap preservó pending perdedor y confirmed anterior; rewind preservó confirmed y convergió al restaurar remoto; 14.17/12.78 s | Runner `/tmp/changeledger-audit-three-clones.mjs`, contenido de ambos changes, refs y worktrees | pass |
| FAULT-01 | Fallo antes de publicar: object write y ref CAS | Repo v2; hacer `.git/objects` no escribible y, por separado, precrear `refs/changeledger/pending.lock`; mutación offline y retry | Confirmed estable, sin pending, worktree limpio | Fallo sin truth parcial; retry posible | Object write falló en `hash-object`/`write-tree`; CAS devolvió conflicto; ambos conservaron confirmed y `pending:null`; retry creó pending válido; matriz total 22.76 s | Runner `/tmp/changeledger-audit-faults.mjs`, refs before/after y worktree | pass |
| FAULT-02 | Fallo de metadata local después del CAS | Remoto avanza; hacer `.git/changeledger` no escribible durante sync | Confirmed/observed antiguos, remote nuevo | El error no revierte ni corrompe refs; retry reconstruye observación | Ref transaction avanzó confirmed/observed al OID remoto y luego EACCES en `observed.json`; `observedAt:null`; retry `current` persistió timestamp, worktree limpio | Runner `/tmp/changeledger-audit-faults.mjs` | pass; degradación explícita recuperable |
| FAULT-03 | Push ambiguo y proceso interrumpido | Pending local; hooks remotos retrasan recepción; matar proceso durante push y reabrir desde disco; complementar con test de timeout sin efecto/respuesta aceptada perdida | Pending directo sobre confirmed, remoto en confirmed | Nunca confirmar por respuesta; conservar pending y reconciliar por observación posterior | En ejecución real el remoto terminó aceptando tras SIGKILL; local conservó pending y retry fue `confirm-observed`. El test focalizado cubre timeout sin efecto y respuesta aceptada perdida | Runner `/tmp/changeledger-audit-faults.mjs`; `state-store.test.mjs` CR6 | pass |
| PERF-01 | Volumen de 250 changes con specs/releases; lectura y hook SHA-1 | Repo v2 con 250 changes done, 25 specs y 1 release; `node /tmp/changeledger-audit-performance.mjs 250` (5 muestras) | 278 archivos de estado, replica local activada, worktree limpio | Medir p50/p95; ausencia de SLO impide usar el resultado para GA | Load 3513/3694 ms; check 13/15 ms; viewer 1.7/3.3 ms; search 0.4/1.1 ms; receive 7021/7142 ms; RSS 134 MB | Receipt válido, 1 commit/236 bytes; OIDs y métricas JSON capturados | pass como capacidad medida; sin SLO aprobado |
| PERF-02 | Volumen de 1.000 changes con specs/releases; límite del hook SHA-1 | Repo v2 con 1.000 changes done, 100 specs y 4 releases; `node /tmp/changeledger-audit-performance.mjs 1000 3` | 1.106 archivos, replica activada, worktree limpio | Completar validación dentro del presupuesto del hook | Load p50/p95 17.676/17.935 ms; check 55/58 ms; viewer 12/21 ms; search 1,9/3,4 ms; receive abortó a 30.001 ms mientras leía changes | `ValidationTimeoutError`, receipt con OIDs y 1 commit/237 bytes; sin escritura | **fail — medio, límite operativo no declarado** |
| PERF-03 | Volumen de 5.000 changes con specs/releases; límite del hook SHA-1 | Repo v2 con 5.000 changes done, 500 specs y 20 releases; `node /tmp/changeledger-audit-performance.mjs 5000 3` | 5.522 archivos, replica activada, worktree limpio | Completar validación dentro del presupuesto del hook | Load p50/p95 87.226/88.431 ms; check 268/272 ms; viewer 41/47 ms; search 9/12 ms; receive abortó a 30.002 ms antes de completar inventario | Timeout fail-closed con receipt, `commits:0`, `object_bytes:0`; worktree limpio | **fail — medio, escala incluida no soportada** |

## Log

- **2026-07-21T19:31:06Z** `[note]` Draft creado como frontera de release: el prototipo actual no es candidato GA y solo la evidencia integrada del core v2 puede cambiar esa decisión; el enforcement remoto califica garantías adicionales sin bloquear el modo advisory.
- **2026-07-22T16:07:03Z** `[note]` Readiness reforzada con baseline y matriz reproducible, severidades y gates explícitos, migración de ledgers legacy reales y aislamiento concurrente entre viewer y CLI por project_id/repositorio/revisión.
- **2026-07-22T18:43:15Z** `[note]` Pre-auditoría independiente revisada: los fixes 163405–163408 y 181234–181235 corrigen seis bugs reproducibles; 163409 cubre tres guards existentes sin cambiar comportamiento. Verificación propia: 64/64 pruebas focalizadas y gate completo 920/920, lint y 220 changes válidos.
- **2026-07-22T18:34:47Z** `[status]` draft → approved
- **2026-07-22T18:45:06Z** `[status]` approved → in-progress
- **2026-07-22T18:45:06Z** `[owner]` set: Roberto Ruiz (auto)
- **2026-07-22T18:45:28Z** `[note]` Baseline congelado: code/contract/config da24a644525c9945481ab766ece7e31d821559f5; ChangeLedger 0.13.0; Node v24.18.0; pnpm 11.13.0; Git 2.50.1 Apple Git-155; macOS 26.5.2 Darwin 25.5.0 arm64; repo SHA-1, integration dev, origin GitHub, authority local ausente. La implementación se audita en repos desechables activados SHA-1/SHA-256 y bare self-managed; el worktree de desarrollo no se presenta como deployment v2.
- **2026-07-22T18:50:43Z** `[note]` LEGACY-02 alto: un ledger real aceptado por versiones anteriores produce un preview determinista, pero `--create` lo rechaza por estructuras históricas y no ofrece compatibilidad segura dentro del cutover. No hubo publicación ni mutación de sources. Owner: bug draft 20260722-185043; Beta/GA quedan bloqueados mientras permanezca abierto.
- **2026-07-22T19:01:37Z** `[note]` ISOL-01 confirmó que el CLI resuelve exclusivamente su cwd y que las mutaciones viewer A / CLI B no cruzan repositorios. ISOL-02 encontró una carrera crítica en el cliente: una respuesta tardía de A reemplaza el repo visible mientras el selector permanece en B. Owner: bug draft 20260722-190137; cualquier release público queda bloqueado mientras permanezca abierto.
- **2026-07-22T19:18:53Z** `[note]` CONV-01 y FAULT-01..03 pasaron: convergencia real de tres clones SHA-1/SHA-256, conflicto y rewind fail-closed, remote config distinta, object/CAS/metadata failures recuperables y push ambiguo tras SIGKILL reconciliado desde disco. No se encontró pérdida silenciosa en el core de réplica; los blockers abiertos siguen siendo migración legacy y afinidad del viewer.
- **2026-07-22T19:39:33Z** `[note]` PERF-01..03: 250 changes completan lectura y hook (p95 3,69/7,14 s); 1.000 y 5.000 exceden de forma fail-closed el presupuesto remoto de 30 s, con lecturas p95 17,93/88,43 s. Check, serialización y búsqueda permanecen subsegundo. Hallazgo medio: la materialización por documento no soporta toda la escala auditada; sin SLO aprobado, GA sigue siendo imposible.
