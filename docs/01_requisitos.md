# Especificación de Requerimientos del Sistema (SRS) — NutriPey

**Versión:** 1.2<br>
**Fecha:** 15 de noviembre de 2026<br>
**Proyecto:** NutriPey (Ecosistema Escolar de Pagos Digitales CoDi)  
**Cambios respecto a 1.0:** ver [Auditoría y Decisiones](./05_auditoria_y_decisiones.md).

---

## 1. Propósito y Alcance

Este documento define los requerimientos funcionales, no funcionales y las reglas de negocio de **NutriPey**.

NutriPey habilita:
1. **A los tutores:** recargar el anticipo de consumo de su hijo mediante cobros CoDi generados con la API pública de **pey**, fijar un tope de gasto diario y bloquear alérgenos o categorías.
2. **A las cooperativas escolares:** cobrar desde un celular Android sin terminal bancaria, y recibir cada recarga directamente en su cuenta.
3. **A la dirección escolar y a SEDECO CDMX:** evidencia agregada de cumplimiento de los lineamientos de alimentación de la SEP y de adopción de pagos digitales.

**Principio rector:** NutriPey no recibe, retiene ni dispersa dinero. Lleva la contabilidad del anticipo que cada familia tiene ante la cooperativa.

**Fuera del alcance del MVP:** operación offline, más de una cuenta receptora por escuela, reembolso automático de saldo.

---

La entrega principal es el **12 de diciembre**. El prototipo del 15 noviembre permite simulaciones rotuladas y no demuestra cumplimiento del producto. Alcances y aceptación en la [spec](./08_spec_entrega_diciembre.md).

## 2. Actores del Sistema

| Actor | Descripción |
| :--- | :--- |
| **Tutor** | Titular de la cuenta bancaria desde la que se recarga. Configura reglas y consulta el historial en la PWA de padres; no recibe mensajes externos. Un alumno puede tener varios tutores. |
| **Estudiante** | Porta una credencial: pulsera o tarjeta NFC, o carnet con QR. No necesita celular. |
| **Cajero** | Personal de la cooperativa. Usa la PWA de punto de venta con sesión propia. |
| **Administrador de cooperativa** | Gestiona catálogo, cajeros y conciliación. Titular de la cuenta bancaria receptora. |
| **Dirección escolar / SEDECO** | Consulta reportes agregados. No ve consumo individual. |
| **API pey** | Servicio externo que emite cobros CoDi ante Banxico y notifica los pagos por webhook. |

---

## 3. Requerimientos Funcionales (RF)

### 3.1 Recargas CoDi

- **RF-01 (Cobro CoDi por QR):** el tutor elige un monto ($20, $50, $100, $200 MXN o personalizado). El backend llama a `POST https://api.pey.mx/codi/qr` con:
  - `amount`: monto fijo. Nunca 0, que deja el monto a elección del pagador.
  - `expiration`: 600 segundos. El mínimo que acepta pey es 360.
  - `bankAccountId`: cuenta receptora de la cooperativa.
  - `metadata`: `recarga_id` y `estudiante_id` internos.
  - `numRef`: opcional y solo informativo; admite máximo 7 dígitos.

  La respuesta (HTTP 201) trae `id` y `qrString`. El QR se dibuja en el cliente a partir de `qrString`.
- **RF-02 (Cobro CoDi por push):** el backend llama a `POST https://api.pey.mx/codi/pn` con los mismos campos más `phoneNumber` (10 dígitos). La respuesta trae `transactionId` y `codiId`.
- **RF-03 (Webhook):** el endpoint `POST /api/webhooks/pey` atiende los eventos `codi.qr.payment_received` y `codi.pn.payment_received`. Verifica la firma con la librería `standardwebhooks` sobre el cuerpo crudo de la petición, usando las cabeceras `webhook-id`, `webhook-timestamp` y `webhook-signature`.
- **RF-04 (Acreditación):** un pago verificado se correlaciona con su recarga por `codiQrId` (QR) o `transactionId` (push). Se acredita el monto que reporta pey, una sola vez por `transactionId`.
- **RF-05 (Pago sin recarga asociada):** si llega un pago que no corresponde a ninguna recarga pendiente, o un segundo pago sobre el mismo QR, el evento se guarda, se responde 2xx y se marca para revisión manual. El dinero ya entró a la cuenta y no debe perderse de vista.
- **RF-06 (Conciliación):** una tarea periódica consulta en pey las recargas pendientes (`GET /transaction/codi/qr/{id}`, `GET /transaction/{id}`) y acredita las que ya estén pagadas. Una vez al día compara el ledger contra `GET /transaction/bank-account/{id}`.
- **RF-07 (Estado en pantalla):** la app del tutor consulta el estado de la recarga cada pocos segundos mientras el cobro está vigente.
- **RF-08 (Recarga en efectivo):** el cajero puede registrar una recarga en efectivo para tutores sin CoDi. Queda asentada en el ledger con el cajero que la recibió.

