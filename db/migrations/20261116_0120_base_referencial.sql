-- #43, primera parte de #6. Ejecutar una vez en el esquema de la aplicación.
BEGIN;

CREATE TABLE escuela (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cct_clave text NOT NULL UNIQUE CHECK (btrim(cct_clave) <> ''),
    nombre text NOT NULL CHECK (btrim(nombre) <> ''),
    alcaldia text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cooperativa (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    escuela_id uuid NOT NULL REFERENCES escuela(id),
    nombre text NOT NULL CHECK (btrim(nombre) <> ''),
    titular_nombre text,
    tipo_titular text NOT NULL CHECK (tipo_titular IN ('PERSON', 'BUSINESS')),
    clabe text CHECK (clabe ~ '^[0-9]{18}$'),
    pey_bank_account_id text UNIQUE CHECK (btrim(pey_bank_account_id) <> ''),
    codi_status text NOT NULL DEFAULT 'PENDING'
        CHECK (codi_status IN ('PENDING', 'PROCESSING', 'ACTIVE', 'ERROR')),
    limite_abonos_mes_centavos bigint
        CHECK (limite_abonos_mes_centavos BETWEEN 1 AND 9007199254740991),
    limite_efectivo_mes_centavos bigint
        CHECK (limite_efectivo_mes_centavos BETWEEN 1 AND 9007199254740991),
    activa boolean NOT NULL DEFAULT true,
    CONSTRAINT cooperativa_activa_requiere_cuenta CHECK (
        codi_status <> 'ACTIVE' OR (clabe IS NOT NULL AND pey_bank_account_id IS NOT NULL)
    ),
    UNIQUE (id, escuela_id)
);
CREATE INDEX cooperativa_escuela_idx ON cooperativa(escuela_id);

CREATE TABLE estudiante (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    escuela_id uuid NOT NULL REFERENCES escuela(id),
    matricula text NOT NULL CHECK (btrim(matricula) <> ''),
    nombre text NOT NULL CHECK (btrim(nombre) <> ''),
    grado_grupo text,
    foto_url text,
    pin_hash text,
    activo boolean NOT NULL DEFAULT true,
    UNIQUE (escuela_id, matricula),
    UNIQUE (id, escuela_id)
);

COMMIT;
