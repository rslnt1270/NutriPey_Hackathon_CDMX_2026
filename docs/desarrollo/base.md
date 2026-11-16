# Base de desarrollo — issue #3

Esta base no implementa pagos, Campus ni el contrato del ledger. La demo del kickoff sigue en su rama de integración y en https://nutripey.y4ga.app/; no se despliega este esqueleto en Pages.

## Herramientas y arranque

Node 22.22.2 (`.nvmrc`), npm y PostgreSQL 18.6. Versiones de Next/React fijadas en `package.json`; `npm ci` instala el lockfile sin resolver versiones nuevas. El entorno Docker/Compose se describe en [Contenedores locales](./docker.md). En Linux se limita la ejecución de validaciones a dos CPU.

```bash
npm ci
npm run dev
```

Abrir http://localhost:3000. La portada indica que la aplicación está en desarrollo. `GET /api/health` responde `200 {"status":"ok"}` sin caché: indica que el proceso HTTP responde, no certifica disponibilidad de PostgreSQL o pey. No expone credenciales ni consulta servicios externos.

## PostgreSQL de prueba

Usar una instancia local desechable. Ejemplo con las herramientas de PostgreSQL instaladas, sin cambiar un servicio existente:

```bash
TEST_PG_DIR=$(mktemp -d /tmp/nutripey-pg.XXXXXX)
initdb -D "$TEST_PG_DIR" -U nutripey_test -A trust --no-locale --encoding=UTF8
pg_ctl -D "$TEST_PG_DIR" -l "$TEST_PG_DIR/server.log" -o '-h 127.0.0.1 -p 55439 -k /tmp' -w start
createdb -h 127.0.0.1 -p 55439 -U nutripey_test nutripey_test
export TEST_DATABASE_URL=postgresql://nutripey_test@127.0.0.1:55439/nutripey_test
```

La autenticación `trust` es exclusivamente para este clúster temporal en loopback; no copiarla a un servidor compartido. Si el puerto está ocupado, elegir otro en todos los comandos. Al terminar: `pg_ctl -D "$TEST_PG_DIR" -m fast -w stop`. Conservar o eliminar solo ese directorio desechable según se necesite.

## Verificación

```bash
python3 scripts/con_dos_cpu.py npm run check
python3 scripts/verificar_enlaces.py
```

`check` ejecuta lint, tipos, build y pruebas en ese orden. `npm test` requiere un build previo y `TEST_DATABASE_URL` exportada; no carga `.env.local`. Falla si falta la base: no salta silenciosamente la prueba. Solo acepta loopback y nombre `nutripey_test`; no debe usarse con datos reales. La prueba crea una tabla temporal, verifica inserción y rollback y cierra la conexión. No crea migraciones ni prueba invariantes del ledger.

El humo arranca el build en un puerto local libre, verifica portada, disponibilidad y 404, y detiene el proceso. La afinidad del comando se hereda por Node y sus hijos; el ejecutor falla fuera de Linux para no prometer un límite de CPU que no puede imponer. CI reproduce la batería con un PostgreSQL de servicio y credenciales ficticias desechables.

## Fronteras para siguientes tareas

- Pagos: `src/server/ledger/`, `src/server/pey/` y rutas API según AGENTS.md; migraciones solo después de #4. No hay adaptador ni SQL de negocio en esta base.
- Campus: sus rutas se habilitan después del gate #12. No reutilizar `ledger-sim.js` como backend.
- El contrato transaccional #28 se acuerda antes del cobro. #4/#28 y #2 siguen con eri2905.
- #19 añade contenedores; #30 prepara HTTPS AWS. Ninguna infraestructura se provisiona desde este PR.

## Dependencias y tamaño del PR

La revisión humana autorizó exceptuar únicamente el lockfile generado del límite de 400 líneas. Los archivos escritos a mano permanecen bajo ese límite. ESLint 10 usa reglas recomendadas de JavaScript/TypeScript; no se habilita aún el preset específico de Next. El override de `@typescript-eslint/typescript-estree` fija `minimatch` 11.0.8 para evitar GHSA-g3hv-75wg-m249; revisar si sigue siendo necesario al actualizar typescript-eslint.