### 3.2 Punto de Venta y Credenciales

- **RF-09 (Lectura NFC):** en Chrome para Android, la PWA lee con `NDEFReader` la URL NDEF de la credencial. La lectura requiere HTTPS, un gesto del cajero para iniciar y la pestaña en primer plano.
- **RF-10 (Alternativas de lectura):** si el dispositivo no soporta Web NFC, el cajero puede:
  1. Abrir la URL del tag con el lector NFC nativo del teléfono (funciona en iPhone).
  2. Escanear el QR del carnet.
  3. Capturar matrícula más PIN. El PIN es un segundo factor, tiene límite de intentos y nunca identifica por sí solo.
- **RF-11 (Cobro en una sola llamada):** `POST /api/pos/cobrar` recibe el token de la credencial, la lista de productos con cantidades y una llave de idempotencia generada por el POS. Los precios los pone el servidor. En una sola transacción valida:
  1. Credencial activa y alumno activo.
  2. Productos disponibles y permitidos por las reglas del tutor.
  3. Tope diario, calculado por día calendario en `America/Mexico_City`.
  4. Saldo suficiente.
- **RF-12 (Atomicidad e idempotencia):** el débito y sus asientos se confirman juntos o no se confirman. Repetir la misma llave de idempotencia devuelve el resultado original sin cobrar otra vez.
- **RF-13 (Anulación):** el cajero puede anular un cobro dentro de los 2 minutos siguientes. La anulación genera un reverso; el cobro original no se modifica.
- **RF-14 (Verificación visual):** tras el cobro, la pantalla muestra iniciales, grupo y, si el tutor lo autorizó, la foto del alumno.
- **RF-15 (Bloqueo de credencial):** el tutor o la escuela pueden suspender una credencial. El bloqueo aplica desde la siguiente lectura.

### 3.3 Catálogo y Reglas

- **RF-16 (Catálogo conforme a la SEP):** cada producto registra sus sellos y leyendas de advertencia y sus alérgenos. Un producto con sellos o leyendas no puede publicarse para venta.
- **RF-17 (Reglas del tutor):** por alumno, el tutor define alérgenos prohibidos, categorías bloqueadas y tope diario.
- **RF-18 (Reporte de cumplimiento):** la escuela descarga un reporte mensual agregado: productos vendidos por categoría, proporción de pagos digitales y número de bloqueos por alérgeno. Sin datos por alumno.

### 3.4 Historial para el tutor (PWA de padres)

Decisión del 16 noviembre: NutriPey no envía mensajes por WhatsApp, Telegram ni correo. El tutor revisa en la PWA lo que compró su hijo, por ejemplo al final del día o de la semana.

- **RF-19 (Historial):** por cada alumno vinculado, la PWA muestra compras (productos, cantidades y total), recargas, anulaciones, reembolsos e intentos bloqueados (producto y tipo de regla, sin motivo médico), junto con el saldo actual obtenido por una lectura autorizada; las páginas de historial indican su instante de consulta y conservan esa instantánea hasta refrescar. Se lee con `historial` y `saldo` del [contrato del ledger](./contratos/ledger.md).
- **RF-20 (Resumen en la app):** la PWA agrupa por día y por semana (total gastado, productos e intentos bloqueados) y resalta el saldo cuando queda por debajo del umbral que fija el tutor.
- **RF-21 (Retirado el 16 nov):** envío desacoplado por outbox y n8n.

