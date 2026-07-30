---
id: "20260730-220857"
title: Hacer portables los fixtures de tests en Windows
type: quick
status: approved
created: 2026-07-30T22:08:57Z
depends_on: []
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
