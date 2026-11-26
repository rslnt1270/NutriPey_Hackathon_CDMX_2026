import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

// Datos ficticios: sin nombres reales de menores.
async function isolated(fn) {
  assert.ok(process.env.TEST_DATABASE_URL, 'Configura TEST_DATABASE_URL');
  const url = new URL(process.env.TEST_DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'solo PostgreSQL local');
  assert.equal(url.pathname, '/nutripey_test', 'base desechable obligatoria');
  const config = { connectionString: url.toString(), connectionTimeoutMillis: 3000, query_timeout: 10000 };
  const client = new pg.Client(config);
  const schema = 'asientos_' + randomUUID().replaceAll('-', '');
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema}, pg_catalog`);
    const directory = new URL('../db/migrations/', import.meta.url);
    for (const file of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
      await client.query(await readFile(new URL(file, directory), 'utf8'));
    }
    const escuela = randomUUID(), coop = randomUUID(), otraCoop = randomUUID();
    const alumno = randomUUID(), otroAlumno = randomUUID();
    await client.query("INSERT INTO escuela(id,cct_clave,nombre) VALUES ($1,'FICTICIA_A','Escuela A')", [escuela]);
    await client.query("INSERT INTO cooperativa(id,escuela_id,nombre,tipo_titular) VALUES ($1,$3,'A','PERSON'),($2,$3,'B','PERSON')", [coop, otraCoop, escuela]);
    await client.query("INSERT INTO estudiante(id,escuela_id,matricula,nombre) VALUES ($1,$3,'A','Alumno A'),($2,$3,'B','Alumno B')", [alumno, otroAlumno, escuela]);
    const cuenta = async (cooperativa, tipo, estudiante = null) => (await client.query(
      'INSERT INTO cuenta_ledger(escuela_id,cooperativa_id,tipo,estudiante_id) VALUES ($1,$2,$3,$4) RETURNING id',
      [escuela, cooperativa, tipo, estudiante])).rows[0].id;
    const c = {
      banco: await cuenta(coop, 'BANCO'), caja: await cuenta(coop, 'CAJA_EFECTIVO'),
      ingreso: await cuenta(coop, 'INGRESO_VENTAS'), anticipo: await cuenta(coop, 'ANTICIPO_ALUMNO', alumno),
      bancoB: await cuenta(otraCoop, 'BANCO'), anticipoB: await cuenta(otraCoop, 'ANTICIPO_ALUMNO', otroAlumno),
    };
    await fn({ client, config, schema, escuela, coop, otraCoop, alumno, otroAlumno, c });
  } finally {
    try { await client.query(`ROLLBACK; DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
    finally { await client.end(); }
  }
}

