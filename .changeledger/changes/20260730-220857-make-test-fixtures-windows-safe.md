---
id: "20260730-220857"
title: Hacer portables los fixtures de tests en Windows
type: quick
status: done
created: 2026-07-30T22:08:57Z
depends_on: []
archived: true
reviewed: true
related_to: []
owner: rarc88
release_impact: none
---

## Request

Corregir los fixtures que fallan solo por asumir POSIX: verificar el tamaño
exacto del contexto sin invocar `/bin/sh`, resolver el directorio de suites con
`fileURLToPath()` y probar nombres no representables en NTFS mediante dobles de
la salida staged de Git, no archivos reales. Mantener intactas las aserciones:
END debe ocupar la línea publicada exacta, el barrido debe cubrir todos los
`*.test.mjs` y las rutas con comillas o saltos de línea deben conservarse
byte-exactas. El gate es `pnpm verify` en Windows Node 24/26 y no se añaden
dependencias ni cambios de producción.

## Log

- **2026-07-30T22:08:57Z** `[note]` Borrador creado tras la matriz remota: cuatro casos intentaron `spawnSync /bin/sh`, el barrido resolvió `D:\D:\...` y tres fixtures intentaron crear nombres que NTFS no representa.
- **2026-07-30T22:17:33Z** `[status]` draft → approved (human via conversation)
- **2026-07-30T22:18:23Z** `[status]` approved → in-progress
- **2026-07-30T22:20:50Z** `[note]` TDD respaldado por la matriz Windows: antes falló con spawnSync /bin/sh ENOENT, D:\D:\... y ENOENT al crear nombres no representables en NTFS. Los fixtures ahora usan salida CLI acotada en proceso, fileURLToPath y dobles staged byte-exactos; tests focalizados 168/168 y pnpm verify 1044/1044.
- **2026-07-30T22:20:58Z** `[status]` in-progress → in-validation
- **2026-07-30T23:11:59Z** `[validation]` in-validation → done (human accepted via conversation)
- **2026-07-30T23:17:07Z** `[graduation]` skipped: Cambio exclusivo de fixtures de prueba para portabilidad Windows; no añadió comportamiento ni verdad persistente del producto.
- **2026-07-30T23:17:14Z** `[archive]` archived
