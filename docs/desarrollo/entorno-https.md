# Preparación de HTTPS de integración — #30

Estado: artefactos para revisión, **sin entorno desplegado**. #30 permanece abierto.
Rutas dedicadas: `infrastructure/entorno-inicial/` y este documento. Reutiliza la
imagen del Dockerfile fusionado en #19 sin modificar el Compose de desarrollo.
No altera la demo de Pages ni `nutripey.y4ga.app`.

## Diseño y requisitos pendientes

Una EC2 con Docker Engine y Compose v2: Caddy termina TLS, Next.js atiende solo
health/webhook desde el proxy y PostgreSQL 18 persiste en volumen privado.
No ofrece alta disponibilidad; perder la EC2/disco puede perder datos. Respaldo y
restauración verificada (#23), operación final y posible RDS (#11) siguen pendientes.
No usar con familias reales mientras esos controles no estén resueltos.

Antes de crear recursos, registrar en #30:

- Cuenta AWS, región y recursos reutilizables, obtenidos mediante inventario de
  solo lectura por la persona autorizada. No se consultaron credenciales locales.
- Tipo de EC2/arquitectura compatible con la imagen, AMI, EBS cifrado, tamaño y
  persistencia al terminar instancia; VPC/subred y rol mínimo para operar.
- Presupuesto aprobado: precio EC2 por hora × horas encendidas + EBS por GB/mes
  + IPv4 pública por hora + transferencia + snapshots + DNS/registro de imágenes.
  Consultar [AWS Pricing Calculator](https://calculator.aws/); no se presume que
  los 80 créditos cubran esos rubros. Aún no existe una estimación monetaria.
- Subdominio exclusivo de integración y acceso autorizado a DNS. A/AAAA deben
  apuntar solo a esta instancia; no publicar AAAA si no funciona IPv6.
- Security group: entrada pública TCP 80/443; sin 3000 ni 5432. Administración
  restringida mediante SSM o SSH desde IP autorizada; salida HTTPS/DNS necesaria.
- Digest aprobado de las tres imágenes y SHA fusionado de aplicación; PostgreSQL
  debe corresponder a `postgres:18.6-bookworm`, con el formato de volumen de v18.
- Secretos de integración fuera de Git: PEY_API_KEY, PEY_WEBHOOK_SECRET,
  PEY_BANK_ACCOUNT_ID, SESSION_SECRET, CRON_SECRET y contraseña PostgreSQL.
  Usar una API key exclusiva; no cambiar el webhook de otra instalación.

## Preparación y arranque (solo tras aprobar destino y despliegue)

Construir/publicar la imagen del commit fusionado mediante el Dockerfile existente.
Anotar SHA y digest. Las imágenes de Caddy y PostgreSQL también deben seleccionarse
por digest (`repositorio@sha256:...`); no usar `latest`. No se ejecuta build en EC2.

Crear fuera del repo `/etc/nutripey/integration.env`, propiedad del operador,
permisos 0600, a partir de `.env.example` de esta carpeta. Completar dominio sin
esquema/ruta/puerto, los tres digests y contraseña hexadecimal aleatoria. La
configuración exige valores pero no valida su formato: revisarlos antes de arrancar.
`APP_ENV_FILE` es una ruta absoluta a un segundo archivo 0600 con los secretos
aplicables de la `.env.example` raíz. Docker/administradores del host pueden leer
env vars: restringir acceso al daemon y al host. No adjuntar `inspect`, `config`
renderizado, cuerpos HTTP ni archivos secretos al PR.

Desde la raíz del checkout del SHA aprobado, en una shell Bash:

```bash
compose=(docker compose --project-name nutripey-integration \
  --env-file /etc/nutripey/integration.env \
  -f infrastructure/entorno-inicial/compose.yaml)
"${compose[@]}" config --quiet
"${compose[@]}" pull
"${compose[@]}" run --rm --no-deps proxy caddy validate --config /etc/caddy/Caddyfile
"${compose[@]}" up -d db
"${compose[@]}" exec -T db psql -U nutripey -d nutripey -c 'SELECT 1'
# Aplicar migraciones revisadas del release con la herramienta de Pagos.
# DETENER aquí si todavía no existe esa herramienta o faltan migraciones.
"${compose[@]}" up -d --no-build
"${compose[@]}" ps
```

La configuración standalone no publica app ni DB al host. La red `database` es
interna; app comparte `frontend` con proxy para acceso saliente a pey. Caddy conserva
certificados en `caddy-data` y obtiene/renueva TLS cuando DNS y 80/443 funcionan.
No tiene access logs habilitados; sus diagnósticos operativos y stdout de app/DB
persisten con rotación acotada. Auditar que app no emita secretos, firmas, cuerpos
o datos de menores antes de conectar pey; desactivar access logs no sanea esos logs.

## Verificación y condiciones para habilitar pey

Con `INTEGRATION_ORIGIN` configurado como el origen HTTPS aprobado:

```bash
curl --fail --silent --show-error "$INTEGRATION_ORIGIN/api/health"
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' \
  -X POST -H 'Content-Type: application/json' --data '{}' \
  "$INTEGRATION_ORIGIN/api/webhooks/pey"
```

Nunca usar `curl -k`. Exigir certificado válido, salud 200 y webhook 401. Un 404
indica implementación ausente y **no es éxito**. `/api/health` actual solo verifica
HTTP: aún falta readiness de DB en el carril correspondiente. #9 debe probar que
firmas ausentes/inválidas se rechazan sin escribir, y firma válida se verifica
sobre cuerpo crudo; #5 debe confirmar cuenta ACTIVE y credenciales. Este proxy no autentica ni reemplaza al handler.
El `SELECT 1` anterior prueba DB por separado, no conexión desde Next.js.
`pg` sigue como dependencia de desarrollo y la app actual no lo usa en runtime;
Pagos debe resolver su disponibilidad y comprobar la imagen antes de habilitar DB.

Antes de registrar el webhook, adjuntar resultados de #5/#9, conectividad
Next→DB y persistencia tras recrear contenedores en un entorno desechable.
Después, registrar la URL del subdominio elegido en pey y verificar un pago de
$0.01 según la guía `.claude/skills/deploy-check/SKILL.md`; no copiar su dominio
histórico de demo. No enviar dinero ni registrar webhook desde estos artefactos.
Las demás rutas devuelven 404: recargas se prueban por el mecanismo autorizado de
Pagos; exponer UI/API adicionales requiere revisar explícitamente el proxy.

## Parada, actualización y recuperación

Mantener siempre `--project-name nutripey-integration`: identifica los volúmenes.
`"${compose[@]}" down` conserva volúmenes. Nunca usar `down --volumes` con datos.
Cambiar POSTGRES_PASSWORD no rota una base inicializada: coordinar rotación en DB.
Antes de actualizar, respaldo verificable y migraciones compatibles. Para rollback,
restaurar APP_IMAGE al digest anterior compatible y ejecutar
`"${compose[@]}" up -d --no-build app`; no revertir migraciones con datos automáticamente.
Registrar digest, fecha, migraciones y evidencia saneada, sin identificadores sensibles.

## Pruebas locales de esta preparación

`python3 infrastructure/entorno-inicial/verificar.py` (requiere PyYAML) comprueba
puertos, aislamiento, persistencia declarada, orden de salud y ausencia de secretos
por defecto. Son pruebas estáticas: no acreditan arranque, TLS, conectividad,
restauración ni firma webhook. Compose y Caddy se validan realmente con los comandos
anteriores cuando haya Docker e imágenes aprobadas. No se requiere instalar AWS CLI.

Referencias: [Caddy en Docker](https://caddyserver.com/docs/running#docker-compose),
[HTTPS automático](https://caddyserver.com/docs/automatic-https),
[logs optativos](https://caddyserver.com/docs/caddyfile/directives/log),
[Docker local del proyecto](docker.md).
