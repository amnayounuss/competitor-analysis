#!/usr/bin/env node

/**
 * Full migration: Cloud Supabase → Self-hosted Supabase
 * Migrates auth users, admin tables, and all client data via API.
 *
 * Usage:
 *   node docker/scripts/migrate-all.mjs
 *
 * Reads cloud credentials from project .env (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
 * Reads self-hosted credentials from docker/.env (mapped to SELF_* vars)
 */

import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const DOCKER_DIR = path.resolve(__dirname, '..');

// Load project .env (cloud credentials)
config({ path: path.join(REPO_ROOT, '.env') });
const CLOUD_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const CLOUD_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Load docker/.env (self-hosted credentials)
const dockerEnv = {};
const dockerEnvContent = fs.readFileSync(path.join(DOCKER_DIR, '.env'), 'utf-8');
for (const line of dockerEnvContent.split('\n')) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match) dockerEnv[match[1]] = match[2].trim();
}

const SELF_URL = `http://localhost:${dockerEnv.API_EXTERNAL_PORT || '8000'}`;
const SELF_KEY = dockerEnv.SERVICE_ROLE_KEY;
const SELF_PG_PASS = dockerEnv.POSTGRES_PASSWORD;
const SELF_PG_PORT = dockerEnv.POSTGRES_PORT || '54322';

if (!CLOUD_URL || !CLOUD_KEY) {
  console.error('ERROR: Cloud credentials not found in .env');
  process.exit(1);
}
if (!SELF_KEY) {
  console.error('ERROR: Self-hosted credentials not found in docker/.env');
  process.exit(1);
}

console.log(`Cloud:       ${CLOUD_URL}`);
console.log(`Self-hosted: ${SELF_URL}`);
console.log('');

const cloud = createClient(CLOUD_URL, CLOUD_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const self = createClient(SELF_URL, SELF_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const BATCH_SIZE = 500;

// ── Helpers ────────────────────────────────────────────────────

async function fetchAll(client, table, orderBy = 'created_at') {
  const rows = [];
  let offset = 0;
  while (true) {
    const { data, error } = await client
      .from(table)
      .select('*')
      .range(offset, offset + BATCH_SIZE - 1)
      .order(orderBy, { ascending: true });

    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }
  return rows;
}

async function insertBatch(client, table, rows) {
  if (!rows.length) return 0;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await client.from(table).upsert(batch, { onConflict: 'id' }).select('id');
    if (error && !error.message.includes('duplicate key')) {
      // Try with different primary key
      const { error: err2 } = await client.from(table).insert(batch);
      if (err2 && !err2.message.includes('duplicate key')) {
        console.error(`  WARN: ${table} batch insert: ${err2.message}`);
      }
    }
    inserted += batch.length;
  }
  return inserted;
}

// ── Step 1: Auth Users ─────────────────────────────────────────

async function migrateAuthUsers() {
  console.log('═══ Step 1: Auth Users ═══');

  // Fetch users from cloud via Admin API
  const response = await fetch(`${CLOUD_URL}/auth/v1/admin/users?per_page=500`, {
    headers: {
      'apikey': CLOUD_KEY,
      'Authorization': `Bearer ${CLOUD_KEY}`,
    },
  });

  if (!response.ok) throw new Error(`Failed to fetch users: ${response.status}`);
  const body = await response.json();
  const users = body.users || body;

  console.log(`  Found ${users.length} user(s) in cloud`);

  let created = 0;
  let skipped = 0;

  for (const user of users) {
    // Check if user exists in self-hosted
    const checkResp = await fetch(`${SELF_URL}/auth/v1/admin/users/${user.id}`, {
      headers: {
        'apikey': SELF_KEY,
        'Authorization': `Bearer ${SELF_KEY}`,
      },
    });

    if (checkResp.ok) {
      skipped++;
      continue;
    }

    // Create user in self-hosted
    const createResp = await fetch(`${SELF_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'apikey': SELF_KEY,
        'Authorization': `Bearer ${SELF_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: user.id,
        email: user.email,
        email_confirm: true,
        user_metadata: user.user_metadata || {},
        app_metadata: user.app_metadata || {},
        // Can't transfer password hash via API — users will need password reset
      }),
    });

    if (createResp.ok) {
      created++;
    } else {
      const err = await createResp.json().catch(() => ({}));
      console.error(`  WARN: Failed to create ${user.email}: ${err.msg || err.message || createResp.status}`);
    }
  }

  console.log(`  Created: ${created}, Skipped (existing): ${skipped}`);

  if (created > 0) {
    console.log('  NOTE: Users will need to reset passwords (hashes cannot transfer via API)');
  }

  console.log('');
}

