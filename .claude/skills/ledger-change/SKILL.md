---
name: ledger-change
description: Invariantes y pruebas obligatorias del ledger de doble partida. Usar antes de escribir o revisar cualquier cambio que toque saldos, asientos, cobros, recargas, reversos o migraciones de esas tablas.
---

# Cambios al ledger

El modelo está en `docs/diagrams/02_data_model_erd.md`. Esta guía es la lista que todo cambio de dinero debe cumplir.

## Antes de escribir

1. Confirma que el issue es del carril Pagos. Si eres del carril Campus, no edites el ledger: pide el cambio.
2. Si cambia la firma de una función exportada, primero va un PR a `docs/contracts/ledger.md`.

## Invariantes

1. **Partida doble:** en cada transacción, la suma de débitos es igual a la de créditos.
2. **Saldo materializado:** `cuenta_ledger.saldo_centavos` se actualiza en la misma transacción SQL que inserta los asientos.
3. **Sin sobregiro:** `CHECK (saldo_centavos >= 0)` en cuentas `ANTICIPO_ALUMNO`. No lo quites ni lo rodees.
4. **Inmutabilidad:** solo `INSERT` en `transaccion` y `asiento_contable`. Un error se corrige con `REVERSO`.
5. **Centavos enteros:** `bigint` en SQL, enteros en código. Nada de `float`, y la conversión a pesos solo ocurre en los bordes (pey, pantalla).
6. **Validar dentro de la transacción:** reglas, tope diario y saldo se evalúan después del `SELECT ... FOR UPDATE` de la cuenta.
7. **Idempotencia:** toda operación que mueve dinero recibe una llave. Repetirla devuelve el resultado original.
8. **Orden de bloqueos:** si una operación bloquea más de una cuenta, lo hace en orden ascendente de `id` para evitar interbloqueos.
9. **Una sola puerta:** el resto del código usa las funciones de `src/server/ledger/index.ts`. Nadie más escribe SQL sobre estas tablas.

## Pruebas obligatorias

Corren contra PostgreSQL real, no contra simulaciones.

- **Concurrencia:** 20 cobros simultáneos sobre un saldo que alcanza para 5. Resultado: exactamente 5 aprobados y saldo final 0.
- **Idempotencia:** la misma llave enviada 3 veces produce una transacción y un débito.
- **Sobregiro:** un cobro mayor al saldo se rechaza sin dejar asientos.
- **Partida doble:** después de cada prueba, débitos y créditos cuadran por transacción.
- **Reconstrucción:** el saldo materializado de cada cuenta es igual al neto de sus asientos.
- **Reverso:** anular un cobro restaura el saldo y libera el tope diario.

## Migraciones

- Nombre con fecha y hora: `20261116_1030_descripcion.sql`.
- Nunca edites una migración fusionada. Crea otra.
- Una migración que cambia tipos de columnas de dinero necesita revisión de las dos personas.

## Al terminar

Pega en el PR la salida de las pruebas. Si alguna no aplica, explica por qué.
