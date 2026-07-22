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

## Log

- **2026-07-21T19:31:06Z** `[note]` Draft creado como frontera de release: el prototipo actual no es candidato GA y solo la evidencia integrada del core v2 puede cambiar esa decisión; el enforcement remoto califica garantías adicionales sin bloquear el modo advisory.
- **2026-07-22T16:07:03Z** `[note]` Readiness reforzada con baseline y matriz reproducible, severidades y gates explícitos, migración de ledgers legacy reales y aislamiento concurrente entre viewer y CLI por project_id/repositorio/revisión.
- **2026-07-22T18:43:15Z** `[note]` Pre-auditoría independiente revisada: los fixes 163405–163408 y 181234–181235 corrigen seis bugs reproducibles; 163409 cubre tres guards existentes sin cambiar comportamiento. Verificación propia: 64/64 pruebas focalizadas y gate completo 920/920, lint y 220 changes válidos.
- **2026-07-22T18:34:47Z** `[status]` draft → approved
- **2026-07-22T18:45:06Z** `[status]` approved → in-progress
- **2026-07-22T18:45:06Z** `[owner]` set: Roberto Ruiz (auto)
- **2026-07-22T18:45:28Z** `[note]` Baseline congelado: code/contract/config da24a644525c9945481ab766ece7e31d821559f5; ChangeLedger 0.13.0; Node v24.18.0; pnpm 11.13.0; Git 2.50.1 Apple Git-155; macOS 26.5.2 Darwin 25.5.0 arm64; repo SHA-1, integration dev, origin GitHub, authority local ausente. La implementación se audita en repos desechables activados SHA-1/SHA-256 y bare self-managed; el worktree de desarrollo no se presenta como deployment v2.