// Patrón del ledger: bloqueo ascendente, validación bajo bloqueo, transacción y dos asientos.
async function mover(db, m) {
  const { escuela, cooperativa, estudiante, tipo, monto, llave, debito, credito, origen = null, validarSaldo = true } = m;
  await db.query('BEGIN');
  try {
    const cuentas = await db.query('SELECT id,tipo,saldo_centavos FROM cuenta_ledger WHERE id = ANY($1) ORDER BY id FOR UPDATE', [[debito, credito]]);
    const t = (await db.query(`INSERT INTO transaccion(escuela_id,cooperativa_id,estudiante_id,tipo,idempotency_key,monto_centavos,transaccion_origen_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (cooperativa_id,tipo,idempotency_key) DO NOTHING RETURNING id`,
    [escuela, cooperativa, estudiante, tipo, llave, monto, origen])).rows[0];
    if (!t) {
      const previa = await db.query('SELECT id FROM transaccion WHERE cooperativa_id=$1 AND tipo=$2 AND idempotency_key=$3', [cooperativa, tipo, llave]);
      await db.query('COMMIT');
      return { ok: true, id: previa.rows[0].id, repetida: true };
    }
    const anticipo = cuentas.rows.find((row) => row.id === debito && row.tipo === 'ANTICIPO_ALUMNO');
    if (validarSaldo && anticipo && BigInt(anticipo.saldo_centavos) < BigInt(monto)) {
      await db.query('ROLLBACK');
      return { ok: false, motivo: 'SALDO_INSUFICIENTE' };
    }
    await db.query(`INSERT INTO asiento_contable(transaccion_id,cooperativa_id,cuenta_ledger_id,tipo_asiento,monto_centavos)
      VALUES ($1,$2,$3,'DEBITO',$5),($1,$2,$4,'CREDITO',$5)`, [t.id, cooperativa, debito, credito, monto]);
    await db.query('COMMIT');
    return { ok: true, id: t.id };
  } catch (error) { await db.query('ROLLBACK'); throw error; }
}
// n conexiones propias en paralelo; cada una corre fn(db, i).
async function enParalelo({ config, schema }, n, fn) {
  const clients = Array.from({ length: n }, () => new pg.Client(config));
  try {
    await Promise.all(clients.map(async (db) => { await db.connect(); await db.query(`SET search_path TO ${schema}, pg_catalog`); }));
    return await Promise.all(clients.map(fn));
  } finally { await Promise.all(clients.map((db) => db.end())); }
}
const saldo = async (db, id) => (await db.query('SELECT saldo_centavos FROM cuenta_ledger WHERE id=$1', [id])).rows[0].saldo_centavos;
async function verificarLibros(db) {
  const descuadres = await db.query(`SELECT t.id FROM transaccion t LEFT JOIN asiento_contable a ON a.transaccion_id=t.id GROUP BY t.id, t.monto_centavos
    HAVING coalesce(sum(a.monto_centavos) FILTER (WHERE tipo_asiento='DEBITO'),0) <> t.monto_centavos
        OR coalesce(sum(a.monto_centavos) FILTER (WHERE tipo_asiento='CREDITO'),0) <> t.monto_centavos`);
  assert.equal(descuadres.rowCount, 0, 'partida doble por transacción');
  const reconstruccion = await db.query(`SELECT c.id FROM cuenta_ledger c LEFT JOIN asiento_contable a ON a.cuenta_ledger_id=c.id GROUP BY c.id
    HAVING c.saldo_centavos <> coalesce(sum(CASE WHEN (c.tipo IN ('BANCO','CAJA_EFECTIVO')) = (a.tipo_asiento='DEBITO') THEN a.monto_centavos ELSE -a.monto_centavos END), 0)`);
  assert.equal(reconstruccion.rowCount, 0, 'saldo materializado = neto de asientos');
  const cuadre = await db.query(`SELECT cooperativa_id FROM cuenta_ledger GROUP BY cooperativa_id HAVING
    sum(saldo_centavos) FILTER (WHERE tipo='ANTICIPO_ALUMNO') IS DISTINCT FROM
    coalesce(sum(saldo_centavos) FILTER (WHERE tipo IN ('BANCO','CAJA_EFECTIVO')),0) - coalesce(sum(saldo_centavos) FILTER (WHERE tipo='INGRESO_VENTAS'),0)`);
  assert.equal(cuadre.rowCount, 0, 'anticipos = banco + caja - ingresos');
}

test('asientos: recarga, compra, reverso y reembolso cuadran y reconstruyen saldos', async () => isolated(async ({ client, escuela, coop, alumno, c }) => {
  const base = { escuela, cooperativa: coop, estudiante: alumno };
  await mover(client, { ...base, tipo: 'RECARGA_CODI', monto: 10000, llave: 'r1', debito: c.banco, credito: c.anticipo });
  await mover(client, { ...base, tipo: 'RECARGA_EFECTIVO', monto: 5000, llave: 'r2', debito: c.caja, credito: c.anticipo });
  const compra = await mover(client, { ...base, tipo: 'COMPRA', monto: 3500, llave: 'k1', debito: c.anticipo, credito: c.ingreso });
  assert.equal(await saldo(client, c.anticipo), '11500');
  await mover(client, { ...base, tipo: 'REVERSO', monto: 3500, llave: 'a1', origen: compra.id, debito: c.ingreso, credito: c.anticipo });
  await mover(client, { ...base, tipo: 'REEMBOLSO', monto: 2000, llave: 'f1', debito: c.anticipo, credito: c.banco });
  assert.deepEqual([await saldo(client, c.anticipo), await saldo(client, c.banco), await saldo(client, c.caja), await saldo(client, c.ingreso)],
    ['13000', '8000', '5000', '0']);
  await verificarLibros(client);
}));

