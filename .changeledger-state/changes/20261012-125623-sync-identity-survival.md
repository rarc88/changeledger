---
id: "20261012-125623"
title: Auditar la supervivencia de identidades en sync
type: audit
status: in-progress
created: 2026-10-12T12:56:23Z
depends_on: []
branch: audit/20261012-125623
related_to: ["20261002-133728", "20261002-161641", "20260808-142200"]
owner: rarc88
---

## Request

Varias revisiones de esta serie (`20261002-133728`, `20261002-161641`) señalaron
el mismo hueco: el fast-forward y la reconciliación de `changeledger sync` no
comprueban que las identidades presentes en la foto local (changes, specs,
releases, registros de consumo y entradas de colecciones desconocidas)
sobrevivan en la revisión que adoptan, mientras `global-state-scope` (incluye
#3) declara que ninguna identidad presente en una foto puede desaparecer de su
descendiente. `20261002-161641` cubrió sólo las entradas desconocidas en el
merge. Se pide auditar el hueco: dónde se pierde integridad, qué borrados son
legítimos y cuánto costaría cerrarlo, para decidir el alcance antes de crear el
change de corrección. Toca el techo de `global-state-scope`, así que el humano
decide el alcance.

## Investigation

Punto de partida, por verificar en la auditoría: `mutateState` en
`src/state-store.mjs` rechaza que desaparezca una identidad sin un
`stage.remove` explícito; `advanceStateRef` (fast-forward) y `commitMergedState`
(reconciliación, que desde `20261002-161641` comprueba por ruta las entradas
desconocidas de ambos padres) no comparan las identidades conocidas. Preguntas:
qué operaciones de la CLI borran identidades de forma legítima y cómo se ven en
una historia remota; si un fast-forward puede distinguir un borrado legítimo de
uno indebido sin datos nuevos; qué hace hoy `sync` ante cada caso, con
reproducciones; y el coste y el riesgo de cada opción frente al techo.

### Hallazgos

Marcas: [E] ejecutado en repos desechables con un remoto bare y
`CHANGELEDGER_HOME` aislado; [C] razonado desde el código.

**Dónde se adopta una revisión y qué se comprueba.**

| Sitio | Supervivencia de identidades |
|---|---|
| `mutateState` (`src/state-store.mjs`) | rechaza una ruta que desaparece sin `stage.remove`, y borrar o reescribir un registro de consumo o una entrada desconocida [C] |
| `advanceStateRef` (fast-forward) | sólo comprueba ancestría y que la foto destino se lea entera; no compara identidades [E] |
| `commitMergedState` (reconciliación) | comprueba por ruta sólo las entradas desconocidas de ambos padres [E] |
| publicación con el local por delante (`sync.mjs`) | no compara nada [E] |
| `seedStateRef` (activate) | no aplica: no hay foto local previa [C] |

El comentario de cabecera de `src/state-store.mjs` ya dice que el fast-forward
y el merge de `sync` no ejecutan esa comprobación.

**Borrados legítimos.** Las cinco llamadas a `mutateState` en `src`
(change-store, cutover, import, usage-collector, config-migration) usan sólo
`stage.write`; fuera de los tests nada llama a `stage.remove` [C, grep]. archive
y discard reescriben el documento sin moverlo; release, graduate, import,
cutover y config migrate sólo escriben; `cutover --undo` borra la ref entera y
no produce una revisión descendiente [C]. En la ref de estado de este repo (923
commits, 488 entradas) `git log --diff-filter=D -m changeledger/state` no
devuelve ningún borrado [E]. Un borrado hecho por la API con `stage.remove`
produce un commit que, salvo árbol y fechas, sólo se distingue de uno hecho con
git crudo por su mensaje libre [E].

**Qué hace `sync` hoy.**

- R1, fast-forward a un commit de git crudo que borra un change, una spec, un
  registro de consumo y una entrada desconocida: `Fast-forwarded …`, exit 0;
  `list --all` deja de mostrar el change [E].
- R2, reconciliación cuyo lado remoto borra un change, una spec y un registro:
  `Reconciled disjoint journals into …` y `Published …`, exit 0; el árbol
  mezclado y el remoto quedan sin ellos [E].
- R3, reconciliación cuyo lado remoto borra una entrada desconocida: falla con
  `merged state drops "…future/a.json" …`, exit 1, sin mover la ref [E].
- R4, borrado remoto de un change editado en local: colisión
  `local 7ec561a vs remote deleted`, exit 1, sin escribir [E].
- R5, tip local por delante con un borrado de git crudo: `Published …`,
  exit 0 [E].
- R6, fast-forward a una revisión que reescribe los bytes de un registro de
  consumo: se adopta [E].

**¿Puede un fast-forward distinguir un borrado legítimo de uno indebido?** No con
los datos actuales: los dos commits sólo difieren en el mensaje [E]. Hoy no hace
falta distinguirlos, porque ningún comando produce un borrado (párrafo anterior),
así que una comprobación por ruta entre extremos no rechazaría ninguna historia
de este repo [E sobre su historia]. Si en el futuro un comando necesitara
borrar, el dato mínimo sería un trailer en el commit de `mutateState`
(p. ej. `ChangeLedger-Removes: <ruta>`), falsificable con git crudo: declara
intención, no confianza [C].

**Opciones.** Un helper común en `state-store` (unas 15–20 líneas): cada ruta de
la foto local sigue en la destino y, para los registros de consumo, con el mismo
oid.

| Opción | Cierra | Coste | Riesgo |
|---|---|---|---|
| 1. Rechazar en el fast-forward | R1, R6 | ~3 líneas y un `ls-tree` del tip local (~2 ms con 488 entradas) | si el remoto ya trae un borrado, cada `sync` lo rechaza y no hay comando para restaurarlo: el mensaje debe dar la salida manual [C] |
| 2. Rechazar en la reconciliación, generalizando la comprobación de desconocidas a todas las rutas | R2 | ~5 líneas, sin subprocesos nuevos | bajo [C] |
| 3. Rechazar al publicar con el local por delante | R5 | ~4 líneas y 1–2 `ls-tree` | sólo lo produce git crudo local [C] |
| 4. Sólo en la reconciliación | R2 | — | deja R1 abierto |
| 5. Avisar en vez de rechazar | — | — | contradice que #3 sea fail-closed [C] |
| 6. Lista de borrados permitidos por journal o trailers | — | datos nuevos y recorrer el rango | sirve a un borrado que hoy no existe y roza la exclusión de afirmaciones de confianza de `global-state-scope` [C] |

Pruebas estimadas: 5–6 tests (unas 120–180 líneas) y cuatro comentarios de
`state-store.mjs`. Las opciones 1–3 completan la garantía #3 que la spec ya
declara, sin capacidad ni datos nuevos y sin tocar las refs existentes; la 6
crecería más allá del techo [C].

**Recomendación de la auditoría:** opciones 1 y 2, con rechazo, comprobación por
ruta entre extremos y un helper común. Quedan para el humano la opción 3 y la
regla de reescritura de registros en el fast-forward (R6).

**Sin determinar.** Si «identidad» en #3 es la ruta o el id (por ruta es más
estricto; hoy no hay renombres); si hay previsto algún borrado legítimo que
pediría la opción 6; árboles de más de 488 entradas y repos SHA-256; specs y
releases borrados por merge por separado; y que la comparación entre extremos no
ve un borrado intermedio vuelto a añadir dentro del rango remoto.

## Log
- **2026-10-12T12:56:23Z** `[version]` 0.18.0-dev
- **2026-10-12T12:58:48Z** `[status]` draft → approved (human via conversation)
- **2026-10-12T14:04:08Z** `[status]` approved → in-progress
- **2026-10-12T14:04:08Z** `[branch]` set: audit/20261012-125623 (auto)
