# Contrato transaccional entre reglas Campus y ledger (propuesta v1)

**Estado:** propuesta v1 (#28). Depende de la v1 de [ledger.md](./ledger.md) (#4). Hay que aprobarla con las dos personas antes de #10 y #17.
**Responsables:** eri2905 define este contrato e implementa el evaluador real en #17. rslnt1270 lo conecta desde `src/server/ledger/` en #10 (M3 de la revisión del PR #18).

## 1. Problema

RF-11 pide que catálogo, reglas del tutor, tope diario y saldo se validen **dentro de la misma transacción** del cobro, con la cuenta bloqueada. `cobrar` es de Pagos y las reglas y el catálogo son de Campus. Este contrato fija la frontera para que:

- Campus no escriba SQL sobre las tablas del ledger ni abra su propia transacción.
- Pagos no reimplemente las reglas de Campus.
- No haya un bypass de reglas en producción.

## 2. Interfaz

El evaluador es una **función pura y síncrona**: no recibe conexión, cliente, pool ni SQL. Pagos lee los datos con consultas fijas sobre la transacción bloqueada y se los entrega ya cargados. Campus no puede expresar ninguna consulta (ni al ledger, ni funciones con efectos, ni locks, ni `set_config`), porque la interfaz no tiene por dónde.

```ts
// src/server/ledger/reglas.ts (Pagos): solo tipos
import type { Centavos, ItemVenta } from "./index";

/** Fotografía leída por Pagos en UNA sentencia, con la cuenta bloqueada (§3). */
export type DatosReglas = {
  productos: {                   // solo los ids pedidos y solo de cooperativaId
    productoId: string;
    precioCentavos: Centavos;
    publicable: boolean;
    disponible: boolean;
    categoria: string;
    alergenos: string[];         // códigos del catálogo
  }[];
  regla: {
    alergenosProhibidosCifrado: Uint8Array | null;
    categoriasBloqueadas: string[];
    topeDiarioCentavos: Centavos | null;
  } | null;                      // null si el alumno no tiene regla
  consentimientoSaludVigente: boolean;
};

export type EntradaReglas = { items: ItemVenta[] }; // validados (ledger.md §1)

export type ResultadoReglas =
  | {
      ok: true;
      lineas: { productoId: string; cantidad: number; precioUnitarioCentavos: Centavos }[];
      topeDiarioCentavos: Centavos | null;
    }
  | { ok: false; motivo: "PRODUCTO_NO_DISPONIBLE"; productos: string[] }
  | {
      ok: false;
      motivo: "PRODUCTO_BLOQUEADO";
      productos: string[];                    // a retirar; se muestran en caja
      reglas: ("ALERGENO" | "CATEGORIA")[];   // tipo de regla; sin códigos de alérgeno
      alergenosParaConteo: string[];          // solo alimenta el conteo agregado (§5); no se registra en otra parte
    };

export type EvaluadorReglas = (datos: DatosReglas, entrada: EntradaReglas) => ResultadoReglas;
```

- Campus implementa `evaluarReglas: EvaluadorReglas` en `src/server/reglas/evaluador.ts`. Puede usar `node:crypto` de forma síncrona para descifrar los alérgenos en memoria. No puede importar `pg`, `src/server/db` ni nada de `src/server/ledger/` salvo `import type`.
- Las consultas fijas viven en `src/server/ledger/reglas-lectura.ts` (Pagos). Leen tablas de Campus (`producto`, `regla_tutor`, `consentimiento`), así que **cambiar sus columnas exige un PR a este contrato** firmado por los dos carriles.
- `src/server/ledger/index.ts` inyecta `evaluarReglas` en `cobrar`. Las pruebas de Pagos usan `crearCobrar({ evaluador })`.

## 3. Orden dentro de la transacción

Pagos lo ejecuta en `cobrar`, todo en un único `BEGIN ... COMMIT`:

1. Busca la llave de idempotencia. Si el resultado ya estaba confirmado, lo devuelve.
2. Resuelve la credencial por `token_hash` (y SDM y contador si es NTAG 424). Si es inválida, `CREDENCIAL_INVALIDA`.
3. Comprueba que el alumno esté activo y sea de la escuela de la cooperativa. Si no, `ALUMNO_INACTIVO` o `CREDENCIAL_INVALIDA`.
4. `SELECT ... FOR UPDATE` de la cuenta `ANTICIPO_ALUMNO`.
5. **Lectura única:** una sola sentencia `SELECT` (CTE) con la cuenta ya bloqueada trae los productos pedidos de esa cooperativa, la regla del alumno y si su consentimiento `DATOS_SALUD` está vigente. Con eso arma `DatosReglas`.
6. **`evaluarReglas(datos, entrada)`**. Si responde `ok: false`, se traduce a `MotivoRechazoCobro`.
7. Calcula `total = Σ cantidad × precioUnitarioCentavos` con enteros y comprueba que sea `≤ MAX_MONTO_OPERACION_CENTAVOS`.
8. Tope diario: si `topeDiarioCentavos` no es nulo y `gastadoHoy + total > tope`, `TOPE_DIARIO`. `gastadoHoy` lo calcula Pagos (compras menos reversos del día CDMX), no Campus.
9. Saldo: si `total > saldo`, `SALDO_INSUFICIENTE`. Además el `CHECK` de la BD protege aunque falle el código.
10. Escribe asientos, `DETALLE_VENTA` con los precios que devolvió el evaluador y el outbox. Luego `COMMIT`.

**Vigencia (versión coherente):** en `READ COMMITTED`, cada sentencia tiene su propia foto, y por eso reglas, consentimiento y catálogo se leen en **una sola sentencia** (paso 5). La evaluación usa exactamente el estado confirmado en el instante de esa sentencia. Nunca combina una regla vieja con un consentimiento nuevo, porque no hay dos lecturas.

- Lo que se confirme **antes** del paso 5 (cambio de regla, revocación de consentimiento, cambio de precio o de disponibilidad) se respeta en este cobro. Lo que se confirme **después** aplica desde el siguiente cobro. Es lo mismo que pide RF-15 para la credencial ("desde la siguiente lectura").
- Los escritores de Campus no necesitan bloquear la cuenta ni coordinarse con `cobrar`. Solo deben cumplir una regla: cada cambio que el tutor ve como uno solo (por ejemplo, regla más consentimiento de salud) se confirma en **una** transacción. Así nunca existe un estado intermedio que la lectura pueda observar.
- No se usa `REPEATABLE READ` ni `SERIALIZABLE`, para no agregar reintentos por conflicto de serialización en el camino del cobro (p95 de 800 ms).

Cualquier rechazo de los pasos 2 a 9 sigue [ledger.md §4](./ledger.md) en su v1: `ROLLBACK`, y auditoría y aviso en otra transacción.

## 4. Límites y tiempos

| El evaluador puede | El evaluador no puede |
| :--- | :--- |
| Calcular con `DatosReglas` y `EntradaReglas` | Recibir o importar cliente, pool, `pg` o SQL de ningún tipo |
| Descifrar `alergenosProhibidosCifrado` en memoria | Registrar alergias, nombres o reglas en logs o errores |
| Lanzar una excepción ante datos corruptos (rollback y `ErrorInterno`) | Ser `async`, hacer red, temporizadores o llamadas a modelos |
| Resolver precios desde `datos.productos` | Aceptar precios del cliente |

**Tiempos** (se distinguen tres cosas distintas):

- **Por sentencia:** `SET LOCAL statement_timeout = '200ms'` aplica a la única lectura de §3 y a cada escritura.
- **Total de la transacción:** `SET LOCAL transaction_timeout = '1500ms'` (PostgreSQL 17 o posterior; el proyecto usa 18.6). El servidor aborta la transacción completa aunque haya varias sentencias cortas, y la conexión vuelve al pool solo después del rollback. Si se vence, `ErrorReintentable` (ledger.md §1, resultado no confirmado).
- **Evaluador:** al ser síncrono y sin I/O, no puede quedarse esperando una Promise. Su costo está acotado por la entrada (máximo 20 partidas y el catálogo de una cooperativa). El presupuesto es de **5 ms p95**, medido en #17 con un catálogo de 500 productos; no hay que cancelarlo porque no puede bloquearse.

**Prueba de arquitectura (#10):** ningún archivo de `src/server/reglas/`, `src/server/catalogo/` ni `app/(pos)/` importa `pg`, `src/server/db` o módulos de valor de `src/server/ledger/`. `evaluador.ts` no exporta funciones `async`.

## 5. Reglas de negocio del evaluador

- Un producto que no existe, de otra cooperativa, con `publicable = false` o `disponible = false` da `PRODUCTO_NO_DISPONIBLE`. Esto se revisa antes que las reglas del tutor.
- `PRODUCTO_BLOQUEADO` aplica si el producto tiene un alérgeno prohibido para el alumno **y** el consentimiento `DATOS_SALUD` está vigente. Sin consentimiento vigente no se aplican reglas de alérgeno, y eso se documenta para el tutor en #14.
- `PRODUCTO_BLOQUEADO` también aplica si la categoría del producto está en `categorias_bloqueadas`.
- Si hay varios bloqueos, se devuelven todos los productos a retirar en una sola respuesta.
- Si no existe `regla_tutor`, no hay bloqueos y `topeDiarioCentavos` es nulo.

## 6. Fixtures y gate #12

- `src/server/reglas/fixtures.ts` exporta `evaluadorFijo(respuestas)` para las pruebas de Pagos (#10 y #12). Así se cubre cada `motivo` de forma determinista antes de que exista el evaluador real.
- Los fixtures **no** se importan desde `src/server/ledger/index.ts`. Solo se inyectan con `crearCobrar({ evaluador })` en pruebas.
- Una prueba de arquitectura en #10 verifica que ningún archivo fuera de `tests/` importe `fixtures.ts`, y que `NODE_ENV=production` con un evaluador distinto de `evaluarReglas` lance un error al arrancar.
- Pasos de validación: #12 valida Pagos con fixtures. #17 conecta `evaluarReglas` real y repite las pruebas de concurrencia (20/5) con reglas reales. #27 lo integra en la entrega. **Ninguna demo de producción corre con fixtures.**

## 7. Pruebas que exige el contrato

- **Pagos (#10):** cada motivo con fixtures; un evaluador que lanza excepción produce rollback sin asientos; vencer `transaction_timeout` con varias sentencias cortas y con una lenta da 503 y la conexión vuelve limpia al pool; la prueba de arquitectura de §4 falla si Campus importa `pg` o el pool.
- **Campus (#17):** alérgeno con consentimiento vigente bloquea y sin él no bloquea; categoría bloqueada; producto no publicable; varios bloqueos en una venta; ninguna consulta toca tablas del ledger; logs sin alergias.
- **Integración (#17):** 20 cobros simultáneos con reglas reales y saldo para 5 dan 5 aprobados; cambio atómico de regla y consentimiento intercalado con cobros concurrentes: cada cobro ve el estado anterior completo o el nuevo completo, nunca una mezcla; un cambio confirmado antes del paso 5 se respeta en ese cobro.

## Preguntas abiertas

- [ ] Confirmar 200 ms por sentencia, 1500 ms de transacción y 5 ms p95 del evaluador cuando se mida en #17.
