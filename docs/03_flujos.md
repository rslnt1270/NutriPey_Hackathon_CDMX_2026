# Diagramas de Flujo y Secuencia — NutriPey

**Versión:** 1.2<br>
**Flujos:** recarga CoDi vía pey, conciliación, cobro en caja y ciclo de vida de la credencial.  
**Cambios respecto a 1.0:** ver [Auditoría y Decisiones](./05_auditoria_y_decisiones.md).

---

## 1. Recarga CoDi (Open-Loop On-Ramp)

El dinero va de la cuenta del tutor a la cuenta bancaria de la cooperativa. NutriPey solo recibe el aviso y asienta el anticipo.

```mermaid
sequenceDiagram
    autonumber
    actor Padre as Tutor (móvil)
    participant NutriApp as NutriPey WebApp
    participant NutriAPI as NutriPey Backend
    participant DB as PostgreSQL (Ledger)
    participant PeyAPI as API pey (api.pey.mx)
    participant Banxico as Red CoDi / Banxico
    participant Banco as App bancaria del tutor

    Padre->>NutriApp: Elige monto 100 MXN y método (QR o push)
    NutriApp->>NutriAPI: POST /api/recargas (estudiante, monto, método)
    NutriAPI->>DB: Crea RECARGA en estado PENDIENTE
    NutriAPI->>PeyAPI: POST /codi/qr (amount, expiration 600, bankAccountId, metadata.recarga_id)
    PeyAPI->>Banxico: Registra el cobro CoDi
    PeyAPI-->>NutriAPI: 201 con id y qrString
    NutriAPI->>DB: Guarda pey_codi_qr_id y expira_en
    NutriAPI-->>NutriApp: qrString
    NutriApp-->>Padre: Dibuja el QR y consulta el estado cada 3 s

    Note over NutriAPI,PeyAPI: Con push se usa POST /codi/pn con phoneNumber. La respuesta trae transactionId y codiId.

    Padre->>Banco: Escanea el QR o abre la solicitud CoDi
    Banco->>Banxico: Autoriza el pago
    Banxico-->>Banco: Pago liquidado en la cuenta de la cooperativa
    Banxico->>PeyAPI: Confirmación de pago

    PeyAPI->>NutriAPI: POST /api/webhooks/pey (webhook-id, webhook-timestamp, webhook-signature)

    critical Verificación antes de cualquier efecto
        NutriAPI->>NutriAPI: Verifica la firma sobre el cuerpo crudo
    option Firma inválida o timestamp fuera de 5 minutos
        NutriAPI-->>PeyAPI: 401 sin efectos
    end

    NutriAPI->>DB: BEGIN
    NutriAPI->>DB: Inserta WEBHOOK_EVENTO (webhook_id único)
    alt Evento ya procesado
        NutriAPI->>DB: ROLLBACK
        NutriAPI-->>PeyAPI: 200
    else Pago sin recarga pendiente
        NutriAPI->>DB: Marca REVISION y COMMIT
        NutriAPI-->>PeyAPI: 200
    else Pago válido
        NutriAPI->>DB: Débito BANCO, crédito ANTICIPO_ALUMNO
        NutriAPI->>DB: RECARGA pasa a PAGADA con pey_transaction_id
        NutriAPI->>DB: COMMIT
        NutriAPI-->>PeyAPI: 200
    end

    NutriApp-->>Padre: La consulta de estado muestra el nuevo saldo
```

**Puntos de diseño**

- Se responde a pey después de confirmar en base de datos; la consulta posterior del tutor ocurre en la PWA y no condiciona la respuesta al webhook.
- La correlación es por `codiQrId` en QR y por `transactionId` en push. `numRef` no se usa como llave: solo admite 7 dígitos.
- Se acredita el monto que reporta pey, no el que pidió el cliente.

---

## 2. Conciliación

Cubre los webhooks que nunca llegan y detecta diferencias entre el banco y el ledger.

```mermaid
sequenceDiagram
    autonumber
    participant Cron as Tarea periódica
    participant NutriAPI as NutriPey Backend
    participant DB as PostgreSQL (Ledger)
    participant PeyAPI as API pey

    loop Cada 2 minutos
        Cron->>NutriAPI: Ejecuta conciliación corta
        NutriAPI->>DB: Lee recargas PENDIENTES
        NutriAPI->>PeyAPI: GET /transaction/codi/qr/{id} o GET /transaction/{id}
        alt Estado PAID en pey
            NutriAPI->>DB: Acredita con la misma rutina del webhook (idempotente por pey_transaction_id)
        else Cobro vencido sin pago
            NutriAPI->>DB: RECARGA pasa a EXPIRADA
        end
    end

    loop Una vez al día
        Cron->>NutriAPI: Ejecuta conciliación diaria
        NutriAPI->>PeyAPI: GET /transaction/bank-account/{id}
        NutriAPI->>DB: Compara contra los débitos de la cuenta BANCO
        NutriAPI->>DB: Registra diferencias para revisión manual
    end
```

