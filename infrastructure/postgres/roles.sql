-- #58: ejecutar como administrador, solo en la BD dedicada de NutriPey.
-- Reaplicar tras cada migración; no contiene ni cambia contraseñas.
BEGIN;
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='nutripey_migracion') THEN
        CREATE ROLE nutripey_migracion LOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='nutripey_app') THEN
        CREATE ROLE nutripey_app LOGIN;
    END IF;
    IF EXISTS (SELECT FROM pg_auth_members WHERE member IN
        (SELECT oid FROM pg_roles WHERE rolname IN ('nutripey_app','nutripey_migracion'))) THEN
        RAISE EXCEPTION 'Los roles dedicados no deben heredar ni poder asumir otros roles';
    END IF;
    IF EXISTS (SELECT FROM pg_database WHERE datname=current_database()
        AND datdba=(SELECT oid FROM pg_roles WHERE rolname='nutripey_app')) THEN
        RAISE EXCEPTION 'La app no puede ser dueña de la base';
    END IF;
END $$;
ALTER ROLE nutripey_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
ALTER ROLE nutripey_migracion NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
REVOKE ALL ON PARAMETER session_replication_role FROM PUBLIC, nutripey_app;
DO $$
BEGIN
    EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC, nutripey_app', current_database());
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO nutripey_app, nutripey_migracion', current_database());
END $$;
ALTER SCHEMA public OWNER TO nutripey_migracion;
REVOKE ALL ON SCHEMA public FROM PUBLIC, nutripey_app;
GRANT USAGE ON SCHEMA public TO nutripey_app;
-- Solo objetos de public en esta base dedicada; nunca REASSIGN OWNED del superusuario.
DO $$
DECLARE obj record;
BEGIN
    FOR obj IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
        EXECUTE format('ALTER TABLE public.%I OWNER TO nutripey_migracion', obj.tablename);
    END LOOP;
    FOR obj IN SELECT p.oid::regprocedure AS firma FROM pg_proc p
        JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' LOOP
        EXECUTE format('ALTER FUNCTION %s OWNER TO nutripey_migracion', obj.firma);
        EXECUTE format('ALTER FUNCTION %s SET search_path TO pg_catalog, public, pg_temp', obj.firma);
    END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, nutripey_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, nutripey_app;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, nutripey_app;
ALTER DEFAULT PRIVILEGES FOR ROLE nutripey_migracion REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
-- Ningún permiso automático para tablas futuras: cada alta requiere revisar los grants.
GRANT SELECT ON public.escuela, public.cooperativa, public.estudiante, public.cuenta_ledger TO nutripey_app;
GRANT INSERT (id, escuela_id, cooperativa_id, estudiante_id, tipo) ON public.cuenta_ledger TO nutripey_app;
DO $$
BEGIN
    IF to_regclass('public.transaccion') IS NOT NULL THEN
        -- Coordinación con #57: único punto privilegiado que escribe el saldo.
        ALTER FUNCTION public.aplicar_asientos() SECURITY DEFINER;
        GRANT SELECT, INSERT ON public.transaccion, public.asiento_contable TO nutripey_app;
        -- PostgreSQL exige UPDATE en alguna columna para SELECT FOR UPDATE.
        -- cuenta_proteger de #57 prohíbe cambiar id; no se concede UPDATE de saldo.
        GRANT UPDATE (id) ON public.cuenta_ledger TO nutripey_app;
    END IF;
END $$;
COMMIT;
