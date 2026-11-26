# Contenedores locales — issue #19

Base Next.js y PostgreSQL; no despliega AWS ni sustituye la demo de Pages. Pagos, Campus y migraciones siguen pendientes. Requiere Docker Engine con Compose v2, Linux y dos CPU disponibles.

## Arranque

Desde la raíz del repo:

```bash
export POSTGRES_PASSWORD=$(openssl rand -hex 24)
export BUILD_CPUSET=$(python3 -c 'import os; print(",".join(map(str, sorted(os.sched_getaffinity(0))[:2])))')
export APP_DATABASE_PASSWORD=$(openssl rand -hex 24)
docker compose up -d db
# Aplicar migraciones y roles antes de arrancar app (ver roles-bd.md).
docker compose up -d --build
docker compose ps
curl --fail http://127.0.0.1:3000/api/health
```

Seguir [roles PostgreSQL](roles-bd.md) para crear los roles y asignar sus contraseñas.

Guardar la contraseña localmente fuera del repo para reutilizar el volumen. Usar hexadecimal evita caracteres que necesiten escape en DATABASE_URL. Compose exige una contraseña; no proporciona una por defecto. Cambiar la variable no cambia la contraseña de una base ya inicializada. No imprimir `docker compose config` con secretos al compartir evidencia.

Solo la app publica `127.0.0.1:3000` (`APP_PORT` permite otro puerto). Dentro del contenedor escucha en `0.0.0.0`. PostgreSQL no publica puertos y solo pertenece a la red interna `database`; la app también tiene una red con salida para futuras integraciones. No hay TLS ni exposición pública: #30 resolverá HTTPS en AWS.

La imagen fija Node 22.22.2/bookworm-slim y Compose PostgreSQL 18.6/bookworm. El lockfile fija dependencias npm; las etiquetas de imágenes no son digests inmutables. El build usa dos CPU mediante `taskset`, y los servicios comparten esas mismas CPU con cuota de una CPU cada uno. `BUILD_CPUSET` debe identificar como máximo dos CPU disponibles también para el daemon.

## Imagen y salud

Tres etapas: dependencias, build y runtime. Next genera salida standalone; la imagen final conserva los módulos trazados por Next, incluye los estáticos y arranca `server.js` como usuario `node`. No vuelve a instalar dependencias: `npm ci` usa el lockfile solo en la etapa de dependencias y la etapa runtime copia la salida standalone. No necesita TypeScript ni ESLint en runtime. `pg` sigue siendo exclusivo de pruebas: moverlo a dependencies cuando Pagos lo importe en producción. No hay directorio `public/` todavía; al incorporarlo habrá que copiarlo explícitamente al runtime.

`.dockerignore` excluye dependencias locales, Git, archivos `.env*`, claves y documentación del contexto. No pasar credenciales como build args. La configuración Next mantiene `agentRules: false` y `next-env.d.ts` sigue ignorado.

La app espera a que PostgreSQL esté sano al arrancar. `/api/health` solo verifica HTTP, no conexión a DB ni disponibilidad de pey. `pg_isready` verifica disponibilidad del servidor PostgreSQL; las pruebas ejecutan además SQL. Un estado `unhealthy` no reinicia por sí solo un contenedor: `unless-stopped` actúa ante la salida del proceso.

## Persistencia y apagado

El volumen `postgres-data` se monta en `/var/lib/postgresql`, ruta del volumen para PostgreSQL 18. `docker compose restart` y `docker compose down` seguido de `up -d` conservan los datos. Para detener sin borrar: `docker compose down`. **No usar `down --volumes` sobre datos que se quieran conservar.** Mantener el mismo nombre de proyecto Compose; cambiarlo crea otro volumen. Un volumen no sustituye un respaldo (#22).

## Verificación automatizada

```bash
python3 scripts/con_dos_cpu.py python3 scripts/verificar_docker.py
python3 scripts/verificar_enlaces.py
```

El script crea un proyecto aleatorio y contraseña desechable, publica un puerto efímero en loopback y comprueba: build/rebuild, healthchecks, HTTP, UID no root, ausencia de herramientas de desarrollo y archivos sensibles conocidos, conectividad app→DB, versión de PostgreSQL, ausencia de puertos DB publicados y una fila persistente tras reinicio y recreación. Finalmente elimina **solo los contenedores y volumen de ese proyecto de prueba**. No usa datos reales ni modifica la base de desarrollo. La imagen local `nutripey-local:0.1.0` puede reconstruirse.

El workflow `Contenedores` ejecuta esta misma prueba en Docker. Podman puede construir el Dockerfile; ejecutar Compose requiere un proveedor compatible y delegación de los controladores CPU/cpuset. No eliminar los límites para lograr una prueba aparentemente verde. No se certifican macOS/Windows ni un despliegue EC2 desde este PR.

Referencias: [Compose y dependencias sanas](https://docs.docker.com/compose/how-tos/startup-order/), [salida standalone](https://nextjs.org/docs/app/api-reference/config/next-config-js/output), [imagen PostgreSQL y volúmenes](https://hub.docker.com/_/postgres).
