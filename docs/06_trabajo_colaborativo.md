# Propuesta de Trabajo Colaborativo — NutriPey

**Fecha:** 14 de noviembre de 2026
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
| **Pagos** | Ledger, integración con pey, webhook, conciliador, cola de WhatsApp, migraciones. | *Por asignar* |
| **Campus** | POS, Web NFC, catálogo SEP, reglas del tutor, app del tutor, reportes. | *Por asignar* |

Las rutas exactas están en [AGENTS.md](../AGENTS.md#carriles-y-rutas).

**Sugerencia para asignar:** Pagos para quien tenga más experiencia en backend y bases de datos; Campus para quien tenga más experiencia en interfaz y vaya a hablar con la cooperativa piloto.

### 2.4 La frontera es un contrato escrito
Campus necesita cobrar, y cobrar es del ledger. Para que nadie espere a nadie:

1. El primer día se escribe `docs/contratos/ledger.md` con la firma de `cobrar`, `anular`, `acreditarRecarga` y `saldo`.
2. Pagos entrega una versión simulada de esas funciones en el primer PR.
3. Campus construye contra la simulación mientras Pagos implementa la real.

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
| 1 | Cerrar la decisión D1 (stack) y D4 (registrar la CLABE en pey). | Las dos | 2 |
| 2 | **PR de esqueleto:** proyecto, carpetas de los carriles, linter, pruebas, CI, `.env.example`. Una sola persona con un solo agente. | Pagos | 3 y 4 |
| 3 | Contrato del ledger y versión simulada. | Pagos | Campus |
| 4 | Proteger `main` y crear etiquetas e issues de la Fase 2 y 3. | Campus | — |

A partir del paso 3 los dos carriles avanzan en paralelo.

### Reparto por fase

| Fase | Carril Pagos | Carril Campus |
| :--- | :--- | :--- |
| **2** (16–22 nov) | Esquema y ledger, `POST /codi/qr` y `/codi/pn`, webhook, conciliador. | Pantallas del tutor (alta, recarga, reglas) contra el ledger simulado. Catálogo SEP. |
| **3** (23–30 nov) | `cobrar` y `anular` reales, pruebas de concurrencia, recarga en efectivo. | POS, Web NFC, fallbacks, grabado de tags. |
| **4** (1–7 dic) | Cola de WhatsApp, límite mensual de cuenta, reporte de conciliación. | Reporte de cumplimiento SEP, pulido del POS, prueba en la cooperativa piloto. |
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

- [ ] Asignar los carriles.
- [ ] Proteger `main` en GitHub (PR obligatorio y una aprobación).
- [ ] Decidir dónde se despliega `nutripey.y4ga.app`, para completar `deploy-check`.
- [ ] Añadir `.github/CODEOWNERS` con los usuarios de GitHub de cada carril.
