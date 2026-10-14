# ChangeLedger v1.0 — plan de recorte

Base: auditoría regla a regla de los 22 fragmentos del contrato, las 44 claves de
configuración, los 48 ficheros de test y los 1.648 changes de los tres repos
(`changeledger` 358, `ionic-app` 406, `backend-laravel` 884).
Todo número está medido salvo donde se dice lo contrario.

---

## 1. El recorte del contrato

| Bloque | Hoy | Después | Eliminar / Suavizar / Mantener |
|---|---|---|---|
| `core.md` | 2.141 | ~960 | 26 / 22 / 17 |
| `spec` + `readiness` | 1.514 | ~690 | 18 / 14 / 22 |
| `implement` + `delegation` + `handoff` | 1.963 | ~700 | 36 / 19 / 24 |
| `review` + `close` + 4 overlays | 1.994 | ~890 | 44 / 6 / 24 |
| 10 cápsulas de agente | 2.272 | ~300 | 8 / 2 / 0 |
| **Total** | **9.884** | **~3.590** | **132 fuera / 63 comprimidas / 87 intactas / 3 nuevas** |

**Coste real por mensaje** (nadie carga el contrato entero):

| Contexto | Hoy | Después |
|---|---|---|
| Clasificar intención (solo core) | 2.141 | ~960 |
| Implementar (core + implement) | 3.693 | **~1.460** |
| Documentar (core + spec) | 3.263 | ~1.650 |
| Revisar (core + review) | 2.752 | ~1.410 |

Ficheros de contrato: **22 → 9**. Claves de configuración: **44 → 23**.

---

## 2. Qué desaparece y por qué

### 2.1 Duplicación pura — cero pérdida de garantías

- `validation.md` entero: nueve reformulaciones de invariantes de `core.md`.
- `discarded.md` entero: 31 palabras que repiten dos líneas del core, con un
  presupuesto de overlay de 1.250 tokens asignado.
