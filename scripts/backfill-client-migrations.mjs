/**
 * backfill-client-migrations.mjs
 *
 * Applies every registered client migration to every existing client schema.
 *
 * Provisioning runs the migrations that existed the day a schema was created and
 * never revisits it, so schemas drift apart: a client onboarded months ago has no
 * word-cloud tables, no performance metrics, no branch health views. Nothing
 * errors — the code checks and skips — the feature simply never appears for them.
 *
 * Every client migration is written to be idempotent (IF NOT EXISTS /
 * CREATE OR REPLACE), so running this repeatedly is safe and is the intended way
 * to bring an old schema up to date.
 *
 * Usage:
 *   node scripts/backfill-client-migrations.mjs                 # all schemas
 *   node scripts/backfill-client-migrations.mjs client_1a36f301 # just one
 *   node scripts/backfill-client-migrations.mjs --dry-run
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CONTAINER = process.env.PG_CONTAINER || 'docker-db-1';
const DB_USER   = process.env.PG_USER || 'supabase_admin';
const DB_NAME   = process.env.PG_DB || 'postgres';
const MIG_DIR   = path.join(process.cwd(), 'supabase', 'client-migrations');

const args    = process.argv.slice(2);
const dryRun  = args.includes('--dry-run');
const only    = args.filter(a => a.startsWith('client_'));

function psql(sql) {
  return execFileSync('docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', DB_USER, '-d', DB_NAME, '-tAc', sql],
    { encoding: 'utf8' }).trim();
}

function psqlFile(schema, file) {
  // search_path is set in the same session as the file, so the migration's bare
  // table names resolve into the client's schema.
  return execFileSync('docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', DB_USER, '-d', DB_NAME,
     '-v', 'ON_ERROR_STOP=1', '-q',
     '-c', `SET search_path TO ${schema}, public;`, '-f', '-'],
    { input: fs.readFileSync(file, 'utf8'), encoding: 'utf8' });
}

// Read the ordered list from provisioning rather than globbing, so this applies
// exactly what a new client would get — no more, no less.
const provSrc = fs.readFileSync(path.join(process.cwd(), 'lib', 'provision-client-schema.ts'), 'utf8');
const block = provSrc.slice(provSrc.indexOf('CLIENT_MIGRATIONS = ['), provSrc.indexOf('];', provSrc.indexOf('CLIENT_MIGRATIONS = [')));
const migrations = Array.from(block.matchAll(/'([^']+\.sql)'/g)).map(m => m[1]);

if (migrations.length === 0) {
  console.error('Could not read CLIENT_MIGRATIONS from lib/provision-client-schema.ts');
  process.exit(1);
}

const schemas = only.length
  ? only
  : psql(`SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'client_%' ORDER BY 1`)
      .split('\n').filter(Boolean);

console.log(`${migrations.length} migration(s) × ${schemas.length} schema(s)${dryRun ? '  (dry run)' : ''}\n`);
migrations.forEach(m => console.log('  ·', m));
console.log();

const problems = [];

for (const schema of schemas) {
  process.stdout.write(`${schema}\n`);
  for (const name of migrations) {
    const file = path.join(MIG_DIR, name);
    if (!fs.existsSync(file)) {
      console.log(`   ?  ${name} — file missing, skipped`);
      continue;
    }
    if (dryRun) { console.log(`   ·  ${name}`); continue; }
    try {
      psqlFile(schema, file);
      console.log(`   ok ${name}`);
    } catch (err) {
      const msg = String(err.stderr || err.message).split('\n').filter(Boolean).slice(-2).join(' ');
      console.log(`   XX ${name} — ${msg}`);
      problems.push(`${schema} / ${name}: ${msg}`);
    }
  }
  console.log();
}

if (!dryRun) {
  // A schema PostgREST does not know about is invisible however complete it is,
  // and the FK cache is separate from the schema list — both need a nudge.
  const list = ['public', 'storage', 'graphql_public', ...schemas].join(',');
  psql(`ALTER ROLE authenticator SET pgrst.db_schemas = '${list}'`);
  psql(`NOTIFY pgrst, 'reload config'`);
  psql(`NOTIFY pgrst, 'reload schema'`);
  console.log(`PostgREST now serving: ${list}\n`);
}

if (problems.length) {
  console.error(`${problems.length} problem(s):`);
  problems.forEach(p => console.error('  ' + p));
  process.exit(1);
}
console.log('All client schemas are up to date.');
