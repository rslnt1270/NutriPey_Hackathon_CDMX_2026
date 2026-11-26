# Roles PostgreSQL (#58)

La base es dedicada a NutriPey y usa `public`. `nutripey` conserva la administración
inicial de Docker, pero nunca se entrega a Next.js. `nutripey_migracion` es dueño
del esquema, tablas y funciones; solo se usa para migrar. `nutripey_app` no tiene
superusuario, BYPASSRLS, creación de roles/BD, membresías ni propiedad del esquema.

## Instalación o transición de un volumen existente

1. Respaldar y verificar restauración en una base desechable. Detener app antes
   de cambiar permisos; no borrar el volumen ni reinicializar PostgreSQL.
2. Como administrador, aplicar las migraciones fusionadas pendientes siguiendo
   [migraciones](migraciones.md). En una base nueva aplicar primero las de #43/#53.
3. Aplicar el script idempotente de permisos, conectado a la base correcta:

   ```bash
   docker compose exec -T db psql -X -U nutripey -d nutripey -v ON_ERROR_STOP=1 \
     < infrastructure/postgres/roles.sql
   ```

   Para integración agregar `--project-name nutripey-integration`, `--env-file
   /etc/nutripey/integration.env` y `-f infrastructure/entorno-inicial/compose.yaml`
   a todos los comandos Compose. Mantener el mismo nombre de proyecto y volumen.
4. En una sesión interactiva de `psql` administrativa usar `\password nutripey_app`
   y `\password nutripey_migracion`. Generar claves distintas fuera del repo. Guardar
   la primera como `APP_DATABASE_PASSWORD` (hexadecimal) en el archivo privado de
   Compose. Guardar la segunda solo en el procedimiento de migraciones (.pgpass
   con permisos 0600); nunca en el contenedor app, logs, argumentos ni Git.
5. Migraciones posteriores: conectar como `nutripey_migracion` con `search_path`
   `public,pg_catalog`, aplicar cada archivo revisado una vez y registrar su hash.
   Reaplicar `roles.sql` como administrador después de cada migración. Los objetos
   futuros no reciben permisos de app automáticamente. El rol de migración no
   puede crear roles ni cambiar privilegios de parámetros del servidor.
6. Recrear solo app con `docker compose up -d --no-deps app`. Cerrar las sesiones
   de la app antigua antes de reabrir tráfico: cambiar DATABASE_URL no revoca una
   conexión administrativa que ya esté abierta. Conservar credenciales de admin
   solo para mantenimiento; cambiar una variable no rota contraseñas existentes.
7. Verificar la conexión desde la red de app con sus credenciales: `current_user`
   debe ser `nutripey_app`. `/api/health` todavía solo prueba HTTP.

El script no modifica migraciones fusionadas. Transfiere los objetos de `public`
en esta base dedicada; no usar en una base compartida con otra aplicación.
Si falta #57, permite consulta y alta de cuentas con saldo cero, sin movimientos.
Tras aplicar #57, reaplicar el script habilita INSERT/SELECT de transacciones y
asientos y convierte únicamente `aplicar_asientos()` en SECURITY DEFINER.
Todas las funciones quedan con `pg_catalog,public,pg_temp`; app no puede crear
objetos en public ni temporales. EXECUTE público se revoca. No se permite UPDATE,
DELETE o TRUNCATE de asientos/transacciones ni UPDATE de saldo.

Con #57 se concede UPDATE únicamente de `cuenta_ledger.id` porque PostgreSQL lo
exige para `SELECT FOR UPDATE`; `cuenta_proteger` rechaza cambiar esa identidad.
La app lee escuela/cooperativa/estudiante; su administración requiere otro flujo
con permisos revisados. No otorgar ALL TABLES ni permisos por defecto para resolver
un error de autorización.

## Prueba reproducible

Requiere binarios PostgreSQL 18 en PATH, usuario no root y dos CPU. El test crea
un clúster temporal, solo socket Unix, con autenticación trust limitada al directorio
privado temporal. No usa TEST_DATABASE_URL ni una base compartida; lo elimina al terminar.

```bash
python3 scripts/con_dos_cpu.py python3 infrastructure/postgres/test_roles.py
# Antes del merge de #57, probar la combinación sin modificar sus worktrees:
git show origin/rslnt1270/44-transacciones-asientos:db/migrations/20261125_2340_transacciones_asientos.sql > /tmp/ledger57.sql
LEDGER_MIGRATION=/tmp/ledger57.sql python3 scripts/con_dos_cpu.py python3 infrastructure/postgres/test_roles.py
```

Verifica propietario, atributos, reaplicación, migración futura, ataques denegados
y movimientos bajo el rol real de app: concurrencia 20/5, llave repetida, reverso
único, sobregiro, partida doble y reconstrucción. La combinación con #57 es una
prueba local, no autorización para aplicar su migración sin fusionar en producción.
Referencia: [permisos PostgreSQL](https://www.postgresql.org/docs/18/ddl-priv.html).

## Evidencia de integración — 26 noviembre 2026

Aplicado #58 en la EC2 de integración con autorización del usuario, sin fusionar
el PR #59 ni aplicar #57. Se conserva app `d8ef800` y las dos migraciones de main.
Respaldo y restauración verificados en base temporal; copia privada en
`/opt/nutripey/respaldo-58-20261126T073101Z`. Las cuatro tablas pertenecen a
`nutripey_migracion`; conexión TCP autenticada como `nutripey_app` desde la red
privada y ataques de privilegios rechazados. App/base sanas y health HTTP 200.
DNS/HTTPS pendiente de reconectar Cloudflare; no se probaron pagos ni webhook real.
