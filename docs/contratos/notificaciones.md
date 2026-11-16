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
  | "LIMITE_CUENTA_80"         // RN-02, destinatario: ADMIN de la cooperativa
  | "LIMITE_CUENTA_100";

type EventoNotificacion = {
  version: 1;
  eventId: string;            // estable por (origen, tipo, destinatario); ver §2
  tipo: TipoEvento;
  ocurridoEn: string;         // ISO 8601 UTC
  destinatario: {
    canal: "TELEGRAM" | "WHATSAPP";
    destinoId: string;        // chat_id verificado o teléfono E.164; solo en la respuesta de reclamar
  };
  alumnoAlias: string | null; // "Alumno A"; nulo en eventos para ADMIN
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

## 2. Identidad y deduplicación

- Se genera **un evento por destinatario autorizado**.
- `eventId = UUIDv5(NS_NUTRIPEY, origen + ":" + tipo + ":" + tutorId)`, donde `origen` es `transaccionId` o, en los rechazos, el `idempotencyKey` del intento. El mismo hecho siempre produce el mismo `eventId`.
- El outbox tiene `UNIQUE (event_id)`, así que insertar dos veces no duplica.
- n8n debe tratar `eventId` como llave de idempotencia ante el proveedor cuando el proveedor lo permita. Si no lo permite, un timeout después del envío puede duplicar el aviso; ese caso queda como `INCIERTO` (§4).

## 3. Elegibilidad del destinatario

Se comprueba **dos veces**: al escribir el evento y otra vez al reclamarlo.

1. Existe un vínculo `TUTOR_ESTUDIANTE` vigente.
2. El tutor tiene un consentimiento de mensajería vigente (sin `revocado_en`).
3. El destino está verificado (`chat_id` confirmado por el bot o teléfono confirmado).
4. La preferencia del tutor admite el tipo de evento (`POR_COMPRA`, `RESUMEN_DIARIO` o `SOLO_ALERTAS`). Los resúmenes diarios se arman en #13 y no forman parte de este contrato v1.

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
- Se reclama con `SELECT ... FOR UPDATE SKIP LOCKED` entre los eventos con estado `PENDIENTE` y `proximo_intento <= now()`, o `RECLAMADO` con el lease vencido. Cada reclamo sube `intentos` y genera un `leaseId` nuevo.
- Dos instancias de n8n nunca reciben el mismo evento con un lease vigente.

### `POST {eventId}/confirmar`

```json
{ "leaseId": "uuid", "proveedorMensajeId": "string" }
```

- 200: el evento pasa a `ENVIADA` (el proveedor aceptó el mensaje, lo que no prueba que haya llegado al teléfono).
- Repetir con el mismo `leaseId` y el mismo `proveedorMensajeId` responde 200 con el mismo cuerpo (idempotente).
- Un `leaseId` vencido o reemplazado responde 409. Aun así se guarda `proveedorMensajeId` como posible duplicado, para auditarlo.

### `POST {eventId}/fallar`

```json
{ "leaseId": "uuid", "codigo": "TIMEOUT" | "RECHAZADO_PROVEEDOR" | "DESTINO_INVALIDO" | "OTRO", "reintentable": true }
```

- Con `reintentable: true` vuelve a `PENDIENTE` con backoff exponencial (`30 s · 2^(intentos-1)`, máximo 1 h).
- Con `reintentable: false`, o al llegar a **5 intentos**, el evento pasa a `REVISION_MANUAL`.
- `TIMEOUT` después de haber enviado al proveedor se registra como `INCIERTO` y no se reintenta solo.
- Es idempotente por `(eventId, leaseId)`. Un lease vencido responde 409.

### Estados

`PENDIENTE → RECLAMADO → ENVIADA | PENDIENTE (reintento) | REVISION_MANUAL | INCIERTO`, más `DESCARTADO` desde `PENDIENTE` o `RECLAMADO`. Ningún estado final se reabre desde la API.

## 5. Cambios al modelo (migración nueva en #13)

El outbox v1.1 se amplía **por migración nueva**, sin editar las fusionadas: `event_id` único, `tipo`, `intento_id` nulo (rechazos), `transaccion_id` nulo, `canal`, `alumno_alias`, `lease_id`, `lease_vence_en`, `proveedor_mensaje_id`, `resultado`, `proximo_intento`, `enviado_en`, y un estado con los valores de §4. El destino verificado vive en una tabla de destinos del tutor, no en `variables`.

## 6. Pruebas que exige el contrato

Token inválido da 401. Dos reclamos concurrentes sin solapamiento. Lease vencido reasignado y confirmación tardía que da 409. Confirmación repetida idempotente. Cinco fallos que llevan a `REVISION_MANUAL`. Consentimiento revocado entre la escritura y el reclamo que lleva a `DESCARTADO`. Hermanos con alias distintos y sin cruce entre tutores. Payloads sin nombre, iniciales ni alergias (aserción sobre el JSON completo).

## Preguntas abiertas

- [ ] Canal inicial para diciembre: Telegram (más simple, `chat_id`) o WhatsApp (requiere proveedor y plantillas aprobadas).
- [ ] ¿Avisamos `LIMITE_CUENTA_*` también por correo al ADMIN?
