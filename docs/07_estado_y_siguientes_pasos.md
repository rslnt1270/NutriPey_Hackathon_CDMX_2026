# Estado del Proyecto y Siguientes Pasos

**Corte:** 15 de noviembre de 2026. Entrega principal: **12 diciembre**; kickoff: prototipo independiente.
**Propósito:** punto de retoma. Quien abra el repo, persona o agente, empieza aquí.

---

## 1. Dónde estamos

| Hecho | Estado |
| :--- | :--- |
| Documentación v1.1 (README, SRS, ERD, flujos, seguridad) | Escrita. Corrige la v1.0 contra el contrato real de pey y el marco regulatorio. |
| Auditoría de la idea y la arquitectura | [05_auditoria_y_decisiones.md](./05_auditoria_y_decisiones.md) |
| Acuerdo de trabajo colaborativo | [06_trabajo_colaborativo.md](./06_trabajo_colaborativo.md) y [AGENTS.md](../AGENTS.md) |
| Skills y subagentes | `.claude/skills/` y `.claude/agents/` |
| Contrato del ledger | Borrador en [contratos/ledger.md](./contratos/ledger.md) |
| Gráficas del contexto educativo y regulatorio | [analisis/](../analisis/README.md): datos de la SEP y ENSANUT, siete gráficas en R. |
| Issues y responsables | Creados en GitHub; ver [plan vigente](./superpowers/plans/2026-11-15-entrega-diciembre.md). No volver a ejecutar el script de alta inicial. |
| Código de aplicación | **No existe todavía.** |

La documentación v1.1 se fusionó el 14 noviembre; esta revisión v1.2 y su planificación se proponen en el PR #18. No confundir documentación con funcionalidad implementada.

La documentación se reorganizó después en `docs/01` a `docs/07`, con CI que verifica los enlaces internos.

Esa fusión se hizo directo a `main`, por decisión del equipo, para cerrar la fase de consolidación. **A partir de aquí aplica el acuerdo:** todo cambio entra por rama y PR.

---

## 2. Arranque en cada PC

```bash
git clone https://github.com/rslnt1270/NutriPey_Hackathon_CDMX_2026.git nutripey
cd nutripey
git fetch origin
```

Cada tarea en su propio directorio, uno por sesión de agente:

```bash
git worktree add ../nutripey-<issue> -b <persona>/<issue>-<descripcion> origin/main
cd ../nutripey-<issue>
```

Al terminar una tarea ya fusionada:

```bash
git worktree remove ../nutripey-<issue>
```

Qué lee cada herramienta al abrir el repo:

| Herramienta | Archivo |
| :--- | :--- |
| Claude Code | `CLAUDE.md`, que importa `AGENTS.md`. Carga `.claude/skills/` y `.claude/agents/`. |
| Codex | `AGENTS.md`. Las skills se le indican por ruta cuando la tarea lo requiera. |
| Antigravity | `AGENTS.md`. |

Primera instrucción sugerida para cualquier agente: *"Lee AGENTS.md y docs/07_estado_y_siguientes_pasos.md. Tu issue es el #N del carril X."*

---

## 3. Lo que hay que hacer, en orden

Primero base y Pagos; Campus inicia tras #12. El [plan vigente](./superpowers/plans/2026-11-15-entrega-diciembre.md) asigna hitos, responsables y pruebas. La lista siguiente conserva el alcance funcional.

### Trámites que no dependen del código (empezar ya)

- [ ] **Registrar la CLABE receptora en pey.** Tarda hasta 5 días hábiles. Mientras tanto, usar la cuenta de prueba de pey con $0.01.
- [ ] **Crear la API key y el webhook en el portal de pey.** Guardar el secreto: se muestra una sola vez.
- [ ] **Elegir Telegram o WhatsApp Cloud**, verificar destinatarios y consentimiento; no retrasar Pagos por mensajería.
- [ ] **Comprar tags:** NTAG213 para la demo y dos o tres NTAG 424 DNA.
- [ ] **Conseguir un Android con NFC** para el POS.
- [ ] **Contactar una cooperativa escolar** para una prueba piloto.

### Paso 0 — Consolidar

- [x] Documentación v1.1, acuerdo de colaboración, skills, subagentes y gráficas fusionados en `main`.
- [ ] Las dos personas leen `docs/05`, `docs/06` y `AGENTS.md`, y anotan desacuerdos como issues.
- [ ] Proteger `main`: PR obligatorio, una aprobación y la verificación *Documentación / Enlaces internos* como requerida.
- [x] Crear issues y asignar responsables en GitHub; mantener dependencias y estados al día.

### Paso 1 — Decidir (las dos personas)

- [x] **Responsables por tarea**, sin dueños permanentes de carril.
- [x] **D1:** monolito modular Next.js con PostgreSQL; diseño con Docker.
- [x] **Proveedor:** AWS; EC2 inicial. Región, costo y base de datos separada pendientes.
- [ ] **D2:** Telegram o WhatsApp Cloud; n8n local disponible, alojamiento continuo pendiente.
- [ ] Aprobar el borrador de [contratos/ledger.md](./contratos/ledger.md).
- [ ] Añadir `.github/CODEOWNERS` con los usuarios de cada carril.

### Paso 2 — Esqueleto (una persona, un agente)

- [ ] Issue y PR de esqueleto: proyecto, carpetas de los carriles, linter, pruebas, CI y completar `.env.example`.

Nadie más crea archivos de aplicación hasta que este PR esté fusionado.

### Paso 3 — Contrato y validación (carril Pagos)

- [ ] Contrato aprobado, implementación real y fixtures para probar el núcleo; gate #12 antes de Campus.

### Paso 4 — Campus e integración tras el gate de Pagos

Issues registrados y desglosados en el plan. Cada tarea implementable es una rama y un PR.

**Carril Pagos**

1. Migración inicial del esquema, con restricciones e índices del ERD.
2. `acreditarRecarga` y `saldo` reales, con pruebas de idempotencia.
3. Cliente de pey: `POST /codi/qr` y `POST /codi/pn`.
4. `POST /api/recargas` y consulta de estado.
5. Webhook de pey: verificación, deduplicación y acreditación.
6. Conciliador corto y diario.
7. `cobrar` y `anular` reales, con prueba de concurrencia.
8. Cola de notificaciones y envío por el canal elegido mediante n8n.

**Carril Campus**

1. Sesión del cajero y del tutor.
2. Catálogo con regla de publicación SEP.
3. Alta de alumno con consentimiento.
4. Reglas del tutor: alérgenos, categorías y tope diario.
5. Pantalla de recarga del tutor: QR, push y estado.
6. POS: carrito, cobro y pantallas de resultado, contra el ledger real después de #12.
7. Lectura Web NFC y fallbacks (URL del tag, QR, matrícula más PIN).
8. Reporte de cumplimiento SEP.

---

## 4. Decisiones y riesgos abiertos

Detalle en [05_auditoria_y_decisiones.md](./05_auditoria_y_decisiones.md#6-decisiones-abiertas).

- **Legal:** la calificación del anticipo de consumo frente a la Ley Fintech necesita validación de un abogado antes de mover dinero de familias reales.
- **Calendario:** el registro de la cuenta en pey es la ruta crítica de la Fase 2.
- **Regulatorio:** confirmar en el DOF las cifras de N2Bis y la Ley de Economía Digital antes del pitch.
- **Marca:** "NutriPey" usa la marca de un patrocinador.
- **Modelo de negocio:** falta definir quién paga.
