# Plan de implementación — entrega NutriPey del 12 de diciembre

> **Para agentes:** seguir la secuencia por issue de este documento; `superpowers:executing-plans` es opcional si está instalada, no un requisito del repo. No iniciar varias sesiones sobre el mismo worktree ni implementar un bloque que dependa de contratos sin aprobar.

**Objetivo:** construir y verificar el flujo completo después del prototipo kickoff.
**Arquitectura:** monolito modular, PostgreSQL transaccional e historial autorizado en la PWA de padres. Docker/EC2 inicial propuestos en PR #18; extensiones por decisión documentada.
**Stack:** Next.js, PostgreSQL, Docker, AWS y pey. Sin mensajería externa, decisión del 16 noviembre.
**Spec:** [especificación de entrega](../../08_spec_entrega_diciembre.md). Este es el plan maestro; cada issue amplio se divide en PR menores de 400 líneas antes de implementar.

## Restricciones globales

Un issue, una persona responsable, una rama y un worktree. Abrir PR en borrador al empezar; contratos en PR compartido previo; infraestructura/automatización en PR dedicado antes de sus dependientes. Campus no escribe SQL del ledger. Dinero entero, asientos inmutables, cuenta bloqueada e idempotencia. Pruebas pey solo $0.01 MXN y datos ficticios. Las fechas siguientes son objetivos, no evidencia de avance; hora final del 12 diciembre pendiente de confirmar.

## Responsables y revisión

`rslnt1270`: base, Pagos y AWS. `eri2905`: contratos, validación, PWA y Campus. Asignaciones iniciales por issue, modificables entre el equipo; no propiedad permanente del carril. Codex/Claude implementan; el otro modelo revisa, y una persona aprueba. Antigravity verifica UI y capturas. Los MCP AWS no sustituyen permisos, presupuestos ni revisiones. No enviar secretos por issues.

## Tareas y puertas de salida

| Bloque / fechas | Issues y responsable | Rutas y entregable | Dependencia / prueba de salida |
| :--- | :--- | :--- | :--- |
| Prototipo, 15 nov | #15 `eri2905` | Material de presentación, simulaciones señaladas | Independiente del producto; no marcar enviado sin evidencia |
| Base, 15–16 nov | #1/#3/#19 `rslnt1270`; #2/#4/#28 `eri2905` | `package.json`, CI, Dockerfile, compose.yaml, docs/contratos/ | PR #18, contrato aprobado por ambos, arranque reproducible y CI; #28 antes de cobro |
| Datos, 16–18 nov | #6/#7 `rslnt1270` | `db/migrations/`, `src/server/ledger/` | #3/#4; migración, partida doble, saldo e idempotencia contra PostgreSQL |
| Recarga, 17–20 nov | #5/#8/#9/#24 `rslnt1270` | `src/server/pey/`, `app/api/recargas/`, `app/api/webhooks/` | #7/#5; contrato pey vigente, QR/push y webhook firmados; duplicado no acredita dos veces |
| Cobro, 19–22 nov | #10/#25/#26/#16/#29 `rslnt1270` | `src/server/ledger/`, `app/api/cron/` | #7/#28 y recargas; reversos, efectivo, reembolso manual, límites y conciliación concurrente |
| HTTPS inicial, antes 22 nov | #30 `rslnt1270` | `infrastructure/aws/`, Docker y endpoint pey | #3/#19/#5; HTTPS válido y BD privada para integración real, sin esperar RDS |
| Gate Pagos, 22 nov | #12 `eri2905` | Evidencias en PR y `docs/` | #9/#10/#16/#24–26/#28/#29 y HTTPS #30; núcleo con fixtures, 5 de 20 cobros, firma inválida, doble evento, reverso |
| Campus, 23–30 nov | #14/#17 `eri2905` | `app/(pos)/`, `app/(tutor)/`, `app/(escuela)/`, `app/api/pos/`, reglas/catálogo/NFC | #12; dividir #17 en catálogo, reglas, consentimiento, credenciales y reporte; repetir pruebas con reglas reales y conexión transaccional preparada por rslnt1270 en #10; eri2905 implementa evaluador en #17 |
| Historial PWA, hasta 7 dic | #14/#17 `eri2905`; #13/#22 pendientes de decisión humana | Lecturas de Pagos y UI tutor; no ejecutar el alcance anterior de #13/#22 | #4/#12; vínculo en cada consulta, hermanos aislados, lectura completa con tope 500/501 y resumen sin doble contar reversos |
| AWS final, hasta 7 dic | #11/#23 `rslnt1270` | `infrastructure/aws/`, runbook en `docs/` | #30; costo, HTTPS, BD privada, healthcheck, restauración y rollback probados |
| Extensiones, decidir antes 7 dic | #20 `rslnt1270`; #21 `eri2905` | ADR/prueba aislada documentada | Lambda: #11/#16; Bedrock: #17. Go/no-go con costo y beneficio; implementación en nuevos issues solo si adoptados |
| Entrega, 8–12 dic | #27 `eri2905`; ambos validan | Evidencias, video y checklist | Todos los RF vigentes y RN/RNF (RF-21/RF-23 retirados); no exige extensiones opcionales; congelar nuevas funciones el 8 |

