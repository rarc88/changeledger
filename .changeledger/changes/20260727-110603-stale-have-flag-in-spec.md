---
id: "20260727-110603"
title: Retirar la referencia al flag --have de la spec
type: quick
status: done
created: 2026-07-27T11:06:03Z
depends_on: []
reviewed: true
related_to: ["20260726-124833", "20260726-130727", "20260726-141123"]
owner: raruiz-hiberuscom
---

## Request

`.changeledger/specs/contract-discovery.md` se contradice a sí misma. Su
párrafo **Sin recuperación por revisión** declara retirados el segmento
`rev:<hash>` de la línea BEGIN y el flag `--have`, pero cincuenta líneas más
abajo el bloque de bootstrap sigue instruyendo:

> Tras una compactación, el `rev` retenido se comprueba con
> `changeledger context [mode] --have <rev>` y una captura perdida o
> desactualizada se recarga por completo.

Ese comando hoy da error: `20260726-124833` eliminó el flag y `contentRev`, y
graduó la retirada a esta misma spec sin limpiar la instrucción. Verdad
persistente apuntando a superficie de CLI retirada — la clase que ya se registró
al graduar `20260726-141123`.

Se pide borrar esas dos frases. No hay verdad nueva que escribir: la retirada ya
está graduada y el resto del párrafo la contradice. El literal del centinela
BEGIN de ese mismo bloque ya se corrigió a `lines:<N>` al graduar
`20260726-130727`.

Alcance: solo esas frases de `contract-discovery.md`. Ni código, ni tests, ni
otros ficheros.

## Log
- **2026-07-27T11:06:29Z** `[status]` draft → approved (human via conversation)
- **2026-07-27T11:06:30Z** `[status]` approved → in-progress
- **2026-07-27T11:07:27Z** `[note]` Borradas las dos frases de contract-discovery.md que instruian 'changeledger context [mode] --have <rev>'. Verificado despues: las unicas menciones que quedan a rev:<hash> y --have son las de las lineas 96-98, dentro del parrafo 'Sin recuperacion por revision', que las describe en pasado como retiradas — que es lo correcto. Ningun otro fichero tocado. Gate: pnpm verify verde, changeledger check 18 valid.
- **2026-07-27T11:07:28Z** `[status]` in-progress → in-validation
- **2026-07-27T11:14:58Z** `[validation]` in-validation → done (human accepted)
- **2026-07-27T11:17:34Z** `[graduation]` spec: `contract-discovery.md`
