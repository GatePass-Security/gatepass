-- The pooler runs this on checkout for every application connection. If the
-- GUC is unset, every policy above evaluates to false and returns zero rows
-- rather than failing open.
CREATE OR REPLACE FUNCTION set_tenant_context(p_tenant uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM set_config('app.tenant_id', p_tenant::text, false);
END;
$$;

ALTER ROLE app_user SET app.tenant_id = '00000000-0000-0000-0000-000000000000';
ALTER ROLE app_user NOBYPASSRLS;
