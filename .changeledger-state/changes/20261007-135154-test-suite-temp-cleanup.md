---
id: "20261007-135154"
title: La suite de tests no deja directorios en el temporal del sistema
type: bug
status: in-progress
created: 2026-10-07T13:51:54Z
depends_on: []
branch: bug/20261007-135154
related_to: []
owner: rarc88
---

## Request

Cada `pnpm test` o `pnpm verify` deja entre 1.300 y 1.700 directorios en `/tmp`
(medido entre el 2026-10-02 y el 2026-10-07: `changeledger-home-*`,
`changeledger-state-repo-*`, `context-repo-*`, `changeledger-repo-*` y otros). El
2026-10-02 llegaron a agotar los inodos de `/tmp` y el gate falló por eso. Se
pide que la suite no deje nada en el directorio temporal del sistema, también
cuando falla o se interrumpe.

Queda fuera de este change reescribir cómo cada test crea sus directorios.

## Investigation

Causa raíz: unos 130 `fs.mkdtempSync(path.join(os.tmpdir(), …))` repartidos en
unos 35 archivos de test, la mayoría sin limpieza (`test/cli-bin.test.mjs` 48,
`test/registry.test.mjs` 16, `test/view.test.mjs` 15, `test/repo.test.mjs` 12,
`test/agent.test.mjs` 12…). Varios fijan `CHANGELEDGER_HOME` a nivel de módulo;
`initStateRepo` de `test/helpers/state-repo.mjs` y `test/helpers/git-env.mjs`
crean directorios sin borrarlos. Sólo algunos tests limpian con
`t.after(() => fs.rmSync(…))`.

`package.json` ejecuta `"test": "CHANGELEDGER_NO_GH=1 node --test"` y nada fija
`TMPDIR`. `os.tmpdir()` de Node lee `TMPDIR` en Linux y macOS (y `TEMP`/`TMP` en
Windows), y `node --test` lanza cada archivo en un proceso hijo que hereda el
entorno, así que un único directorio raíz por ejecución puede contener todo lo
que la suite crea.

Interfaces externas: ninguna.

## Specification

### CR1 — Una ejecución correcta no deja nada en el temporal del sistema
- **Given** el directorio temporal del sistema antes de ejecutar la suite
- **When** se ejecuta `pnpm test` y termina con código cero
- **Then** no queda en el temporal del sistema ninguna entrada creada durante la ejecución por la suite

### CR2 — Un fallo conserva su código y también limpia
- **Given** un test que falla
- **When** se ejecuta `pnpm test`
- **Then** el comando termina con el mismo código distinto de cero que `node --test`, y no queda ninguna entrada creada por la suite

### CR3 — Una interrupción también limpia
- **Given** `pnpm test` en marcha
- **When** recibe SIGINT
- **Then** termina y no queda ninguna entrada creada por la suite

### CR4 — El gate y el hook siguen funcionando
- **Given** el repo con el cambio aplicado
- **When** se ejecutan `pnpm verify` y el hook `hooks/pre-commit`
- **Then** ambos pasan como hoy y tampoco dejan entradas en el temporal del sistema

## Plan

- [x] Probar el envoltorio de la suite con un temporal propio por ejecución
  - **Target:** `scripts/run-tests.mjs, test/run-tests.test.mjs`
  - **Verify:** `node --test test/run-tests.test.mjs`
  - **Criteria:** CR1, CR2, CR3
  - **Resolved:** `2026-10-07T15:18:17Z`
- [x] Ejecutar la suite a través del envoltorio
  - **Target:** `package.json, test/run-tests.test.mjs`
  - **Verify:** `pnpm test`
  - **Criteria:** CR1, CR4
  - **Resolved:** `2026-10-07T15:18:18Z`
- [x] Ejecutar el gate completo y comprobar el temporal del sistema
  - **Target:** `package.json, hooks/pre-commit`
  - **Verify:** verify: manual — contar las entradas del temporal del sistema antes y después de `pnpm verify` y de un commit con el hook
  - **Criteria:** CR4
  - **Resolved:** `2026-10-07T15:19:20Z`

## Log
- **2026-10-07T13:51:54Z** `[version]` 0.18.0-dev
- **2026-10-07T15:03:01Z** `[status]` draft → approved (human via conversation)
- **2026-10-07T15:03:29Z** `[status]` approved → in-progress
- **2026-10-07T15:03:29Z** `[branch]` set: bug/20261007-135154 (auto)
- **2026-10-07T15:19:20Z** `[note]` Implementación delegada (subagente, tier medio), tareas 1 a 3. scripts/run-tests.mjs crea una raíz changeledger-test-* por ejecución, lanza node --test con TMPDIR, TEMP y TMP apuntando a ella, reenvía SIGINT y SIGTERM, sale con el código del hijo (130/143 en señal) y borra la raíz al terminar; package.json test pasa por el envoltorio. Antes: un pnpm test dejó 1336 entradas en /tmp. Después: pnpm test, pnpm verify (1764/1764) y hooks/pre-commit ejecutado a mano por el orquestador (este clon no tiene core.hooksPath configurado) dejan 0 entradas nuevas. Red→green de 5 tests sobre fixtures inertes (pass, fail, hang); mutantes: sin limpieza tras fallo o tras señal, sin reenvío de señal, sin propagación del código, sin redirección de TMPDIR y sin mapeo 130/143; todos fallan. Decisiones no especificadas: fixtures como .mjs inertes salvo con RUN_TESTS_FIXTURE porque node --test carga los módulos bajo test/; rmSync con maxRetries 5 y salida distinta de cero si no se puede borrar la raíz; scripts/ no se publica (files no lo incluye). Residuos: SIGKILL del envoltorio deja la raíz; Windows (TEMP/TMP) no se ejecutó; test:coverage no pasa por el envoltorio y sigue dejando entradas; un test que escriba en /tmp fijo no queda cubierto; los restos de ejecuciones anteriores siguen en /tmp.
