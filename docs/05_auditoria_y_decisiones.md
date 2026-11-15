# Auditoría de la Idea y la Arquitectura — NutriPey

**Fecha:** 14 de noviembre de 2026
**Alcance:** README, SRS (01), ERD (02), flujos (03) y seguridad (04) en su versión 1.0 (`ef894c1`).
**Método:** lectura completa del repo, contraste contra el OpenAPI público de pey (`docs.pey.mx/openapi.json`, versión `2026-10-20`) y contra fuentes públicas del marco regulatorio.

Los documentos 01–04 y el README ya incorporan las correcciones descritas aquí (versión 1.1). Este archivo conserva el porqué de cada cambio y las decisiones que siguen abiertas.

---

## 1. Veredicto

La idea es buena y encaja con el hackatón: usa CoDi donde CoDi es fuerte (recarga sin comisión desde la banca del padre) y evita usarlo donde es débil (un niño sin celular en una fila de recreo). El ledger de doble partida y la verificación de webhooks son las decisiones correctas.

La versión 1.0 tenía cuatro problemas que podían tumbar el proyecto, ninguno de ellos de código:

1. El diseño hacía que NutriPey custodiara dinero de terceros, lo que es actividad regulada.
2. El contrato de la API de pey estaba parcialmente inventado, y el registro de la cuenta bancaria ante Banxico tarda hasta 5 días hábiles.
3. La pulsera era clonable con cualquier celular y el documento afirmaba lo contrario.
4. La función nutricional estrella (bloquear productos con sellos) regula algo que la SEP ya prohíbe vender en escuelas.

---

## 2. Hallazgos críticos

### C1. Custodia de fondos: riesgo de actividad regulada (Ley Fintech)

**Qué decía:** la recarga se registraba contra una "Cuenta Concentradora CoDi en Tránsito" y el saldo del alumno era un pasivo de la plataforma.

**Problema:** recibir dinero del público, mantenerlo como saldo y permitir gastarlo con un tercero se parece a emitir fondos de pago electrónico, actividad reservada a instituciones autorizadas por la CNBV. Un equipo de hackatón no puede operar eso, y un jurado con pey y SEDECO lo va a preguntar.

**Corrección aplicada:** NutriPey nunca toca el dinero. Cada recarga CoDi se liquida directamente en la cuenta bancaria de la cooperativa, usando el parámetro `bankAccountId` que pey acepta por cobro. El saldo del alumno es un **anticipo de consumo ante esa cooperativa**, equivalente a un monedero de comercio único. NutriPey es el software que lleva la contabilidad de ese anticipo.

**Consecuencia de diseño:** el monedero queda atado a una cuenta receptora. En el MVP, una escuela tiene una sola cuenta receptora.

**Pendiente:** validar esta lectura con un abogado fintech antes de un piloto con dinero real. Es un argumento razonable, no una opinión legal.

### C2. Contrato real de la API de pey

Verificado contra el OpenAPI público. Diferencias con la v1.0:

| Tema | v1.0 | Contrato real |
| :--- | :--- | :--- |
| Respuesta de `POST /codi/qr` | `codiQrId`, `qrData` | HTTP 201 con `id`, `qrString` y `qrImage` (solo si `generateImage: true`). `codiQrId` solo aparece en el webhook. |
| Respuesta de `POST /codi/pn` | No especificada | `transactionId` (ULID) y `codiId` (folio Banxico de 20 dígitos). |
| `numRef` | Llave de conciliación | Máximo 7 dígitos. No sirve como llave única a escala. |
| Correlación | Por `numRef` | Por `codiQrId` (QR) o `transactionId` (push), más `metadata` propia (hasta 50 pares). |
| `expiration` | No especificada | Segundos. 0 = sin expiración; mínimo 360 cuando se fija. |
| `phoneNumber` (push) | No especificado | Obligatorio, exactamente 10 dígitos. Monto máximo 1,000,000. |
| Eventos de webhook | Solo `codi.qr.payment_received` | También `codi.pn.payment_received` y uno de cuenta bancaria actualizada. |
| Llave de idempotencia | `transactionId` | pey documenta la cabecera `webhook-id` como llave de idempotencia. Se usan ambas. |
| Destino de los fondos | Una API key por cooperativa | Una API key con `bankAccountId` por cobro. Las cuentas se registran con `POST /bank-account`. |
| Pagos por QR | Uno | Un QR puede recibir varios pagos (`GET /transaction/codi/qr/{id}` devuelve una lista). |
| Sandbox | Asumido | No existe. pey recomienda probar en producción con $0.01 MXN. |
| Conciliación | Solo webhook | Existen `GET /transaction/{id}`, `/transaction/api-key`, `/transaction/bank-account/{id}`. |

