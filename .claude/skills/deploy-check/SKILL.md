---
name: deploy-check
description: Lista de verificación para desplegar NutriPey y prueba de humo posterior con un pago CoDi real de $0.01. Usar antes de un despliegue a producción, después de él, o al preparar el entorno de la demo.
---

# Despliegue de NutriPey

> **Pendiente:** el proveedor de hospedaje de `nutripey.y4ga.app` no está decidido. Los comandos concretos se añaden aquí cuando se cierre. La lista aplica a cualquier proveedor.

Desplegar a producción es una acción visible y difícil de revertir. Pide confirmación a la persona antes de ejecutar el despliegue; esta guía no la sustituye.

## 1. Antes de desplegar

- [ ] `main` está verde en CI y el commit a desplegar está fusionado.
- [ ] Las migraciones pendientes se revisaron y son compatibles con la versión anterior del código.
- [ ] Hay respaldo de la base de datos de producción.
- [ ] Las variables de entorno existen en producción. Compara contra `.env.example`:
  - `DATABASE_URL`
  - `PEY_API_KEY` (la de producción, distinta de la de desarrollo)
  - `PEY_WEBHOOK_SECRET`
  - `PEY_BANK_ACCOUNT_ID` de la cooperativa de la demo
  - Credenciales del proveedor de WhatsApp
  - Secreto de sesión
- [ ] La cuenta bancaria está en `codiStatus: ACTIVE` (`GET /bank-account/{id}`).
- [ ] La base de datos y el cómputo están en la misma región. El objetivo en caja es p95 ≤ 800 ms.

## 2. Desplegar

1. Aplicar migraciones.
2. Desplegar la aplicación.
3. Confirmar en el portal de pey que el webhook de la API key apunta a `https://nutripey.y4ga.app/api/webhooks/pey`. Cada API key admite un solo webhook: si desarrollo y producción comparten llave, uno de los dos deja de recibir eventos.

## 3. Prueba de humo

En este orden. Si un paso falla, se detiene y se reporta.

1. **Salud:** el endpoint de salud responde 200 y confirma conexión a la base de datos.
2. **HTTPS:** el dominio sirve con certificado válido. Web NFC no funciona sin HTTPS.
3. **Webhook rechaza lo no firmado:** un `POST` sin firma a `/api/webhooks/pey` responde 401 y no crea registros.
4. **Recarga real de $0.01:** crear la recarga, pagar desde una app bancaria y confirmar:
   - el saldo sube exactamente 1 centavo,
   - existe un `WEBHOOK_EVENTO` con resultado `ACREDITADO`,
   - llegó el aviso por WhatsApp.
5. **Cobro:** un cobro de prueba contra el alumno de demostración se aprueba; repetirlo con la misma llave de idempotencia no cobra dos veces.
6. **Rechazo:** un producto con alérgeno bloqueado devuelve 422 `PRODUCTO_BLOQUEADO`.
7. **Latencia:** 20 cobros seguidos; anotar el p95.
8. **Conciliador:** la tarea periódica corrió al menos una vez sin errores.

## 4. Si algo falla

- Volver a la versión anterior de la aplicación.
- No revertir migraciones con datos reales sin revisar con la otra persona.
- Revisar el historial de entregas del webhook en el portal de pey ("Webhook Logs").

## 5. Antes de la demo

- [ ] Alumno, tutor y productos de demostración cargados, sin datos reales de menores.
- [ ] Tags NFC grabados y probados con el teléfono que se usará.
- [ ] Teléfono del cajero con datos móviles como respaldo del WiFi.
- [ ] Saldo suficiente en la cuenta del alumno de demostración.
- [ ] Video grabado como respaldo si falla la red del recinto.
