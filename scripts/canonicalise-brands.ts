/**
 * Give every branch of one chain the same brand label.
 *
 * Google store names spell a chain inconsistently — "مقهى وايت | White Cafe"
 * beside "وايت كافيه | الخبر" — and deriving a key from each name separately
 * listed them as different brands in the dashboard filter. This decides the
 * label across the whole account and rewrites branches and reviews to match.
 *
 * Only the client's own branches are touched: a competitor's brand comes from
 * the analysis that found it, not from a store name.
 *
 *   npx tsx scripts/canonicalise-brands.ts                  every client
 *   npx tsx scripts/canonicalise-brands.ts shovel@wags.sa   just one
 *   npx tsx scripts/canonicalise-brands.ts --dry-run
 */

import { config } from 'dotenv';
config({ path: '.env' });

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { brandKeyFromStoreName, canonicaliseBrands } = require('../scrapers/gmb-review-sync');

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
      .from('branches').select('id, store_name, brand, brand_key').eq('is_target', true);
    if (error || !branches?.length) { console.log(`${email}: no own branches`); continue; }

    const label: Map<string, string> = canonicaliseBrands(
      branches.map((b: any) => b.store_name).filter(Boolean));

    let changed = 0;
    for (const b of branches) {
      const key = brandKeyFromStoreName(b.store_name);
      const canonical = (key && label.get(key)) || key;
      if (!canonical || (b.brand === canonical && b.brand_key === canonical)) continue;
      changed++;
      if (dryRun) { console.log(`   ${b.store_name} : ${b.brand} → ${canonical}`); continue; }
      await cdb.from('branches').update({ brand: canonical, brand_key: canonical }).eq('id', b.id);
      await cdb.from('reviews').update({ brand: canonical }).eq('branch_id', b.id);
    }

    const after = new Set(
      branches.map((b: any) => {
        const k = brandKeyFromStoreName(b.store_name);
        return (k && label.get(k)) || k;
      }).filter(Boolean));
    console.log(`${email.padEnd(25)} ${dryRun ? 'would change' : 'changed'} ${String(changed).padEnd(4)} → ${after.size} brand(s): ${[...after].join(', ').slice(0, 70)}`);
  }
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
