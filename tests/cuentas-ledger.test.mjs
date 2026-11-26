import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

async function isolated(fn) {
  assert.ok(process.env.TEST_DATABASE_URL, 'Configura TEST_DATABASE_URL');
  const url = new URL(process.env.TEST_DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'solo PostgreSQL local');
  assert.equal(url.pathname, '/nutripey_test', 'base desechable obligatoria');
  const config = { connectionString: url.toString(), connectionTimeoutMillis: 3000, query_timeout: 10000 };
  const client = new pg.Client(config);
  const schema = 'cuentas_' + randomUUID().replaceAll('-', '');
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema}, pg_catalog`);
    const directory = new URL('../db/migrations/', import.meta.url);
    for (const file of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
      await client.query(await readFile(new URL(file, directory), 'utf8'));
    }
    assert.equal((await client.query("SELECT to_regclass('cuenta_ledger')::text AS tabla")).rows[0].tabla,
      'cuenta_ledger', 'las migraciones deben habilitar cuentas contables');
    const escuela = randomUUID(), otraEscuela = randomUUID();
    const coop = randomUUID(), otraCoop = randomUUID(), coopAjena = randomUUID();
    const alumno = randomUUID(), alumnoAjeno = randomUUID();
    await client.query("INSERT INTO escuela(id,cct_clave,nombre) VALUES ($1,'FICTICIA_A','Escuela A'),($2,'FICTICIA_B','Escuela B')", [escuela, otraEscuela]);
    await client.query("INSERT INTO cooperativa(id,escuela_id,nombre,tipo_titular) VALUES ($1,$4,'A','PERSON'),($2,$4,'B','PERSON'),($3,$5,'C','PERSON')", [coop, otraCoop, coopAjena, escuela, otraEscuela]);
    await client.query("INSERT INTO estudiante(id,escuela_id,matricula,nombre) VALUES ($1,$3,'A','Alumno A'),($2,$4,'B','Alumno B')", [alumno, alumnoAjeno, escuela, otraEscuela]);
    await fn({ client, config, schema, escuela, otraEscuela, coop, otraCoop, coopAjena, alumno, alumnoAjeno });
  } finally {
    try { await client.query(`ROLLBACK; DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
    finally { await client.end(); }
  }
}
const insert = `INSERT INTO cuenta_ledger(escuela_id,cooperativa_id,tipo,estudiante_id)
  VALUES ($1,$2,$3,$4) RETURNING id,saldo_centavos`;

test('cuentas: tipos, ámbito escolar y unicidad', async () => isolated(async ({ client, escuela, otraEscuela, coop, otraCoop, coopAjena, alumno, alumnoAjeno }) => {
  for (const tipo of ['BANCO', 'CAJA_EFECTIVO', 'INGRESO_VENTAS', 'ANTICIPO_ALUMNO']) {
    const input = [escuela, coop, tipo, tipo === 'ANTICIPO_ALUMNO' ? alumno : null];
    assert.equal((await client.query(insert, input)).rows[0].saldo_centavos, '0');
    await assert.rejects(client.query(insert, input), { code: '23505' });
  }
  await client.query(insert, [escuela, otraCoop, 'BANCO', null]);
  await assert.rejects(client.query(insert, [escuela, otraCoop, 'ANTICIPO_ALUMNO', alumno]), { code: '23505' });
  for (const [tipo, estudiante] of [['OTRA', null], ['ANTICIPO_ALUMNO', null], ['BANCO', alumno]]) {
    await assert.rejects(client.query(insert, [escuela, otraCoop, tipo, estudiante]), { code: '23514' });
  }
  for (const input of [[escuela, coopAjena, 'BANCO', null], [otraEscuela, otraCoop, 'CAJA_EFECTIVO', null], [escuela, otraCoop, 'ANTICIPO_ALUMNO', alumnoAjeno], [escuela, otraCoop, 'ANTICIPO_ALUMNO', randomUUID()]]) {
    await assert.rejects(client.query(insert, input), { code: '23503' });
  }
  await assert.rejects(client.query(insert, [null, otraCoop, 'BANCO', null]), { code: '23502' });
  await assert.rejects(client.query(insert, [escuela, null, 'BANCO', null]), { code: '23502' });
}));

