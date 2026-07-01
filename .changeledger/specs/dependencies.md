---
title: Política de dependencias
updated: 2026-07-01T22:23:29Z
tags: [ dependencies ]
---

## Política de dependencias

> Graduado del change 20260615-214818.
> Graduado del change 20260630-225211 (commander en la política runtime).

ChangeLedger no prohíbe dependencias runtime, pero las trata como coste de
producto: cada una debe ser madura, mantenida y proporcional al problema que
resuelve. El núcleo CLI prefiere APIs estándar de Node y código propio pequeño,
pero usa `yaml` para parsear y serializar `.changeledger/config.yml` y frontmatter porque
YAML tiene suficientes reglas y bordes como para no mantener un parser propio, y
`commander` como parser CLI maduro que centraliza argumentos, opciones,
subcomandos, errores y help en lugar de un dispatcher artesanal que habría que
mantener y documentar a mano. En
dominios con superficie amplia o riesgo de seguridad —templates DOM, render
Markdown, sanitización HTML, diagramas— el visor usa librerías especializadas y
conocidas (`lit-html`, `marked`, `dompurify`, `mermaid`) en vez de reinventarlas.
