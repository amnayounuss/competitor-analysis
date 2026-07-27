-- Self-hosted Supabase: add schema_name to client_databases
-- Each client gets their own Postgres schema for data isolation.

ALTER TABLE public.client_databases
  ADD COLUMN IF NOT EXISTS schema_name text;

COMMENT ON COLUMN public.client_databases.schema_name IS
  'Postgres schema name for this client (e.g. client_a1b2c3d4). NULL = legacy cloud Supabase.';

ALTER TABLE public.client_databases ALTER COLUMN supabase_url DROP NOT NULL;
ALTER TABLE public.client_databases ALTER COLUMN service_role_key DROP NOT NULL;

-- exec_sql: lets the app run DDL (schema provisioning) via RPC.
-- Only callable with service_role (which bypasses RLS).
CREATE OR REPLACE FUNCTION public.exec_sql(query text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  EXECUTE query;
END;
$$;

REVOKE ALL ON FUNCTION public.exec_sql(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.exec_sql(text) FROM anon;
REVOKE ALL ON FUNCTION public.exec_sql(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.exec_sql(text) TO service_role;
