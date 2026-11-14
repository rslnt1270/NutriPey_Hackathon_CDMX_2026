# Especificación de Requerimientos del Sistema (SRS) — NutriPey

**Versión:** 1.0  
**Fecha:** Noviembre 2026  
**Proyecto:** NutriPey (Ecosistema Escolar de Pagos Digitales CoDi)  
**Marco Normativo:** Ley de Economía Digital para Pagos Digitales y Electrónicos & Cuentas N2Bis (Banxico)

---

## 1. Propósito y Alcance

El presente documento define los requerimientos funcionales, no funcionales, reglas de negocio y restricciones técnicas para la plataforma **NutriPey**.

NutriPey provee una solución integral que habilita:
1. **A los Padres de Familia:** Recargar saldos escolares mediante solicitudes de cobro CoDi generadas a través de la API pública de **pey** (`POST /codi/qr` y `POST /codi/pn`), establecer límites de gasto diario y fijar restricciones nutricionales preventivas (bloqueo de alérgenos o alimentos con sellos de advertencia).
2. **A las Cooperativas y Cafeterías Escolares:** Operar un punto de venta (POS) ligero en dispositivos móviles estándar sin costo de adquisición de hardware bancario, utilizando la API Web NFC para debitar el consumo del monedero del estudiante en menos de 500 milisegundos.
3. **A la Administración Escolar y SEDECO CDMX:** Garantizar la formalización bancaria simplificada mediante Cuentas Nivel 2 Bis (N2Bis), auditoría contable de doble partida (*double-entry ledger*) y trazabilidad de hábitos de consumo saludable.

---

## 2. Actores del Sistema

| Actor | Descripción |
| :--- | :--- |
| **Padre / Tutor** | Titular de la cuenta bancaria de circuito abierto. Configura el perfil del estudiante, recarga saldo vía CoDi y recibe notificaciones de consumo vía WhatsApp. |
| **Estudiante** | Portador del wearable/pulsera con chip NFC pasivo (NTAG213/215/216) o carnet escolar con código QR único. Consume en la cafetería escolar. |
| **Encargado de Cooperativa (Cajero)** | Personal de la cafetería escolar que utiliza la Web App POS en un smartphone Android/iOS para registrar productos y procesar cobros por proximidad NFC. |
| **Administrador Escolar / SEDECO** | Monitorea el volumen de recaudación digital, cumplimiento de la cuota N2Bis (mínimo 12,000 UDIs digitales) y reportes de nutrición. |
| **API pey (Pasarela CoDi)** | Servicio externo de pey que gestiona la emisión de QRs/Push notifications de CoDi ante el Banco de México y notifica vía webhooks la liquidación de fondos. |

---

## 3. Requerimientos Funcionales (RF)

### 3.1 Módulo de Recargas y Pagos CoDi (Open-Loop On-Ramp)
- **RF-01 (Generación de Cobro CoDi QR):** El sistema debe permitir al padre solicitar una recarga de saldo fija ($20, $50, $100, $200 MXN o monto personalizado), consumiendo el endpoint `POST https://api.pey.mx/codi/qr`.
- **RF-02 (Generación de CoDi Push):** El sistema debe permitir enviar una solicitud de cobro CoDi directamente al teléfono del padre mediante `POST https://api.pey.mx/codi/pn` para autorizar desde su aplicación bancaria sin escanear.
- **RF-03 (Recepción y Validación de Webhooks):** El backend debe exponer un endpoint seguro (`POST /api/webhooks/pey`) que reciba el evento `codi.qr.payment_received`, validando la firma criptográfica con la especificación `Standard Webhooks` (`webhook-id`, `webhook-timestamp`, `webhook-signature`).
- **RF-04 (Acreditación Automática de Saldo):** Al verificar un webhook exitoso, el sistema debe registrar el asiento contable de crédito en el monedero del alumno asociado a la referencia numérica (`numRef`).

