# AGENTS.md — Reglas para agentes de código en NutriPey

Este archivo lo leen Codex, Antigravity y Claude Code (vía `CLAUDE.md`). Aplica a cualquier agente y a cualquier persona que trabaje en el repo. El plan de trabajo entre personas está en [docs/06_trabajo_colaborativo.md](./docs/06_trabajo_colaborativo.md).

## Qué es el proyecto

Software de cobro sin efectivo para cooperativas escolares: recarga por CoDi (API de pey), pago con pulsera NFC, reglas del tutor y ledger de doble partida. Lee primero `README.md` y `docs/05_auditoria_y_decisiones.md`.

## Reglas de coordinación

1. **Sin issue no hay trabajo.** Cada tarea es un issue de GitHub asignado a una persona. Si no existe, créalo o pídelo antes de escribir código.
2. **Un issue, una rama, un PR.** Rama: `<persona>/<issue>-<descripcion-corta>`, por ejemplo `ana/12-webhook-pey`.
3. **Abre el PR en borrador al empezar.** El PR en borrador es el aviso de que alguien ya está en eso. Antes de empezar, revisa los PR abiertos con `gh pr list`.
4. **Un worktree por sesión de agente.** Nunca dos agentes en el mismo directorio de trabajo. Usa `git worktree add ../nutripey-<issue> -b <rama>`.
5. **Nunca hagas commit directo a `main`** ni `push --force` sobre una rama ajena.
6. **Quédate en tu carril.** Solo edita las rutas del carril de tu issue (tabla de abajo). Si necesitas un cambio en otro carril, abre un issue para su dueño; no lo edites tú.
7. **PR pequeños:** menos de 400 líneas de diff. Haz `git fetch && git rebase origin/main` antes de pedir revisión.
8. **Quien escribe no revisa.** Si el PR lo escribió Claude Code, lo revisa Codex, y al revés. Lo aprueba una persona.

## Carriles y rutas

D1: monolito Next.js con PostgreSQL, decidido el 15 noviembre. Los carriles delimitan rutas, no personas: el responsable se asigna por issue. Pagos se valida antes de implementar Campus; ver docs/08_spec_entrega_diciembre.md.

| Carril | Rutas | Contenido |
| :--- | :--- | :--- |
| **Pagos** | `src/server/ledger/`, `src/server/pey/`, `src/server/notificaciones/`, `app/api/webhooks/`, `app/api/recargas/`, `app/api/cron/`, `db/` | Ledger, integración pey, webhook, conciliador, outbox, migraciones. |
| **Campus** | `app/(pos)/`, `app/(tutor)/`, `app/(escuela)/`, `app/api/pos/`, `src/server/reglas/`, `src/server/catalogo/`, `src/lib/nfc/` | POS, Web NFC, catálogo SEP, reglas del tutor, reportes, UI. |
| **Compartido** | `Dockerfile`, `.dockerignore`, `compose*.yaml`, `package.json`, lockfile, `db/migrations/`, `src/server/ledger/index.ts`, `docs/contratos/`, `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.github/` | Solo se cambia en un PR dedicado, pequeño, que se fusiona antes que el resto. |

`README.md` y `docs/` (salvo contratos) pueden actualizarse en el PR funcional del issue. `infrastructure/` y `automation/` pertenecen a tareas de infraestructura/automatización con rutas explícitas y PR dedicado; se fusionan antes de sus dependientes, no antes de todo el proyecto. #13 separa backend Pagos del workflow en `automation/n8n/`; #11/#22/#23/#30 usan sus rutas de infraestructura.

**Frontera entre carriles:** Campus nunca escribe SQL sobre tablas del ledger. Llama a las funciones que Pagos exporta desde `src/server/ledger/index.ts` (`cobrar`, `anular`, `acreditarRecarga`, `saldo`). La firma de esas funciones se acuerda en `docs/contratos/` antes de implementarlas.

**Migraciones:** solo el carril Pagos las crea, con prefijo de fecha y hora (`20261116_1030_nombre.sql`). Nunca edites una migración ya fusionada.

## Reglas de dominio que no se negocian

- **NutriPey no custodia dinero.** Todo cobro CoDi lleva `bankAccountId` de la cooperativa.
- **Dinero en centavos enteros.** Nunca `float` ni `decimal` en código de aplicación.
- **Asientos inmutables.** Los errores se corrigen con un reverso.
- **Toda validación de cobro ocurre dentro de la transacción**, con la cuenta bloqueada y llave de idempotencia.
- **La API de pey se consulta, no se supone.** La fuente es `https://docs.pey.mx/openapi.json`. No inventes campos.
- **Pruebas de pago solo con $0.01 MXN.** pey no tiene sandbox y el dinero de prueba no se devuelve.
- **El webhook se verifica sobre el cuerpo crudo** antes de cualquier efecto.
- **Sin secretos en el repo.** Solo `.env.example` con nombres de variables.
- **Datos de menores:** no pongas nombres reales, fotos ni alergias en datos de prueba, logs o capturas.

Antes de tocar dinero o pey, lee `.claude/skills/ledger-change/SKILL.md` y `.claude/skills/pey-codi/SKILL.md`. Son Markdown plano y sirven para cualquier agente.

## Definición de terminado

- Pruebas del cambio escritas y pasando; se pega la salida en el PR.
- Si toca el ledger: prueba de concurrencia y de idempotencia.
- Documentación en `docs/` actualizada si cambió un requisito, el modelo de datos o un flujo.
- El PR enlaza su issue y dice qué se verificó y qué no.

## Commits

Formato convencional en español o inglés: `feat(pos): cobro idempotente`. Los commits hechos con ayuda de un agente llevan su línea `Co-Authored-By`.