**Riesgo de calendario:** registrar una cuenta bancaria ante Banxico tarda hasta 5 días hábiles. pey ofrece una CLABE de prueba que se activa de inmediato, pero el dinero enviado ahí no se devuelve. Si el registro de la cuenta real no arranca este fin de semana, la Fase 2 (16–22 nov) solo podrá probarse contra la cuenta de prueba.

Cada API key admite un solo webhook, y el secreto se muestra una sola vez al crearlo.

### C3. La pulsera es clonable

**Qué decía:** el chip guarda un UUID "tokenizado y ofuscado mediante hash salt", y el README hablaba de "mitigación de clonación NFC".

**Problema:** un identificador estático es una contraseña que se transmite en claro a quien acerque un teléfono. Hashearlo no cambia nada: quien copia la cadena la puede escribir en otro tag de $5 pesos. Además, un identificador fijo permite rastrear al menor fuera de la escuela. La v1.0 no contenía ninguna medida real contra clonación.

Web NFC añade una restricción: solo expone mensajes NDEF y el número de serie. No permite comandos nativos del chip, así que la contraseña y la firma de originalidad de los NTAG21x no se pueden usar desde el navegador.

**Corrección aplicada, en dos niveles:**

- **Demo y piloto pequeño (NTAG213/215):** el tag lleva una URL NDEF con un token aleatorio de 128 bits. El backend guarda solo su hash. Controles compensatorios: saldo y tope diario bajos, foto o iniciales en pantalla, PIN por encima de un umbral, anulación por el cajero y bloqueo inmediato. El documento declara el riesgo en vez de negarlo.
- **Producción (NTAG 424 DNA):** el chip genera en cada lectura una URL con datos cifrados, un contador y un CMAC (función SUN/SDM). El backend verifica el CMAC y exige que el contador crezca, de modo que una lectura copiada no sirve por segunda vez y el identificador visible cambia en cada tap. Funciona con Web NFC porque el resultado es una URL NDEF normal.

**Beneficio lateral:** un tag con URL NDEF lo lee cualquier iPhone de forma nativa, sin Web NFC. El fallback para iOS deja de depender de la cámara.

### C4. La regla nutricional estrella regula algo ya prohibido

**Qué decía:** el padre define cuántos sellos negros tolera por producto.

**Problema:** los lineamientos de la SEP, obligatorios desde el 29 de marzo de 2025, prohíben vender en escuelas productos con sellos o leyendas de advertencia. Una función que permite al padre "autorizar hasta N sellos" presupone que la cooperativa vende lo que no puede vender. El README lo llamaba además "nuevo decreto nacional", lo cual es impreciso.

**Corrección aplicada:** el producto cambia de enfoque y gana fuerza:

- **Cumplimiento por diseño:** el catálogo no deja publicar productos con sellos o leyendas. La escuela obtiene un reporte que demuestra el cumplimiento ante la autoridad.
- **Reglas del tutor:** alérgenos, tope diario, categorías y horarios. Es lo que la norma no cubre y lo que un padre sí necesita.

Esto convierte a NutriPey en una herramienta que la dirección escolar quiere tener, no solo en un medio de pago.

---

## 3. Hallazgos altos

### A1. Cuentas N2Bis: afirmaciones imprecisas

