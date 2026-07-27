import fs from 'node:fs';
import path from 'node:path';
import { adminClient } from './supabase';

const CLIENT_SCHEMA_SQL = fs.readFileSync(
  path.join(process.cwd(), 'supabase', 'client-schema.sql'),
  'utf-8',
);

const CLIENT_MIGRATIONS = ['002_branch_analytics.sql', '003_store_name.sql'];

export function schemaNameForUser(userId: string): string {
  return 'client_' + userId.replace(/-/g, '').slice(0, 8);
}

export async function provisionClientSchema(userId: string): Promise<string> {
  const sb = adminClient();
  const schemaName = schemaNameForUser(userId);

  const { data: existing } = await sb
    .from('client_databases')
    .select('schema_name')
    .eq('user_id', userId)
    .maybeSingle();
  if (existing?.schema_name) return existing.schema_name;

  const { error: rpcErr } = await sb.rpc('exec_sql', {
    query: buildProvisionSQL(schemaName),
  });
  if (rpcErr) throw new Error('Schema provisioning failed: ' + rpcErr.message);

  await sb.from('client_databases').upsert({
    user_id: userId,
    supabase_url: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    service_role_key: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    schema_name: schemaName,
    last_test_ok: true,
    last_test_at: new Date().toISOString(),
    last_test_error: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });

  return schemaName;
}

function buildProvisionSQL(schemaName: string): string {
  const migrationDir = path.join(process.cwd(), 'supabase', 'client-migrations');
  let migrationSQL = '';
  for (const file of CLIENT_MIGRATIONS) {
    const fp = path.join(migrationDir, file);
    if (fs.existsSync(fp)) {
      migrationSQL += '\n' + fs.readFileSync(fp, 'utf-8');
    }
  }

  return `
    CREATE SCHEMA IF NOT EXISTS ${schemaName};
    SET search_path TO ${schemaName}, public;

    ${CLIENT_SCHEMA_SQL}
    ${migrationSQL}

    -- Grant access to PostgREST roles
    GRANT USAGE ON SCHEMA ${schemaName} TO anon, authenticated, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA ${schemaName} TO anon, authenticated, service_role;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA ${schemaName} TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaName}
      GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaName}
      GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

    -- Register schema with PostgREST (hot reload)
    DO $$
    DECLARE
      current_schemas text;
    BEGIN
      SELECT COALESCE(
        (SELECT setting FROM pg_settings WHERE name = 'pgrst.db_schemas'),
        'public,storage,graphql_public'
      ) INTO current_schemas;

      IF current_schemas NOT LIKE '%${schemaName}%' THEN
        EXECUTE format(
          'ALTER ROLE authenticator SET pgrst.db_schemas = %L',
          current_schemas || ',${schemaName}'
        );
        NOTIFY pgrst, 'reload config';
      END IF;
    END
    $$;

    RESET search_path;
  `;
}
