# Contrato de eventos de notificación (propuesta v1)

**Estado:** propuesta v1 (#4). Hay que aprobarla con las dos personas antes de #13.
**Dueño:** carril Pagos (`src/server/notificaciones/`, `app/api/interno/notificaciones/`).
**Consumidor:** n8n (`automation/n8n/`, #13 y #22).

El ledger y el outbox los escribe solo Pagos. n8n **no** tiene acceso a PostgreSQL ni a las funciones del ledger: solo reclama eventos ya confirmados y reporta el resultado. Un fallo de n8n nunca revierte un pago.

---

## 1. Evento

```ts
type TipoEvento =
  | "RECARGA_ACREDITADA"
  | "COMPRA_APROBADA"
  | "COMPRA_ANULADA"
  | "COMPRA_BLOQUEADA"         // rechazo por regla del tutor, sin motivo médico
  | "SALDO_BAJO"               // RF-19: el saldo cruzó el umbral del tutor
  | "LIMITE_CUENTA_80"         // RN-02, destinatario: ADMIN de la cooperativa
  | "LIMITE_CUENTA_100";

type EventoNotificacion = {
  version: 1;
  eventId: string;            // estable por (origen, tipo, destinatario); ver §2
  tipo: TipoEvento;
  ocurridoEn: string;         // ISO 8601 UTC
  destinatario: {
    tipo: "TUTOR" | "OPERADOR"; // OPERADOR solo en LIMITE_CUENTA_* (rol ADMIN)
    canal: "TELEGRAM" | "WHATSAPP";
    destinoId: string;        // chat_id verificado o teléfono E.164; solo en la respuesta de reclamar
  };
  alumnoAlias: string | null; // "Alumno A"; nulo cuando el destinatario es OPERADOR
  variables: {
    montoCentavos?: number;   // entero
    saldoCentavos?: number;   // entero
    productos?: string[];     // nombres comerciales; en COMPRA_BLOQUEADA, solo los que hay que retirar
    porcentajeLimite?: 80 | 100;
  };
};
```

Privacidad (L6 de la revisión del PR #18, documento 04 §4):

- Nunca se incluyen nombre, iniciales, matrícula, foto, grupo, alergias ni el motivo de un bloqueo. `alumnoAlias` es un alias neutro asignado por el sistema por tutor ("Alumno A", "Alumno B") y no es texto libre. El tutor ve en su app a qué alumno corresponde.
- Un alias es único dentro del conjunto de alumnos de cada tutor. Dos tutores de un mismo alumno pueden verlo con alias distintos.
- `destinoId` solo aparece en la respuesta de `reclamar`. No se registra en logs de la API ni de n8n (configurar retención de ejecuciones en #22).

**`SALDO_BAJO`:** cada vínculo tutor–alumno tiene `umbral_saldo_bajo_centavos` (por defecto 5000, es decir $50; el tutor lo cambia y con 0 lo desactiva). El evento se genera en la transacción de `cobrar` solo cuando el saldo **cruza** el umbral (antes ≥ umbral, después < umbral), así que no se repite en cada compra. Vuelve a poder generarse cuando una recarga deja el saldo en el umbral o por encima.

## 2. Identidad y deduplicación

- Se genera **un evento por destinatario autorizado**. La auditoría del hecho es una sola fila, aparte de los eventos ([ledger.md §4](./ledger.md#4-rechazos-de-cobro-auditoría-y-aviso)).
- La fórmula es fija, para que dos implementaciones produzcan el mismo valor:

```text
NS_NUTRIPEY = 67161562-f75d-4611-902e-b76f8b466b3c
nombre      = "v1|" + tipo + "|" + origen + "|" + destinatarioId
eventId     = UUIDv5(NS_NUTRIPEY, utf8(nombre))
```

| Tipo | `origen` |
| :--- | :--- |
| `RECARGA_ACREDITADA`, `COMPRA_APROBADA` | `transaccionId` |
| `COMPRA_BLOQUEADA` | `intento_operacion.id + "|" + motivo` (la misma identidad del rechazo que usa la auditoría) |
| `COMPRA_ANULADA` | `reversoId`; se escribe en la transacción de `anular` |
| `SALDO_BAJO` | `transaccionId` del cobro que cruzó el umbral |
| `LIMITE_CUENTA_80`, `LIMITE_CUENTA_100` | `cooperativaId + "|" + AAAA-MM` (mes CDMX); `tipo` ya distingue el umbral |

- Cada componente es un UUID o un enum en mayúsculas, sin `|`, así que la concatenación no es ambigua. `destinatarioId` es el UUID del tutor u operador, nunca el teléfono ni el `chat_id`.
- El outbox tiene `UNIQUE (event_id)` y se inserta con `ON CONFLICT DO NOTHING`.
- `eventId` se envía al proveedor como llave de idempotencia **solo si el proveedor la soporta**; si no, este contrato no promete deduplicación ante el proveedor (§4, `INCIERTO`).

## 3. Elegibilidad del destinatario

Se comprueba **dos veces**: al escribir el evento y otra vez al reclamarlo.

**Tutor:**

1. Existe un vínculo `TUTOR_ESTUDIANTE` vigente.
2. El tutor tiene un consentimiento de mensajería vigente (sin `revocado_en`).
3. El destino está verificado (`chat_id` confirmado por el bot o teléfono confirmado).
4. La preferencia del tutor admite el tipo de evento:

| Tipo | `POR_COMPRA` | `RESUMEN_DIARIO` | `SOLO_ALERTAS` |
| :--- | :---: | :---: | :---: |
| `RECARGA_ACREDITADA`, `COMPRA_BLOQUEADA`, `SALDO_BAJO` (alertas RF-19) | sí | sí | sí |
| `COMPRA_APROBADA`, `COMPRA_ANULADA` | sí | no (van en el resumen, #13) | no |

**Operador:** rol `ADMIN`, activo en la cooperativa del evento, con destino verificado y suscripción a alertas de la cuenta activada. No necesita vínculo con alumnos ni consentimiento de tutor, porque el evento no contiene datos de menores.

Los resúmenes diarios se arman en #13 y no forman parte de este contrato v1.

Si al reclamar ya no cumple, el evento pasa a `DESCARTADO` y no se entrega a n8n. Revocar el consentimiento detiene los avisos futuros y los que estén pendientes.

## 4. API interna

Base: `/api/interno/notificaciones/`. Solo se expone dentro de la red privada o detrás de autenticación de servicio.

**Autenticación:** `Authorization: Bearer <token de servicio>` con alcance `notificaciones:procesar`. El token se guarda en un almacén de secretos, se rota sin redeploy (se aceptan dos tokens válidos durante la rotación) y se compara en tiempo constante. Sin token o con uno inválido la respuesta es 401, sin detalles.

### `POST reclamar`

```json
// solicitud
{ "limite": 20, "leaseSegundos": 120 }
// respuesta 200
{ "eventos": [ { "leaseId": "uuid", "intento": 1, "evento": { /* EventoNotificacion */ } } ] }
```

- `limite` va de 1 a 50 y `leaseSegundos` de 30 a 300.
- Solo se reclaman eventos `PENDIENTE` con `proximo_intento <= now()` e `intentos < 5`, usando `SELECT ... FOR UPDATE SKIP LOCKED`. Cada reclamo suma 1 a `intentos` y genera un `leaseId` nuevo; `intento` en la respuesta es ese contador.
- Un evento `RECLAMADO` con el lease vencido **nunca se reasigna**. Si el worker cayó después de que el proveedor aceptara el mensaje, no hay forma de saberlo. Un barrido (en cada `reclamar` y por cron) lo mueve a `INCIERTO`. Así ningún evento se reenvía automáticamente con un resultado desconocido, y un worker antiguo que siga vivo no compite con otro.
- Límite total: **5 reclamos** por evento. El quinto sí se entrega en `RECLAMADO`: éxito → `ENVIADA`; fallo conocido → `REVISION_MANUAL`; resultado desconocido o lease vencido → `INCIERTO`. No existe sexto reclamo, tampoco por reencolado manual.

### `POST {eventId}/confirmar`

```json
{ "leaseId": "uuid", "proveedorMensajeId": "string" }
```

Precedencia:

1. Si el evento ya está `ENVIADA` con el mismo `proveedorMensajeId`, responde 200 con el mismo cuerpo (idempotente).
2. Si está `ENVIADA` con otro `proveedorMensajeId`, responde 409 y guarda el id como **duplicado confirmado**, para auditoría.
3. Si está `RECLAMADO` con ese `leaseId` (vigente o vencido) o `INCIERTO` por ese `leaseId`, pasa a `ENVIADA`. Una confirmación tardía es evidencia de envío y gana sobre el vencimiento.
4. Con un `leaseId` desconocido o de otro evento responde 409, sin cambios.

`ENVIADA` solo significa que el proveedor aceptó el mensaje; no prueba que haya llegado al teléfono.

### `POST {eventId}/fallar`

```json
{ "leaseId": "uuid", "fase": "ANTES_DE_ENVIAR" | "RECHAZADO_PROVEEDOR" | "RESULTADO_DESCONOCIDO", "codigo": "TIMEOUT" | "DESTINO_INVALIDO" | "LIMITE_PROVEEDOR" | "OTRO" }
```

| `fase` | Significado | Efecto |
| :--- | :--- | :--- |
| `ANTES_DE_ENVIAR` | n8n no llegó a llamar al proveedor | `PENDIENTE` con backoff `30 s · 2^(intentos-1)`, máximo 1 h; si `intentos = 5`, `REVISION_MANUAL` |
| `RECHAZADO_PROVEEDOR` | el proveedor respondió con un error definitivo | `DESTINO_INVALIDO` → `REVISION_MANUAL`; los demás, igual que `ANTES_DE_ENVIAR` |
| `RESULTADO_DESCONOCIDO` | timeout o caída después de llamar al proveedor | `INCIERTO` |

- `confirmar`, `fallar`, el barrido y la resolución manual bloquean la misma fila antes de validar estado/lease y modificarla. `fallar` solo aplica por primera vez en `RECLAMADO` con el último lease vigente; lease vencido pasa a INCIERTO, no a PENDIENTE. Un lease ajeno/antiguo o un estado incompatible da 409 sin mutar. Si confirmar ya dejó ENVIADA, fallar nunca la revierte.
- Guardar la respuesta y el hash del payload de fallo por `(eventId, leaseId)`: repetición idéntica devuelve esa respuesta sin volver a ejecutar la transición; payload distinto da 409. La respuesta repetida describe el reporte aceptado originalmente, no el estado actual. Una confirmación posterior solo puede cambiar los estados expresamente admitidos en confirmar; los estados finales no se reabren.

### `INCIERTO`

- No se reintenta automáticamente, porque Telegram y WhatsApp no ofrecen una llave de idempotencia que garantice que no habrá duplicado.
- Aparece en la vista de operación (#13) y una persona decide si **reencolar** (vuelve a `PENDIENTE`, sin pasar del límite de 5) o **cerrar**. Si más adelante un proveedor permite consultar por `eventId`, #13 puede resolverlo automáticamente; eso necesitaría una v2 de este contrato.

### Estados

`PENDIENTE → RECLAMADO → ENVIADA | PENDIENTE | INCIERTO | REVISION_MANUAL`; `INCIERTO → ENVIADA` (por confirmación tardía) `| PENDIENTE` (reencolado manual) `| CERRADO`. `DESCARTADO` puede venir de `PENDIENTE` o `RECLAMADO`. `ENVIADA`, `REVISION_MANUAL`, `DESCARTADO` y `CERRADO` son finales.

## 5. Cambios al modelo (migración nueva en #13)

El outbox v1.1 se amplía **por migración nueva**, sin editar las fusionadas: `event_id` único, `tipo`, `intento_id` nulo (rechazos), `transaccion_id` nulo, `canal`, `alumno_alias`, `lease_id`, `lease_vence_en`, `proveedor_mensaje_id`, `duplicados_confirmados`, `fase_fallo`, `resultado`, `proximo_intento`, `enviado_en`, y un estado con los valores de §4. El destino verificado vive en una tabla de destinos del tutor, no en `variables`.

## 6. Pruebas que exige el contrato

Token inválido da 401. Dos reclamos concurrentes sin solapamiento. Caída del worker después de que el proveedor acepta y antes de confirmar: el evento pasa a `INCIERTO` sin reenvío. Confirmación tardía de un lease vencido: `ENVIADA`. Confirmación duplicada con otro id: 409 y duplicado auditado. Cinco reclamos sin éxito: `REVISION_MANUAL`. `RESULTADO_DESCONOCIDO`: `INCIERTO`. Consentimiento revocado entre la escritura y el reclamo que lleva a `DESCARTADO`. Hermanos con alias distintos y sin cruce entre tutores. ADMIN sin vínculo con alumnos recibe `LIMITE_CUENTA_80`; el mismo umbral en el mismo mes no se repite y en el mes siguiente sí. `SALDO_BAJO` solo al cruzar, también con `SOLO_ALERTAS`. `COMPRA_ANULADA` sale de `anular`. Payloads sin nombre, iniciales ni alergias (aserción sobre el JSON completo).

Prueba M4: quinto reclamo con éxito, fallo conocido y expiración; ningún sexto reclamo ni reencolado después del quinto. Intercalar confirmar/fallar: confirmar primero conserva ENVIADA; RESULTADO_DESCONOCIDO primero admite confirmación tardía desde INCIERTO. Repetir fallar no repite transiciones ni cambia estados finales.

## Preguntas abiertas

- [ ] Canal inicial para diciembre: Telegram (más simple, `chat_id`) o WhatsApp (requiere proveedor y plantillas aprobadas).
- [ ] ¿Avisamos `LIMITE_CUENTA_*` también por correo al ADMIN?