Confirmado: la Circular 11/2026 de Banxico (DOF 17 de junio de 2026) crea la cuenta Nivel 2 Bis con abonos de hasta 15,000 UDIs al mes.

Correcciones:

- **No existe una "cuota obligatoria de 12,000 UDIs digitales".** La regla es un tope de 3,000 UDIs en depósitos en efectivo. Los 12,000 son el resto. Decir que Banxico "exige" esa cifra es falso y un jurado regulatorio lo detecta.
- **Titularidad.** Según el resumen regulatorio de BBVA Research (octubre 2026), la cuenta es para personas físicas mexicanas residentes en México. "La cooperativa o mesa directiva abre su cuenta" es incorrecto: la abre una persona física, por ejemplo el concesionario. Verificar en el texto de la circular.
- **Disponibilidad.** Los bancos tienen hasta el 14 de diciembre de 2026 para ofrecerla, dos días después de la entrega final. El diseño no puede depender de N2Bis: cualquier CLABE con CoDi habilitado funciona, y N2Bis queda como la vía de formalización recomendada.
- **RN-02 estaba mal planteada.** El límite es sobre abonos mensuales. Dispersar el dinero no libera cupo.
- **El límite no alcanza para escuelas medianas.** 15,000 UDIs son unos $132,000 MXN. Con un consumo de $30 diarios por alumno y 20 días de clase, eso cubre unos 220 alumnos activos. Una escuela de 500 alumnos necesita una cuenta de nivel superior.

### A2. Condición de carrera en el cobro

El flujo v1.0 consultaba saldo y reglas, y después abría la transacción. Dos taps simultáneos del mismo alumno podían pasar ambas validaciones y dejar saldo negativo. El bloqueo de 3 segundos en el lector no lo resuelve: es por dispositivo, y no cubre reintentos de red.

**Corrección aplicada:** todo ocurre dentro de una sola transacción con bloqueo de fila sobre la cuenta, `CHECK (saldo_centavos >= 0)` en la base de datos y una llave de idempotencia generada por el POS en cada venta.

### A3. Modelo de datos

| Problema | Corrección |
| :--- | :--- |
| `CUENTA_LEDGER` sin saldo: cada tap sumaría todos los asientos | Saldo materializado en la cuenta, actualizado en la misma transacción que los asientos. |
| Montos en `decimal` | Enteros en centavos (`bigint`). |
| Sin tabla de idempotencia de webhooks | `WEBHOOK_EVENTO` con `webhook_id` único. |
| Sin identidad del cajero | `OPERADOR` y `operador_id` en cada transacción. |
| Tutor y estudiante 1:N | N:M (`TUTOR_ESTUDIANTE`): un alumno suele tener dos tutores. |
| `sellos_advertencia` como conteo | Lista de sellos y leyendas. Las leyendas de cafeína y edulcorantes son las relevantes para menores. |
| `COOPERATIVA.pey_api_key_id` | `pey_bank_account_id` y `codi_status`. |
| Estados del wearable distintos en ERD y diagrama | Un solo conjunto de estados. |
| "El saldo se transfiere a la nueva pulsera" | El saldo vive en la cuenta del alumno. La pulsera es una credencial y no hay nada que transferir. |
| Sin reversos ni reembolsos | Tipos `REVERSO` y `REEMBOLSO`. Los asientos nunca se editan. |
| Sin consentimiento ni notificaciones | `CONSENTIMIENTO` y `NOTIFICACION_OUTBOX`. |

### A4. Privacidad de menores

- **El INAI ya no existe.** Se extinguió en 2025. La ley vigente es la nueva LFPDPPP (DOF 20 de marzo de 2025) y la autoridad es la Secretaría Anticorrupción y Buen Gobierno.
- **Las alergias son datos personales sensibles.** Requieren consentimiento expreso del tutor y un aviso de privacidad. La v1.0 no lo mencionaba.
- **"Zero-Knowledge Chip" era un nombre incorrecto.** No hay ninguna prueba de conocimiento cero. Se renombró a "chip sin datos personales".
- **Los tickets por WhatsApp envían nombre y consumo del menor a un tercero** (Meta o Twilio). Se minimiza el contenido y se declara en el aviso.
- **SEDECO y la escuela reciben agregados**, nunca consumo individual.
- **La foto pasa a ser opcional.** Iniciales y grupo cumplen la misma función con menos riesgo.

