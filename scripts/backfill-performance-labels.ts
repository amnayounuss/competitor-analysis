/**
 * Relabel stored performance rows with the store name.
 *
 * gbp_metrics.branch_name was filled from branches.branch_name, which holds the
 * city — so a chain with eighteen Riyadh branches showed eighteen rows all
 * called "الرياض". The store name is what every other table shows.
 *
 *   npx tsx scripts/backfill-performance-labels.ts [email] [--dry-run]
 */

import { config } from 'dotenv';
config({ path: '.env' });

(async () => {
  const { adminClient } = await import('../lib/supabase');
  const { clientDbClient, getClientDbCreds } = await import('../lib/client-db');

  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const only = args.find(a => !a.startsWith('--')) || null;

  const admin = adminClient();
  const { data: users } = await admin.auth.admin.listUsers();
  const { data: rows } = await admin.from('client_databases').select('user_id');

  for (const row of rows || []) {
    const email = users.users.find(u => u.id === row.user_id)?.email || row.user_id;
    if (only && email !== only) continue;

    let cdb;
    try { cdb = clientDbClient(await getClientDbCreds(row.user_id)); }
    catch { console.log(`${email}: no client database — skipped`); continue; }

    const { data: branches, error } = await cdb
      .from('branches').select('gmb_location_id, store_name, branch_name')
      .not('gmb_location_id', 'is', null);
    if (error) { console.log(`${email}: ${error.message.slice(0, 50)}`); continue; }

    const label = new Map<string, string>();
    for (const b of branches || []) {
      const name = b.store_name || b.branch_name;
      if (name) label.set(String(b.gmb_location_id), name);
    }
    if (label.size === 0) { console.log(`${email}: no locations`); continue; }

    let changed = 0;
    for (const [locationId, name] of label) {
      const { count } = await cdb
        .from('gbp_metrics')
        .select('id', { count: 'exact', head: true })
        .eq('gmb_location_id', locationId).neq('branch_name', name);
      if (!count) continue;
      changed += count;
      if (!dryRun) {
        await cdb.from('gbp_metrics').update({ branch_name: name }).eq('gmb_location_id', locationId);
      }
    }
    console.log(`${email.padEnd(25)} ${dryRun ? 'would relabel' : 'relabelled'} ${changed} performance row(s) across ${label.size} location(s)`);
  }
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
