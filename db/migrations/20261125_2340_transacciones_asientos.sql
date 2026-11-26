-- #44 (entrega 2): transacciones, asientos e invariantes contables.
-- Idempotencia con hash/resultado, recargas, eventos y auditoría siguen en #45.
BEGIN;

ALTER TABLE cuenta_ledger ADD CONSTRAINT cuenta_cooperativa_unica UNIQUE (id, cooperativa_id);

CREATE TABLE transaccion (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    escuela_id uuid NOT NULL,
    cooperativa_id uuid NOT NULL,
    estudiante_id uuid NOT NULL,
    tipo text NOT NULL CHECK (tipo IN ('RECARGA_CODI', 'RECARGA_EFECTIVO', 'COMPRA', 'REVERSO', 'REEMBOLSO')),
    transaccion_origen_id uuid,
    idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
    monto_centavos bigint NOT NULL CHECK (monto_centavos BETWEEN 1 AND 9007199254740991),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((tipo = 'REVERSO') = (transaccion_origen_id IS NOT NULL)),
    UNIQUE (cooperativa_id, tipo, idempotency_key),
    UNIQUE (id, cooperativa_id),
    FOREIGN KEY (cooperativa_id, escuela_id) REFERENCES cooperativa(id, escuela_id),
    FOREIGN KEY (estudiante_id, escuela_id) REFERENCES estudiante(id, escuela_id),
    FOREIGN KEY (transaccion_origen_id, cooperativa_id) REFERENCES transaccion(id, cooperativa_id)
);
CREATE UNIQUE INDEX transaccion_reverso_unico ON transaccion(transaccion_origen_id) WHERE tipo = 'REVERSO';
CREATE INDEX transaccion_estudiante_fecha_idx ON transaccion(estudiante_id, created_at);

CREATE TABLE asiento_contable (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    transaccion_id uuid NOT NULL,
    cooperativa_id uuid NOT NULL,
    cuenta_ledger_id uuid NOT NULL,
    tipo_asiento text NOT NULL CHECK (tipo_asiento IN ('DEBITO', 'CREDITO')),
    monto_centavos bigint NOT NULL CHECK (monto_centavos BETWEEN 1 AND 9007199254740991),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (transaccion_id, cooperativa_id) REFERENCES transaccion(id, cooperativa_id),
    FOREIGN KEY (cuenta_ledger_id, cooperativa_id) REFERENCES cuenta_ledger(id, cooperativa_id)
);
CREATE INDEX asiento_transaccion_idx ON asiento_contable(transaccion_id);
CREATE INDEX asiento_cuenta_idx ON asiento_contable(cuenta_ledger_id) INCLUDE (tipo_asiento, monto_centavos);

-- Un reverso anula una compra completa del mismo alumno, una sola vez (índice parcial).
CREATE FUNCTION validar_transaccion() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
    origen transaccion%ROWTYPE;
BEGIN
    IF NEW.tipo = 'REVERSO' THEN
        SELECT * INTO origen FROM transaccion WHERE id = NEW.transaccion_origen_id;
        IF origen.tipo IS DISTINCT FROM 'COMPRA' OR origen.estudiante_id <> NEW.estudiante_id
           OR origen.monto_centavos <> NEW.monto_centavos THEN
            RAISE EXCEPTION 'Un reverso anula una compra completa del mismo alumno' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER transaccion_validar BEFORE INSERT ON transaccion
    FOR EACH ROW EXECUTE FUNCTION validar_transaccion();

-- Cada tipo de transacción mueve exactamente un par de cuentas (docs/02_modelo_de_datos.md).
CREATE FUNCTION validar_asiento() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
    t transaccion%ROWTYPE;
    c cuenta_ledger%ROWTYPE;
    esperado text[];
BEGIN
    SELECT * INTO t FROM transaccion WHERE id = NEW.transaccion_id;
    SELECT * INTO c FROM cuenta_ledger WHERE id = NEW.cuenta_ledger_id;
    esperado := CASE t.tipo
        WHEN 'RECARGA_CODI' THEN ARRAY['BANCO', 'ANTICIPO_ALUMNO']
        WHEN 'RECARGA_EFECTIVO' THEN ARRAY['CAJA_EFECTIVO', 'ANTICIPO_ALUMNO']
        WHEN 'COMPRA' THEN ARRAY['ANTICIPO_ALUMNO', 'INGRESO_VENTAS']
        WHEN 'REVERSO' THEN ARRAY['INGRESO_VENTAS', 'ANTICIPO_ALUMNO']
        WHEN 'REEMBOLSO' THEN ARRAY['ANTICIPO_ALUMNO', 'BANCO']
    END;
    IF c.tipo <> esperado[CASE NEW.tipo_asiento WHEN 'DEBITO' THEN 1 ELSE 2 END]
       OR (c.tipo = 'ANTICIPO_ALUMNO' AND c.estudiante_id <> t.estudiante_id) THEN
        RAISE EXCEPTION 'Cuenta % no corresponde al % de una %', c.tipo, NEW.tipo_asiento, t.tipo
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER asiento_validar BEFORE INSERT ON asiento_contable
    FOR EACH ROW EXECUTE FUNCTION validar_asiento();

