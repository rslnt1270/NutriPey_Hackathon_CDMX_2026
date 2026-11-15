# Propuesta de Trabajo Colaborativo — NutriPey

**Fecha:** 15 de noviembre de 2026
**Equipo:** dos personas, cada una con Claude Code, Codex y Antigravity.
**Reglas para los agentes:** [AGENTS.md](../AGENTS.md). Este documento explica el acuerdo entre personas.

---

## 1. El problema a evitar

Con dos personas y hasta seis sesiones de agentes, los choques vienen de tres lugares:

1. **Dos agentes en el mismo directorio.** Uno cambia de rama o reescribe un archivo mientras el otro trabaja. Ocurrió durante la fase de especificación, cuando Antigravity y Claude Code compartieron directorio.
2. **Dos agentes en la misma tarea**, porque nadie sabía que el otro ya la tenía.
3. **Dos ramas que tocan los mismos archivos**: el esquema de base de datos, `package.json`, un tipo compartido.

Cada regla de abajo ataca uno de esos tres.

---

## 2. Acuerdos

### 2.1 Un directorio por sesión
Cada sesión de agente trabaja en su propio `git worktree`. Nadie comparte carpeta. Resuelve el choque 1.

```bash
git worktree add ../nutripey-12 -b ana/12-webhook-pey
```

### 2.2 GitHub Issues es la única lista de tareas
- Toda tarea es un issue asignado a **una persona**. La persona responde por lo que hagan sus agentes.
- Al empezar, se abre un PR en borrador. Ese PR es el aviso de "ocupado". Resuelve el choque 2.
- Etiquetas: `carril:pagos`, `carril:campus`, `compartido`, `bloqueado`.

### 2.3 Dos carriles por rutas
El trabajo se divide en vertical. Cada carril tiene carpetas propias y los agentes no salen de ellas. Resuelve el choque 3.

| Carril | Qué construye | Dueña o dueño |
| :--- | :--- | :--- |
| **Pagos** | Ledger, integración con pey, webhook, conciliador, cola de notificaciones, migraciones. | Responsable del issue; no hay dueño permanente. |
| **Campus** | POS, Web NFC, catálogo SEP, reglas del tutor, app del tutor, reportes. | Responsable del issue; no hay dueño permanente. |

