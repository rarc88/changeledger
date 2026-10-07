---
title: Consumo de tokens por change
updated: 2026-10-07T13:20:14Z
tags: [usage, metrics]
graduated_from: ["20261001-155612", "20261002-133728", "20261002-140038"]
---

# Consumo de tokens por change

ChangeLedger puede registrar cuántos tokens y cuánto coste lleva cada change,
para analizar la eficacia y la eficiencia de la herramienta. El agente no
conoce su propio consumo, así que el dato nunca sale de él: lo lee
[`ccusage`](https://github.com/ryoppippi/ccusage), una herramienta de terceros
que interpreta los logs que los harness dejan en la máquina y les pone precio.
ChangeLedger no mantiene soporte por harness ni tablas de precios, y no añade
`ccusage` como dependencia: lo ejecuta con `npx --yes ccusage@20.0.26`.

## Activación

La captura es opcional y por clon: se activa con
`git config changeledger.usage.collector ccusage`, en cualquier ámbito que git
resuelva (local, global o de sistema), y no se versiona ni vive en
`config.yml`. Sin valor no se lanza ningún proceso ni se crea ninguna carpeta.
`changeledger check` rechaza cualquier otro valor con
`git config "changeledger.usage.collector" must be "ccusage"`, y en una
transición el valor inválido sólo omite la foto con un aviso.

## Cuándo y qué se registra

Después de que la escritura tenga éxito, cada evento de transición (`[status]`,
`[review]`, `[validation]`) y cada creación de un change (`new`, `apply` con
`target: "new"`) toman una foto. Las transiciones del viewer pasan por los
mismos comandos. Los demás comandos no fotografían.

Una foto pregunta a `ccusage` qué fuentes tienen sesiones y, por cada una, pide
sus sesiones con precios online, con la tabla offline de `ccusage` como
respaldo. Conserva sólo las sesiones cuyo `projectPath` es igual, no por
prefijo, a la ruta de la raíz del repo o de uno de sus worktrees con cada
carácter no alfanumérico sustituido por `-`. Las fuentes cuyas sesiones no traen
`projectPath` quedan fuera y se registran como excluidas. Cada sesión guarda,
por modelo, los tokens acumulados de entrada, salida, lectura y escritura de
caché, y el coste en dólares con precios de la API congelado en ese momento; un
modelo sin precio guarda `null`, nunca `0`. Los subagentes se suman a su sesión,
así que el rol sólo se distingue por el modelo.

El registro es JSON `schema: 1` con el change, el instante del evento, el evento
(`created`, `status`, `review` o `validation`), los estados de origen y destino,
el colector con su versión y su modo de precios, las sesiones, las fuentes
excluidas y un `error`. La versión de ChangeLedger de cada registro se obtiene
cruzando su instante con las líneas `[version]` del Log, sin copiarla. El
consumo de un tramo es la diferencia entre dos fotos consecutivas; `ccusage`
recalcula el coste acumulado de una sesión con los precios de cada foto, así que
un cambio de precio dentro de una sesión mezcla tablas entre dos fotos.

## Dónde viven

Los registros son una colección más del ledger, `usage`, con un archivo plano
por registro, `<id>--<YYYYMMDDTHHMMSSZ>-<sufijo>.json`: el instante es el del
evento y el sufijo son 8 caracteres hexadecimales aleatorios. Se versionan y se
comparten como el resto del ledger; la activación sigue siendo por clon, así
que cada persona decide si mide y lo que mide se comparte. Cada registro añade
`recorded_by`, la identidad que la CLI resuelve para `owner`, o `null` si no
resuelve ninguna.

- Con la ref de estado viven en `.changeledger-state/usage/`. Cada foto se
  publica después de su transición como un commit compare-and-swap propio,
  `usage: <id> <event>`, que sólo añade su registro. Si la ref avanzó se
  reintenta una vez, y si vuelve a fallar se avisa con
  `usage: record not published: <motivo>` sin tocar la transición. Como el
  sufijo aleatorio distingue las rutas de dos clones, `sync` fusiona sus
  registros sin conflicto. `mutateState` rechaza que una mutación local elimine
  un registro o cambie sus bytes; el fast-forward y la fusión de `sync` no lo
  comprueban.
- En el layout legacy viven en `.changeledger/usage/` del worktree, y
  `changeledger commit` prepara los registros pendientes del change cuyo id
  lleva el commit. Los que git ignora y no tienen seguimiento se quedan fuera
  con el aviso `usage: records ignored by git were not staged: …`, y cualquier
  otro fallo al prepararlos avisa con `usage: records not staged: …`; ninguno de
  los dos bloquea el commit.

El colector vuelve a sortear el sufijo cuando encuentra el nombre ocupado; con
la ref de estado, si no lo detecta y los bytes difieren, `mutateState` rechaza
la publicación con el aviso anterior. `cutover` e `import` llevan la colección;
`import` identifica cada registro por su nombre, y el mismo nombre con otros
bytes es conflicto.

La carga del ledger, común a la CLI y al viewer, expone los registros parseados
y asociados al id de su change en ambos layouts. `changeledger check` valida
cada uno — JSON, `schema: 1`, `change` igual al id de su nombre y forma del
nombre — con errores que empiezan por `usage record <nombre>: `. Un registro
inválido no impide cargar el resto del ledger, pero `check` lo rechaza.

## Análisis

`changeledger analyze [id] [--by segment|model|version|type|recorder] [--json]`
convierte los registros en cifras por change, sin que el agente lea los archivos
de registro. El cálculo vive en `src/usage-analysis.mjs`, puro y sin IO, para
que el panel del viewer lo reutilice.

- Por cada `recorded_by`, los registros se ordenan por `at`; los de un mismo
  change con el mismo `at` siguen la cadena de sus transiciones, nunca el
  nombre de archivo, y entre changes distintos va primero el id menor.
- Cada registro con datos se resta, sesión a sesión y modelo a modelo, contra
  los últimos valores que ese registrador vio de cada sesión, en cualquier
  registro anterior de cualquier change; una sesión que nunca vio cuenta
  entera y una sesión que decrece cuenta 0 en ese tramo.
- La diferencia va al change del registro y al tramo que cierra su transición:
  `pre-draft` para `created`, si no el estado `from`, y `rework` para un tramo
  `in-progress` cerrado en o después del primer `[review]` hacia `in-progress`
  o `blocked`, o `[validation]` hacia `in-progress`, del mismo change.
- El primer registro con datos de cada registrador es su base y no se atribuye.
  Un registro con `error` no es base ni cierra tramo: su hueco cae en el
  siguiente registro con datos del registrador.
- El coste suma una diferencia de `cost_usd` sólo cuando ambos extremos tienen
  precio y no baja; los tokens de cualquier otra diferencia van a
  `unpriced_tokens`, nunca como coste 0.
- La versión de un tramo es la del último `[version]` del Log de su change en o
  antes del registro que lo cierra, o `unknown`.

Un change sin ningún tramo atribuido no está medido: no tiene fila, suma en
`unmeasured` y, con `<id>`, sus cifras son `null`. Los avisos son hechos sin
umbrales: `rework`, `unpriced`, `anomaly`, `baseline`, `unmeasured`, `failed`
(registros con `error`) y `gap` (transiciones del Log de cualquier change entre
la base y el registro que cierra un tramo sin ningún registro en su `change` y
`at`; lo que consumió el registrador del tramo mientras ocurrían cae en ese
tramo). El contexto core nombra `analyze` como la consulta del consumo. La
opción `ids` del módulo restringe el resultado a un conjunto de changes después
de atribuir sobre todos los registros; el viewer la usa para sus filtros.

## Fallos

La captura nunca bloquea ni cambia el código de salida de una transición ya
escrita. Cada llamada a `ccusage` tiene un límite de 10 s. Un `npx` ausente, el
límite vencido, un código distinto de cero en ambos modos de precio o un JSON
inválido dejan un registro con `error` y sin sesiones, para que el hueco sea
visible, y un aviso en stderr con el prefijo `usage: `. Fuera de un repositorio
git no se escribe ningún registro.

Un supervisor de Node lanza cada llamada en su propio grupo de procesos y mata
ese grupo al vencer el límite, al recibir SIGINT, SIGTERM, SIGHUP o SIGQUIT, o
si se rompe su salida; en Windows usa `taskkill /T /F`. Un descendiente que cree
su propio grupo o sesión escapa a esa limpieza. Sólo el comando por defecto pasa
por `cmd.exe` en Windows, como una cadena de tokens fijos validados; el comando
alternativo de `CHANGELEDGER_USAGE_COMMAND`, que usan las pruebas, nunca pasa
por una shell.
