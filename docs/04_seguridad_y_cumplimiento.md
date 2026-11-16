# Seguridad, Privacidad y Cumplimiento Normativo — NutriPey

**Versión:** 1.1  
**Enfoque:** protección de menores, integridad del dinero y cumplimiento normativo.  
**Cambios respecto a 1.0:** ver [Auditoría y Decisiones](./05_auditoria_y_decisiones.md).

---

## 1. Posición Regulatoria: NutriPey no custodia fondos

- Cada recarga CoDi se liquida en la cuenta bancaria de la cooperativa, indicada por `bankAccountId` en cada cobro. NutriPey no tiene cuenta concentradora.
- El saldo del alumno es un anticipo de consumo ante un solo comercio, la cooperativa de su escuela. No es transferible entre personas ni canjeable en otros comercios.
- NutriPey no solicita ni almacena tarjetas, contraseñas ni credenciales bancarias. El tutor autoriza dentro de su propia app bancaria.
- La devolución de saldo la ejecuta la cooperativa por transferencia; NutriPey solo la asienta.

**Riesgo residual:** esta estructura busca quedar fuera de la emisión de fondos de pago electrónico que regula la Ley Fintech. Debe validarla un abogado antes de operar con dinero de familias reales.

---

## 2. Datos Personales de Menores

Marco aplicable: *Ley General de los Derechos de Niñas, Niños y Adolescentes* y *Ley Federal de Protección de Datos Personales en Posesión de los Particulares* (DOF 20 de marzo de 2025). La autoridad es la Secretaría Anticorrupción y Buen Gobierno, que asumió las funciones del extinto INAI.

| Dato | Clasificación | Tratamiento |
| :--- | :--- | :--- |
| Nombre, matrícula, grupo | Personal | Necesario para operar. |
| Alergias | **Sensible** | Consentimiento expreso del tutor. Cifrado en reposo. Solo se usa para evaluar el cobro. |
| Foto | Personal, opcional | Consentimiento separado. Por defecto se muestran iniciales y grupo. |
| Historial de consumo | Personal | Visible solo para los tutores del alumno. |
| Teléfono del tutor | Personal | Solo para CoDi push. No se usa para mensajería. |

**Principios**

1. **Consentimiento antes del alta.** El tutor acepta el aviso de privacidad, con consentimiento expreso para datos de salud. Se registra la versión del aviso y la fecha. Puede revocarlo.
2. **Chip sin datos personales.** La credencial contiene únicamente un token aleatorio. No guarda nombre, saldo, alergias ni foto.
3. **Minimización en caja.** El cajero ve qué producto retirar, nunca el motivo médico.
4. **Sin mensajería externa.** Desde el 16 noviembre, NutriPey no envía datos del menor a WhatsApp, Telegram, n8n ni correo. El tutor ve el historial dentro de la PWA, con su sesión, y el ledger vuelve a comprobar el vínculo tutor–alumno en cada consulta.
5. **Reportes agregados.** La dirección escolar y SEDECO reciben totales por categoría y periodo, con un mínimo de alumnos por grupo para evitar la reidentificación.
6. **Retención.** Al egresar el alumno se eliminan foto, reglas y alergias. Los asientos contables se conservan disociados.

---

## 3. Integración con pey y Webhooks

### A. Verificación de firma (Standard Webhooks)
- Se usa la librería oficial `standardwebhooks` con el secreto `whsec_...` del webhook.
- La verificación se hace sobre el **cuerpo crudo** de la petición, antes de parsear el JSON.
- Se rechazan eventos cuyo `webhook-timestamp` difiera más de 5 minutos, lo que limita los ataques de repetición.
- Una firma inválida responde 401 y no produce ningún efecto.

### B. Idempotencia en dos niveles
- **Evento:** la cabecera `webhook-id` se inserta en `WEBHOOK_EVENTO` con restricción de unicidad. pey la documenta como llave de idempotencia. Un reintento responde 200 sin efectos.
- **Pago:** `pey_transaction_id` es único en `RECARGA`. El mismo pago no se acredita dos veces aunque llegue por webhook y por conciliación.

### C. Integridad del monto
- Se acredita el `amount` del evento firmado. Nunca el monto que envió el navegador.
- Los cobros se crean con monto fijo y expiración de 600 segundos.
- Un pago que no corresponde a una recarga pendiente queda en `REVISION`.

### D. Secretos
- La API key de pey y el secreto del webhook viven en variables de entorno del servidor. Nunca en el repositorio ni en el cliente.
- Cada API key admite un solo webhook. El secreto se puede rotar desde el portal de pey.
- pey no tiene sandbox: las pruebas usan la llave de producción con montos de $0.01 MXN. La llave de desarrollo y la de la demo deben ser distintas.

