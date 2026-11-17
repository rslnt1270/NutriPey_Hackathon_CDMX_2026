import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

const migration = new URL('../db/migrations/20261116_0120_base_referencial.sql', import.meta.url);
async function isolated(fn) {
  assert.ok(process.env.TEST_DATABASE_URL, 'Configura TEST_DATABASE_URL');
  const url = new URL(process.env.TEST_DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'solo PostgreSQL local');
  assert.equal(url.pathname, '/nutripey_test', 'base desechable obligatoria');
  const client = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 3000, query_timeout: 5000 });
  const schema = 'base_' + randomUUID().replaceAll('-', '');
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}, pg_catalog`);
    await fn(client, schema);
  } finally {
    try { await client.query(`ROLLBACK; DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
    finally { await client.end(); }
  }
}
async function seed(client) {
  const a = randomUUID(), b = randomUUID(), coop = randomUUID(), alumno = randomUUID();
  await client.query("INSERT INTO escuela(id,cct_clave,nombre) VALUES ($1,'FICTICIA_A','Escuela A'),($2,'FICTICIA_B','Escuela B')", [a, b]);
  await client.query("INSERT INTO cooperativa(id,escuela_id,nombre,tipo_titular) VALUES ($1,$2,'Cooperativa A','PERSON')", [coop, a]);
  await client.query("INSERT INTO estudiante(id,escuela_id,matricula,nombre) VALUES ($1,$2,'A','Alumno A')", [alumno, a]);
  return { a, b, coop, alumno };
}

test('migración base: integridad, índices, dinero y separación de escuelas', async (t) => {
  await isolated(async (client) => {
    const sql = await readFile(migration, 'utf8');
    await client.query(sql);
    const { a, b, coop, alumno } = await seed(client);
    await t.test('unicidad, índices y referencias obligatorias', async () => {
      const { rows: indices } = await client.query("SELECT indexdef FROM pg_indexes WHERE schemaname=current_schema() AND tablename='cooperativa'");
      assert.ok(indices.some(({ indexdef }) => indexdef.endsWith('(escuela_id)')));
      await assert.rejects(client.query("INSERT INTO escuela(cct_clave,nombre) VALUES ('FICTICIA_A','Duplicada')"), { code: '23505' });
      await assert.rejects(client.query("INSERT INTO cooperativa(escuela_id,nombre,tipo_titular) VALUES ($1,'Huérfana','PERSON')", [randomUUID()]), { code: '23503' });
      await assert.rejects(client.query("INSERT INTO estudiante(escuela_id,matricula,nombre) VALUES ($1,'A','Alumno A')", [a]), { code: '23505' });
      await client.query("INSERT INTO estudiante(escuela_id,matricula,nombre) VALUES ($1,'A','Alumno B')", [b]);
      await assert.rejects(client.query('DELETE FROM escuela WHERE id=$1', [a]), { code: '23503' });
    });
    await t.test('cuenta receptora y límites enteros configurables', async () => {
      await assert.rejects(client.query("UPDATE cooperativa SET codi_status='ACTIVE' WHERE id=$1", [coop]), { code: '23514' });
      await assert.rejects(client.query("UPDATE cooperativa SET clabe='123' WHERE id=$1", [coop]), { code: '23514' });
      for (const value of ['0', '-1', '9007199254740992']) {
        await assert.rejects(client.query('UPDATE cooperativa SET limite_abonos_mes_centavos=$1 WHERE id=$2', [value, coop]), { code: '23514' });
      }
      await assert.rejects(client.query('UPDATE cooperativa SET limite_efectivo_mes_centavos=$1 WHERE id=$2', ['1.5', coop]), { code: '22P02' });
      await client.query('UPDATE cooperativa SET limite_abonos_mes_centavos=9007199254740991, limite_efectivo_mes_centavos=NULL WHERE id=$1', [coop]);
      const { rows } = await client.query('SELECT limite_abonos_mes_centavos,limite_efectivo_mes_centavos FROM cooperativa WHERE id=$1', [coop]);
      assert.equal(rows[0].limite_abonos_mes_centavos, '9007199254740991');
      assert.equal(rows[0].limite_efectivo_mes_centavos, null);
    });
    await t.test('claves compuestas permiten impedir cuentas entre escuelas', async () => {
      await client.query(`CREATE TABLE vinculo_prueba (
        escuela_id uuid, cooperativa_id uuid, estudiante_id uuid,
        FOREIGN KEY (cooperativa_id,escuela_id) REFERENCES cooperativa(id,escuela_id),
        FOREIGN KEY (estudiante_id,escuela_id) REFERENCES estudiante(id,escuela_id))`);
      await client.query('INSERT INTO vinculo_prueba VALUES ($1,$2,$3)', [a, coop, alumno]);
      await assert.rejects(client.query('INSERT INTO vinculo_prueba VALUES ($1,$2,$3)', [b, coop, alumno]), { code: '23503' });
      await assert.rejects(client.query("UPDATE estudiante SET escuela_id=$1, matricula='TRASLADO' WHERE id=$2", [b, alumno]), { code: '23503' });
    });
    await t.test('un cambio abortado no altera los datos', async () => {
      await client.query('BEGIN');
      await client.query('UPDATE cooperativa SET activa=false WHERE id=$1', [coop]);
      await client.query('ROLLBACK');
      assert.equal((await client.query('SELECT activa FROM cooperativa WHERE id=$1', [coop])).rows[0].activa, true);
    });
  });
});

test('migración base: un fallo intermedio revierte todo y no borra tablas previas', async () => {
  await isolated(async (client) => {
    await client.query('CREATE TABLE cooperativa (marcador integer); INSERT INTO cooperativa VALUES (7)');
    await assert.rejects(client.query(await readFile(migration, 'utf8')), { code: '42P07' });
    await client.query('ROLLBACK');
    assert.equal((await client.query("SELECT to_regclass('escuela') AS tabla")).rows[0].tabla, null);
    assert.equal((await client.query('SELECT marcador FROM cooperativa')).rows[0].marcador, 7);
  });
});