test('asientos: 20 compras simultáneas con saldo para 5 aprueban exactamente 5', async () => isolated(async ({ client, config, schema, escuela, coop, alumno, c }) => {
  const base = { escuela, cooperativa: coop, estudiante: alumno };
  await mover(client, { ...base, tipo: 'RECARGA_CODI', monto: 500, llave: 'r', debito: c.banco, credito: c.anticipo });
  const results = await enParalelo({ config, schema }, 20, (db, i) => mover(db, { ...base, tipo: 'COMPRA', monto: 100, llave: `k${i}`, debito: c.anticipo, credito: c.ingreso }));
  assert.equal(results.filter((r) => r.ok).length, 5);
  assert.equal(results.filter((r) => r.motivo === 'SALDO_INSUFICIENTE').length, 15);
  assert.deepEqual([await saldo(client, c.anticipo), await saldo(client, c.ingreso)], ['0', '500']);
  assert.equal((await client.query("SELECT count(*) FROM transaccion WHERE tipo='COMPRA'")).rows[0].count, '5');
  await verificarLibros(client);
}));

test('asientos: la misma llave tres veces produce un solo efecto, también en paralelo', async () => isolated(async ({ client, config, schema, escuela, coop, otraCoop, alumno, otroAlumno, c }) => {
  const base = { escuela, cooperativa: coop, estudiante: alumno };
  await mover(client, { ...base, tipo: 'RECARGA_CODI', monto: 1000, llave: 'r', debito: c.banco, credito: c.anticipo });
  const compra = { ...base, tipo: 'COMPRA', monto: 100, llave: 'misma', debito: c.anticipo, credito: c.ingreso };
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push((await mover(client, compra)).id);
  assert.equal(new Set(ids).size, 1);
  const paralelas = await enParalelo({ config, schema }, 3, (db) => mover(db, { ...compra, llave: 'paralela' }));
  assert.equal(new Set(paralelas.map((r) => r.id)).size, 1);
  await mover(client, { escuela, cooperativa: otraCoop, estudiante: otroAlumno, tipo: 'RECARGA_CODI', monto: 100, llave: 'r', debito: c.bancoB, credito: c.anticipoB });
  assert.equal((await client.query("SELECT count(*) FROM asiento_contable a JOIN transaccion t ON t.id=a.transaccion_id WHERE t.tipo='COMPRA' AND a.tipo_asiento='DEBITO'")).rows[0].count, '2');
  assert.deepEqual([await saldo(client, c.anticipo), await saldo(client, c.anticipoB)], ['800', '100']);
  await verificarLibros(client);
}));