### 3.5 Consentimiento

- **RF-22 (Alta con consentimiento):** el alta de un alumno exige la aceptación del aviso de privacidad por el tutor, con consentimiento expreso y separado para datos de alergias y, si aplica, para la foto.

### 3.6 Informes asistidos

- **RF-23 (Retirado el 16 nov):** vinculación de mensajería.
- **RF-24 (Resumen asistido, opcional):** Bedrock podrá redactar reportes agregados ya calculados; nunca decidir saldo, cobro, alergias o cumplimiento. Con fallo se conserva el reporte numérico. Requiere decisión de adopción y evaluación independiente.

## 4. Requerimientos No Funcionales (RNF)

- **RNF-01 (Latencia en caja):** p95 ≤ 800 ms desde el tap hasta el resultado en pantalla; p95 ≤ 300 ms en servidor.
- **RNF-02 (Webhooks):** verificación de firma antes de cualquier efecto. Tolerancia de timestamp de 5 minutos. Respuesta 2xx en menos de 2 segundos, sin esperar a terceros.
- **RNF-03 (Consistencia contable):** en toda transacción la suma de débitos es igual a la de créditos. Los montos se guardan en centavos como enteros. Los asientos son inmutables.
- **RNF-04 (Datos de menores):** la credencial no contiene datos personales. No se almacenan datos bancarios de los tutores. Las alergias se guardan cifradas y solo se usan para evaluar el cobro.
- **RNF-05 (Disponibilidad):** el POS requiere conexión y usa datos móviles como respaldo del WiFi. Ante una caída, la cooperativa cobra en efectivo.
- **RNF-06 (Trazabilidad):** cada cobro, anulación, recarga en efectivo y cambio de reglas registra quién lo hizo y cuándo.
- **RNF-07 (Pruebas de pagos):** pey no tiene sandbox. La integración se prueba en producción con montos de $0.01 MXN.

- **RNF-08 (Reproducibilidad):** imágenes Docker versionadas, arranque documentado, healthcheck, migraciones explícitas y PostgreSQL persistente sin puerto público.
- **RNF-09 (Recuperación):** respaldos cifrados y restauración ensayada en entorno aislado; registrar RPO/RTO medidos y objetivos acordados antes del 7 diciembre.
- **RNF-10 (Operación):** métricas de latencia, errores y conciliación, sin datos personales.
- **RNF-11 (Costo y acceso):** verificar elegibilidad/vigencia de créditos, región, presupuesto y alertas; IAM mínimo y secretos fuera de imágenes/repositorio. Las alertas no cortan el gasto.
- **RNF-12 (Escalabilidad):** medir p95 con carga y recursos documentados; Docker no implica alta disponibilidad. Adoptar servicios adicionales solo con prueba, costo y decisión registrados.

## 5. Reglas de Negocio (RN)

- **RN-01 (Sin sobregiro):** el saldo de un alumno nunca es negativo. Lo garantiza una restricción de la base de datos, no solo el código.
- **RN-02 (Límite de la cuenta receptora):** el sistema lleva el acumulado mensual de abonos de cada cuenta. Al llegar al 80% del límite configurado avisa al administrador. Al 100% deja de generar cobros CoDi para esa cuenta hasta el mes siguiente o hasta que se registre una cuenta de mayor nivel. Para N2Bis el límite es 15,000 UDIs mensuales, con máximo 3,000 UDIs en efectivo.
- **RN-03 (Reposición de credencial):** el saldo pertenece a la cuenta del alumno. Reponer una pulsera perdida solo vincula una credencial nueva; el saldo no cambia.
- **RN-04 (Una cuenta receptora por escuela):** en el MVP, todas las recargas de una escuela se liquidan en una misma cuenta.
- **RN-05 (Reembolso):** la devolución de saldo al tutor la ejecuta la cooperativa por transferencia fuera de la plataforma y se asienta como `REEMBOLSO`.
- **RN-06 (Cuenta activa):** solo se generan cobros hacia cuentas con `codiStatus: ACTIVE` en pey.
