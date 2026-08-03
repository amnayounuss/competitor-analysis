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

/**
 * Anything that did not fully transfer. Collected as we go and reprinted at the
 * end, because a 400-line migration log makes it far too easy to miss a single
 * failure line and assume everything came across.
 */
const PROBLEMS = [];

// ── Helpers ────────────────────────────────────────────────────

/**
 * Page through a table using keyset pagination on a unique key.
 *
 * Do NOT go back to .range() + .order('created_at'): created_at is not unique
 * (rows written by one job share a timestamp), so Postgres is free to return
 * tied rows in a different order per query. With offset paging that means
 * pages overlap and rows in between are never fetched — silently losing data.
 * The primary key is unique and stable, so `> lastSeen` cannot skip or repeat.
 */
async function fetchAll(client, table, keyColumn = 'id') {
  const rows = [];
  let last = null;
  while (true) {
    let q = client
      .from(table)
      .select('*')
      .order(keyColumn, { ascending: true })
      .limit(BATCH_SIZE);
    if (last !== null) q = q.gt(keyColumn, last);

    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < BATCH_SIZE) break;
    last = data[data.length - 1][keyColumn];
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

  // Migrate tables.
  //
  // Failures are recorded in PROBLEMS and reprinted at the end. Previously a
  // failed batch still counted toward `inserted`, so a run that dropped every
  // row of a table (e.g. a column present in cloud but missing from
  // client-schema.sql) printed a success line and scrolled past a lone WARN.
  for (const table of CLIENT_TABLES) {
    try {
      const rows = await fetchAll(cloudClient, table);
      if (!rows.length) continue;

      let inserted = 0;
      let failed = 0;
      const reasons = new Set();
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const { error } = await selfClient
          .from(table)
          .upsert(batch, { onConflict: 'id', ignoreDuplicates: true });
        if (error) {
          failed += batch.length;
          reasons.add(error.message.slice(0, 160));
        } else {
          inserted += batch.length;
        }
      }

      const { count: actual } = await selfClient
        .from(table)
        .select('*', { count: 'exact', head: true });

      if (failed) {
        console.error(`    FAIL: ${table}: ${failed}/${rows.length} rows rejected (self-hosted now has ${actual ?? '?'})`);
        for (const r of reasons) console.error(`          ${r}`);
        PROBLEMS.push(`${schemaName}.${table}: ${failed}/${rows.length} rows rejected — ${[...reasons][0]}`);
      } else if (inserted > 0) {
        console.log(`    ${table}: ${inserted} rows (cloud ${rows.length} → self ${actual ?? '?'})`);
        if (typeof actual === 'number' && actual < rows.length) {
          PROBLEMS.push(`${schemaName}.${table}: cloud has ${rows.length} but self-hosted has ${actual}`);
        }
      }
    } catch (e) {
      // Never swallow "does not exist": a missing table or column is exactly
      // the kind of failure that silently loses an entire table.
      console.error(`    FAIL: ${table}: ${e.message}`);
      PROBLEMS.push(`${schemaName}.${table}: ${e.message}`);
    }
  }

  // Migrate storage.
  //
  // storage.list() returns folders (prefixes) with `id: null` and real objects
  // with an id. The previous `if (!folder.id) continue` therefore skipped every
  // job folder at the bucket root, so zero files were ever copied while the run
  // still reported success. Entries with an id are files; entries without are
  // folders to descend into.
  try {
    const { data: entries, error: listErr } = await cloudClient.storage
      .from('reports').list('', { limit: 1000 });
    if (listErr) throw new Error(listErr.message);

    let migrated = 0;
    let failed = 0;

    const copy = async (srcPath, dstPath, mimetype) => {
      const { data: blob, error: dErr } = await cloudClient.storage.from('reports').download(srcPath);
      if (dErr || !blob) { failed++; console.error(`      download failed: ${srcPath}: ${dErr?.message ?? 'empty'}`); return; }
      const buffer = Buffer.from(await blob.arrayBuffer());
      const { error: upErr } = await self.storage.from('reports').upload(dstPath, buffer, {
        upsert: true,
        contentType: mimetype || 'application/octet-stream',
      });
      if (upErr) { failed++; console.error(`      upload failed: ${dstPath}: ${upErr.message}`); return; }
      migrated++;
    };

    for (const entry of entries ?? []) {
      if (entry.id) {
        // A file sitting at the bucket root.
        await copy(entry.name, `${schemaName}/${entry.name}`, entry.metadata?.mimetype);
        continue;
      }
      const { data: files } = await cloudClient.storage
        .from('reports').list(entry.name, { limit: 1000 });
      for (const file of files ?? []) {
        if (!file.id) continue; // nested folder — reports are only one level deep
        await copy(
          `${entry.name}/${file.name}`,
          `${schemaName}/${entry.name}/${file.name}`,
          file.metadata?.mimetype,
        );
      }
    }

    console.log(`    storage: ${migrated} files copied${failed ? `, ${failed} failed` : ''}`);
    if (failed) PROBLEMS.push(`${schemaName} storage: ${failed} files failed to copy`);
    if (migrated === 0 && (entries?.length ?? 0) > 0) {
      PROBLEMS.push(`${schemaName} storage: cloud bucket is not empty but 0 files were copied`);
    }
  } catch (e) {
    console.error(`    FAIL: storage: ${e.message}`);
    PROBLEMS.push(`${schemaName} storage: ${e.message}`);
  }

  // Repoint report download URLs at self-hosted storage. The rows copied from
  // cloud carry that project's public URLs, so without this the app keeps
  // serving Excel/Markdown from the old project and the migration is not
  // actually complete — the downloads die when cloud is shut down.
  try {
    const { data: reports } = await selfClient.from('reports').select('id, job_id, excel_url, report_md_url');
    let repointed = 0;
    for (const r of reports ?? []) {
      const { data: files } = await self.storage.from('reports').list(`${schemaName}/${r.job_id}`, { limit: 1000 });
      if (!files?.length) continue;
      const pick = ext => files.find(f => f.name.endsWith(ext));
      const publicUrl = name =>
        self.storage.from('reports').getPublicUrl(`${schemaName}/${r.job_id}/${name}`).data.publicUrl;

      const patch = {};
      const xlsx = pick('.xlsx'), md = pick('.md');
      if (xlsx) patch.excel_url = publicUrl(xlsx.name);
      if (md) patch.report_md_url = publicUrl(md.name);
      if (!Object.keys(patch).length) continue;

      const { error } = await selfClient.from('reports').update(patch).eq('id', r.id);
      if (error) PROBLEMS.push(`${schemaName}.reports ${r.job_id}: repoint failed — ${error.message}`);
      else repointed++;
    }
    if (repointed) console.log(`    reports: ${repointed} download URLs repointed to self-hosted`);

    const stillCloud = (reports ?? []).length - repointed;
    if (stillCloud > 0) {
      PROBLEMS.push(`${schemaName}.reports: ${stillCloud} report(s) still point at cloud storage`);
    }
  } catch (e) {
    console.error(`    FAIL: repointing report URLs: ${e.message}`);
    PROBLEMS.push(`${schemaName}.reports: ${e.message}`);
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

  if (PROBLEMS.length) {
    console.log('');
    console.error('═══ MIGRATION INCOMPLETE ═══');
    console.error(`${PROBLEMS.length} problem(s) — data did NOT fully transfer:`);
    for (const p of PROBLEMS) console.error(`  ✗ ${p}`);
    console.error('');
    console.error('Do not shut down the cloud projects. Fix the above and re-run;');
    console.error('this script upserts on primary key, so re-running is safe.');
    process.exit(1);
  }

  console.log('═══ Migration Complete ═══');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Update app .env with self-hosted credentials');
  console.log('  2. Rebuild the app — NEXT_PUBLIC_* vars are inlined at build');
  console.log('     time, so a restart alone keeps pointing at cloud');
  console.log('  3. Ask users to reset passwords (or set via Admin API)');
  console.log('  4. Start app: npm run dev');
}

main().catch(e => {
  console.error('\nMigration failed:', e);
  process.exit(1);
});
