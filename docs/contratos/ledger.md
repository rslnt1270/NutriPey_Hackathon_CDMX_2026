# Contrato del Ledger (propuesta v1)

**Estado:** propuesta v1 (#4). Hay que aprobarla con las dos personas antes de implementar #6, #7, #10 y #29.
**Dueño:** carril Pagos. **Consumidores:** carril Campus, webhook pey, conciliador y caja.
**Ubicación del código:** `src/server/ledger/index.ts`.

Fuera de Pagos, nadie escribe SQL sobre `cuenta_ledger`, `transaccion`, `asiento_contable`, `detalle_venta` ni `notificacion_outbox`; solo se usan estas funciones. Para cambiar una firma hace falta un PR propio a este archivo que suba la versión.

La integración con las reglas de Campus dentro de `cobrar` se define en `reglas.md` (#28, PR propio). Los avisos que generan estas funciones se definen en [notificaciones.md](./notificaciones.md).

---

## 1. Convenciones

### Montos

```ts
/** Entero seguro y mayor o igual a 0. Nunca float ni decimal. */
type Centavos = number;
```

- En TypeScript, un monto es válido solo si `Number.isSafeInteger(x) && x >= 0`. Los montos de una operación (`montoCentavos`, total de una venta) además deben ser `> 0`.
- Tope por operación: `MAX_MONTO_OPERACION_CENTAVOS = 1_000_000` ($10,000.00). Lo que exceda ese tope se rechaza como `ErrorEntrada` antes de abrir la transacción. Ningún saldo se acerca a 2^53, así que `number` alcanza sin perder precisión.
- En SQL se usa `bigint`. El driver `pg` devuelve `bigint` como string; la capa del ledger lo convierte con `BigInt`, comprueba que esté en el rango seguro y solo entonces lo devuelve como `number`. Si queda fuera de rango lanza `ErrorInterno`; nunca redondea.
- En JSON viaja un entero (`1250`). Los strings con decimales o notación científica se rechazan.
- Solo los bordes convierten a pesos: el cliente pey (que usa `amount` en pesos según su OpenAPI) y la pantalla. Los dos convierten con aritmética entera y tienen pruebas.

### Cantidades

`cantidad` es un entero en `[1, 50]` por partida. Una venta lleva entre 1 y 20 partidas y no repite `productoId`; si se repite, es `ErrorEntrada`.

### Identificadores y fechas

- Los IDs son UUID en texto. Las fechas van en ISO 8601 UTC.
- "Hoy" para el tope diario y el mes de RN-02 se calculan en `America/Mexico_City`.

### Llaves de idempotencia

- Las genera quien origina la operación (POS, caja o administración) como UUID v4: una por intención de negocio, no por intento HTTP.
- El ámbito es `(cooperativaId, operación, idempotencyKey)`.
- Si la misma llave llega con otra entrada, el resultado es `ErrorIdempotencia` (409) y no hay ningún efecto.
- Repetir una llave cuya operación se **confirmó** devuelve exactamente el resultado original, aunque el estado haya cambiado después. Antes de devolverlo se vuelve a comprobar que el operador actual esté activo en esa cooperativa; si no, `ErrorNoAutorizado`.
- Un **rechazo de negocio** no crea `TRANSACCION`. Si la misma llave se reintenta, la operación se vuelve a evaluar (el tutor pudo recargar en el intermedio). Un 422 no autoriza un reintento automático: lo decide el cajero.

### Registro de intención

La vinculación llave↔entrada vive en una tabla propia, `intento_operacion`, que no es un asiento financiero:

| Columna | Uso |
| :--- | :--- |
| `id` | UUID generado por el servidor; es la identidad canónica de la intención (la usan auditoría y outbox) |
| `cooperativa_id`, `operacion`, `llave` | `UNIQUE (cooperativa_id, operacion, llave)` |
| `hash_entrada` | SHA-256 de la entrada canónica |
| `estado` | `EN_CURSO` → `CONFIRMADA` \| `RECHAZADA` (`RECHAZADA` puede volver a `EN_CURSO` al reevaluar) |
| `evaluaciones`, `ultimo_motivo` | Contador de evaluaciones y último motivo de rechazo |
| `resultado`, `transaccion_id` | Solo en `CONFIRMADA`; `resultado` es el JSON devuelto |

1. **Alta**, en su propia transacción corta y antes de la del dinero: `INSERT ... ON CONFLICT DO NOTHING` y luego se lee la fila. Si el hash no coincide, 409. Esta fila **sobrevive** a cualquier rollback posterior.
2. **Operación:** la transacción del dinero bloquea primero la fila de intención (`FOR UPDATE`), y después la cuenta. Dos solicitudes simultáneas con la misma llave quedan en serie: la segunda ve `CONFIRMADA` y devuelve el resultado, o ve `RECHAZADA`/`EN_CURSO` y reevalúa.
3. **Éxito:** en la misma transacción del dinero se marca `CONFIRMADA` con `resultado` y `transaccion_id`.
4. **Rechazo:** rollback del dinero y, en otra transacción, `RECHAZADA` más `evaluaciones + 1`, `ultimo_motivo`, auditoría y outbox (sección 4).
5. La vinculación llave↔hash es **permanente**, aunque la ejecución se haya abortado por completo. Una llave nunca se reutiliza con otra entrada.

**Entrada canónica:** JSON con las claves en orden alfabético, sin espacios, con `operacion` y `cooperativaId` incluidos. En `cobrar` entra `sha256(tokenCredencial)` y no el token crudo, y las partidas se ordenan por `productoId`. `operadorId` **no** entra en el hash (otro cajero puede reintentar la venta), pero se autoriza en cada llamada.

### Errores

Hay dos familias que no se mezclan:

1. **Resultado de negocio** (`ok: false`). Se devuelve como valor, es definitivo para ese estado y no se reintenta solo.
2. **Excepciones** (`throw`). Son errores del sistema o de entrada:

```ts
class ErrorEntrada extends Error {}       // validación previa; 400; no reintentar
class ErrorIdempotencia extends Error {}  // llave reutilizada con otra entrada; 409
class ErrorNoAutorizado extends Error {}  // operador/ámbito inválido; 403
class ErrorReintentable extends Error {}  // resultado NO CONFIRMADO al llamador; 503
class ErrorInterno extends Error {}       // invariante rota; 500; alerta
```

`ErrorReintentable` significa **resultado no confirmado**, no "sin efectos": si se pierde la respuesta de un `COMMIT` (timeout, conexión caída), puede que el efecto sí exista. Por eso:

- El llamador reintenta siempre con **la misma llave** (o el mismo `transactionId` de pey). Nunca genera una llave nueva por un 503.
- El reintento se resuelve con el registro durable de intención (sección 1, "Registro de intención"): si el efecto se confirmó, devuelve el resultado original; si no, lo ejecuta. No hay manera de producir dos efectos.
- POS: reintenta de forma automática con backoff y, si se agota, muestra "verificando" y consulta reintentando con la misma llave; no cobra con otra. Webhook: responde 5xx para que pey reenvíe el mismo evento. Conciliador: vuelve a pasar el mismo `transactionId` en la siguiente corrida.
- Cuando sí se sabe que hubo rollback (deadlock o serialización detectados antes del `COMMIT`), la capa reintenta internamente hasta 3 veces antes de devolver 503.

---

## 2. Tipos compartidos

```ts
type MotivoRechazoCobro =
  | "CREDENCIAL_INVALIDA"     // inexistente, SUSPENDIDA, BAJA o de otra escuela
  | "ALUMNO_INACTIVO"
  | "PRODUCTO_NO_DISPONIBLE"  // no existe, no publicable o no disponible
  | "PRODUCTO_BLOQUEADO"      // regla del tutor (alérgeno o categoría)
  | "TOPE_DIARIO"
  | "SALDO_INSUFICIENTE";

type ItemVenta = { productoId: string; cantidad: number };

/** Datos que la caja puede mostrar (RF-14). Nunca nombre completo ni alergias. */
type AlumnoEnCaja = {
  iniciales: string;
  gradoGrupo: string;
  fotoUrl: string | null; // solo con consentimiento FOTO vigente
};
```

---

## 3. Funciones

### `cobrar`

Valida y cobra dentro de una sola transacción, con la cuenta `ANTICIPO_ALUMNO` bloqueada (`FOR UPDATE`). El orden interno lo fija `reglas.md` §3 (#28).

```ts
function cobrar(input: {
  idempotencyKey: string;
  operadorId: string;       // de la sesión del cajero; debe pertenecer a cooperativaId
  cooperativaId: string;
  tokenCredencial: string;  // token crudo leído del tag, QR o URL
  items: ItemVenta[];       // los precios los pone el servidor
}): Promise<
  | {
      ok: true;
      transaccionId: string;
      totalCentavos: Centavos;
      saldoCentavos: Centavos;
      alumno: AlumnoEnCaja;
      anulableHasta: string;
    }
  | {
      ok: false;
      motivo: MotivoRechazoCobro;
      productosARetirar?: string[]; // solo PRODUCTO_BLOQUEADO; sin motivo médico
      saldoCentavos?: Centavos;     // solo TOPE_DIARIO y SALDO_INSUFICIENTE
      disponibleHoyCentavos?: Centavos; // solo TOPE_DIARIO
    }
>;
```

- `tokenCredencial` llega crudo y se resuelve dentro de la transacción por `token_hash`. En NTAG 424 la verificación SDM y el avance del contador se hacen en esa misma transacción (si el contador se repite o retrocede, `CREDENCIAL_INVALIDA`). El verificador criptográfico vive en `src/lib/nfc/` como función pura que no toca la BD.
- Asientos al aprobar: débito `ANTICIPO_ALUMNO` y crédito `INGRESO_VENTAS` por `totalCentavos`. Se crea `DETALLE_VENTA` con el precio del momento y el aviso `COMPRA_APROBADA` va al outbox en la misma transacción. Si el saldo cruza el umbral del tutor, también se escribe `SALDO_BAJO` ([notificaciones.md §1](./notificaciones.md#1-evento)).
- HTTP en `POST /api/pos/cobrar`: `ok: true` responde 200 y `ok: false` responde 422 con el cuerpo tal cual. Las excepciones se mapean con la tabla de errores.

### `anular`

Crea un `REVERSO` del cobro y no toca el original.

```ts
function anular(input: {
  idempotencyKey: string;
  operadorId: string;      // misma cooperativa que el cobro
  cooperativaId: string;
  transaccionId: string;
}): Promise<
  | { ok: true; reversoId: string; saldoCentavos: Centavos }
  | { ok: false; motivo: "NO_ENCONTRADA" | "FUERA_DE_VENTANA" | "YA_ANULADA" }
>;
```

- La ventana es fija de **120 s** desde `created_at` del cobro, medida con el reloj de la BD (RF-13). Configurarla por cooperativa queda fuera del MVP.
- Una transacción de otra cooperativa responde `NO_ENCONTRADA`, para no revelar que existe.
- `YA_ANULADA` lo garantiza un índice único parcial sobre `transaccion_origen_id` donde `tipo = 'REVERSO'`.
- El reverso resta del gasto del día, así que libera tope diario.
- En la misma transacción se escribe en el outbox el aviso `COMPRA_ANULADA`, con origen `reversoId`.

### `acreditarRecarga`

La usan el webhook pey (#9), el conciliador (#16) y la caja en efectivo (#25).

```ts
/** Lo que pey reportó del pago. Lo construye quien ya verificó el origen; el ledger no llama a pey. */
type EvidenciaCodi = {
  fuente: "WEBHOOK" | "CONCILIADOR";
  peyTransactionId: string;     // transactionId del pago
  bankAccountId: string;        // cuenta receptora observada en el pago
  montoCentavos: Centavos;      // amount de pey convertido a centavos con aritmética entera
  codiQrId: string | null;      // QR; nulo en push
  webhookId: string | null;     // solo fuente WEBHOOK (fila de WEBHOOK_EVENTO)
};

function acreditarRecarga(
  input:
    | { origen: "CODI"; recargaId: string; evidencia: EvidenciaCodi }
    | {
        origen: "EFECTIVO";
        recargaId: string;
        idempotencyKey: string;   // de la caja
        operadorId: string;       // obligatorio
        cooperativaId: string;    // de la sesión del operador
        montoCentavos: Centavos;  // efectivo recibido
      },
): Promise<
  | { ok: true; transaccionId: string; saldoCentavos: Centavos; yaAcreditada: boolean }
  | {
      ok: false;
      motivo: "RECARGA_NO_ENCONTRADA" | "MONTO_DISTINTO" | "CUENTA_DISTINTA" | "NO_CORRELACIONA" | "PAGO_ADICIONAL" | "LIMITE_EFECTIVO";
    }
>;
```

**Quién verifica qué:**

- **Webhook (#9):** verifica la firma sobre el cuerpo crudo, deduplica `webhook-id` y arma `EvidenciaCodi` con los campos del evento (`transactionId`, `bankAccountId`, `amount`, `codiQrId`).
- **Conciliador (#16):** arma la evidencia con lo que devuelve `GET /transaction/bank-account/{id}` hecho con la API key propia, **fuera** de la transacción. El `bankAccountId` sale de la cuenta consultada.
- **Ledger:** dentro de la transacción, con la recarga bloqueada (`FOR UPDATE`), compara la evidencia contra lo que tiene guardado:
  - `evidencia.bankAccountId` contra `cooperativa.pey_bank_account_id` de **la cooperativa de la recarga**. Si no coincide, `CUENTA_DISTINTA`.
  - `codiQrId` contra `recarga.pey_codi_qr_id` en QR, o `peyTransactionId` contra `recarga.pey_transaction_id` en push. Si no coincide, `NO_CORRELACIONA`.
  - `montoCentavos` contra `recarga.monto_centavos`. Si no coincide, `MONTO_DISTINTO`.
- **Efectivo:** `operadorId` debe estar activo, con rol `CAJERO` o `ADMIN`, en la misma cooperativa que la recarga y que `cooperativaId`. Si no, `ErrorNoAutorizado`. Es idempotente por `idempotencyKey` (registro de intención, §1).

**Reglas:**

- CoDi es idempotente por `peyTransactionId` (`UNIQUE`). Webhook y conciliador pueden traer el mismo pago y solo se acredita una vez; la segunda vez responde `yaAcreditada: true`.
- Un QR puede pagarse más de una vez. Si la recarga ya está `PAGADA` con otro `peyTransactionId`, el pago nuevo es `PAGO_ADICIONAL` y no se acredita solo.
- Ningún rechazo de CoDi acredita: la recarga queda en `REVISION` con la evidencia en auditoría. pey ya cobró, así que lo resuelve una persona; no hay reintento automático.
- RN-02 **no** bloquea un pago CoDi ya recibido (eso se aplica al crear el cobro en #26). En efectivo sí se rechaza con `LIMITE_EFECTIVO` si se supera el tope mensual de efectivo.
- Asientos: en CODI, débito `BANCO` y crédito `ANTICIPO_ALUMNO`; en EFECTIVO, débito `CAJA_EFECTIVO` y crédito `ANTICIPO_ALUMNO`. El aviso `RECARGA_ACREDITADA` se escribe en la misma transacción.

### `registrarReembolso` (RN-05, #29)

Registra una devolución que la cooperativa **ya hizo** por transferencia fuera de la plataforma. No mueve dinero real.

```ts
function registrarReembolso(input: {
  idempotencyKey: string;
  operadorId: string;            // rol ADMIN de la cooperativa
  cooperativaId: string;
  estudianteId: string;
  montoCentavos: Centavos;
  referenciaTransferencia: string; // clave de rastreo SPEI; nunca CLABE ni datos bancarios del tutor
  motivo: "BAJA_ALUMNO" | "SOLICITUD_TUTOR" | "CORRECCION";
}): Promise<
  | { ok: true; transaccionId: string; saldoCentavos: Centavos }
  | { ok: false; motivo: "SALDO_INSUFICIENTE" | "ALUMNO_DE_OTRA_COOPERATIVA" }
>;
```

- Asientos: débito `ANTICIPO_ALUMNO` y crédito `BANCO` (modelo de datos §2). La restricción `CHECK` impide reembolsar más de lo que hay de saldo.
- Si el operador no es ADMIN, lanza `ErrorNoAutorizado`. La auditoría guarda operador, referencia y motivo.

### `saldo`

Es de solo lectura. Quien llama ya comprobó que el tutor o el operador puede ver a ese alumno; el ledger vuelve a comprobar `cooperativaId`.

```ts
function saldo(input: { cooperativaId: string; estudianteId: string }): Promise<{
  saldoCentavos: Centavos;
  gastadoHoyCentavos: Centavos;      // compras menos reversos del día CDMX
  topeDiarioCentavos: Centavos | null;
}>;
```

---

## 4. Rechazos de cobro: auditoría y aviso

Cubre M5 de la revisión del PR #18.

1. Un rechazo de negocio hace `ROLLBACK` de la transacción del cobro. No deja asientos, `TRANSACCION` ni `DETALLE_VENTA`.
2. Después, en **otra** transacción, se actualiza `intento_operacion` (sección 1) y se escriben la auditoría y, si aplica, el aviso.
3. **Identidad del rechazo:** `(intento_operacion.id, motivo)`. `intento_operacion.id` es un UUID del servidor ya acotado por cooperativa y operación, así que dos cooperativas con la misma llave del cliente nunca colisionan.
   - **Auditoría:** `UNIQUE (intento_id, motivo)`. No incluye destinatario ni columnas nulas, así que un rechazo sin tutor (`CREDENCIAL_INVALIDA`) tampoco se duplica. La auditoría no depende de que exista un destinatario elegible.
   - **Outbox:** una fila por destinatario elegible, con `UNIQUE (intento_id, motivo, destinatario_id)`, donde `destinatario_id` nunca es nulo (si no hay destinatario, no hay fila). `eventId` se deriva de la misma identidad ([notificaciones.md §2](./notificaciones.md#2-identidad-y-deduplicación)).
   - **Política:** si la misma llave se reevalúa con **el mismo motivo**, es el mismo hecho y no se duplica. Con un **motivo distinto**, es un hecho nuevo: otra fila de auditoría y otro aviso. Todo se inserta con `ON CONFLICT DO NOTHING`, así que un conflicto nunca produce 503.
4. Si falla esa segunda transacción, `cobrar` lanza `ErrorReintentable` y nunca devuelve `ok: false` como si el aviso estuviera encolado. El POS reintenta con la misma llave.
5. `CREDENCIAL_INVALIDA` no genera aviso al tutor porque no se sabe a quién pertenece el token. Solo genera auditoría, sin token crudo.

## 5. Tabla de errores HTTP

| Resultado | HTTP | Cuerpo |
| :--- | :--- | :--- |
| `ok: true` | 200 | resultado |
| `ok: false` | 422 | `{ ok: false, motivo, ... }` |
| `ErrorEntrada` | 400 | `{ error: "ENTRADA_INVALIDA", campo }` |
| `ErrorNoAutorizado` | 403 | `{ error: "NO_AUTORIZADO" }` |
| `ErrorIdempotencia` | 409 | `{ error: "LLAVE_REUTILIZADA" }` |
| `ErrorReintentable` | 503 + `Retry-After` | `{ error: "REINTENTAR" }` |
| `ErrorInterno` | 500 | `{ error: "INTERNO" }`; sin detalles ni datos personales |

## 6. Pruebas que exige el contrato

Corren contra PostgreSQL real (skill `ledger-change`): concurrencia 20/5, triple reintento con la misma llave, llave con otra entrada que da 409, sobregiro sin asientos, partidas que cuadran, reconstrucción de saldos, reverso que restaura saldo y tope, ventana de 120 s, reintento tras un rechazo sin duplicar el aviso, fallo inyectado en la auditoría del rechazo que da 503, montos `1.5`, `-1`, `2^53` y `"100"` que dan 400.

## Preguntas abiertas

- [ ] Confirmar `MAX_MONTO_OPERACION_CENTAVOS = 1_000_000` y los límites de partidas y cantidades.
- [ ] Confirmar el tope de efectivo mensual de RN-02 en centavos (3,000 UDI convertidas con qué valor de UDI y cuándo se actualiza; #26).
