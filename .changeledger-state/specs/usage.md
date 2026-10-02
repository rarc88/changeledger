---
title: Consumo de tokens por change
updated: 2026-10-02T15:25:51Z
tags: [usage, metrics]
graduated_from: ["20261001-155612"]
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

Los registros viven en `<git-common-dir>/changeledger/usage/<id>/`, comunes a
los worktrees del clon, fuera del ledger y sin versionar.

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
