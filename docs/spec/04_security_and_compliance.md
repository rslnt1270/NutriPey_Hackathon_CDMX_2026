# Seguridad, Privacidad y Cumplimiento Normativo — NutriPey

**Versión:** 1.0  
**Enfoque:** Protección de la Infancia, Ciberseguridad Bancaria y Cumplimiento Normativo Nacional.

---

## 1. Protección de la Privacidad de los Menores de Edad
De acuerdo con la *Ley General de los Derechos de Niñas, Niños y Adolescentes* y la regulación en materia de protección de datos personales (INAI):

1. **Datos Cero en el Wearable (Zero-Knowledge Chip):**
   - El chip NFC de la pulsera no almacena nombres, apellidos, saldo, alergias ni fotos del menor.
   - Solo almacena un identificador único global (UUIDv4) tokenizado y ofuscado mediante hash salt. Si un tercero ilegítimo lee la pulsera en la calle con un teléfono, solo obtiene una cadena hexadecimal aleatoria sin sentido.
2. **Foto y Datos Visibles Exclusivamente en el Momento del Cobro:**
   - La foto del menor se renderiza en la pantalla del cajero durante 3 segundos únicamente para verificar que quien porta la pulsera es el alumno legítimo, evitando robos de pulseras entre compañeros de clase.
3. **Cero Custodia de Datos Bancarios de los Padres:**
   - NutriPey no solicita ni almacena números de tarjeta, CVVs ni contraseñas bancarias. Todas las recargas se procesan mediante la infraestructura regulada de **CoDi (Banco de México)** a través del API de **pey**, donde el padre autoriza directamente dentro del entorno protegido de su propia aplicación bancaria.

---

## 2. Seguridad en la Integración con pey y Webhooks

### A. Validación Criptográfica con Standard Webhooks
Los webhooks de pey que notifican pagos recibidos (`codi.qr.payment_received`) están protegidos contra suplantación y ataques de intermediario (Man-in-the-Middle):
- Se verifica la cabecera `webhook-signature` utilizando la clave secreta de webhook compartida.
- Se implementa verificación temporal obligatoria: cualquier evento con una diferencia de tiempo mayor a 300 segundos (5 minutos) respecto a la cabecera `webhook-timestamp` se descarta automáticamente para mitigar **ataques de repetición (Replay Attacks)**.

### B. Idempotencia Transaccional
Para evitar que un reintento de webhook de pey acredite saldo dos veces al alumno:
- Cada evento de pey contiene un identificador único de transacción (`transactionId`).
- El backend registra cada `transactionId` en una tabla de control con restricción de unicidad (`UNIQUE`). Si se recibe un evento duplicado, el sistema responde `HTTP 200 OK` inmediatamente sin alterar los balances contables.

---

## 3. Seguridad Física y Operativa del Punto de Venta (NFC)

1. **Mitigación de Cobros Duplicados en Caja (Debounce):**
   - El lector Web NFC implementa un bloqueo de software de 3 segundos tras cada lectura exitosa para evitar que si el alumno deja la mano cerca de la antena del celular se cobre dos veces.
2. **Canal Seguro en Tránsito:**
   - Comunicación de extremo a extremo cifrada mediante **TLS 1.3** con encabezados HSTS estrictos, evitando interceptación de tráfico dentro de la red WiFi escolar.
3. **Mecanismo de Desconexión Rápida (Kill Switch de Pulsera):**
   - Desde la app móvil de los padres, ante cualquier sospecha de extravío, existe un botón de "Bloqueo Preventivo" que inhabilita el tag en menos de 100 ms en la base de datos central.

---

## 4. Auditoría y Trazabilidad para SEDECO y Mesas Directivas
- Registro inmutable de eventos de auditoría (*Audit Log*): cada cambio de balance, asignación de tag, intento de cobro rechazado por política de salud y actualización de reglas nutricionales queda sellado con marca de tiempo UTC y firma del operador.
- Reporte mensual automatizado de dispersión y conciliación fiscal para la Cuenta Nivel 2 Bis de la cooperativa escolar.
