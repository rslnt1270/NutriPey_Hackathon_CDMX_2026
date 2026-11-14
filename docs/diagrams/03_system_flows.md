# Diagramas de Flujo y Secuencia — NutriPey

**Versión:** 1.0  
**Flujos Principales:** Recarga CoDi vía pey, Compra NFC en Caja con Motor Nutricional y Notificación WhatsApp.

---

## 1. Flujo de Secuencia: Recarga CoDi (Open-Loop On-Ramp)

Este flujo describe cómo el padre transfiere fondos desde su aplicación bancaria al monedero escolar del estudiante con 0% de comisión utilizando la API de pey y el webhook con Standard Webhooks.

```mermaid
sequenceDiagram
    autonumber
    actor Padre as Padre / Tutor (Móvil)
    participant NutriApp as NutriPey WebApp
    participant NutriAPI as NutriPey Backend (Next.js/FastAPI)
    participant PeyAPI as API pey (api.pey.mx)
    participant Banxico as Red CoDi / Banxico
    participant Banco as App Bancaria del Padre
    participant WhatsApp as Gateway WhatsApp (Twilio/Meta)

    Padre->>NutriApp: Selecciona monto ($100 MXN) y método (QR o Push)
    NutriApp->>NutriAPI: POST /api/recargas/iniciar {estudiante_id, monto, metodo}
    NutriAPI->>PeyAPI: POST /codi/qr (o /codi/pn) {amount: 100, concept: "NutriPey #4092", numRef: "4092"}
    PeyAPI->>Banxico: Registra orden CoDi
    Banxico-->>PeyAPI: OK (Cadena CoDi / Push emitida)
    PeyAPI-->>NutriAPI: {codiQrId: "01HXYZ...", qrData: "..."}
    NutriAPI-->>NutriApp: Muestra QR en pantalla o avisa "Push enviado a tu cel"

    alt Escaneo QR o Notificación Push
        Padre->>Banco: Abre notificación / escanea QR CoDi
        Banco->>Banxico: Autoriza pago de $100.00 MXN con biométricos
        Banxico->>Banco: Liquidación completada en tiempo real
    end

    Banxico->>PeyAPI: Confirmación de pago recibido
    PeyAPI->>NutriAPI: Webhook: POST /api/webhooks/pey (headers: webhook-signature, webhook-id)
    
    critical Verificación Criptográfica
        NutriAPI->>NutriAPI: Valida HMAC-SHA256 con Standard Webhooks secret
    end

    NutriAPI->>NutriAPI: Ejecuta asiento contable (Crédito al Monedero del Alumno)
    NutriAPI->>WhatsApp: POST /enviar-mensaje (Confirmación de recarga)
    WhatsApp-->>Padre: 📲 "¡Recarga acreditada de $100.00 MXN para Mateo!"
    NutriAPI-->>PeyAPI: HTTP 200 OK
```

---

## 2. Flujo de Secuencia: Compra en Cafetería Escolar (Closed-Loop Campus)

Este flujo describe la interacción de alta velocidad (< 500 ms) en la fila del recreo, validando saldo y salud antes de descontar.

```mermaid
sequenceDiagram
    autonumber
    actor Estudiante as Estudiante (Pulsera NFC)
    actor Cajero as Encargado Cooperativa (PWA Móvil)
    participant POS as Terminal Web (Web NFC API)
    participant Backend as NutriPey Core Engine
    participant DB as PostgreSQL (Ledger ACID)
    participant WhatsApp as Gateway WhatsApp

    Cajero->>POS: Marca productos (1x Mollete $25, 1x Manzana $10)
    Cajero->>POS: Solicita "Cobrar con Pulsera"
    Estudiante->>POS: Acerca pulsera NFC al celular del cajero
    POS->>POS: Web NFC (NDEFReader) extrae nfc_uid
    POS->>Backend: POST /api/pos/cobrar {nfc_uid, items: [id_1, id_2]}

    rect rgb(240, 248, 255)
        Note over Backend, DB: Validación en milisegundos
        Backend->>DB: Consulta Estudiante + Saldo Ledger + Reglas Nutricionales
        DB-->>Backend: Datos recuperados

        alt Producto Viola Restricción Nutricional (ej. Sellos prohibidos / Alergia)
            Backend-->>POS: HTTP 403 RECHAZADO: "Producto bloqueado por política de salud del padre"
            POS-->>Cajero: Pantalla Roja: Alerta médica o de sellos
            Backend-)WhatsApp: ⚠️ Alerta al Padre: Intento de compra de producto prohibido
        else Saldo Insuficiente o Límite Diario Excedido
            Backend-->>POS: HTTP 400 RECHAZADO: "Saldo insuficiente"
            POS-->>Cajero: Pantalla Amarilla: Solicitar otro medio
        else Transacción Válida y Aprobada
            Backend->>DB: BEGIN TRANSACTION (Débito Alumno, Crédito Cooperativa)
            DB-->>Backend: COMMIT OK
            Backend-->>POS: HTTP 200 APROBADO: {nuevo_saldo: $65.00, alumno: "Mateo"}
            POS-->>Cajero: Pantalla Verde con Foto del Alumno y "¡Cobro Exitoso!"
            Backend-)WhatsApp: 🥪 Notificación al Padre: Ticket de compra con semáforo verde
        end
    end
```

---

## 3. Diagrama de Estados: Ciclo de Vida del Wearable NFC

```mermaid
stateDiagram-v2
    [*] --> INVENTARIO : Chip adquirido (NTAG213)
    INVENTARIO --> ASIGNADO : Vinculación con Matrícula del Alumno
    ASIGNADO --> ACTIVO : Activado tras primera recarga de saldo
    ACTIVO --> ACTIVO : Compra en cafetería exitosa
    ACTIVO --> SUSPENDIDO : Reporte temporal de extravío por el padre
    SUSPENDIDO --> ACTIVO : Reactivación confirmada
    SUSPENDIDO --> DADO_DE_BAJA : Confirmación de pérdida definitiva
    DADO_DE_BAJA --> [*] : Saldo transferido íntegramente a nueva pulsera
```
