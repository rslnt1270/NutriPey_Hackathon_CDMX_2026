# Contenedores locales — issue #19

Entorno reproducible de la base Next.js y PostgreSQL. No despliega AWS ni sustituye la demo de GitHub Pages. Pagos y Campus siguen pendientes.

## Plan y alcance

- Imagen multi-stage con versiones fijas, dependencias de producción y usuario sin root.
- Compose publica solo la app en loopback; PostgreSQL usa red privada y volumen persistente.
- Validar build, salud HTTP, usuario, aislamiento de PostgreSQL y persistencia tras recrear contenedores.
- No modificar contratos ni ejecutar pagos reales.