### E. Conciliación
Una tarea consulta en pey las recargas pendientes y, una vez al día, compara las transacciones de la cuenta bancaria contra el ledger. Los webhooks son el camino rápido, no la única fuente.

---

## 4. Credenciales NFC y Clonación

### A. Modelo de amenaza
Un tag con identificador estático puede copiarse con un celular y una app gratuita. Hashear u ofuscar el identificador no lo evita: quien copia la cadena la reproduce tal cual. El número de serie de fábrica tampoco protege, porque existen tags con serie reescribible.

Web NFC solo expone mensajes NDEF y el número de serie. No permite usar desde el navegador la contraseña ni la firma de originalidad de los NTAG21x.

### B. Nivel 1: demo y piloto (NTAG213/215)
El tag contiene una URL NDEF con un token aleatorio de 128 bits:

`https://nutripey.y4ga.app/t/<token>`

El backend guarda solo el SHA-256 del token. **Este nivel es clonable** y se sostiene con controles compensatorios:

- Tope diario y saldo bajos, que acotan la pérdida máxima.
- Iniciales, grupo o foto en pantalla tras cada cobro.
- Anulación por el cajero durante 2 minutos.
- Bloqueo por el tutor, efectivo desde la siguiente lectura.
- Historial de compras visible para el tutor en la PWA.
- PIN del alumno por encima de un monto configurable (posterior al MVP).

### C. Nivel 2: producción (NTAG 424 DNA)
El chip genera en cada lectura una URL distinta con datos cifrados, un contador de lecturas y un código de autenticación (SUN/SDM con AES-128).

- El backend descifra, verifica el código y exige que el contador sea mayor al último aceptado.
- Una lectura copiada no funciona por segunda vez.
- El identificador visible cambia en cada tap, lo que impide rastrear al menor fuera de la escuela.
- Es compatible con Web NFC y con el lector nativo de iPhone, porque el resultado es una URL NDEF.
- La llave de cada tag se guarda cifrada en el servidor.

### D. Fallbacks
- **QR en carnet:** es estático y fotocopiable. Aplican los controles del nivel 1.
- **Matrícula más PIN:** el PIN es segundo factor. Cinco intentos fallidos bloquean el acceso por 15 minutos.

---

## 5. Punto de Venta

1. **Sesión del cajero.** Cada POS inicia sesión con un operador. Sin sesión no hay cobro.
2. **Idempotencia del cobro.** El POS genera una llave por venta. Los reintentos de red no duplican cargos.
3. **Bloqueo de lectura.** Tras una lectura, el POS ignora nuevas lecturas hasta que el cajero inicia otra venta. Es una ayuda de interfaz; la garantía real es la llave de idempotencia.
4. **Precios en servidor.** El POS envía identificadores y cantidades.
5. **Sin sobregiro.** Bloqueo de fila y `CHECK (saldo_centavos >= 0)`.
6. **Transporte.** HTTPS con TLS 1.2 o superior y HSTS. Web NFC exige HTTPS.
7. **Efectivo.** Las recargas en efectivo quedan ligadas al cajero y se cuadran en el corte de caja.
8. **Límite de peticiones** en los endpoints de cobro y de PIN, por operador y por credencial.

---

## 6. Auditoría y Trazabilidad

- `ASIENTO_CONTABLE` y `TRANSACCION` son de solo inserción.
- `AUDIT_LOG` registra actor, acción y hora UTC para: cobros rechazados, anulaciones, recargas en efectivo, cambios de reglas, altas y bajas de credenciales, y accesos a datos de salud.
- Reporte mensual por cooperativa: abonos recibidos contra el límite de su cuenta, ventas y saldo pendiente de entregar.
- Reporte de cumplimiento de la SEP por escuela, agregado.

---

## 7. Riesgos Abiertos

| Riesgo | Estado |
| :--- | :--- |
| Calificación legal del anticipo de consumo | Pendiente de validación por abogado. |
| Clonación en nivel 1 | Aceptado para demo y piloto con topes bajos. Migrar a NTAG 424 DNA antes de escalar. |
| Sin sandbox de pey | Mitigado con montos de $0.01 y llaves separadas. |
| Dependencia de conectividad en caja | Mitigado con datos móviles. Sin modo offline en el MVP. |
| Aviso de privacidad | Por redactar antes del primer alumno real. |

## 8. Infraestructura y automatizaciones (diseño v1.2)

PostgreSQL sin acceso público; roles IAM mínimos, secretos fuera de imágenes y respaldo cifrado con restauración probada. Bedrock, si se adopta, recibe solo agregados sin identificadores ni datos de salud. El presupuesto debe verificar créditos elegibles y alertas; no se presupone un corte automático de gasto.
