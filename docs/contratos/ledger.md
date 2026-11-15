# Contrato del Ledger (borrador v0)

**Estado:** borrador. Lo aprueban las dos personas antes de implementar.
**Dueño:** carril Pagos. **Consumidor:** carril Campus.
**Ubicación del código:** `src/server/ledger/index.ts` (Next.js + PostgreSQL decidido).

Campus nunca escribe SQL sobre tablas del ledger. Usa únicamente estas funciones. Cambiar una firma requiere un PR propio a este archivo.

Convenciones: montos en centavos enteros, identificadores UUID como texto, fechas ISO 8601 en UTC.

---

## Tipos

```ts
type Centavos = number; // entero, nunca negativo

type MotivoRechazo =
  | "CREDENCIAL_INVALIDA"
  | "ALUMNO_INACTIVO"
  | "PRODUCTO_NO_DISPONIBLE"
  | "PRODUCTO_BLOQUEADO"
  | "TOPE_DIARIO"
  | "SALDO_INSUFICIENTE";

type ItemVenta = { productoId: string; cantidad: number };

type AlumnoEnCaja = {
  iniciales: string;
  gradoGrupo: string;
  fotoUrl: string | null; // solo si hay consentimiento
};
```

## `cobrar`

Valida y cobra en una sola transacción. Repetir la misma `idempotencyKey` devuelve el resultado original.

```ts
function cobrar(input: {
  idempotencyKey: string;   // generada por el POS, una por venta
  operadorId: string;       // de la sesión del cajero
  cooperativaId: string;
  tokenCredencial: string;  // token leído del tag o del QR
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
      motivo: MotivoRechazo;
      productosARetirar?: string[]; // en PRODUCTO_BLOQUEADO; sin motivo médico
      saldoCentavos?: Centavos;     // en TOPE_DIARIO y SALDO_INSUFICIENTE
    }
>;
```

Mapa a HTTP en `POST /api/pos/cobrar`: `ok: true` responde 200; `ok: false` responde 422 con `motivo`.

## `anular`

Genera un `REVERSO` del cobro. Solo dentro de la ventana de anulación y por un operador de la misma cooperativa.

```ts
function anular(input: {
  idempotencyKey: string;
  operadorId: string;
  transaccionId: string;
}): Promise<
  | { ok: true; reversoId: string; saldoCentavos: Centavos }
  | { ok: false; motivo: "NO_ENCONTRADA" | "FUERA_DE_VENTANA" | "YA_ANULADA" }
>;
```

## `acreditarRecarga`

La usan el webhook de pey, el conciliador y la recarga en efectivo. Idempotente por `referenciaPago`.

```ts
function acreditarRecarga(input: {
  recargaId: string;
  montoCentavos: Centavos;          // el monto que reporta pey, o el efectivo recibido
  origen: "CODI" | "EFECTIVO";
  referenciaPago: string;           // transactionId de pey, o llave del POS en efectivo
  operadorId?: string;              // obligatorio en EFECTIVO
}): Promise<{
  transaccionId: string;
  saldoCentavos: Centavos;
  yaAcreditada: boolean;
}>;
```

## `saldo`

```ts
function saldo(estudianteId: string): Promise<{
  saldoCentavos: Centavos;
  gastadoHoyCentavos: Centavos;
  topeDiarioCentavos: Centavos | null;
}>;
```

---

## Fixtures y validación antes de Campus

Los fixtures permiten probar cada `MotivoRechazo` y preparar el prototipo. La implementación Campus espera el gate #12 de Pagos; luego debe verificarse con reglas reales dentro de la misma transacción. El contrato de esa integración se acuerda antes de implementar `cobrar`. No se permite activar fixtures en producción.

## Preguntas abiertas

- [ ] Ventana de anulación: 2 minutos, ¿fija o configurable por cooperativa?
- [ ] ¿`cobrar` recibe el token crudo o ya resuelto a `credencialId`? Depende de dónde se verifique el NTAG 424.
- [ ] ¿El aviso al tutor en `PRODUCTO_BLOQUEADO` lo encola `cobrar` o la ruta HTTP?
