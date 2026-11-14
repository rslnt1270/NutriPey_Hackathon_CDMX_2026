# Cómo contribuir

Este repositorio lo trabajan dos personas, cada una con varios agentes de código. Las reglas existen para que nadie pise el trabajo de otro.

## Flujo

1. **Toma un issue** asignado a ti. Si no existe, créalo con la plantilla *Tarea*.
2. **Crea un worktree y una rama** desde `main` actualizado:

   ```bash
   git fetch origin
   git worktree add ../nutripey-<issue> -b <persona>/<issue>-<descripcion> origin/main
   ```

3. **Abre un PR en borrador** al empezar. Es el aviso de que la tarea está ocupada.
4. **Trabaja solo en las rutas de tu carril.** Ver la tabla en [AGENTS.md](./AGENTS.md#carriles-y-rutas).
5. **Antes de pedir revisión:** `git rebase origin/main`, pruebas pasando y menos de 400 líneas de diff.
6. **Revisión cruzada:** el PR lo revisa un modelo distinto al que lo escribió y lo aprueba una persona.
7. **Fusión con squash.** Después: `git worktree remove ../nutripey-<issue>`.

## Comprobaciones locales

```bash
python3 scripts/verificar_enlaces.py   # enlaces internos de la documentación
```

La CI ejecuta la misma comprobación en cada PR.

## Commits

Formato convencional: `tipo(alcance): descripción`, por ejemplo `feat(pos): cobro idempotente`. Tipos habituales: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`.

## Reglas que no se negocian

Están en [AGENTS.md](./AGENTS.md#reglas-de-dominio-que-no-se-negocian): sin custodia de dinero, montos en centavos, asientos inmutables, pruebas de pago solo con $0.01, sin secretos ni datos reales de menores en el repositorio.

## Más contexto

- [Acuerdo de trabajo colaborativo](./docs/06_trabajo_colaborativo.md)
- [Estado y siguientes pasos](./docs/07_estado_y_siguientes_pasos.md)
