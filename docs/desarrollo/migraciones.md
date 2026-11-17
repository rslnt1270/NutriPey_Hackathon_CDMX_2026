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
