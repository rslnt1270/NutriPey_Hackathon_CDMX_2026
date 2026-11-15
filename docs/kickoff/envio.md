# Materiales de envío — kickoff NutriPey

15 noviembre 2026 · Sub-issue #32 de #15 · PR de la demo: #31.
Meta: materiales listos 12:00, envío humano antes de 12:30; límite 13:00 CDMX.
Estado: borrador para revisión; no acredita envío ni validación final de la demo.

## Descripción para el formulario

NutriPey propone facilitar el cobro sin efectivo en cooperativas escolares y dar al tutor controles sobre el consumo. El diseño contempla recargar por CoDi directamente a la cuenta bancaria de la cooperativa y usar una pulsera como credencial de compra. NutriPey llevaría la contabilidad del anticipo y las reglas de consumo, sin custodiar el dinero.

Para este kickoff presentamos un prototipo estático, sin backend, con operaciones y alumnos ficticios. El recorrido muestra una recarga mediante QR de ejemplo, un cobro con tap NFC simulado, reglas de consumo, avisos simulados y un ledger demostrativo de doble partida. Incluye reintentos con la misma llave para ilustrar la idempotencia y una anulación mediante reverso. No hay conexión con pey, bancos, lectores NFC ni servicios de mensajería; no hubo pagos reales.

El objetivo de hoy es comunicar y evaluar ese recorrido. La implementación productiva de Next.js, PostgreSQL, AWS y notificaciones mediante n8n pertenece al plan de entrega del 12 de diciembre; no se presenta como funcionalidad desplegada en esta demo. El canal definitivo, Telegram o WhatsApp, está por confirmar.

## Qué está simulado y qué es real