- `core.md` se duplica a sí mismo seis veces ("nunca implementar un draft", "el
  veredicto humano se transmite", "sin ediciones silenciosas", la vía `quick`…).
- El párrafo del "delta esperado" de `implement.md`: 175 palabras de exégesis
  sobre las clases de commit.
- Las listas de flags de CLI dentro del contrato: `changeledger <cmd> --help`
  ya es la fuente.

### 2.2 Defensas contra fallos de modelo de junio de 2026

- El estándar de cuantificadores universales y su contabilidad (el implementador
  lista cada frase, el revisor la escruta). Su efecto medible es discutir
  redacción: el **20,8 %** de las vueltas de revisión en los repos de producto.
- "No copiar la checklist de la cápsula en el contexto del orquestador".
- "Tratar cifras y números de línea recibidos como datos a verificar".
- "Restaurar un mutante editando, nunca con git, y probar que el fichero está limpio".
- "Cargar `context review` una sola vez; no recargar".

### 2.3 Capacidades retiradas por decisión

- `in-validation` y `blocked` como estados; `reopen` y `validation` como comandos.
- El aislamiento de correcciones completo: corrección sin commitear,
  re-transición a `in-review`, revisión de confirmación y prohibición de
  trabajar en otra cosa mientras espera.
- El `Definition of Ready` test-grade y sus `readiness.*_patterns`.
- El `graduation-review` delegado.
- 8 de las 10 cápsulas de agente: duplican `delegation.md`.
- La matriz `types.*.stages`, `review_required` por tipo y `tdd` por tipo.
- Con ruptura limpia: `config migrate` y los tres modos de migración de `fix`.

### 2.4 Lo que sale del core pero no del producto

La semántica de `sync` (~165 palabras dentro de lo que carga *todo* agente en
*cada* mensaje) se muda a `global-state.md`, cargado solo cuando aplica. Lo usa
1 de los 3 repos.

---

## 3. El modelo de aprobación nuevo

Es el cambio de fondo; el resto del recorte sirve a esto.

**Hoy** el humano aprueba un draft que ya trae Specification y Plan, escritos
antes de que nadie contrastara nada con el código. **Después** aprueba dos cosas
y nada más:

- **El objetivo** — qué problema se resuelve y qué significa terminado.
- **La frontera** — qué superficie entra, qué queda fuera y qué queda
  pre-autorizado dentro de ella.

Specification y Plan se escriben ya en `in-progress`, con el código delante, y
**no vuelven a pasar por aprobación**. Reescribirlos durante la implementación es
el comportamiento esperado: git ya versiona el documento.

Por qué: la mediana de un change de producto son 4-6 tareas y **aun así el 50 %
se desvía** (49 % en `ionic-app`, 50 % en `backend-laravel`). A ese tamaño el
problema ya no es que el change fuera grande: es que se planifica antes de
investigar. Mover la puerta no tolera ese 50 %, lo vuelve irrelevante.

### 3.1 Qué entra en el trabajo y qué no

> Entra lo que **tiene que ser cierto** para que el objetivo aprobado se cumpla.
> Sale lo que, si no se hace, **deja el objetivo cumplido igual**.

Un bug que bloquea el objetivo es el trabajo. Un bug encontrado de camino que no
impide terminar, no — aunque esté en el mismo fichero.

Sustituye a *"if related work materially expands observable scope, obtain
explicit human authorization"*, que obliga a discutir qué es "material" cada vez.
El test nuevo es falsable; el viejo no.

### 3.2 La frontera puede pre-autorizar

La frontera no solo dice qué queda fuera: dice qué queda permitido sin volver a
preguntar. Por ejemplo *"objetivo X, y dentro de `src/pagos/**` arregla lo que
encuentres"*. El agente no decide unilateralmente y tampoco interrumpe quince veces.

### 3.3 La salida barata: `[finding]`

**751 de los 1.648 changes registran un residuo o algo fuera de alcance** — como
prosa suelta en una entrada `[note]` del Log, dentro de un change que hoy está
cerrado y archivado. No hay campo estructurado, ningún comando los lista y
`changeledger list --pending` solo tiene `graduation` y `archive`. Se escriben y
se evaporan.

Hoy solo hay dos caminos: meterlo en el change activo (y que no termine) o abrir
otro change completo con draft, aprobación y ciclo (change tras change). Falta
el del medio:

- **`[finding]`, décimo tipo de evento del Log.** El Log ya tiene nueve tipos con
  gramática validada. Sin almacenamiento nuevo, sin fichero nuevo, sin estado nuevo.
- **`changeledger list --pending findings`** los saca de todo el ledger.
- **Promoción a change** cuando el humano lo decide, no cuando el agente tropieza.

---

## 4. Lo que se queda, y qué lo sostiene

| Garantía | Evidencia |
|---|---|
| Revisión independiente por subagente con contexto limpio | **334 de 466** vueltas en repos de producto (71,7 %) encontraron defectos funcionales o huecos de test; 120 de 174 aquí (69 %) |
| Aprobación humana explícita | Única puerta de control sobre lo que se construye |
| Un concern por change; cambiar objetivo o frontera exige autorización | Lo que hace el change revertible y aprobable (§3) |
| Nunca implementar en la rama de integración ni en la de release | Defecto funcional demostrado y caro de deshacer |
| Trazabilidad `type(scope): desc [#id]` + `check --commits` | 1.202 de 1.566 commits; lo verifica la máquina |
| Toda selección commiteada antes de delegar la revisión | Sin esto la revisión no es auditable |
| TDD: test rojo desde el criterio, verde, refactor | Verificable en el diff |
| Reproducir el defecto y mostrar el test fallando antes del arreglo | Única prueba de que el test cubre el defecto; el 24 % de las vueltas son huecos de test |
| Graduación a specs | 44.903 líneas vivas en los repos consumidores (56 y 190 specs) |
| Delegación de un solo nivel; un dueño por superficie de escritura | Evita cadenas de auto-delegación y ediciones perdidas |
| Taxonomía de fallos: enumeración incompleta vs clase nueva | Evita repetir rondas por el mismo defecto |
| Triaje de fricción al entregar | Ahora con mecanismo: `[finding]` (§3.3) |

La taxonomía de `blocked.md` **no muere con el estado**: se muda a `review.md` y
pasa a cubrir también el rechazo humano.

---

## 5. El contrato nuevo

| Fragmento | Palabras | Contenido |
|---|---|---|
| `core.md` | ~960 | marco, tabla de intención, propiedad del trabajo, invariantes, ciclo, commits |
| `spec.md` | ~690 | formato del change, frontmatter, CRs, gramática de Plan, idioma |
| `implement.md` | ~500 | ramas, ejecución, comandos de mutación, gate de salida, evidencia |
| `review.md` | ~450 | revisión independiente, veredictos, taxonomía de fallos |
| `close.md` | ~350 | graduación y reconciliación de specs |
| `delegation.md` | ~200 | criterio de delegación y contrato de prompt (absorbe `handoff`) |
| `global-state.md` | ~165 | `cutover`, `activate`, `sync` — fuera del core |
| `agent-contexts/review.md` | ~150 | checklist del revisor |
| `agent-prompts/review.md` | ~150 | esqueleto del prompt de revisión |

Desaparecen como ficheros: `readiness`, `validation`, `blocked`, `discarded`,
`handoff` y 8 de las 10 cápsulas.

---

## 6. Lo que se añade

El recorte quita 132 reglas y añade tres. Las tres se pagan con lo que sustituyen.

### 6.1 Test de alcance y frontera pre-autorizada (§3.1, §3.2)

Sustituye a las tres formulaciones actuales del límite de alcance, repartidas
entre `core.md`, `spec.md` e `implement.md`. **Neto: ~30 palabras menos.**

### 6.2 `[finding]`, décimo tipo de evento del Log (§3.3)

~55 palabras entre la gramática de eventos de `implement.md` y la lista de
descubrimiento de `core.md`. Compra una salida barata para los 751 residuos que
hoy se evaporan.

### 6.3 Ninguna referencia al ledger fuera de `.changeledger/`

Nada en el contrato pide hoy que el código cite `CRn`. La dirección escrita ya es
la correcta. Las referencias vienen del incentivo: `agent-contexts/review.md`
manda al revisor inspeccionar *"every `CRn`"*, y el implementador estampa el CR
donde el revisor lo encuentre. Y es estructural: el DoR exige que cada tarea cite
CRs y que cada CR sea test-grade, así que la salida natural es un test por CR.

Dónde están hoy:

| Repo | Dónde | Ids de change | `CRn` |
|---|---|---|---|
| ionic-app | **código de producción** (82 de 1.477 ficheros) | 282 | 238 |
| ionic-app | `*.spec.ts` | 227 | 809 |
| backend-laravel | **`database/`** (migraciones) | 266 | 81 |
| backend-laravel | `resources/` | 40 | 29 |
| backend-laravel | `tests/` | 2.601 | 8.179 |
| changeledger | `test/` | — | 2.543 |

**936 referencias viven en artefactos que no son tests**, incluidas 266 dentro de
migraciones de Laravel.

Y no es un problema futuro: de las 948 líneas de `ionic-app` que mencionan un
`CRn`, **756 no llevan el id del change en la misma línea**. `CR1` a secas
aparece 154 veces en 50 ficheros, en un repo con 406 changes. **Ya no se pueden
resolver hoy, con ChangeLedger funcionando.**

La regla:

> Ningún fichero fuera de `.changeledger/` contiene un id de change ni un `CRn`.
> La referencia va siempre del change al código — `Target`, `Verify`, y el
> marcador `[#id]` del commit, donde una máquina la verifica.

Dos cambios, no uno: la prohibición (~25 palabras) y **quitar el incentivo** — la
checklist del revisor deja de recorrer "cada `CRn`" y verifica el comportamiento
que el change declara.

Red mecánica: un grep en el `pre-commit` de cada repo. No en `changeledger check`,
que obligaría a la herramienta a leer el árbol fuente. Las referencias existentes
se quedan como están.

**Coste total de lo añadido: ~50 palabras netas.** El contrato queda en ~3.590.

---

## 7. La regla de producto que evita la recaída

El contrato creció 2.042 → 9.884 palabras en cuatro meses sin bajar nunca
(v0.6.0 2.042 · v0.10.0 6.542 · v0.13.0 7.047 · v0.15.0 8.519 · v0.17.0 8.939 ·
v0.18.0 9.884). `budgets.yml` tenía techos y jamás se usaron para recortar, solo
para autorizar crecimiento hasta ellos.

> El techo del contrato es **decreciente**. Una regla nueva solo entra si sale
> otra. Un techo es para recortar, no para gastar.

---

## 8. Migración

| | Cantidad |
|---|---|
| Changes en los tres repos | 1.648 |
| Terminales (done/discarded): nada que migrar | 1.587 |
| Vivos | 61 |
| En un estado que desaparece (`in-validation`, `blocked`) | **17** |

Las specs no se tocan. El frontmatter sobrante (`reviewed`, `graduated_from`) lo
ignora el esquema nuevo. La migración es un comando que corre una vez sobre 17
documentos.

---

## 9. La poda del repositorio

Barrido de los 48 ficheros y 46.389 LOC de la suite, caso por caso.

| Grupo | LOC | Eliminables | % |
|---|---|---|---|
| Estado global + usage | 7.860 | 386 | 4,9 % |
| Comandos y utilidades | 8.076 | 838 | 10,4 % |
| Viewer | 9.711 | 1.208 | 12,4 % |
| Ciclo de vida y CLI | 8.714 | 1.885 | 21,6 % |
| Contrato y cápsulas | 5.421 | 2.510 | 46,3 % |
| `check` y migraciones | 6.607 | 3.515 | 53,2 % |
| **Total** | **46.389** | **10.342** | **22,3 %** |

**El reparto es bimodal.** Los tests de producto sobran entre un 5 % y un 12 %;
los de metodología, la mitad. No hay suite hinchada: hay una capa de tests sobre
el método mezclada con una suite sana.

### 9.1 De los 502 casos que no son comportamiento

| Categoría | Casos | ¿Hay que decidir algo? |
|---|---|---|
| Capacidad retirada | 254 | No: caen con el plan |
| Prosa del contrato | 67 | No: caen con el recorte del contrato |
| Duplicado | 123 | Sí: deuda independiente |
| Sintético | 58 | Sí: deuda independiente |

Unos dos tercios del recorte vienen incluidos con lo ya decidido.

### 9.2 El dividendo de la ruptura limpia

`config-migration.test.mjs` son 1.648 LOC y **sobreviven 2 de sus 57 casos**: que
un esquema futuro falle cerrado y que `init` escriba el esquema actual. Lo demás
prueba una cadena de migraciones entre seis esquemas que v1.0 no tiene. Con las
501 LOC de `src/config-migration.mjs`, la ruptura limpia vale **~2.080 líneas**,
sin tocar datos ni comportamiento.

### 9.3 Código de producción que cae con el DoR

El motor de readiness ocupa **134 de las 1.081 LOC de `src/check.mjs` (12 %)**:
patrones en 806-885, validador de config en 1026-1047, las comprobaciones
test-grade dentro de `checkCoverage` y el resolutor del flag `tdd` en 42-61.

### 9.4 Tests que no prueban el producto

En cuatro sitios: helpers de la suite verificados como si fueran producto
(`usage-collector`), greps sobre el propio fichero fuente (`fix`, `cli-bin`),
aserciones sobre la ausencia de un diagnóstico que nunca existió (`check`) y un
barrido que se prueba a sí mismo (`git-env`). Más un test cuyo comentario admite
que no ejercita el error 500 que dice cubrir (`view`) y otro que reimplementa en
el test el ternario que debería probar (`viewer-routing`).

### 9.5 Por qué la duplicación era invisible

**1.558 de los 1.854 casos (84 %) llevan un `CRn` en el nombre y 1.343 (72 %)
empiezan por un id de change.** La suite es un test por criterio por change,
acumulado cuatro meses y nunca consolidado. Como cada nombre lleva un id
distinto, dos tests que prueban lo mismo **nunca colisionan textualmente**: en
toda la suite hay exactamente **dos** nombres repetidos. Los 123 duplicados
reales solo aparecen leyendo.

Densidad: 25 LOC por caso, 7,5 LOC por aserción, 6.168 aserciones.

### 9.6 Ratios

| | Test | Fuente | Ratio |
|---|---|---|---|
| Global | 46.389 | 22.174 | 2,09:1 |
| Viewer | 9.711 | 8.000 | 1,21:1 |
| CLI | 36.678 | 14.174 | 2,59:1 |

Tras la poda, la suite queda en ~36.000 LOC.

---

## 10. El repositorio, antes y después

| | Hoy | Después | Certeza |
|---|---|---|---|
| Contrato normativo | 9.884 palabras | ~3.590 | medido regla a regla |
| Ficheros de contrato | 22 | 9 | medido |
| Claves de configuración | 44 | 23 | medido |
| Carga por mensaje al implementar | 3.693 palabras | ~1.460 | medido |
| Suite de tests | 46.389 LOC | ~36.000 | medido caso a caso |
| `src/` + `bin/` sin viewer | 14.174 LOC | ~12.400 | **estimado** |
| Viewer | 8.000 LOC | ~7.800 | **estimado** |
| **Total del repo** | **68.563 LOC** | **~56.200** | |

Lo único sin medir caso a caso es el código de producción que cae al retirar
estados y comandos: `config-migration.mjs` (501) y los modos de migración de
`fix` (664) son seguros, el motor de readiness de `check.mjs` (134) está medido,
y lo que se encoge en `agent.mjs`, `lifecycle.mjs` y el dominio del viewer es
estimación hasta hacer el corte.

---

## 11. Decisiones abiertas

| # | Cuestión | Estado |
|---|---|---|
| 1 | **`in-validation`**: se decidió sustituirlo por el PR, pero es una suposición sin medir — **272 rechazos humanos** registrados, 15 % en `ionic-app`. Alternativa: conservar la aceptación como campo, no como estado, y que el merge del PR la registre. Conservas la métrica, borras la ceremonia. | pendiente de revisar |
| 2 | **La poda de la suite**: ¿entra con el recorte o va aparte? | medida (§9); sin decidir |
| 3 | **Secuencia**: cuatro changes simultáneos sobre la herramienta que gobierna su propio desarrollo, frente a cortar el contrato primero y solo el contrato — migración cero, reversible con `git revert` — y medir dos semanas. | sin decidir |
| 4 | **Cadencia de revisión** (hipótesis, sin dato): hoy es una sola puerta al final y el 32 % de las veces devuelve el change entero. Una revisión por selección resuelta cazaría lo mismo con menos retrabajo. | sin investigar |

---

## 12. Cómo bajar de 3.000 palabras si se quiere

1. **`delegation.md` dentro de `core.md`** (~100 palabras de solape). Sin pérdida.
2. **Comprimir el bloque de commits del core** (~400 palabras, el más denso) a una
   tabla de tres clases. Pérdida: los ejemplos que desambiguan.
3. **Soltar las obligaciones de evidencia que sobreviven** — reproducir el
   defecto, mostrar el test en rojo (~120 palabras). **No lo recomiendo**: el
   24 % de las vueltas de revisión son huecos de test y esas reglas los destapan.

Con 1 y 2: ~3.040. Con las tres: ~2.920. Recomendación: parar en 1 y 2.

---

## 13. Los cuatro changes propuestos

1. **Ciclo de vida** — 8 estados → 6; fuera `in-validation`, `blocked`, `reopen`,
   `validation` y el aislamiento de correcciones. Toca `lifecycle.mjs`,
   `agent.mjs`, `check.mjs`, el viewer y la CLI.
2. **Tipos y config** — 6 tipos → 2, etapas → 3, fuera `readiness.*` y 21 claves.
   Toca `config.mjs`, `new.mjs`, `check.mjs`.
3. **Contrato** — 22 fragmentos → 9, presupuestos nuevos, las tres reglas
   añadidas. Migración cero y reversible.
4. **Cápsulas y prompts** — 10 → 2.

La poda de la suite (§9) viaja con el change que retira cada capacidad; los 181
casos de deuda independiente (duplicados y sintéticos) son un quinto change
opcional.