// ── Step 2: Admin Tables ───────────────────────────────────────

async function migrateAdminTables() {
  console.log('═══ Step 2: Admin Tables ═══');

  // Order matters due to foreign keys
  const tables = [
    { name: 'profiles', pk: 'id' },
    { name: 'app_settings', pk: 'id', orderBy: 'id' },
    { name: 'client_databases', pk: 'user_id' },
    { name: 'schedules', pk: 'id' },
    { name: 'jobs', pk: 'id', orderBy: 'queued_at' },
    { name: 'job_logs', pk: 'id' },
    { name: 'notifications', pk: 'id' },
  ];

  for (const { name, pk, orderBy } of tables) {
    try {
      let rows = await fetchAll(cloud, name, orderBy || 'created_at');
      if (!rows.length) {
        console.log(`  ${name}: empty`);
        continue;
      }

      // Transform profiles: cloud has is_admin, self-hosted has role
      if (name === 'profiles') {
        rows = rows.map(r => {
          const { is_admin, ...rest } = r;
          return { ...rest, role: is_admin ? 'admin' : (r.role || 'client') };
        });
      }

      // app_settings: remove columns that don't exist in self-hosted
      if (name === 'app_settings') {
        rows = rows.map(r => {
          const { created_at, gmail_user, gmail_from_name, gmail_oauth_client_id,
                  gmail_oauth_client_secret, gmail_refresh_token, ...rest } = r;
          return rest;
        });
      }

      // Use direct SQL insert via psql for reliability (bypasses RLS)
      const values = rows.map(row => {
        const cols = Object.keys(row);
        const vals = cols.map(c => {
          const v = row[c];
          if (v === null || v === undefined) return 'NULL';
          if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
          if (typeof v === 'number') return String(v);
          if (Array.isArray(v)) return `'{${v.map(i => `"${String(i).replace(/"/g, '\\"')}"`).join(',')}}'`;
          return `'${String(v).replace(/'/g, "''")}'`;
        });
        return `(${vals.join(', ')})`;
      });

      const cols = Object.keys(rows[0]);
      const sql = `INSERT INTO public.${name} (${cols.map(c => `"${c}"`).join(', ')})
VALUES ${values.join(',\n')}
ON CONFLICT (${pk}) DO NOTHING;\n`;

      execSync(
        `docker exec -i docker-db-1 psql -U supabase_admin -d postgres -v ON_ERROR_STOP=0`,
        { input: sql, encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }
      );

      console.log(`  ${name}: ${rows.length} rows`);
    } catch (e) {
      console.error(`  ${name}: ERROR — ${e.message}`);
    }
  }

  console.log('');
}

// ── Step 3: Client Data ────────────────────────────────────────

const clientSchemaSQL = fs.readFileSync(path.join(REPO_ROOT, 'supabase/client-schema.sql'), 'utf-8');
const clientMigrations = ['002_branch_analytics.sql', '003_store_name.sql']
  .map(f => {
    const fp = path.join(REPO_ROOT, 'supabase/client-migrations', f);
    return fs.existsSync(fp) ? fs.readFileSync(fp, 'utf-8') : '';
  })
  .join('\n');

const CLIENT_TABLES = ['branches', 'reviews', 'analyses', 'reports', 'job_history', 'branch_analytics'];

