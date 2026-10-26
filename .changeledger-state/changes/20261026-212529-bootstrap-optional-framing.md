---
id: "20261026-212529"
title: Reescribir el bloque bootstrap para que la opcionalidad se lea primero
type: change
status: approved
created: 2026-10-26T21:25:29Z
depends_on: []
related_to:
  - "20260720-212659"
  - "20260629-155349"
  - "20260726-124834"
  - "20260701-213931"
  - "20260711-103803"
  - "20261020-130304"
owner: Roberto Ruiz
---

## Request

Parte del equipo no trabaja con ChangeLedger y le molesta la referencia
obligatoria del `AGENTS.md`. La reacción observada es reescribir el bloque a
mano por un párrafo propio que declara la herramienta «opcional» y subordina el
contrato al resto del fichero. Se busca una forma de convivencia que no dependa
de la buena voluntad de cada persona.

### Investigación

La convivencia funcional ya está entregada: `#20260720-212659` hizo que la
adopción dependa de que el CLI esté disponible, y el bloque vigente lo publica
en `src/contract.mjs` (`REFERENCE`):

> Command not installed (`command not found`) → ChangeLedger is absent:
> continue the task normally and never emulate it.

Quien no tiene el ejecutable instalado no pierde nada hoy. La fricción no es
funcional, es de lectura. `AGENTS.md` lo leen también las personas, y sus dos
primeras líneas afirman un gobierno sobre el repositorio y una obligación
absoluta:

> **ChangeLedger governs this repo.** Before planning, investigating, answering
> or editing anything, run exactly this — it is mandatory, not optional:

La obligación real es mucho más estrecha que esa frase: lo obligatorio es
*intentar el comando* y no inventarse el contrato; el gobierno sólo existe si el
comando responde. El texto no dice eso en ese orden, y la puerta de salida está
en el tercer bullet, detrás de dos bullets de protocolo anti-truncado que sólo
importan a quien sí carga contexto. El resultado es que un colaborador que no usa
la herramienta lee una imposición que, en su entorno, no se le aplica.

El párrafo que el equipo escribe en su lugar no es una redacción más suave, es
una degradación semántica: retira el centinela `CHANGELEDGER CONTEXT END`, con lo
que una captura truncada pasa a ser contexto válido — el fallo que costó
`#20260629-155349` y `#20260726-124834` —; borra la distinción entre ausente y
roto, convirtiendo una instalación rota en bypass silencioso; e invierte la
autoridad («si choca con algo de este fichero, manda este fichero»).

Además no sobrevive. El bloque está administrado entre delimitadores
(`#20260711-103803`): `applyBootstrap` en `src/contract.mjs` clasifica cualquier
interior distinto del publicado como `replaced`, `changeledger register` lo
reescribe y `checkContract` lo reporta como error de repositorio
(`AGENTS.md has an outdated ChangeLedger reference`), que `changeledger check`
eleva en `pnpm verify` y en el hook de pre-commit. El parche manual rompe el gate
de todo el equipo, incluido el de quien no usa la herramienta.

La evidencia que faltaba en `#20260720-212659` —que descartó explícitamente
flags de opt-out «sin evidencia de que la disponibilidad del CLI sea un proxy
insuficiente»— ya existe, pero apunta a la redacción y al orden de lectura, no al
mecanismo: el proxy sigue siendo correcto, lo que falla es que el bloque no lo
cuenta en primer lugar.

Sobre la versión del bloque: `BOOTSTRAP_VERSION` se sube «only when the
delimited block's shape or required content changes in a way that must be
detected and re-registered in consuming repos». Un cambio de prosa dentro de v4
ya se detecta como `replaced` y se corrige con `register`, de modo que un salto a
v5 no es evidentemente necesario. La decisión se toma en la Specification, con el
código delante.

Hay guards que pinchan literalmente la frase que se quiere cambiar, al menos
`test/contract.test.mjs` («the block must state the mandatory framing
literally»). Reapuntarlos a la obligación vigente es parte del trabajo, no un
daño colateral.

### Propuesta

Reescribir `REFERENCE` para que el orden de lectura corresponda a la política ya
decidida:

1. la primera frase dice que si `changeledger` no está en el entorno se sigue
   trabajando con normalidad y no se emula nada;
2. la segunda ancla la obligación en el intento del comando y en que, si
   responde, su contexto gobierna el trabajo;
3. el protocolo de validez (centinela `END`, captura completa, ausente ≠ roto,
   recarga tras compactación) se conserva íntegro, después.

No se añade configuración, flag de opt-out ni un segundo bloque paralelo: el
bloque administrado sigue siendo el único sitio donde esto se dice, y pasa a
contestar la queja por sí mismo, de modo que nadie tenga motivo para reescribirlo.

Alternativas descartadas: bajar el bloque al pie del `AGENTS.md` no responde a la
queja de fondo y degrada el discovery temprano decidido en `#20260701-213931`;
un opt-out por configuración fragmenta la única puerta de entrada del repositorio
y sigue sin justificarse, porque la evidencia disponible señala la redacción.

### Objective

El bloque bootstrap administrado cuenta, en su primera lectura, que ChangeLedger
sólo gobierna el trabajo cuando el CLI está disponible, conservando intactas las
garantías de captura completa, centinela `END`, distinción entre ausencia y
fallo, y recarga tras compactación. Está terminado cuando el bloque publicado por
`src/contract.mjs` dice eso en ese orden, el `AGENTS.md` de este repositorio lo
lleva instalado, los guards apuntan a la obligación y no a su antigua
formulación, y `pnpm verify` pasa.

### Frontier

Dentro: el texto de `REFERENCE` en `src/contract.mjs`; la decisión sobre
`BOOTSTRAP_VERSION`, que queda pre-autorizada en cualquiera de sus dos sentidos;
los guards de `test/contract.test.mjs` y de `test/register.test.mjs` que pinchan
la formulación retirada; el `AGENTS.md` de este repositorio, re-registrado; la
documentación de este modelo de adopción en `README.md` y en la spec
`contract-discovery` si el texto vigente queda falso.

Fuera: el mecanismo de discovery y sus delimitadores; la ubicación del bloque
dentro del `AGENTS.md`; cualquier opt-out por configuración o por usuario;
el contenido de `templates/contract/` y sus presupuestos; el comportamiento de
`register`, `check` e `init` más allá de la prosa que publican.

## Specification

## Plan

## Log
- **2026-10-26T21:27:11Z** `[version]` 1.0.0
- **2026-10-26T21:27:11Z** `[status]` draft → approved (human via conversation)