Las rutas exactas están en [AGENTS.md](../AGENTS.md#carriles-y-rutas).

Asignación inicial: `rslnt1270` implementa Pagos e infraestructura; `eri2905` coordina contratos, validación, notificaciones y luego Campus. Ambas personas pueden asumir tareas de cualquier carril; sus rutas se respetan por issue.

### 2.4 La frontera es un contrato escrito
Campus necesita cobrar, y cobrar es del ledger. Para que nadie espere a nadie:

1. El primer día se escribe `docs/contratos/ledger.md` con la firma de `cobrar`, `anular`, `acreditarRecarga` y `saldo`.
2. Pagos usa fixtures y un contrato transaccional de reglas para validar el núcleo sin depender de pantallas Campus.
3. Campus inicia implementación después del gate de Pagos (#12); las pruebas se repiten con catálogo y reglas reales antes de entrega. Un prototipo aislado no sustituye ese gate.

Un cambio de contrato es un PR propio que aprueban las dos personas.

### 2.5 Archivos compartidos
`package.json`, migraciones, contratos, `AGENTS.md` y `.github/` solo se cambian en un PR pequeño y dedicado, que se fusiona antes que cualquier otro. Las migraciones las crea únicamente el carril Pagos.

### 2.6 `main` protegida
- Sin commits directos. Todo entra por PR con una aprobación humana.
- PR de menos de 400 líneas, con rebase sobre `main` antes de revisar.
- Fusión con squash.

---

## 3. Papel de cada herramienta

Lo que se reparte son papeles, no personas: cada quien usa las tres herramientas dentro de su carril.

| Herramienta | Papel principal | Papel secundario |
| :--- | :--- | :--- |
| **Claude Code** | Implementa. Cambios que cruzan varios archivos, ledger, integración con pey. | Revisa los PR escritos con Codex. |
| **Codex** | Implementa tareas acotadas y bien especificadas. | Revisa los PR escritos con Claude Code. |
| **Antigravity** | Verifica en navegador: POS, flujo del tutor, capturas para el pitch. | Documentación y diagramas. |

**Regla de revisión cruzada:** el modelo que escribió un PR no lo revisa. Un segundo modelo encuentra errores que el primero no ve en su propio trabajo. La aprobación final es de una persona.

**Una rama, un agente.** Dos agentes no editan la misma rama a la vez. Si Codex va a continuar algo que empezó Claude Code, el primero termina, hace push y se cierra su sesión.

---

## 4. Ritmo

- **Sincronía diaria de 10 minutos:** qué se fusionó, qué está bloqueado, qué contrato cambió.
- **Fusionar al menos una vez al día por carril.** Las ramas largas son las que chocan.
- **Viernes:** demo interna del flujo completo en `main`.

---

## 5. Arranque: antes de paralelizar

El repo todavía no tiene código. Si las dos personas generan el esqueleto al mismo tiempo, habrá dos proyectos incompatibles. Los primeros pasos van en serie:

| # | Tarea | Quién | Bloquea a |
| :- | :--- | :--- | :--- |
| 0 | Fusionar la documentación v1.1 y este acuerdo. | Una persona | Todo |
| 1 | Confirmar contrato; D1 ya decidido (Next.js + PostgreSQL). Verificar cuenta pey. | Las dos | 2 |
| 2 | **PR de esqueleto:** proyecto, carpetas de los carriles, linter, pruebas, CI, `.env.example`. Una sola persona con un solo agente. | Pagos | 3 y 4 |
| 3 | Contrato del ledger/reglas y validación de Pagos. | Pagos | Campus |
| 4 | Proteger `main` y crear etiquetas e issues de la Fase 2 y 3. | Campus | — |

Después del gate #12 inicia Campus. Contratos, trámites y preparación de infraestructura sí pueden avanzar mientras se completa Pagos.

### Reparto por fase

| Fase | Carril Pagos | Carril Campus |
| :--- | :--- | :--- |
| **2** (16–22 nov) | Esquema y ledger, `POST /codi/qr` y `/codi/pn`, webhook, conciliador. | Contrato de reglas, casos de aceptación y validación de Pagos; sin implementación Campus. |
| **3** (23–30 nov) | Integración y correcciones sobre Pagos ya verificado. | POS, Web NFC, fallbacks, grabado de tags. |
| **4** (1–7 dic) | Cola/n8n, recuperación, métricas y presupuesto AWS. | Reporte de cumplimiento SEP, pulido del POS, prueba en la cooperativa piloto. |
| **5** (8–12 dic) | Despliegue y verificación. | Video y pitch. |

---

## 6. Skills y subagentes

Viven en `.claude/` y están versionados, así que las dos personas tienen los mismos. Las skills son Markdown plano: Codex y Antigravity pueden leerlas como guías aunque no las carguen de forma nativa.

### Skills

| Skill | Cuándo se usa | Qué aporta |
| :--- | :--- | :--- |
| [`pey-codi`](../.claude/skills/pey-codi/SKILL.md) | Cualquier código que llame a pey o reciba su webhook. | Contrato verificado, reglas de prueba con $0.01, errores frecuentes. |
| [`ledger-change`](../.claude/skills/ledger-change/SKILL.md) | Cualquier cambio que toque saldos, asientos o migraciones. | Invariantes y pruebas obligatorias. |
| [`deploy-check`](../.claude/skills/deploy-check/SKILL.md) | Antes y después de desplegar. | Lista de verificación y prueba de humo con pago real de $0.01. |

### Subagentes

| Subagente | Cuándo se lanza | Permisos |
| :--- | :--- | :--- |
| [`ledger-reviewer`](../.claude/agents/ledger-reviewer.md) | Antes de fusionar un PR del carril Pagos. | Solo lectura. |
| [`pey-contract-checker`](../.claude/agents/pey-contract-checker.md) | Cuando cambia `src/server/pey/` o el webhook. | Lectura y consulta del OpenAPI. |
| [`deploy-verifier`](../.claude/agents/deploy-verifier.md) | Después de cada despliegue. | Lectura y peticiones HTTP. No despliega ni modifica. |

Los tres revisan y reportan; ninguno escribe código. Es deliberado: con dos personas y varios agentes escribiendo, lo que falta es verificación independiente.

**Para más adelante**, cuando exista el código: una skill para grabar tags NFC y otra para generar datos de demostración sin datos reales de menores.

---

## 7. Pendientes para cerrar este acuerdo

- [x] Asignar responsables por issue; consultar el [plan](./superpowers/plans/2026-11-15-entrega-diciembre.md).
- [ ] Proteger `main` en GitHub (PR obligatorio y una aprobación).
- [ ] Completar región, tamaño, presupuesto y separación de PostgreSQL en AWS; EC2 es la propuesta inicial del PR #18.
- [ ] Añadir `.github/CODEOWNERS` con revisores acordados, sin imponer propiedad permanente de carriles.
