import assert from 'node:assert/strict';
import { test } from 'node:test';
import pg from 'pg';

test('PostgreSQL real permite transacción y rollback sin dejar registros', async () => {
  assert.ok(process.env.TEST_DATABASE_URL, 'Configura TEST_DATABASE_URL de una base local desechable');
  const url = new URL(process.env.TEST_DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'solo PostgreSQL de prueba local');
  assert.equal(url.pathname, '/nutripey_test', 'usar exclusivamente nutripey_test');
  const client = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 3000, query_timeout: 3000 });
  await client.connect();
  try {
    const { rows } = await client.query('SELECT current_database() AS name, version() AS version');
    assert.equal(rows[0].name, 'nutripey_test');
    assert.match(rows[0].version, /^PostgreSQL /);
    await client.query('CREATE TEMP TABLE humo (id integer PRIMARY KEY)');
    await client.query('BEGIN');
    await client.query('INSERT INTO humo VALUES (1)');
    assert.equal((await client.query('SELECT * FROM humo')).rowCount, 1);
    await client.query('ROLLBACK');
    assert.equal((await client.query('SELECT * FROM humo')).rowCount, 0);
  } finally { await client.end(); }
});