La prueba de Pagos con fixtures no es una autorización de piloto: catálogo/reglas/consentimiento reales se verifican en Campus y #27. Un retraso en #12 mueve Campus; no se oculta como trabajo completo. Infraestructura, contratos y trámites pueden avanzar en paralelo; una sesión por worktree.

## Secuencia ejecutable dentro de cada issue

- [ ] Leer AGENTS.md, spec y criterios del issue; comprobar dependencias fusionadas y PR abiertos.
- [ ] Si el bloque es amplio, crear subissues asignados con archivos concretos y menos de 400 líneas por PR; mantener enlace al padre.
- [ ] Acordar contratos pendientes antes de implementar; no inventar endpoints internos ni tipos que otra tarea necesite.
- [ ] Crear worktree `<persona>/<issue>-<descripcion>` desde `origin/main` y PR borrador; cambios compartidos se fusionan primero.
- [ ] Escribir la prueba del comportamiento, comprobar que falla, implementar, ejecutar pruebas apropiadas y registrar salida.
- [ ] En dinero, usar PostgreSQL real y la batería de `.claude/skills/ledger-change/SKILL.md`; en pey revisar OpenAPI vigente.
- [ ] Fetch/rebase, enlaces internos, diff menor a 400 líneas, revisión por otro modelo y aprobación humana; no fusionar automáticamente.
- [ ] Tras fusión y prueba de salida, cerrar issue y retirar `bloqueado` solo de dependencias satisfechas; actualizar evidencia del hito.

## Casos de revisión que deben tener prueba

- [ ] #4/#10: misma clave con payload distinto no debe cobrar una segunda venta ni revelar datos de otro operador.
- [ ] #8/#14/#17: tutor o cajero de otra escuela no accede a saldos, recargas, catálogo ni reportes ajenos.
- [ ] #9/#16: webhook adelantado a persistencia de correlación, pago tardío y webhook/conciliador simultáneos quedan recuperables sin doble crédito.
- [ ] #14/#17: vínculo revocado entre consultas da 403; 501 movimientos dan ErrorEntrada sin datos parciales; recarga o rechazo tardío aparecen al refrescar sin mezclar saldo y movimientos.
- [ ] #10/#17/#26: cambio de día CDMX, reverso y modificación concurrente de regla mantienen límite y autorización coherentes.

## Evidencia y estado de planificación

Guardar en cada PR comandos, resultados y lo no verificado; #12 y #27 enlazan la matriz de aceptación. `python3 scripts/verificar_enlaces.py` comprueba documentación; los comandos de tests/build se fijan en #3 al elegir herramientas. No presentar ese chequeo como prueba de la aplicación. El repositorio sigue sin código de aplicación al preparar este plan. [Issues activos](https://github.com/rslnt1270/NutriPey_Hackathon_CDMX_2026/issues) son la fuente de asignaciones y estado.
