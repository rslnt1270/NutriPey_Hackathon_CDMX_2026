# Migraciones — primera parte de #6 (#43)

La migración `db/migrations/20261116_0120_base_referencial.sql` crea escuela, cooperativa y estudiante del modelo aprobado. No implementa la PWA, roles ni autenticación. No carga datos de alumnos, cuentas bancarias ni secretos.

Las claves únicas `(id, escuela_id)` permiten que la siguiente migración de cuentas/transacciones use FKs compuestas para exigir que cooperativa y alumno pertenezcan a la misma escuela. Esta migración prepara esas claves; todavía no existe una cuenta de ledger que pueda probarse en producción.

Los límites monetarios son bigint en centavos, positivos y dentro del entero seguro de la aplicación; NULL significa sin tope. No se fija una UDI ni se convierte moneda. `limite_efectivo_mes_centavos` completa el dato requerido por estadoLimiteCuenta. La CLABE se valida solo en formato; su titularidad y estado real se verifican mediante pey. ACTIVE requiere una cuenta receptora configurada, pero una fila SQL no prueba la activación bancaria.

## Ejecución

Se aplica una sola vez y en orden de nombre sobre el esquema de aplicación, con `psql -v ON_ERROR_STOP=1 -f db/migrations/20261116_0120_base_referencial.sql`. BEGIN/COMMIT forman parte del archivo; no envolverlo en una transacción externa. Una segunda aplicación falla, no omite silenciosamente un esquema distinto. Aún no hay runner con registro/checksums de migraciones; se debe registrar manualmente la aplicación y verificar la base de destino. No ejecutar sobre producción desde las pruebas.

No editar esta migración tras fusionarla. Cambios posteriores van en archivos nuevos. La eliminación de la base o un rollback destructivo no son procedimientos de actualización.

## Pruebas

Usar la base local desechable `nutripey_test` de la [guía de desarrollo](./base.md). Con TEST_DATABASE_URL exportada:

```bash
python3 scripts/con_dos_cpu.py node --test --test-concurrency=1 tests/migracion-base.test.mjs
```

La prueba crea y elimina solo un esquema aleatorio propio. Verifica migración real, unicidad, FKs, límites enteros, restricciones de cuenta activa, rollback y fallo intermedio sin borrar tablas existentes. Una tabla desechable dentro de ese esquema demuestra el patrón de FKs compuestas necesario para #44; no se instala como tabla del producto.

#44 añadirá cuentas, transacciones, asientos, inmutabilidad, partida doble diferida y saldo materializado. #45 añadirá persistencia de idempotencia, recargas, eventos y auditoría sin mensajería. Por ello esta parte no satisface aún los criterios de concurrencia 20/5, doble partida, reversos e idempotencia de #6: se exigirán contra PostgreSQL real en el núcleo contable. No cerrar #6 con este PR.

## Cuentas contables (#53, parte de #44)

Después de la base referencial, aplicar una sola vez `db/migrations/20261117_1440_cuentas_ledger.sql` con el mismo procedimiento manual. Ambas migraciones incluyen BEGIN/COMMIT. No editar archivos fusionados ni ejecutar pruebas en producción.

La nueva tabla exige ámbito escolar común, anticipo único por alumno y cuentas generales únicas por cooperativa/tipo. El trigger de alta rechaza un saldo inicial distinto de cero; los CHECK limitan el rango entero seguro y evitan anticipos negativos. No bloquea UPDATE directo de saldo: la actualización contable y su protección pertenecen a las siguientes partes de #44, junto con transacciones, asientos, reversos y partida doble. No habilita APIs ni pagos.

Con PostgreSQL desechable y TEST_DATABASE_URL de la guía, ejecutar:

```bash
python3 scripts/con_dos_cpu.py node --test tests/cuentas-ledger.test.mjs
```

Arrancar también PostgreSQL bajo `scripts/con_dos_cpu.py` para que servidor y pruebas compartan las mismas dos CPU. Los tests crean un esquema aleatorio, aplican las migraciones ordenadas y lo eliminan al finalizar. Comprueban tipos, FKs, unicidad entre cooperativas, límites de saldo y rollback; veinte conexiones compiten por el mismo anticipo y por la misma cuenta BANCO, obteniendo una alta y diecinueve conflictos de unicidad en cada caso. Esto no prueba cobros concurrentes 20/5 ni idempotencia de movimientos; siguen pendientes en #44/#45.

## Transacciones y asientos (entrega 2 de #44)

Aplicar después `db/migrations/20261125_2340_transacciones_asientos.sql`, con el mismo procedimiento manual. Crea `transaccion` y `asiento_contable` con FKs compuestas por cooperativa y escuela, y las invariantes de `docs/02_modelo_de_datos.md`:

- Centavos `bigint` positivos dentro del entero seguro. Unicidad `(cooperativa_id, tipo, idempotency_key)`: la misma llave no repite el efecto financiero y dos cooperativas no colisionan. La vinculación llave↔hash/resultado (`intento_operacion`) sigue en #45.
- Cada tipo mueve un solo par de cuentas (recarga CoDi: BANCO/ANTICIPO; efectivo: CAJA/ANTICIPO; compra: ANTICIPO/INGRESO; reverso: INGRESO/ANTICIPO; reembolso: ANTICIPO/BANCO), y el anticipo debe ser del alumno de la transacción.
- Partida doble diferida al `COMMIT`: débitos = créditos = monto. Una transacción sin asientos, descuadrada o con asientos añadidos después no se confirma.
- El trigger de asiento actualiza `saldo_centavos` en la misma transacción SQL (activos suben con débito; anticipo e ingreso con crédito). El CHECK de anticipo aborta el sobregiro. Cualquier cambio de saldo que no iguale el neto de los asientos de la cuenta se rechaza, aunque venga de otro trigger; la identidad de la cuenta no cambia. La protección actúa contra el rol de la app solo si no es dueño ni superusuario: el dueño puede desactivar triggers (separación de roles pendiente en un issue Compartido).
- `transaccion` y `asiento_contable` solo admiten INSERT (UPDATE, DELETE y TRUNCATE dan 55000). Un `REVERSO` anula una compra completa del mismo alumno y el índice parcial lo hace único.

El llamador (futuro `src/server/ledger/`) abre la transacción, bloquea las cuentas con `SELECT ... FOR UPDATE` en orden ascendente de id, valida bajo el bloqueo e inserta transacción y asientos. `tests/asientos-ledger.test.mjs` reproduce ese patrón (mismo comando de dos CPU que arriba). Cubren concurrencia 20/5, compras y reversos simultáneos sin interbloqueo, la misma llave tres veces (en serie y en paralelo), sobregiro, descuadres y pares invertidos sin residuos (rollback), reverso único, inmutabilidad, un trigger ajeno que intenta inflar saldo, reconstrucción de saldos y el cuadre anticipos = banco + caja − ingresos. No cubren tope diario, reglas del tutor, `detalle_venta` ni la recuperación del resultado original: pertenecen a #10 y #45. La prueba de cuentas desactiva el trigger de protección solo para verificar los límites de columna. #44 y #6 siguen abiertos hasta la entrega 3 y #45.