-- Saldo materializado en la misma transacción SQL, una vez por cuenta y sentencia. Activos
-- crecen con débito; pasivo e ingreso con crédito. El CHECK de anticipo aborta el sobregiro.
-- El llamador bloquea antes las cuentas con SELECT ... FOR UPDATE en orden ascendente de id.
CREATE FUNCTION aplicar_asientos() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
    UPDATE cuenta_ledger c
       SET saldo_centavos = c.saldo_centavos + m.neto
      FROM (SELECT n.cuenta_ledger_id, sum(CASE
                WHEN (k.tipo IN ('BANCO', 'CAJA_EFECTIVO')) = (n.tipo_asiento = 'DEBITO')
                THEN n.monto_centavos ELSE -n.monto_centavos END) AS neto
              FROM nuevos n JOIN cuenta_ledger k ON k.id = n.cuenta_ledger_id
             GROUP BY n.cuenta_ledger_id) m
     WHERE c.id = m.cuenta_ledger_id;
    RETURN NULL;
END;
$$;
CREATE TRIGGER asiento_aplicar AFTER INSERT ON asiento_contable
    REFERENCING NEW TABLE AS nuevos FOR EACH STATEMENT EXECUTE FUNCTION aplicar_asientos();

-- Todo cambio de saldo debe igualar el neto de los asientos de la cuenta, venga de donde
-- venga (otro trigger incluido). La identidad de la cuenta nunca cambia.
CREATE FUNCTION proteger_cuenta() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
    IF (NEW.id, NEW.escuela_id, NEW.cooperativa_id, NEW.estudiante_id, NEW.tipo, NEW.created_at)
       IS DISTINCT FROM (OLD.id, OLD.escuela_id, OLD.cooperativa_id, OLD.estudiante_id, OLD.tipo, OLD.created_at)
       OR (NEW.saldo_centavos <> OLD.saldo_centavos AND NEW.saldo_centavos <> (
           SELECT coalesce(sum(CASE WHEN (NEW.tipo IN ('BANCO', 'CAJA_EFECTIVO')) = (a.tipo_asiento = 'DEBITO')
                                    THEN a.monto_centavos ELSE -a.monto_centavos END), 0)
             FROM asiento_contable a WHERE a.cuenta_ledger_id = NEW.id)) THEN
        RAISE EXCEPTION 'El saldo solo cambia mediante asientos' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER cuenta_proteger BEFORE UPDATE ON cuenta_ledger
    FOR EACH ROW EXECUTE FUNCTION proteger_cuenta();

-- Partida doble al confirmar: débitos = créditos = monto de la transacción. Como el monto es
-- fijo, añadir asientos después a una transacción ya confirmada también se rechaza.
CREATE FUNCTION verificar_partida() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
    tid uuid := coalesce(to_jsonb(NEW) ->> 'transaccion_id', to_jsonb(NEW) ->> 'id')::uuid;
    monto bigint;
    debitos bigint;
    creditos bigint;
BEGIN
    SELECT t.monto_centavos,
           coalesce(sum(a.monto_centavos) FILTER (WHERE a.tipo_asiento = 'DEBITO'), 0),
           coalesce(sum(a.monto_centavos) FILTER (WHERE a.tipo_asiento = 'CREDITO'), 0)
      INTO monto, debitos, creditos
      FROM transaccion t LEFT JOIN asiento_contable a ON a.transaccion_id = t.id
     WHERE t.id = tid GROUP BY t.monto_centavos;
    IF debitos <> monto OR creditos <> monto THEN
        RAISE EXCEPTION 'Partida doble descuadrada en %: débitos %, créditos %, monto %',
            tid, debitos, creditos, monto USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER transaccion_partida AFTER INSERT ON transaccion
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verificar_partida();
CREATE CONSTRAINT TRIGGER asiento_partida AFTER INSERT ON asiento_contable
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verificar_partida();

-- Solo INSERT: los errores se corrigen con un REVERSO.
CREATE FUNCTION rechazar_modificacion() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
    RAISE EXCEPTION '% es inmutable; corrige con un reverso', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER transaccion_inmutable BEFORE UPDATE OR DELETE OR TRUNCATE ON transaccion
    FOR EACH STATEMENT EXECUTE FUNCTION rechazar_modificacion();
CREATE TRIGGER asiento_inmutable BEFORE UPDATE OR DELETE OR TRUNCATE ON asiento_contable
    FOR EACH STATEMENT EXECUTE FUNCTION rechazar_modificacion();

COMMIT;
