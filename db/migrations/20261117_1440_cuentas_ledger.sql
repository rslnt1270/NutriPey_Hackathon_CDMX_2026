-- #53: cuentas únicamente; movimientos e invariantes contables siguen en #44.
BEGIN;

CREATE TABLE cuenta_ledger (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    escuela_id uuid NOT NULL,
    cooperativa_id uuid NOT NULL,
    estudiante_id uuid,
    tipo text NOT NULL CHECK (tipo IN ('BANCO', 'CAJA_EFECTIVO', 'ANTICIPO_ALUMNO', 'INGRESO_VENTAS')),
    saldo_centavos bigint NOT NULL DEFAULT 0
        CHECK (saldo_centavos BETWEEN -9007199254740991 AND 9007199254740991),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((tipo = 'ANTICIPO_ALUMNO') = (estudiante_id IS NOT NULL)),
    CHECK (tipo <> 'ANTICIPO_ALUMNO' OR saldo_centavos >= 0),
    FOREIGN KEY (cooperativa_id, escuela_id) REFERENCES cooperativa(id, escuela_id),
    FOREIGN KEY (estudiante_id, escuela_id) REFERENCES estudiante(id, escuela_id)
);
CREATE UNIQUE INDEX cuenta_anticipo_unico ON cuenta_ledger(estudiante_id)
    WHERE tipo = 'ANTICIPO_ALUMNO';
CREATE UNIQUE INDEX cuenta_general_unica ON cuenta_ledger(cooperativa_id, tipo)
    WHERE tipo <> 'ANTICIPO_ALUMNO';
CREATE INDEX cuenta_cooperativa_escuela_idx ON cuenta_ledger(cooperativa_id, escuela_id);

CREATE FUNCTION exigir_saldo_inicial_cero() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.saldo_centavos <> 0 THEN
        RAISE EXCEPTION 'Una cuenta nueva requiere saldo cero' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER cuenta_saldo_inicial BEFORE INSERT ON cuenta_ledger
    FOR EACH ROW EXECUTE FUNCTION exigir_saldo_inicial_cero();

COMMIT;
