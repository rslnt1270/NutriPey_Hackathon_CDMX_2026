---
name: pey-codi
description: Contrato verificado de la API CoDi de pey y reglas para integrarla. Usar al escribir o revisar código que llame a api.pey.mx, que reciba webhooks de pey o que concilie pagos.
---

# Integración con la API CoDi de pey

La fuente de verdad es `https://docs.pey.mx/openapi.json`. Si algo de esta guía contradice al OpenAPI, gana el OpenAPI: descárgalo y actualiza esta guía en el mismo PR. No inventes campos.

Verificado contra la versión `2026-10-20`.

## Datos básicos

- Base: `https://api.pey.mx`. Autenticación: `Authorization: Bearer <api-key>`.
- **No hay sandbox.** Se prueba en producción con **$0.01 MXN**. El dinero enviado a la cuenta de prueba no se devuelve.
- Registrar una cuenta bancaria ante Banxico tarda hasta 5 días hábiles.
- Una API key admite un solo webhook.

## Crear cobros

**`POST /codi/qr`** responde 201 con `id`, `qrString` y `qrImage` (solo con `generateImage: true`).

**`POST /codi/pn`** responde 200 con `transactionId` y `codiId`. Requiere `phoneNumber` de exactamente 10 dígitos. Monto máximo 1,000,000.

Campos comunes:

| Campo | Regla del proyecto |
| :--- | :--- |
| `amount` | Pesos como número. Convertir desde centavos justo antes de enviar. Nunca 0 en QR. |
| `expiration` | 600 segundos. El mínimo es 360. En QR, 0 significa sin expiración: no usar. |
| `bankAccountId` | **Siempre.** Es la cuenta de la cooperativa y debe estar en `codiStatus: ACTIVE`. |
| `metadata` | `recarga_id` y `estudiante_id`. Todos los valores regresan como texto. |
| `numRef` | Opcional. Máximo 7 dígitos. No es llave de conciliación. |

Dibuja el QR en el cliente a partir de `qrString`. Pedir `qrImage` hace más lenta la respuesta.

## Webhook

Eventos: `codi.qr.payment_received` y `codi.pn.payment_received`. Campos: `amount`, `apiKeyId`, `codiQrId` (QR), `concept`, `datePaid` (segundos Unix), `numRef`, `transactionId`, `type`, `metadata`, `bankAccountId`.

Orden obligatorio del manejador:

1. Leer el **cuerpo crudo** como texto. No parsear antes de verificar.
2. Verificar con la librería `standardwebhooks` y el secreto `whsec_...`. Si falla, responder 401.
3. Insertar `webhook-id` en `WEBHOOK_EVENTO`. Si ya existe, responder 200 y terminar.
4. Correlacionar por `codiQrId` (QR) o `transactionId` (push).
5. Acreditar el `amount` del evento con `acreditarRecarga`, que es idempotente por `transactionId`.
6. Responder 2xx. Las notificaciones salen de la cola, nunca dentro del manejador.

Un pago sin recarga pendiente no es un error: se guarda, se marca `REVISION` y se responde 200.

## Conciliación

- `GET /transaction/codi/qr/{id}`: pagos de un QR. Devuelve una lista porque un QR puede pagarse más de una vez.
- `GET /transaction/{id}`: estado de un pago (`PENDING` o `PAID`).
- `GET /transaction/bank-account/{id}`: pagos recibidos por la cuenta, 80 por página con `nextToken`.

## Cuentas bancarias

`POST /bank-account` con `alias`, `name`, `clabe` y `entity` (`PERSON` o `BUSINESS`). Nace en `PENDING` y pasa a `ACTIVE`. Hay un webhook de cuenta actualizada.

## Errores

Forma: `{ "error": { "message", "type", "requestId" } }`. Registra siempre `requestId`. Un 503 indica mantenimiento: reintentar con espera.

## Errores frecuentes a evitar

- Leer `codiQrId` o `qrData` de la respuesta de creación: no existen ahí.
- Usar `numRef` como identificador único.
- Parsear el JSON antes de verificar la firma.
- Acreditar el monto que mandó el navegador.
- Probar con montos mayores a $0.01.
- Poner la API key en código de cliente o en el repo.