---

## 3. Cobro en Cafetería (Closed-Loop Campus)

Una sola llamada y una sola transacción. Objetivo: p95 ≤ 800 ms de extremo a extremo.

```mermaid
sequenceDiagram
    autonumber
    actor Estudiante as Estudiante (pulsera NFC)
    actor Cajero as Cajero (PWA móvil)
    participant POS as POS Web (Web NFC)
    participant Backend as NutriPey Backend
    participant DB as PostgreSQL (Ledger)

    Cajero->>POS: Marca productos (1 mollete, 1 manzana)
    Cajero->>POS: Pulsa Cobrar e inicia la lectura
    POS->>POS: Genera la llave de idempotencia de la venta
    Estudiante->>POS: Acerca la pulsera
    POS->>POS: NDEFReader lee la URL con el token
    POS->>Backend: POST /api/pos/cobrar (token, productos, llave) con sesión del cajero

    Backend->>DB: BEGIN
    Backend->>DB: Inserta TRANSACCION por llave de idempotencia
    alt Llave repetida
        Backend-->>POS: Devuelve el resultado original
    else Venta nueva
        Backend->>DB: Resuelve credencial, alumno y reglas
        Backend->>DB: SELECT de la cuenta FOR UPDATE
        alt Credencial inválida o suspendida
            Backend->>DB: ROLLBACK
            Backend-->>POS: 422 CREDENCIAL_INVALIDA
            POS-->>Cajero: Pantalla roja: credencial no válida
        else Producto bloqueado por regla del tutor
            Backend->>DB: ROLLBACK del intento de cobro
            Backend->>DB: BEGIN separado, auditoría del rechazo, COMMIT
            Backend-->>POS: 422 PRODUCTO_BLOQUEADO
            POS-->>Cajero: Pantalla roja: indica qué producto retirar
        else Tope diario o saldo insuficiente
            Backend->>DB: ROLLBACK
            Backend-->>POS: 422 TOPE_DIARIO o SALDO_INSUFICIENTE
            POS-->>Cajero: Pantalla amarilla: saldo disponible
        else Aprobada
            Backend->>DB: Débito ANTICIPO_ALUMNO, crédito INGRESO_VENTAS
            Backend->>DB: Detalle de venta
            Backend->>DB: COMMIT
            Backend-->>POS: 200 con saldo nuevo, iniciales y grupo
            POS-->>Cajero: Pantalla verde con botón Anular por 2 minutos
        end
    end

    opt El cajero detecta que no es el alumno
        Cajero->>POS: Pulsa Anular
        POS->>Backend: POST /api/pos/anular (transacción)
        Backend->>DB: REVERSO: débito INGRESO_VENTAS, crédito ANTICIPO_ALUMNO
        Backend-->>POS: 200 anulada
    end

```

**Puntos de diseño**

- Si la red falla después de enviar el cobro, el POS reintenta con la misma llave. No hay doble cobro.
- La pantalla de alérgeno no muestra el motivo médico, solo el producto a retirar.
- Sin Web NFC, el token llega por la URL del tag abierta con el lector nativo, por el QR del carnet o por matrícula más PIN. El resto del flujo es idéntico.

---

## 4. Ciclo de Vida de la Credencial

El saldo pertenece a la cuenta del alumno, no a la credencial.

```mermaid
stateDiagram-v2
    [*] --> INVENTARIO : Tag grabado con su token
    INVENTARIO --> ACTIVA : Vinculación con el alumno
    ACTIVA --> ACTIVA : Cobro aprobado
    ACTIVA --> SUSPENDIDA : Bloqueo por tutor o escuela
    SUSPENDIDA --> ACTIVA : Reactivación
    SUSPENDIDA --> BAJA : Pérdida confirmada
    ACTIVA --> BAJA : Reposición o egreso del alumno
    BAJA --> [*] : El saldo sigue en la cuenta del alumno
```

## 5. Consulta del tutor en la PWA (decisión del 16 nov)

NutriPey no envía mensajes externos. El tutor abre la PWA cuando quiere, por ejemplo al final del día o de la semana:

```mermaid
sequenceDiagram
    actor Padre as Tutor
    participant PWA as PWA de padres
    participant API as NutriPey Backend
    participant DB as PostgreSQL
    Padre->>PWA: Abre el historial del alumno (día o semana)
    PWA->>API: GET historial (sesión del tutor, alumno, rango)
    API->>DB: historial(): comprueba vínculo vigente y lee movimientos y bloqueos
    DB-->>API: Compras, recargas, anulaciones, reembolsos, intentos bloqueados y saldo
    API-->>PWA: Página de 50 con cursor
    PWA-->>Padre: Resumen del periodo y saldo; resalta saldo bajo
```

Un fallo de la PWA no afecta cobros ni webhooks. Ver `historial` en el [contrato del ledger](./contratos/ledger.md).