### A5. Modo offline contradice "sin sobregiro"

RNF-05 prometía operación offline con sincronización diferida. Con el saldo en el servidor y una pulsera sin datos, un POS sin conexión no puede saber si hay saldo. Las dos promesas no se sostienen a la vez.

**Corrección aplicada:** queda fuera del MVP. El POS usa datos móviles como respaldo del WiFi. Si se retoma, será con un tope offline por alumno y el riesgo asumido por la cooperativa.

---

## 4. Hallazgos medios

| # | Hallazgo | Corrección |
| :- | :--- | :--- |
| M1 | Latencia inconsistente: 500 ms en RF-07 y README, 800 ms en RNF-01, "100 ms" para el bloqueo | Un solo objetivo: p95 ≤ 800 ms de extremo a extremo, ≤ 300 ms en servidor. El bloqueo aplica desde la siguiente lectura. |
| M2 | El webhook respondía 200 después de llamar a WhatsApp | Confirmar la transacción, responder 2xx y enviar la notificación desde una cola (outbox). Una caída de WhatsApp no debe provocar reintentos de pey. |
| M3 | Sin conciliación si se pierde un webhook | Tarea periódica que consulta las recargas pendientes en pey y compara el ledger contra `/transaction/bank-account/{id}`. |
| M4 | Fallback con PIN de 4 dígitos como identificador | El PIN es segundo factor, nunca identificador. Se combina con matrícula o QR y tiene límite de intentos. |
| M5 | Un WhatsApp por compra | Costo por mensaje y saturación del padre. Por defecto: resumen diario, con aviso inmediato solo en recarga, bloqueo y saldo bajo. Configurable. |
| M6 | La foto se mostraba después del cobro | Se cobra en el tap y el cajero tiene una ventana para anular. Verificar antes del cobro duplicaría el tiempo por alumno. |
| M7 | Solo recarga por CoDi | Muchos tutores no tienen CoDi activo. Se añade recarga en efectivo en caja, registrada en el ledger. |
| M8 | Stack sin decidir ("Next.js/FastAPI") | Un solo servicio. Ver decisión D1. |
| M9 | "Standard Webhooks con Svix" | Basta la librería `standardwebhooks`. Se verifica sobre el cuerpo crudo, antes de parsear el JSON. |
| M10 | Códigos HTTP 403 y 400 para rechazos de negocio | 422 con un código de motivo. El 403 se reserva para un cajero sin permiso. |
| M11 | Ley de Economía Digital descrita como mandato | Publicada en el DOF el 4 de noviembre de 2026. La adopción es voluntaria salvo sectores que defina la SHCP. Se cita como impulso, no como obligación. |

---

## 5. Retroalimentación de producto y pitch

**Fortalezas que conviene subrayar**

- Cero hardware bancario: el POS es el celular Android que el cajero ya tiene.
- Cero comisión por transacción: la API de pey no cobra y CoDi tampoco.
- Un problema con dueño institucional claro: la escuela debe demostrar que cumple los lineamientos de la SEP.

**Huecos del pitch**

- **Modelo de negocio.** No se dice quién paga. Opciones: cuota mensual a la cooperativa, margen sobre pulseras o patrocinio institucional. Elegir una.
- **Evidencia del problema.** "Miles de estudiantes pierden dinero" no tiene fuente. Cinco entrevistas con cooperativas y diez con padres valen más que cualquier cifra.
- **Competencia.** Ya existen monederos escolares de circuito cerrado en México. El diferenciador a defender es CoDi sin comisión más cumplimiento SEP.
- **Marca.** "NutriPey" usa la marca registrada de un patrocinador. Sirve para el hackatón; después habrá que pedir permiso o renombrar.
- **Reembolso de saldo.** CoDi solo cobra. Devolver saldo al fin del ciclo escolar exige un SPEI manual desde la cuenta de la cooperativa. Hay que definir la política.

