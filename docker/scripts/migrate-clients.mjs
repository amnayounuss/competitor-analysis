#!/usr/bin/env node

/**
 * Migrate client data from individual Supabase Cloud projects
 * to self-hosted Supabase (one schema per client).
 *
 * Usage:
 *   node docker/scripts/migrate-clients.mjs
 *
 * Requires:
 *   - Self-hosted Supabase running (docker compose up)
 *   - Admin data already migrated (migrate-admin.sh)
 *   - .env loaded with self-hosted credentials
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

// ── Config ──────────────────────────────────────────────────
const SELF_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SELF_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SELF_URL || !SELF_KEY) {
  console.error('ERROR: Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const admin = createClient(SELF_URL, SELF_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const CLIENT_TABLES = ['branches', 'reviews', 'analyses', 'reports', 'job_history', 'branch_analytics'];
const BATCH_SIZE = 500;

// ── Read schema SQL ─────────────────────────────────────────
const clientSchemaSQL = fs.readFileSync(path.join(REPO_ROOT, 'supabase/client-schema.sql'), 'utf-8');
const migrations = ['002_branch_analytics.sql', '003_store_name.sql']
  .map(f => {
    const fp = path.join(REPO_ROOT, 'supabase/client-migrations', f);
    return fs.existsSync(fp) ? fs.readFileSync(fp, 'utf-8') : '';
  })
  .join('\n');

// ── Main ────────────────────────────────────────────────────
async function main() {
  console.log('═══ Client Data Migration ═══\n');

  // Get all clients from admin DB
  const { data: clients, error } = await admin
    .from('client_databases')
    .select('user_id, supabase_url, service_role_key, schema_name');

  if (error) throw new Error('Failed to fetch clients: ' + error.message);
  if (!clients?.length) {
    console.log('No clients found. Nothing to migrate.');
    return;
  }

  console.log(`Found ${clients.length} client(s) to migrate.\n`);

  for (const client of clients) {
    // Skip already-migrated clients
    if (client.schema_name) {
      console.log(`✓ ${client.user_id.slice(0, 8)} — already migrated (${client.schema_name})`);
      continue;
    }

    // Skip clients with no valid cloud URL
    if (!client.supabase_url || !client.service_role_key) {
      console.log(`⊘ ${client.user_id.slice(0, 8)} — no cloud credentials, skipping`);
      continue;
    }

    console.log(`→ Migrating ${client.user_id.slice(0, 8)}...`);

    try {
      await migrateClient(client);
      console.log(`  ✓ Done\n`);
    } catch (e) {
      console.error(`  ✗ Failed: ${e.message}\n`);
    }
  }

  console.log('═══ Client migration complete ═══');
}

async function migrateClient(client) {
  const schemaName = 'client_' + client.user_id.replace(/-/g, '').slice(0, 8);

  // 1. Create schema + tables via exec_sql
  console.log(`  Creating schema ${schemaName}...`);
  const provisionSQL = `
    CREATE SCHEMA IF NOT EXISTS ${schemaName};
    SET search_path TO ${schemaName}, public;
    ${clientSchemaSQL}
    ${migrations}
    GRANT USAGE ON SCHEMA ${schemaName} TO anon, authenticated, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA ${schemaName} TO anon, authenticated, service_role;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA ${schemaName} TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaName}
      GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaName}
      GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
    DO $$
    DECLARE current_schemas text;
    BEGIN
      SELECT COALESCE(
        (SELECT setting FROM pg_settings WHERE name = 'pgrst.db_schemas'),
        'public,storage,graphql_public'
      ) INTO current_schemas;
      IF current_schemas NOT LIKE '%${schemaName}%' THEN
        EXECUTE format('ALTER ROLE authenticator SET pgrst.db_schemas = %L',
          current_schemas || ',${schemaName}');
        NOTIFY pgrst, 'reload config';
      END IF;
    END $$;
    RESET search_path;
  `;

  const { error: sqlErr } = await admin.rpc('exec_sql', { query: provisionSQL });
  if (sqlErr) throw new Error('Schema creation failed: ' + sqlErr.message);

  // 2. Connect to cloud client DB
  const cloud = createClient(client.supabase_url, client.service_role_key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 3. Create a self-hosted client scoped to the new schema
  const selfClient = createClient(SELF_URL, SELF_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: schemaName },
  });

  // 4. Migrate each table
  for (const table of CLIENT_TABLES) {
    await migrateTable(cloud, selfClient, table);
  }

  // 5. Migrate storage files
  await migrateStorage(cloud, schemaName);

  // 6. Update client_databases record
  const { error: updateErr } = await admin
    .from('client_databases')
    .update({
      supabase_url: SELF_URL,
      service_role_key: SELF_KEY,
      schema_name: schemaName,
      last_test_ok: true,
      last_test_at: new Date().toISOString(),
      last_test_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', client.user_id);

  if (updateErr) throw new Error('Failed to update client_databases: ' + updateErr.message);
}

async function migrateTable(cloud, selfClient, table) {
  let offset = 0;
  let total = 0;

  while (true) {
    const { data, error } = await cloud
      .from(table)
      .select('*')
      .range(offset, offset + BATCH_SIZE - 1)
      .order('created_at', { ascending: true });

    if (error) {
      // Table might not exist in old client DBs
      if (error.message.includes('does not exist') || error.code === '42P01') {
        console.log(`  ${table}: not found in cloud, skipping`);
        return;
      }
      throw new Error(`${table} read failed: ${error.message}`);
    }

    if (!data?.length) break;

    const { error: insertErr } = await selfClient.from(table).insert(data);
    if (insertErr) {
      // Skip duplicate key errors (already migrated rows)
      if (!insertErr.message.includes('duplicate key')) {
        throw new Error(`${table} insert failed: ${insertErr.message}`);
      }
    }

    total += data.length;
    offset += BATCH_SIZE;

    if (data.length < BATCH_SIZE) break;
  }

  if (total > 0) console.log(`  ${table}: ${total} rows`);
}

async function migrateStorage(cloud, schemaName) {
  const { data: files, error } = await cloud.storage.from('reports').list('', { limit: 1000 });
  if (error || !files?.length) return;

  let migrated = 0;
  // Files are in folders named by jobId
  for (const folder of files) {
    if (!folder.id) continue; // skip non-folders

    const { data: folderFiles } = await cloud.storage.from('reports').list(folder.name, { limit: 100 });
    if (!folderFiles?.length) continue;

    for (const file of folderFiles) {
      const srcPath = `${folder.name}/${file.name}`;
      const dstPath = `${schemaName}/${folder.name}/${file.name}`;

      const { data: blob, error: dlErr } = await cloud.storage.from('reports').download(srcPath);
      if (dlErr || !blob) continue;

      const buffer = Buffer.from(await blob.arrayBuffer());
      const { error: upErr } = await admin.storage.from('reports').upload(dstPath, buffer, {
        upsert: true,
        contentType: file.metadata?.mimetype || 'application/octet-stream',
      });
      if (!upErr) migrated++;
    }
  }

  if (migrated > 0) console.log(`  storage: ${migrated} files`);
}

main().catch(e => {
  console.error('Migration failed:', e);
  process.exit(1);
});