### 3.2 Módulo de Wearables NFC y Punto de Venta (Closed-Loop Campus)
- **RF-05 (Lectura Web NFC):** La interfaz del punto de venta en dispositivos Android con Chrome debe interactuar con la Web NFC API (`NDEFReader`) para leer el UID/identificador único del chip del estudiante.
- **RF-06 (Modo Contingencia / Fallback):** Si el dispositivo del cajero no soporta Web NFC (ej. laptop o iOS), la PWA debe proveer lectura óptica de código QR o ingreso manual de PIN escolar de 4 dígitos.
- **RF-07 (Cobro Subsegundo):** Al aproximar la pulsera, el sistema debe validar en un solo viaje redondo (< 500 ms):
  1. Identidad y foto del alumno.
  2. Saldo disponible en el ledger.
  3. Límite de gasto diario no excedido.
  4. Compatibilidad de los productos seleccionados con las restricciones nutricionales del alumno.
- **RF-08 (Transacción Atómica):** El descuento de saldo debe ejecutarse como una transacción atómica (ACID) para evitar doble cobro bajo concurrencia.

### 3.3 Módulo Nutricional y Salud Escolar
- **RF-09 (Catálogo con Semáforo Nutricional):** Cada producto de la cooperativa debe catalogarse con sus atributos de salud: número de sellos de advertencia (Exceso Calorías, Azúcares, Sodio, Grasas Saturadas) y alérgenos (Nueces, Lácteos, Gluten, Huevo).
- **RF-10 (Reglas Preventivas del Tutor):** El padre debe poder definir políticas en el perfil del alumno:
  - *Bloqueo estricto:* Prohibir productos con más de $N$ sellos negros.
  - *Restricción médica:* Bloqueo de alérgenos específicos.
  - *Tope diario:* Monto máximo acumulado por jornada escolar.

### 3.4 Módulo de Notificaciones WhatsApp
- **RF-11 (Notificación de Recarga):** Envío automático de confirmación al padre tras la liquidación del pago CoDi.
- **RF-12 (Ticket Digital Nutricional):** Tras cada cobro en cafetería, se debe disparar un mensaje a WhatsApp con el detalle de los alimentos consumidos, el desglose calórico/sellos, el monto debitado y el saldo remanente.
- **RF-13 (Alerta de Intento de Compra Bloqueada):** Si el cajero intenta cobrar un alimento prohibido por el tutor, el sistema rechaza la transacción y notifica al padre preventivamente.

---

## 4. Requerimientos No Funcionales (RNF)

- **RNF-01 (Latencia Transaccional en Caja):** El tiempo total de procesamiento de cobro en el POS escolar no debe exceder los 800 ms (percentil 95), asegurando la fluidez de la fila durante el recreo.
- **RNF-02 (Seguridad Criptográfica de Webhooks):** Todas las cargas útiles de webhooks recibidas de `pey.mx` deben verificarse mediante HMAC-SHA256 antes de mutar saldos. Solicitudes con timestamps mayores a 5 minutos deben descartarse (mitigación de ataques de repetición).
- **RNF-03 (Consistencia Contable):** El sistema debe implementar un registro de doble partida (*double-entry bookkeeping*), donde cada débito a una cuenta de usuario tenga un crédito equivalente a la cuenta de la cooperativa, impidiendo la creación o destrucción artificial de saldo.
- **RNF-04 (Protección de Datos de Menores):** No se almacenarán datos bancarios de los padres en la base de datos de NutriPey (delegados a CoDi/Banxico vía pey). Los identificadores de pulseras NFC no deben contener datos personales en texto plano en la memoria del chip, sino únicamente un UUID opaco referenciado al backend con TLS 1.3.
- **RNF-05 (Disponibilidad y Resiliencia):** Arquitectura desacoplada lista para operar en modo offline-resilient con sincronización diferida en caso de caída temporal del WiFi de la escuela.

---

## 5. Reglas de Negocio (RN)

- **RN-01 (Sin Sobregiro):** Un estudiante bajo ninguna circunstancia puede realizar compras a crédito o dejar su saldo en negativo.
- **RN-02 (Cumplimiento N2Bis):** La cuenta concentradora de la cooperativa escolar alertará al administrador cuando los ingresos acumulados en el mes alcancen el 80% del límite de 15,000 UDIs para programar dispersiones o conciliaciones bancarias.
- **RN-03 (Bloqueo Inmediato de Wearable):** Si el estudiante reporta la pérdida de la pulsera, el padre o la escuela pueden desactivar el chip desde la aplicación en 1 clic; el saldo permanece íntegro y se transfiere a un nuevo tag sin penalización.
