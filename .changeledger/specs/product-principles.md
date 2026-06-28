---
title: Filtros de decisión y no-goals de producto
updated: 2026-06-28T01:05:07Z
tags: [product, principles, architecture]
---

# Filtros de decisión y no-goals de producto

> Graduado del change 20260627-205034.

La complejidad del core es un presupuesto limitado. Una capacidad nueva debe
reducir la complejidad total o aportar una mejora real demostrada por el uso; si
no hace ninguna de las dos, no pertenece al core.

Antes de incorporarla se evalúa:

- si resuelve un problema observado en proyectos reales;
- si puede resolverse limpiamente fuera de ChangeLedger;
- si simplifica el modelo mental lo suficiente para justificar conceptos nuevos;
- si seguirá teniendo sentido aunque cambien los agentes y editores actuales.

ChangeLedger no es un orquestador de IA, un sistema de memoria ni una plataforma
de agentes autónomos. El core no introduce automatización oculta ni dependencias
obligatorias de nube, autenticación o proveedores. Esas capacidades pueden vivir
en integraciones opcionales, pero el flujo canónico permanece determinista,
local-first, explícito y agnóstico al agente.

