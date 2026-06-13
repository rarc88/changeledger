# Spec Ledger (`sl`)

> Los documentos son la fuente de verdad. El código es su reflejo.

Spec Ledger es una herramienta para **planificar antes de codificar**. Cada cambio
en un repo (feature, bug, auditoría, refactor) nace de una conversación con un
agente, se documenta como un **change** con su ciclo de vida, y queda tangible,
trackeable y accionable: qué se hizo, qué falta, qué está bloqueado.

Lo que la diferencia: una **capa de consumo humana**. No lees markdown crudo —
un visor local consolida los documentos en un tablero navegable, filtrable y
ordenado por el ciclo de vida.

## Cómo funciona

- **CLI global** (`sl`). El código del visor vive en la instalación global, no en tu repo.
- En cada repo solo viven los documentos y la config, bajo `.sl/`.
- Cualquier agente lee `AGENTS.md` y sigue la convención. Sin tooling atado a un agente.

```
sl init      # prepara .sl/ en el repo
sl view      # levanta el visor local en el navegador
sl new <tipo>  # scaffold de un change
```

## Estado

En construcción. Este repo se autodocumenta con su propio formato (dogfooding):
ver [`.sl/changes/`](.sl/changes/).

## Modelo

- **`changes/`** — deltas con ciclo de vida (lo que se está trabajando).
- **`specs/`** — verdad persistente (estado actual del sistema). _Llega cuando el primer change se gradúa._

El contrato completo para agentes está en [`AGENTS.md`](AGENTS.md).