test('cuentas: cero inicial, bigint seguro y sobregiro solo en anticipo', async () => isolated(async ({ client, escuela, coop, alumno }) => {
  const anticipo = (await client.query(insert, [escuela, coop, 'ANTICIPO_ALUMNO', alumno])).rows[0].id;
  const banco = (await client.query(insert, [escuela, coop, 'BANCO', null])).rows[0].id;
  await assert.rejects(client.query("INSERT INTO cuenta_ledger(escuela_id,cooperativa_id,tipo,saldo_centavos) VALUES ($1,$2,'CAJA_EFECTIVO',1)", [escuela, coop]), { code: '23514' });
  // Límites de columna; desde #44 el saldo de producto solo cambia mediante asientos.
  await client.query('ALTER TABLE cuenta_ledger DISABLE TRIGGER cuenta_proteger');
  const update = 'UPDATE cuenta_ledger SET saldo_centavos=$1 WHERE id=$2';
  for (const value of ['9007199254740992', '-9007199254740992']) {
    await assert.rejects(client.query(update, [value, banco]), { code: '23514' });
  }
  await assert.rejects(client.query(update, ['1.5', banco]), { code: '22P02' });
  await assert.rejects(client.query(update, ['-1', anticipo]), { code: '23514' });
  for (const value of ['9007199254740991', '-9007199254740991', '0']) {
    await client.query(update, [value, banco]);
    assert.equal((await client.query('SELECT saldo_centavos FROM cuenta_ledger WHERE id=$1', [banco])).rows[0].saldo_centavos, value);
  }
  await client.query(update, ['9007199254740991', anticipo]);
  assert.equal((await client.query('SELECT saldo_centavos FROM cuenta_ledger WHERE id=$1', [anticipo])).rows[0].saldo_centavos, '9007199254740991');
}));

test('cuentas: rollback no conserva altas ni cambios de saldo', async () => isolated(async ({ client, escuela, coop }) => {
  const id = (await client.query(insert, [escuela, coop, 'BANCO', null])).rows[0].id;
  await client.query('ALTER TABLE cuenta_ledger DISABLE TRIGGER cuenta_proteger');
  await client.query('BEGIN');
  await client.query('UPDATE cuenta_ledger SET saldo_centavos=9 WHERE id=$1', [id]);
  await client.query(insert, [escuela, coop, 'CAJA_EFECTIVO', null]);
  await client.query('ROLLBACK');
  const { rows } = await client.query('SELECT id,saldo_centavos FROM cuenta_ledger');
  assert.deepEqual(rows, [{ id, saldo_centavos: '0' }]);
}));

test('cuentas: 20 altas simultáneas producen una cuenta por identidad', async () => isolated(async ({ client, config, schema, escuela, coop, alumno }) => {
  for (const [tipo, estudiante] of [['ANTICIPO_ALUMNO', alumno], ['BANCO', null]]) {
    const clients = Array.from({ length: 20 }, () => new pg.Client(config));
    try {
      await Promise.all(clients.map(async (connection) => {
        await connection.connect();
        await connection.query(`SET search_path TO ${schema}, pg_catalog`);
      }));
      const outcomes = await Promise.allSettled(clients.map((connection) => connection.query(insert, [escuela, coop, tipo, estudiante])));
      assert.equal(outcomes.filter(({ status }) => status === 'fulfilled').length, 1);
      const rejected = outcomes.filter(({ status }) => status === 'rejected');
      assert.equal(rejected.length, 19);
      for (const { reason } of rejected) assert.equal(reason.code, '23505');
      assert.equal((await client.query('SELECT count(*) FROM cuenta_ledger WHERE tipo=$1', [tipo])).rows[0].count, '1');
    } finally { await Promise.all(clients.map((connection) => connection.end())); }
  }
}));