test('asientos: sobregiro y descuadre abortan sin dejar movimientos', async () => isolated(async ({ client, escuela, coop, alumno, otroAlumno, c }) => {
  const base = { escuela, cooperativa: coop, estudiante: alumno };
  await mover(client, { ...base, tipo: 'RECARGA_CODI', monto: 100, llave: 'r', debito: c.banco, credito: c.anticipo });
  await assert.rejects(mover(client, { ...base, tipo: 'COMPRA', monto: 101, llave: 'k', debito: c.anticipo, credito: c.ingreso, validarSaldo: false }), { code: '23514' });
  const unSolo = async (tipoAsiento, cuenta, tipo = 'COMPRA', estudiante = alumno) => {
    await client.query('BEGIN');
    try {
      const t = (await client.query('INSERT INTO transaccion(escuela_id,cooperativa_id,estudiante_id,tipo,idempotency_key,monto_centavos) VALUES ($1,$2,$3,$4,$5,50) RETURNING id', [escuela, coop, estudiante, tipo, randomUUID()])).rows[0].id;
      if (cuenta) await client.query('INSERT INTO asiento_contable(transaccion_id,cooperativa_id,cuenta_ledger_id,tipo_asiento,monto_centavos) VALUES ($1,$2,$3,$4,50)', [t, coop, cuenta, tipoAsiento]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  };
  await assert.rejects(unSolo('DEBITO', c.anticipo), { code: '23514' }); // sin crédito
  await assert.rejects(unSolo(null, null), { code: '23514' });          // sin asientos
  await assert.rejects(unSolo('DEBITO', c.banco), { code: '23514' });   // cuenta fuera de la matriz
  await assert.rejects(unSolo('DEBITO', c.anticipo, 'COMPRA', otroAlumno), { code: '23514' }); // anticipo ajeno
  // Pares cuadrados que crearían dinero: los detiene la matriz, no la partida diferida.
  const k = { ...base, tipo: 'COMPRA', monto: 50, validarSaldo: false };
  await assert.rejects(mover(client, { ...k, llave: 'inv', debito: c.ingreso, credito: c.anticipo }), { code: '23514', message: /no corresponde/ });
  await assert.rejects(mover(client, { ...k, llave: 'caja', debito: c.anticipo, credito: c.caja }), { code: '23514', message: /no corresponde/ });
  await assert.rejects(mover(client, { ...k, estudiante: otroAlumno, llave: 'ajeno', debito: c.anticipo, credito: c.ingreso }), { code: '23514', message: /no corresponde/ });
  await assert.rejects(unSolo('DEBITO', c.bancoB, 'RECARGA_CODI'), { code: '23503' }); // cuenta de otra cooperativa
  const previa = (await client.query("SELECT id FROM transaccion WHERE tipo='RECARGA_CODI'")).rows[0].id;
  await client.query('BEGIN');
  await client.query(`INSERT INTO asiento_contable(transaccion_id,cooperativa_id,cuenta_ledger_id,tipo_asiento,monto_centavos)
    VALUES ($1,$2,$3,'DEBITO',1),($1,$2,$4,'CREDITO',1)`, [previa, coop, c.banco, c.anticipo]);
  await assert.rejects(client.query('COMMIT'), { code: '23514' }); // asientos tardíos
  assert.equal((await client.query('SELECT count(*) FROM transaccion')).rows[0].count, '1');
  assert.equal((await client.query('SELECT count(*) FROM asiento_contable')).rows[0].count, '2');
  assert.equal(await saldo(client, c.anticipo), '100');
  await verificarLibros(client);
}));

test('asientos: reverso único de una compra completa restaura saldo', async () => isolated(async ({ client, escuela, coop, alumno, otroAlumno, c }) => {
  const base = { escuela, cooperativa: coop, estudiante: alumno };
  const recarga = await mover(client, { ...base, tipo: 'RECARGA_CODI', monto: 300, llave: 'r', debito: c.banco, credito: c.anticipo });
  const compra = await mover(client, { ...base, tipo: 'COMPRA', monto: 120, llave: 'k', debito: c.anticipo, credito: c.ingreso });
  const reverso = { ...base, tipo: 'REVERSO', monto: 120, origen: compra.id, debito: c.ingreso, credito: c.anticipo };
  await mover(client, { ...reverso, llave: 'a1' });
  assert.equal(await saldo(client, c.anticipo), '300');
  await assert.rejects(mover(client, { ...reverso, llave: 'a2' }), { code: '23505' });
  await assert.rejects(mover(client, { ...reverso, llave: 'a3', origen: recarga.id }), { code: '23514' });
  const otra = await mover(client, { ...base, tipo: 'COMPRA', monto: 80, llave: 'k2', debito: c.anticipo, credito: c.ingreso });
  await assert.rejects(mover(client, { ...reverso, llave: 'a4', origen: otra.id, monto: 40 }), { code: '23514' });
  await assert.rejects(mover(client, { ...reverso, llave: 'a5', origen: otra.id, estudiante: otroAlumno }), { code: '23514', message: /reverso/ });
  await assert.rejects(client.query("INSERT INTO transaccion(escuela_id,cooperativa_id,estudiante_id,tipo,idempotency_key,monto_centavos) VALUES ($1,$2,$3,'REVERSO','x',1)", [escuela, coop, alumno]), { code: '23514' });
  await verificarLibros(client);
}));

test('asientos: inmutables y saldo protegido contra escritura directa', async () => isolated(async ({ client, escuela, coop, alumno, c }) => {
  await mover(client, { escuela, cooperativa: coop, estudiante: alumno, tipo: 'RECARGA_CODI', monto: 100, llave: 'r', debito: c.banco, credito: c.anticipo });
  for (const sql of ['UPDATE transaccion SET monto_centavos=1', 'DELETE FROM transaccion', 'TRUNCATE transaccion CASCADE',
    'UPDATE asiento_contable SET monto_centavos=1', 'DELETE FROM asiento_contable', 'TRUNCATE asiento_contable',
    'UPDATE cuenta_ledger SET saldo_centavos=saldo_centavos+1', `UPDATE cuenta_ledger SET tipo='CAJA_EFECTIVO' WHERE id='${c.banco}'`]) {
    await assert.rejects(client.query(sql), { code: '55000' }, sql);
  }
  assert.equal(await saldo(client, c.anticipo), '100');
  await verificarLibros(client);
}));

test('asientos: compras y reversos simultáneos del mismo alumno no se interbloquean', async () => isolated(async ({ client, config, schema, escuela, coop, alumno, c }) => {
  const base = { escuela, cooperativa: coop, estudiante: alumno };
  await mover(client, { ...base, tipo: 'RECARGA_CODI', monto: 1000, llave: 'r', debito: c.banco, credito: c.anticipo });
  const compras = [];
  for (let i = 0; i < 5; i++) compras.push(await mover(client, { ...base, tipo: 'COMPRA', monto: 100, llave: `k${i}`, debito: c.anticipo, credito: c.ingreso }));
  const results = await enParalelo({ config, schema }, 10, (db, i) => (i < 5
    ? mover(db, { ...base, tipo: 'REVERSO', monto: 100, llave: `a${i}`, origen: compras[i].id, debito: c.ingreso, credito: c.anticipo })
    : mover(db, { ...base, tipo: 'COMPRA', monto: 100, llave: `n${i}`, debito: c.anticipo, credito: c.ingreso })));
  assert.ok(results.every((r) => r.ok));
  assert.deepEqual([await saldo(client, c.anticipo), await saldo(client, c.ingreso)], ['500', '500']);
  await verificarLibros(client);
}));

test('asientos: un trigger ajeno no puede crear saldo sin asientos', async () => isolated(async ({ client, escuela, coop, alumno, c }) => {
  await mover(client, { escuela, cooperativa: coop, estudiante: alumno, tipo: 'RECARGA_CODI', monto: 100, llave: 'r', debito: c.banco, credito: c.anticipo });
  await client.query(`CREATE TABLE ajena(x int);
    CREATE FUNCTION inflar() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      UPDATE cuenta_ledger SET saldo_centavos = saldo_centavos + 100000 WHERE tipo = 'ANTICIPO_ALUMNO'; RETURN NULL; END; $$;
    CREATE TRIGGER inflar AFTER INSERT ON ajena FOR EACH ROW EXECUTE FUNCTION inflar();`);
  await assert.rejects(client.query('INSERT INTO ajena VALUES (1)'), { code: '55000' });
  assert.equal(await saldo(client, c.anticipo), '100');
  await verificarLibros(client);
}));