Fuente de capacidades: [descripción del PR #31](https://github.com/rslnt1270/NutriPey_Hackathon_CDMX_2026/pull/31), consultada el 15 noviembre con HEAD `2b108046b8b901ff34fb99b092df8c4218c8a518`.
El panel «Avisos (simulado)» está confirmado en el código publicado del PR #31; su corrección A1 corresponde al SHA `55e1b6b6928ba81aad415eed04d1e6891e40ecff`. Publicar la rama del PR no equivale a desplegar en Pages. Esta tabla no sustituye la revisión cruzada del SHA congelado ni las pruebas de la URL final.

| Elemento | Qué existe en el prototipo | Límite que debe explicarse |
| :--- | :--- | :--- |
| Interfaz | Página estática HTML/CSS/JavaScript en `demo/`. | Sin backend ni producto operativo. |
| Recarga | QR de ejemplo y acción que simula la confirmación; control de duplicados. | QR no pagable; no llama a pey ni mueve dinero. |
| Caja | Catálogo y cobro con tap simulado; restricciones y repetición de llave. | No se lee una pulsera física; no prueba concurrencia en PostgreSQL. |
| Reglas | Simulación de restricciones de productos, alérgenos, tope y suspensión. | Datos ficticios; no demuestra cumplimiento normativo certificado. |
| Avisos | Vista denominada «Avisos (simulado)» con mensajes de ejemplo (cambio reportado por la sesión de demo). | No envía mensajes; el canal real sigue por decidir entre Telegram y WhatsApp. |
| Ledger | Código de simulación con centavos enteros, doble partida y reversos. | No es el ledger real ni implementa todavía su contrato de backend. |
| Pruebas | El PR reporta 15/15 pruebas de `demo/pruebas.js` tras A1. | Codex reprodujo 15/15 sobre `55e1b6b`; no son pruebas del backend productivo. |
| Publicación | Vista previa en GitHub Pages. | La sesión de demo publica; URL y contenido final pendientes de validación tras congelar. |
| Infraestructura | Diseño documentado para la entrega de diciembre. | Esta demo no prueba AWS, Docker, PostgreSQL ni n8n. |

## Comentarios sobre API pey para el formulario

En este kickoff no conectamos la demo a la API de pey ni realizamos pagos reales; por ello no podemos evaluar su funcionamiento operativo, disponibilidad o tiempos de respuesta. Nuestro trabajo hasta ahora fue de diseño y revisión documental. La documentación interna registra cómo crear cobros CoDi, correlacionar confirmaciones, verificar el cuerpo crudo del webhook y evitar acreditaciones duplicadas.

Según la guía del proyecto, pey no dispone de sandbox: las pruebas deben hacerse en producción con $0.01 MXN y el dinero enviado a la cuenta de prueba no se devuelve. Esto limita la experimentación sin mover dinero real; un entorno de pruebas sería útil. Como siguiente paso planeamos validar la integración con una cuenta habilitada y esos montos controlados. También serían útiles ejemplos completos de reintentos y conciliación de extremo a extremo. Son sugerencias desde la revisión documental, no fallos observados durante uso real.

Fuentes internas: [auditoría de la API](../05_auditoria_y_decisiones.md#c2-contrato-real-de-la-api-de-pey) y [guía pey-codi](../../.claude/skills/pey-codi/SKILL.md). No usar la secuencia histórica de pagos reales sugerida en el pitch de la auditoría para describir esta demo simulada.

## Guion de video — 2 minutos 45 segundos

Grabar solo la demo con datos ficticios, sin cuentas personales, pestañas privadas ni credenciales. Completar cada recarga antes de generar otra: el hallazgo M2 sobre QR simultáneos queda diferido. Ensayar tras el congelamiento: confirmar los nombres y la ubicación de los controles en la versión final. Si una acción no funciona, describir la limitación; no presentarla como ejecutada.

| Tiempo | Pantalla y acción | Narración sugerida / qué mostrar |
| :--- | :--- | :--- |
| 0:00–0:20 | Portada o vista inicial. | «NutriPey propone cobro sin efectivo para cooperativas escolares. Hoy mostramos un prototipo: los pagos, el NFC y los avisos son simulados». Mantener visible la advertencia de simulación. |
| 0:20–0:55 | Tutor: mostrar QR de ejemplo y activar la simulación de pago. | «En el producto previsto, CoDi liquidaría a la cooperativa. Este QR no se puede pagar». Mostrar saldo antes y después; explicar que la referencia repetida no debe acreditar dos veces. |
| 0:55–1:35 | Caja: seleccionar producto permitido, simular tap y repetir la misma llave con el control previsto. | «La compra descuenta saldo; repetir esta operación con la misma llave no debe cobrar de nuevo». Mostrar el saldo estable en el reintento. Preparar un rechazo por una regla ficticia y mostrar el motivo sin afirmar que hubo cobro. |
| 1:35–2:00 | Avisos: mostrar el panel «Avisos (simulado)». | «Estos mensajes se muestran dentro del prototipo, no se envían a un teléfono. El canal real será Telegram o WhatsApp, aún por confirmar». Mostrar aviso de recarga o compra bloqueada. |
| 2:00–2:30 | Ledger: mostrar movimientos de recarga y compra. | «Este ledger de demostración representa importes en centavos y asientos de doble partida. El reintento no agrega otro cobro. Una corrección se representaría con un reverso, sin editar el asiento original». No afirmar persistencia o seguridad productiva. |
| 2:30–2:45 | Cierre con enlace público. | «El siguiente paso es implementar y verificar los pagos reales antes de integrar Campus. Esta demo recoge el flujo que queremos validar para la entrega del 12 de diciembre». |

Video: pendiente de grabación y enlace público. Es opcional; no retrasar el envío por producirlo.

## Campos del formulario

[Formulario de entrega](https://docs.google.com/forms/d/e/1FAIpQLSf65jvztIzALgXfuVVrQpdBeeXyQNIDwft2t62RtYghG35eag/viewform), leído el 15 noviembre de 2026. Un envío por equipo.

| Campo exacto | Obligatorio | Valor preparado / acción humana |
| :--- | :--- | :--- |
| Ciudad | Sí | pendiente — confirmar por canal privado y seleccionar en el formulario. |
| Nombre del equipo | Sí | pendiente — confirmar por canal privado; no asumir que coincide con la marca del proyecto. |
| Descripción del proyecto | Sí | Copiar los tres párrafos de «Descripción para el formulario», ajustados a la versión realmente publicada. |
| Repositorio de código público (URL) | Sí | https://github.com/rslnt1270/NutriPey_Hackathon_CDMX_2026/tree/integracion/demo-kickoff/demo — enlace preparado para el envío; usar solo después de fusionar #31 con aprobación humana y confirmar que muestra el código. Mientras tanto, el código está en la rama del PR #31, no en `main`. |
| Link de la app en vivo (preferido) | No | https://rslnt1270.github.io/NutriPey_Hackathon_CDMX_2026/ — validar la publicación final antes de pegar. |
| Video demo (opcional) | No | pendiente — enlace de acceso público, si se graba. |
| Correos de los integrantes del equipo | Sí | pendiente — introducir uno por línea directamente en el formulario, usando los del registro Luma. Nunca guardarlos en este archivo ni en GitHub. |
| Comentarios sobre API pey | Sí | Copiar los dos párrafos de comentarios de esta página, conservando que no hubo pagos reales. |

## Control de entrega humana

- [ ] 10:00: recibir SHA congelado de la sesión de demo; cotejar este texto con ese contenido.
- [ ] Revisar el PR #31 en solo lectura y reproducir sus pruebas; informe separado con hallazgos por ID.
- [ ] Confirmar con la sesión de demo qué SHA publicó en `gh-pages`; solo esa sesión edita y publica.
- [ ] Antes de 12:00: abrir la URL en vivo sin autenticación, recorrer tutor → caja → aviso → ledger y comprobar escritorio y 390 px.
- [ ] Confirmar que los avisos y pagos siguen rotulados como simulados y no aparecen datos personales.
- [ ] M1: confirmar que #31 está fusionado en `integracion/demo-kickoff` y que el enlace al código indicado en el formulario abre `demo/` desde una ventana sin sesión; comprobar también el video, si existe.
- [ ] Una persona completa los datos privados, revisa los ocho campos y envía antes de 12:30.
- [ ] Esa persona conserva la confirmación de envío en privado. No marcar entregado antes de obtenerla.

Codex prepara estos materiales; no fusiona PR, no publica `gh-pages` y no envía el formulario en esta tarea.
