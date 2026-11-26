import os
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]

class Roles(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix='nutripey-58-')
        cls.path = pathlib.Path(cls.tmp.name)
        cls.env = dict(os.environ, PGHOST=str(cls.path), PGDATABASE='nutripey_test', PGUSER=os.environ['USER'])
        subprocess.run(['initdb', '-D', str(cls.path / 'db'), '-A', 'trust', '--no-locale'], check=True, stdout=subprocess.DEVNULL)
        subprocess.run(['pg_ctl', '-D', str(cls.path / 'db'), '-l', str(cls.path / 'pg.log'), '-o', f"-k {cls.path} -c listen_addresses=''", '-w', 'start'], check=True, stdout=subprocess.DEVNULL)
        cls.addClassCleanup(cls.cleanup)
        subprocess.run(['createdb', 'nutripey_test'], env=cls.env, check=True)
        for migration in sorted((ROOT / 'db/migrations').glob('*.sql')):
            cls.sql(migration.read_text())
        cls.sql((ROOT / 'infrastructure/postgres/roles.sql').read_text())
        # Optional #57 migration, exported from Git without touching its worktree.
        if os.environ.get('LEDGER_MIGRATION'):
            cls.sql(pathlib.Path(os.environ['LEDGER_MIGRATION']).read_text(), 'nutripey_migracion')
        cls.sql((ROOT / 'infrastructure/postgres/roles.sql').read_text())
        cls.sql((ROOT / 'infrastructure/postgres/roles.sql').read_text())
        cls.ledger = cls.sql("SELECT to_regclass('public.transaccion') IS NOT NULL").stdout.strip() == 't'

    @classmethod
    def cleanup(cls):
        subprocess.run(['pg_ctl', '-D', str(cls.path / 'db'), '-m', 'fast', '-w', 'stop'], check=True, stdout=subprocess.DEVNULL)
        cls.tmp.cleanup()

    @classmethod
    def sql(cls, sql, role=None, ok=True):
        env = dict(cls.env, PGUSER=role or cls.env['PGUSER'])
        p = subprocess.run(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], input=sql, text=True, capture_output=True, env=env)
        if ok and p.returncode:
            raise AssertionError(p.stderr)
        return p

    def test_movimiento_con_rol_app(self):
        if not self.ledger:
            self.skipTest('requiere migración #57 para movimientos')
        self.sql("""
          INSERT INTO escuela(id,cct_clave,nombre) VALUES ('00000000-0000-0000-0000-000000000001','SIMULADA58','Simulada');
          INSERT INTO cooperativa(id,escuela_id,nombre,tipo_titular) VALUES ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','Simulada','PERSON');
          INSERT INTO estudiante(id,escuela_id,matricula,nombre) VALUES ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','SIMULADA','Simulado');
        """)
        self.sql("""
          INSERT INTO cuenta_ledger(id,escuela_id,cooperativa_id,estudiante_id,tipo) VALUES
          ('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',NULL,'BANCO'),
          ('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','ANTICIPO_ALUMNO');
          BEGIN;
          SELECT id FROM cuenta_ledger ORDER BY id FOR UPDATE;
          INSERT INTO transaccion(id,escuela_id,cooperativa_id,estudiante_id,tipo,idempotency_key,monto_centavos) VALUES
          ('00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','RECARGA_CODI','simulada58',5);
          INSERT INTO asiento_contable(transaccion_id,cooperativa_id,cuenta_ledger_id,tipo_asiento,monto_centavos) VALUES
          ('00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000004','DEBITO',5),
          ('00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000005','CREDITO',5);
          COMMIT;
        """, 'nutripey_app')
        self.assertEqual(self.sql('SELECT sum(saldo_centavos) FROM cuenta_ledger', 'nutripey_app').stdout.strip(), '10')

        self.sql("INSERT INTO cuenta_ledger(id,escuela_id,cooperativa_id,tipo) VALUES ('00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','INGRESO_VENTAS')", 'nutripey_app')
        def movement(key, tipo='COMPRA', origin=None):
            tid = str(uuid4())
            debit, credit = ('5', '7') if tipo == 'COMPRA' else ('4', '5')
            if tipo == 'REVERSO':
                debit, credit = '7', '5'
            ref = f"'{origin}'" if origin else 'NULL'
            return self.sql(f"""\\set VERBOSITY sqlstate
              BEGIN;
              SELECT id FROM cuenta_ledger ORDER BY id FOR UPDATE;
              INSERT INTO transaccion(id,escuela_id,cooperativa_id,estudiante_id,tipo,idempotency_key,monto_centavos,transaccion_origen_id)
              VALUES ('{tid}','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','{tipo}','{key}',1,{ref});
              INSERT INTO asiento_contable(transaccion_id,cooperativa_id,cuenta_ledger_id,tipo_asiento,monto_centavos) VALUES
              ('{tid}','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000000{debit}','DEBITO',1),
              ('{tid}','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000000{credit}','CREDITO',1);
              COMMIT;
            """, 'nutripey_app', ok=False)
        with ThreadPoolExecutor(max_workers=20) as pool:
            results = list(pool.map(lambda i: movement(str(i)), range(20)))
        self.assertEqual(sum(p.returncode == 0 for p in results), 5)
        self.assertTrue(all('23514' in p.stderr for p in results if p.returncode))
        self.assertEqual(movement('repetida', 'RECARGA_CODI').returncode, 0)
        for _ in range(2):
            self.assertIn('23505', movement('repetida', 'RECARGA_CODI').stderr)
        self.assertEqual(self.sql("SELECT saldo_centavos FROM cuenta_ledger WHERE tipo='ANTICIPO_ALUMNO'", 'nutripey_app').stdout.strip(), '1')
        self.assertEqual(self.sql("SELECT count(*) FROM transaccion WHERE idempotency_key='repetida'", 'nutripey_app').stdout.strip(), '1')
        self.assertEqual(self.sql("SELECT count(*) FROM (SELECT t.id FROM transaccion t JOIN asiento_contable a ON a.transaccion_id=t.id GROUP BY t.id HAVING sum(CASE WHEN tipo_asiento='DEBITO' THEN a.monto_centavos ELSE -a.monto_centavos END)<>0) mal", 'nutripey_app').stdout.strip(), '0')

        origin = self.sql("SELECT id FROM transaccion WHERE tipo='COMPRA' LIMIT 1").stdout.strip()
        self.assertEqual(movement('reverso', 'REVERSO', origin).returncode, 0)
        self.assertIn('23505', movement('reverso2', 'REVERSO', origin).stderr)
        self.assertEqual(self.sql("SELECT saldo_centavos FROM cuenta_ledger WHERE tipo='ANTICIPO_ALUMNO'").stdout.strip(), '2')
        self.assertEqual(self.sql("SELECT count(*) FROM cuenta_ledger c WHERE saldo_centavos <> (SELECT coalesce(sum(CASE WHEN (c.tipo IN ('BANCO','CAJA_EFECTIVO'))=(a.tipo_asiento='DEBITO') THEN monto_centavos ELSE -monto_centavos END),0) FROM asiento_contable a WHERE a.cuenta_ledger_id=c.id)").stdout.strip(), '0')
        p = self.sql("\\set VERBOSITY sqlstate\nUPDATE cuenta_ledger SET id=gen_random_uuid()", 'nutripey_app', ok=False)
        self.assertIn('55000', p.stderr)

    def test_roles_y_propiedad(self):
        self.assertEqual(self.sql("SELECT rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb FROM pg_roles WHERE rolname='nutripey_app'").stdout.strip(), 'f')
        self.assertEqual(self.sql("SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tableowner <> 'nutripey_migracion'").stdout.strip(), '0')
        self.sql('CREATE TABLE public.prueba_futura(id int)', 'nutripey_migracion')
        self.assertNotEqual(self.sql('SELECT * FROM public.prueba_futura', 'nutripey_app', ok=False).returncode, 0)
        self.sql('DROP TABLE public.prueba_futura', 'nutripey_migracion')

    def test_ataques_rechazados(self):
        attacks = ["SET session_replication_role=replica", 'ALTER TABLE cuenta_ledger DISABLE TRIGGER ALL',
                   'TRUNCATE cuenta_ledger CASCADE', 'UPDATE cuenta_ledger SET saldo_centavos=1',
                   'DELETE FROM cuenta_ledger', 'CREATE TABLE public.intrusa(id int)',
                   'CREATE TEMP TABLE cuenta_ledger(id int)', 'SET ROLE nutripey_migracion',
                   'ALTER FUNCTION exigir_saldo_inicial_cero() SECURITY DEFINER']
        if self.ledger:
            attacks += ['UPDATE asiento_contable SET monto_centavos=1', 'DELETE FROM asiento_contable',
                        'TRUNCATE asiento_contable', 'UPDATE transaccion SET monto_centavos=1',
                        'DELETE FROM transaccion', 'ALTER TABLE asiento_contable DISABLE TRIGGER ALL']
        for attack in attacks:
            with self.subTest(sql=attack):
                p = self.sql('\\set VERBOSITY sqlstate\n' + attack, 'nutripey_app', ok=False)
                self.assertNotEqual(p.returncode, 0, attack)
                self.assertIn('42501', p.stderr)

if __name__ == '__main__':
    unittest.main(verbosity=2)
