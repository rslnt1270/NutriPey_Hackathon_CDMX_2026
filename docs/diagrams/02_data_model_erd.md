# Modelo de Datos y Diagrama Entidad-Relación (ERD) — NutriPey

**Versión:** 1.0  
**Arquitectura de Datos:** PostgreSQL con Contabilidad de Doble Partida (*Double-Entry Ledger*) y Trazabilidad ACID.

---

## 1. Diagrama Entidad-Relación (ERD)

```mermaid
erDiagram
    ESCUELA ||--o{ COOPERATIVA : opera
    ESCUELA ||--o{ ESTUDIANTE : matricula
    TUTOR ||--o{ ESTUDIANTE : tutela
    ESTUDIANTE ||--o{ WEARABLE_NFC : posee
    ESTUDIANTE ||--|| CUENTA_LEDGER : tiene
    COOPERATIVA ||--|| CUENTA_LEDGER : tiene
    COOPERATIVA ||--o{ PRODUCTO : cataloga
    PRODUCTO ||--o{ DETALLE_VENTA : incluye
    TRANSACCION ||--o{ DETALLE_VENTA : genera
    TRANSACCION ||--o{ ASIENTO_CONTABLE : registra
    CUENTA_LEDGER ||--o{ ASIENTO_CONTABLE : afecta
    TUTOR ||--o{ RECARGA_CODI : inicia
    RECARGA_CODI ||--o| TRANSACCION : acredita
    ESTUDIANTE ||--o{ REGLA_NUTRICIONAL : tiene

    ESCUELA {
        uuid id PK
        string cct_clave UK "Clave Centro de Trabajo SEP"
        string nombre
        string alcaldia
        timestamp created_at
    }

    COOPERATIVA {
        uuid id PK
        uuid escuela_id FK
        string razon_social
        string rfc
        string clabe_n2bis "Cuenta Nivel 2 Bis (Banxico)"
        string pey_api_key_id "Identificador en pey.mx"
        boolean status_activa
    }

    TUTOR {
        uuid id PK
        string nombre_completo
        string telefono_whatsapp "Para alertas y CoDi Push"
        string email
        timestamp created_at
    }

    ESTUDIANTE {
        uuid id PK
        uuid tutor_id FK
        uuid escuela_id FK
        string matricula UK
        string nombre
        string grado_grupo
        string foto_url
        decimal limite_gasto_diario
        boolean status_activo
    }

    WEARABLE_NFC {
        uuid id PK
        uuid estudiante_id FK
        string nfc_uid UK "Identificador de chip NTAG213/215"
        string token_hash "Hash criptográfico de validación"
        string status "ACTIVO | EXTRAVIADO | SUSPENDIDO"
        timestamp fecha_vinculacion
    }

    PRODUCTO {
        uuid id PK
        uuid cooperativa_id FK
        string nombre
        string sku
        decimal precio
        int sellos_advertencia "Conteo de sellos negros (0 a 5)"
        string[] alergenos "Array: gluten, lactosa, nuez..."
        string categoria "BEBIDAS | COMIDA_CALIENTE | FRUTA | SNACK"
        boolean disponible
    }

    REGLA_NUTRICIONAL {
        uuid id PK
        uuid estudiante_id FK
        int max_sellos_permitidos "Tope de sellos por producto"
        string[] alergenos_prohibidos
        boolean prohibir_refrescos
        boolean activa
    }

    CUENTA_LEDGER {
        uuid id PK
        string tipo_titular "ESTUDIANTE | COOPERATIVA | TRANSITO_CODI"
        uuid titular_id UK
        string moneda "MXN"
        timestamp created_at
    }

    ASIENTO_CONTABLE {
        uuid id PK
        uuid transaccion_id FK
        uuid cuenta_ledger_id FK
        string tipo_asiento "DEBITO | CREDITO"
        decimal monto
        timestamp created_at
    }

    TRANSACCION {
        uuid id PK
        string tipo "RECARGA_CODI | COMPRA_CAFETERIA | AJUSTE"
        uuid cooperativa_id FK "Opcional si es compra"
        uuid estudiante_id FK
        decimal monto_total
        string status "PENDIENTE | COMPLETADA | RECHAZADA"
        string motivo_rechazo
        timestamp created_at
    }

    DETALLE_VENTA {
        uuid id PK
        uuid transaccion_id FK
        uuid producto_id FK
        int cantidad
        decimal precio_unitario
        decimal subtotal
    }

    RECARGA_CODI {
        uuid id PK
        uuid tutor_id FK
        uuid estudiante_id FK
        string pey_codi_id "ID devuelto por POST /codi/qr o /pn"
        string num_ref "Referencia numérica CoDi"
        decimal monto
        string metodo "QR | PUSH_NOTIFICATION"
        string status "PENDIENTE | PAGADA | EXPIRADA"
        timestamp fecha_pago
        string pey_transaction_id "UUID emitido por pey en webhook"
    }
```

---

## 2. Principios de Integridad Financiera

### A. Contabilidad de Doble Partida (*Double-Entry Ledger*)
Para garantizar que jamás exista discrepancia en el dinero real frente al virtual:
1. **Recarga CoDi exitosa de $100 MXN:**
   - `DEBITO` a Cuenta Concentradora CoDi en Tránsito (Activo).
   - `CREDITO` a la Cuenta Ledger del Estudiante (Pasivo/Monedero).
2. **Compra en Cafetería de $35 MXN:**
   - `DEBITO` a la Cuenta Ledger del Estudiante por $35.00 MXN.
   - `CREDITO` a la Cuenta Ledger de la Cooperativa por $35.00 MXN.
3. **Invariante Matemático:** $\sum \text{Débitos} = \sum \text{Créditos}$ en cada transacción.

---

## 3. Optimización de Índices para Baja Latencia en Caja
- `CREATE UNIQUE INDEX idx_wearable_nfc_uid ON wearable_nfc (nfc_uid) WHERE status = 'ACTIVO';`
- `CREATE INDEX idx_recarga_codi_numref ON recarga_codi (num_ref);`
- `CREATE INDEX idx_asiento_cuenta ON asiento_contable (cuenta_ledger_id, created_at DESC);`
- `CREATE INDEX idx_estudiante_tutor ON estudiante (tutor_id);`
