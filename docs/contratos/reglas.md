# Contrato transaccional entre reglas Campus y ledger (propuesta v1)

**Estado:** propuesta v1 (#28). Depende de la v1 de [ledger.md](./ledger.md) (#4). Hay que aprobarla con las dos personas antes de #10 y #17.
**Responsables:** eri2905 define este contrato e implementa el evaluador real en #17. rslnt1270 lo conecta desde `src/server/ledger/` en #10 (M3 de la revisión del PR #18).

## 1. Problema

RF-11 pide que catálogo, reglas del tutor, tope diario y saldo se validen **dentro de la misma transacción** del cobro, con la cuenta bloqueada. `cobrar` es de Pagos y las reglas y el catálogo son de Campus. Este contrato fija la frontera para que:

- Campus no escriba SQL sobre las tablas del ledger ni abra su propia transacción.
- Pagos no reimplemente las reglas de Campus.
- No haya un bypass de reglas en producción.

## 2. Interfaz

El ledger define el tipo y Campus lo implementa. La dependencia en tiempo de ejecución va solo de `ledger` hacia `reglas`; `reglas` importa del ledger únicamente tipos (`import type`), así que no hay ciclo.

```ts
// src/server/ledger/reglas.ts (Pagos): solo tipos
import type { Centavos, ItemVenta } from "./index";

/** Lectura restringida sobre la transacción abierta por cobrar. */
export interface LectorTransaccional {
  /** SELECT parametrizado. Rechaza cualquier sentencia que no empiece con SELECT. */
  consultar<T>(sql: string, params: unknown[]): Promise<T[]>;
}

export type EntradaReglas = {
  cooperativaId: string;
  estudianteId: string;   // ya resuelto por Pagos desde la credencial
  items: ItemVenta[];     // validados: enteros, sin duplicados (ledger.md §1)
  ahora: string;          // now() de la BD, para reglas por horario futuras
};

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
      productos: string[];                       // a retirar; se muestran en caja
      reglas: ("ALERGENO" | "CATEGORIA")[];      // solo para auditoría agregada (RF-18)
      alergenos?: string[];                      // códigos del catálogo; solo para auditoría agregada
    };

export type EvaluadorReglas = (
  lector: LectorTransaccional,
  entrada: EntradaReglas,
) => Promise<ResultadoReglas>;
```

- Campus implementa `evaluarReglas: EvaluadorReglas` en `src/server/reglas/evaluador.ts`.
- `src/server/ledger/index.ts` lo inyecta en `cobrar`. Las pruebas de Pagos reciben el evaluador como parámetro de la fábrica interna (`crearCobrar({ evaluador })`), y lo que se exporta públicamente usa siempre `evaluarReglas`.

## 3. Orden dentro de la transacción

Pagos lo ejecuta en `cobrar`, todo en un único `BEGIN ... COMMIT`:

1. Busca la llave de idempotencia. Si el resultado ya estaba confirmado, lo devuelve.
2. Resuelve la credencial por `token_hash` (y SDM y contador si es NTAG 424). Si es inválida, `CREDENCIAL_INVALIDA`.
3. Comprueba que el alumno esté activo y sea de la escuela de la cooperativa. Si no, `ALUMNO_INACTIVO` o `CREDENCIAL_INVALIDA`.
4. `SELECT ... FOR UPDATE` de la cuenta `ANTICIPO_ALUMNO`.
5. **`evaluador(lector, entrada)`**, con el bloqueo ya tomado. Si responde `ok: false`, se traduce a `MotivoRechazoCobro`.
6. Calcula `total = Σ cantidad × precioUnitarioCentavos` con enteros y comprueba que sea `≤ MAX_MONTO_OPERACION_CENTAVOS`.
7. Tope diario: si `topeDiarioCentavos` no es nulo y `gastadoHoy + total > tope`, `TOPE_DIARIO`. `gastadoHoy` lo calcula Pagos (compras menos reversos del día CDMX), no Campus.
8. Saldo: si `total > saldo`, `SALDO_INSUFICIENTE`. Además el `CHECK` de la BD protege aunque falle el código.
9. Escribe asientos, `DETALLE_VENTA` con los precios que devolvió el evaluador y el outbox. Luego `COMMIT`.

Cualquier rechazo de los pasos 2 a 8 sigue [ledger.md §4](./ledger.md) en su v1: `ROLLBACK`, y auditoría y aviso en otra transacción.

## 4. Lo que el evaluador puede y no puede hacer

| Puede | No puede |
| :--- | :--- |
| `SELECT` sobre `producto`, `regla_tutor`, `consentimiento` y tablas de catálogo de Campus | Leer o escribir `cuenta_ledger`, `transaccion`, `asiento_contable`, `detalle_venta` o `notificacion_outbox` |
| Descifrar `alergenos_prohibidos_cifrado` en memoria | Registrar alergias, nombres o el contenido de reglas en logs o errores |
| Lanzar una excepción ante datos corruptos (implica `ROLLBACK` y `ErrorReintentable` o `ErrorInterno`) | Abrir una transacción, hacer `COMMIT`/`ROLLBACK`, usar `SET`, `LOCK`, `FOR UPDATE` o advisory locks |
| Resolver precios desde `producto.precio_centavos` | Aceptar precios del cliente |
| | Llamar servicios externos, red o modelos; tardar más de **50 ms** (p95) |

Pagos impone esto así:

- `LectorTransaccional` rechaza cualquier sentencia que no empiece con `SELECT` y las que contengan `FOR UPDATE`/`FOR SHARE`.
- El rol de BD de la aplicación es uno solo, así que la lista de tablas prohibidas se comprueba en las pruebas de #17 (auditoría de las consultas emitidas), no con permisos.
- `SET LOCAL statement_timeout = '200ms'` alrededor del paso 5. Si se vence, `ErrorReintentable`.

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

- **Pagos (#10):** cada motivo con fixtures; un evaluador que lanza excepción produce rollback sin asientos; el timeout del evaluador da 503; un evaluador que intenta `INSERT` o `FOR UPDATE` es rechazado por el lector.
- **Campus (#17):** alérgeno con consentimiento vigente bloquea y sin él no bloquea; categoría bloqueada; producto no publicable; varios bloqueos en una venta; ninguna consulta toca tablas del ledger; logs sin alergias.
- **Integración (#17):** 20 cobros simultáneos con reglas reales y saldo para 5 dan 5 aprobados; un cambio de regla del tutor confirmado antes del bloqueo de la cuenta se respeta en el siguiente cobro.

## Preguntas abiertas

- [ ] Si un tutor cambia una regla mientras hay un cobro en curso, se aplica la versión que se lea después del `FOR UPDATE` de la cuenta. ¿Basta, o la actualización de reglas también debe bloquear la cuenta?
- [ ] ¿50 ms p95 y 200 ms de timeout son razonables con el catálogo de una cooperativa típica?