**Lo que debe verse en la demo de 3 minutos**

1. El padre recarga $0.01 por CoDi y el saldo aparece en segundos.
2. Un tap aprobado en la caja, con el tiempo real en pantalla.
3. Un tap rechazado por alergia, con el aviso llegando al padre.
4. El reporte de cumplimiento SEP de la escuela.

Todo lo que no aparezca en esos cuatro momentos es candidato a recorte.

---

## 6. Decisiones abiertas

| # | Decisión | Recomendación |
| :- | :--- | :--- |
| D1 | Stack — decidido 15 nov | Monolito modular Next.js + PostgreSQL y AWS decididos; Docker/EC2 inicial propuestos en PR #18. No implementado todavía. |
| D2 | Canal — pendiente | Telegram o WhatsApp Cloud vía n8n. Un canal verificado basta para diciembre; n8n local sirve para desarrollo. |
| D3 | Tags para la demo | NTAG213 para el flujo principal y dos o tres NTAG 424 DNA para mostrar la verificación dinámica. |
| D4 | Cuenta receptora | Registrar hoy una CLABE propia en pey. Mientras se activa, usar la cuenta de prueba con $0.01. |
| D5 | Escuela piloto | Conseguir una cooperativa real, aunque sea para una prueba de un recreo. Cambia el pitch de propuesta a evidencia. |
| D6 | Validación legal | Una consulta sobre C1 y sobre el aviso de privacidad antes de mover dinero de familias reales. |

---

## 7. Fuentes

- pey: [documentación](https://docs.pey.mx), [OpenAPI](https://docs.pey.mx/openapi.json), [crear API key y pruebas](https://docs.pey.mx/en/docs/tutorials/getting-started/create-an-api-key), [webhooks](https://docs.pey.mx/en/docs/webhooks/introduction).
- N2Bis: [IDC Online](https://idconline.mx/finanzas/2026/06/17/mipymes-tendran-monto-maximo-de-depositos-diferente), [Bloomberg Línea](https://www.bloomberglinea.com/latinoamerica/mexico/banxico-emite-medidas-para-simplificar-pagos-digitales-y-ampliar-limite-en-cuentas-sin-registro-ante-el-sat/), [BBVA Research, octubre 2026](https://www.bbvaresearch.com/publicaciones/mexico-regulacion-financiera-octubre-2026/).
- Ley de Economía Digital: [Basham](https://basham.com.mx/se-publica-la-ley-de-economia-digital-para-pagos-digitales-y-electronicos/), [White & Case](https://www.whitecase.com/insight-alert/mexicos-draft-digital-payments-law-identity-acceptance-and-cash-free-sectors).
- Lineamientos SEP: [N+](https://www.nmas.com.mx/nacional/sep-pone-fecha-fin-comida-chatarra-productos-prohibidos-cooperativas-escuelas-mexico/), [Eje Central](https://www.ejecentral.com.mx/nuestro-eje/avanza-estrategia-vive-saludable-vive-feliz-de-la-sep-86-de-escuelas-en-mexico-ya-no-venden-comida-chatarra).
- Web NFC: [Chrome for Developers](https://developer.chrome.com/docs/capabilities/nfc?hl=es-419), [MDN NDEFReader](https://developer.mozilla.org/docs/Web/API/NDEFReader).

Las afirmaciones regulatorias provienen de prensa especializada y resúmenes de despachos. Antes de citarlas ante el jurado conviene confirmarlas en el texto del DOF y de la circular.

## 8. Actualización del 15 de noviembre

La [spec de diciembre](./08_spec_entrega_diciembre.md) separa el kickoff del producto final. AWS dispone de 80 créditos reportados (cobertura por verificar); n8n está instalado localmente. Lambda/SQS, Bedrock y RDS requieren evaluación y no se consideran implementados. Responsables por tarea; Pagos precede a Campus. Los hallazgos históricos anteriores no prueban capacidades desplegadas.
