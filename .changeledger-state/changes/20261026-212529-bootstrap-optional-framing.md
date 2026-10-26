---
id: "20261026-212529"
title: Reescribir el bloque bootstrap para que la opcionalidad se lea primero
type: change
status: in-progress
created: 2026-10-26T21:25:29Z
depends_on: []
branch: change/20261026-212529
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

El bloque vigente ordena sus enunciados por antigüedad, no por la política que
hoy rige. Reordenarlo es suficiente: la exención por ausencia del CLI pasa a la
primera frase y la obligación queda explícitamente condicionada al entorno que sí
tiene el ejecutable. El protocolo de validez no se toca.

`BOOTSTRAP_VERSION` se queda en `4`. El salto de versión existe para forzar la
detección de cambios que `applyBootstrap` no distinguiría por sí solo; aquí no
hace falta, porque `replaceDelimited` ya clasifica como `replaced` cualquier
interior v4 distinto del publicado y `checkContract` lo reporta. Subirlo sólo
añadiría una migración a todos los repositorios consumidores sin ganar detección.

Los fixtures de `test/contract.test.mjs` y `test/register.test.mjs` mutan el
primer tramo en negrita del bloque escribiéndolo a mano. Esa literalidad es lo
que convierte cada reescritura de la prosa en una ronda de retargeting; se
sustituye por una derivación del propio `REFERENCE`, de modo que el fixture siga
al texto en vez de pincharlo.

### CR1 — La exención se lee antes que la obligación
- **Given** el bloque publicado en `REFERENCE` de `src/contract.mjs`
- **When** se localizan en su prosa la condición de ausencia `command not found` y el término que expresa obligación `mandatory`
- **Then** la condición de ausencia aparece en una posición estrictamente anterior
- **And** esa condición ordena seguir trabajando con normalidad y no emular la herramienta

### CR2 — La obligación queda condicionada al entorno que tiene el CLI
- **Given** el bloque publicado en `REFERENCE`
- **When** se aísla la frase que contiene `mandatory`
- **Then** esa misma frase condiciona la obligación a que `changeledger` esté instalado
- **And** sigue exigiendo ejecutar el comando antes de planificar, investigar, responder o editar

### CR3 — El protocolo de validez sobrevive íntegro
- **Given** el bloque publicado en `REFERENCE`
- **When** se lee su prosa aplanada
- **Then** publica literalmente `changeledger context 2>&1 | head -400`, condiciona la validez de la captura al centinela `CHANGELEDGER CONTEXT END`, explica la re-ejecución con `head -<lines>` leída de la línea `BEGIN`, distingue el fallo del ejecutable de su ausencia pidiendo decisión humana, y ordena repetir la carga como primera acción tras una compactación

### CR4 — La reescritura no necesita subir la versión del bloque
- **Given** un `AGENTS.md` con el bloque delimitado `v4` en su formulación anterior
- **When** se ejecuta `checkContract` sobre ese repositorio
- **Then** devuelve exactamente `AGENTS.md has an outdated ChangeLedger reference — run \`changeledger register\``
- **And** tras `ensureReference` el fichero contiene el nuevo texto y conserva el marcador `<!-- CHANGELEDGER BOOTSTRAP BEGIN v4 -->`

### CR5 — La formulación retirada no sobrevive en el árbol
- **Given** el repositorio excluyendo `node_modules`
- **When** se busca la cadena `it is mandatory, not optional`
- **Then** no aparece en ningún fichero versionado

### CR6 — El `AGENTS.md` de este repositorio queda instalado y válido
- **Given** este repositorio tras ejecutar `changeledger register`
- **When** se compara el bloque instalado en `AGENTS.md` con `REFERENCE`
- **Then** el bloque es byte-idéntico al publicado
- **And** `changeledger check` no reporta ningún error sobre `AGENTS.md`

### CR7 — Los fixtures derivan su anclaje en vez de escribirlo
- **Given** `test/contract.test.mjs` y `test/register.test.mjs`
- **When** un fixture necesita mutar o reflowar el primer tramo en negrita del bloque
- **Then** obtiene ese tramo de `REFERENCE` en tiempo de ejecución
- **And** ningún fixture de esos dos ficheros contiene ese tramo escrito a mano

## Plan

- [x] Derivar el anclaje de los fixtures desde `REFERENCE` y reapuntar los guards a la nueva formulación, dejándolos en rojo
  - **Target:** `test/contract.test.mjs`, `test/register.test.mjs`
  - **Verify:** `node --test test/contract.test.mjs test/register.test.mjs`
  - **Criteria:** CR1, CR2, CR5, CR7
  - **Resolved:** `2026-10-26T21:42:26Z`
- [x] Reescribir `REFERENCE` con la exención en primera posición y la obligación condicionada
  - **Target:** `src/contract.mjs`
  - **Verify:** `node --test test/contract.test.mjs test/register.test.mjs`
  - **Criteria:** CR1, CR2, CR3
  - **Resolved:** `2026-10-26T21:42:27Z`
- [x] Cubrir que el bloque `v4` anterior se reporta como desactualizado y se reescribe sin cambiar de versión
  - **Target:** `test/contract.test.mjs`
  - **Verify:** `node --test test/contract.test.mjs`
  - **Criteria:** CR4
  - **Resolved:** `2026-10-26T21:42:28Z`
- [x] Re-registrar el `AGENTS.md` de este repositorio
  - **Target:** `AGENTS.md`
  - **Verify:** `changeledger check`
  - **Criteria:** CR6
  - **Resolved:** `2026-10-26T21:42:31Z`
- [x] Revisar `README.md` y la spec `contract-discovery` con el texto nuevo delante y corregir sólo lo que haya quedado falso
  - **Support:**
  - **Resolved:** `2026-10-26T21:42:33Z`
- [x] Ejecutar `pnpm verify` sobre el candidato completo
  - **Support:**
  - **Resolved:** `2026-10-26T21:42:34Z`

## Log
- **2026-10-26T21:27:11Z** `[version]` 1.0.0
- **2026-10-26T21:27:11Z** `[status]` draft → approved (human via conversation)
- **2026-10-26T21:28:04Z** `[status]` approved → in-progress
- **2026-10-26T21:28:04Z** `[branch]` set: change/20261026-212529 (auto)
- **2026-10-26T21:28:09Z** `[branch]` set: change/20261026-212529
- **2026-10-26T21:42:40Z** `[finding]` prettierBootstrap en test/register.test.mjs conserva un .replace('> to continue; do not treat', ...) que no casa con ningún texto del REFERENCE vigente: código muerto previo a este cambio, fuera de su frontera
