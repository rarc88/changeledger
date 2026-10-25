---
title: Definition of Ready
updated: 2026-10-02T14:58:14Z
tags: [ readiness, tdd ]
graduated_from: ["20260614-162547", "20260616-151216", "20260617-020229", "20260626-115134", "20260630-225208", "20260726-141122", "20260729-185200", "20260729-203257", "20261002-113320"]
---

## Definition of Ready (retirada)

El Definition of Ready no existe: ningún fragmento del contrato, ningún motor de
`check` ni ninguna clave de configuración lo sostienen, y una clave `readiness`
que quede en `config.yml` es un error de `check` que nombra `changeledger config
migrate`. Lo retiró la épica `20261023-181733`, en su hijo `20261023-181753`.

La aprobación humana juzga sólo el `### Objective` y la `### Frontier` del
`## Request`; Specification y Plan se escriben en `in-progress` y los exige la
entrada a `in-review`. El test-first sigue siendo obligación del implementador:
`tdd` global en la configuración y `tdd: false` por change, con su porqué en el
Log (ver `templates/contract/implement.md`). La sede de esa verdad es la spec
`lifecycle.md`.
