---
title: Política de dependencias
updated: 2026-06-27T21:25:58Z
tags: [ dependencies ]
---

## Política de dependencias

> Graduado del change 20260615-214818.

ChangeLedger no prohíbe dependencias runtime, pero las trata como coste de
producto: cada una debe ser madura, mantenida y proporcional al problema que
resuelve. El núcleo CLI prefiere APIs estándar de Node y código propio pequeño,
pero usa `yaml` para parsear y serializar `.changeledger/config.yml` y frontmatter porque
YAML tiene suficientes reglas y bordes como para no mantener un parser propio. En
dominios con superficie amplia o riesgo de seguridad —templates DOM, render
Markdown, sanitización HTML, diagramas— el visor usa librerías especializadas y
conocidas (`lit-html`, `marked`, `dompurify`, `mermaid`) en vez de reinventarlas.