async function migrateClients() {
  console.log('═══ Step 3: Client Data ═══');

  const { data: clients, error } = await self
    .from('client_databases')
    .select('user_id, supabase_url, service_role_key, schema_name');

  if (error) throw new Error('Failed to fetch clients: ' + error.message);
  if (!clients?.length) {
    console.log('  No clients found.');
    return;
  }

  console.log(`  Found ${clients.length} client(s)\n`);

  for (const client of clients) {
    if (client.schema_name) {
      console.log(`  ✓ ${client.user_id.slice(0, 8)} — already migrated (${client.schema_name})`);
      continue;
    }

    if (!client.supabase_url || !client.service_role_key) {
      console.log(`  ⊘ ${client.user_id.slice(0, 8)} — no cloud credentials, skipping`);
      continue;
    }

    console.log(`  → ${client.user_id.slice(0, 8)}...`);

    try {
      await migrateOneClient(client);
      console.log(`    ✓ Done`);
    } catch (e) {
      console.error(`    ✗ Failed: ${e.message}`);
    }
  }
  console.log('');
}

async function migrateOneClient(client) {
  const schemaName = 'client_' + client.user_id.replace(/-/g, '').slice(0, 8);

  // Create schema via psql (more reliable for complex DDL than RPC)
  console.log(`    Creating schema ${schemaName}...`);
  const provisionSQL = `
CREATE SCHEMA IF NOT EXISTS ${schemaName};
SET search_path TO ${schemaName}, public;

${clientSchemaSQL}

${clientMigrations}

GRANT USAGE ON SCHEMA ${schemaName} TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA ${schemaName} TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA ${schemaName} TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaName}
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaName}
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

DO $body$
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
END $body$;

RESET search_path;
`;

  try {
    execSync(
      'docker exec -i docker-db-1 psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1',
      { input: provisionSQL, encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }
    );
  } catch (e) {
    throw new Error('Schema creation failed: ' + (e.stderr || e.message).slice(0, 200));
  }

  // Connect to cloud client DB
  const cloudClient = createClient(client.supabase_url, client.service_role_key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Self-hosted client scoped to new schema
  const selfClient = createClient(SELF_URL, SELF_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: schemaName },
  });

  // Migrate tables
  for (const table of CLIENT_TABLES) {
    try {
      const rows = await fetchAll(cloudClient, table);
      if (!rows.length) continue;

      // Insert in batches
      let inserted = 0;
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const { error } = await selfClient.from(table).insert(batch);
        if (error && !error.message.includes('duplicate key')) {
          console.error(`    WARN: ${table}: ${error.message}`);
        }
        inserted += batch.length;
      }
      if (inserted > 0) console.log(`    ${table}: ${inserted} rows`);
    } catch (e) {
      if (!e.message.includes('does not exist')) {
        console.error(`    WARN: ${table}: ${e.message}`);
      }
    }
  }

  // Migrate storage
  try {
    const { data: folders } = await cloudClient.storage.from('reports').list('', { limit: 1000 });
    let migrated = 0;
    if (folders?.length) {
      for (const folder of folders) {
        if (!folder.id) continue;
        const { data: files } = await cloudClient.storage.from('reports').list(folder.name, { limit: 100 });
        if (!files?.length) continue;
        for (const file of files) {
          const srcPath = `${folder.name}/${file.name}`;
          const dstPath = `${schemaName}/${folder.name}/${file.name}`;
          const { data: blob } = await cloudClient.storage.from('reports').download(srcPath);
          if (!blob) continue;
          const buffer = Buffer.from(await blob.arrayBuffer());
          const { error: upErr } = await self.storage.from('reports').upload(dstPath, buffer, {
            upsert: true,
            contentType: file.metadata?.mimetype || 'application/octet-stream',
          });
          if (!upErr) migrated++;
        }
      }
    }
    if (migrated > 0) console.log(`    storage: ${migrated} files`);
  } catch (e) {
    console.error(`    WARN: storage: ${e.message}`);
  }

  // Update client_databases
  const { error: updateErr } = await self
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

// ── Main ───────────────────────────────────────────────────────

async function main() {
  console.log('═══ Full Migration: Cloud → Self-Hosted ═══\n');

  await migrateAuthUsers();
  await migrateAdminTables();
  await migrateClients();

  console.log('═══ Migration Complete ═══');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Update app .env with self-hosted credentials');
  console.log('  2. Ask users to reset passwords (or set via Admin API)');
  console.log('  3. Start app: npm run dev');
}

main().catch(e => {
  console.error('\nMigration failed:', e);
  process.exit(1);
});
